// referral/claim.js
// POST { accessToken, code }  →  { success, sgtBalance, message }
//
// LATAR BELAKANG:
// Sebelumnya claimReferral() di frontend mencoba menulis LANGSUNG ke
// Firestore 'users/{uid}.sgtBalance' untuk kredit bonus 100/200 SGT.
// Ini TIDAK PERNAH berhasil karena rule 'users/{userId}' sengaja mengunci
// "allow update: if false" (saldo hanya boleh diubah lewat backend).
// Sesuai arsitektur yang sudah ada di api/sgt/_lib.js — sumber kebenaran
// saldo SGT adalah 'sgt_wallets/{username}' (kunci = username Pi,
// lowercase), BUKAN uid — endpoint ini memindahkan seluruh proses klaim
// referral (validasi kode, cegah klaim ganda, kredit dua wallet) ke
// server, atomik & idempotent, sama seperti pola di sgt/sync.js.
//
// Dipanggil LANGSUNG dari browser pengklaim (bukan server-to-server),
// makanya identitas diverifikasi lewat accessToken Pi milik pengklaim
// sendiri — bukan x-internal-secret (itu untuk app lain / server lain).

import { setCors, verifyPiToken, walletRef, ledgerRef, ensureWallet, admin, db } from '../sgt/_lib.js';

const CLAIMER_BONUS  = 100;
const REFERRER_BONUS = 200;

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { accessToken, code } = req.body || {};
  const codeInput = (code || '').trim().toUpperCase();
  if (!codeInput || codeInput.length < 4) {
    return res.status(400).json({ error: 'Kode referral tidak valid' });
  }

  const pi = await verifyPiToken(accessToken);
  if (!pi) return res.status(401).json({ error: 'accessToken Pi tidak valid' });

  const claimerUsername = pi.username.trim().toLowerCase();

  try {
    // 1. Ambil data kode dari referral_codes (ditulis client via initReferralCode)
    const codeSnap = await db().collection('referral_codes').doc(codeInput).get();
    if (!codeSnap.exists) return res.status(404).json({ error: 'Kode tidak ditemukan' });
    const refData = codeSnap.data();
    const referrerUsername = (refData.username || '').trim().toLowerCase();
    if (!referrerUsername) {
      return res.status(500).json({ error: 'Data kode referral tidak lengkap' });
    }
    if (referrerUsername === claimerUsername) {
      return res.status(400).json({ error: 'Tidak bisa pakai kode sendiri' });
    }

    // 2. Kunci klaim + catat relasi referral dalam SATU transaksi atomik,
    //    supaya race condition (klik klaim 2x berbarengan) tidak lolos.
    const claimLockRef = db().collection('referral_claims').doc(claimerUsername);
    // Coba ambil firebaseUid terakhir yg tersimpan di doc users/{piUid} —
    // best-effort, dipakai agar client masih bisa baca doc ini langsung
    // dari Firestore (lihat rule referrals di firestore.rules). Kalau
    // tidak ketemu / beda sesi, tidak fatal — endpoint tetap sukses.
    const [claimerUserDoc, referrerUserDoc] = await Promise.all([
      pi.uid ? db().collection('users').doc(pi.uid).get().catch(() => null) : null,
      refData.userId ? db().collection('users').doc(refData.userId).get().catch(() => null) : null
    ]);
    const claimerFbUid  = claimerUserDoc && claimerUserDoc.exists ? claimerUserDoc.data().firebaseUid || null : null;
    const referrerFbUid = referrerUserDoc && referrerUserDoc.exists ? referrerUserDoc.data().firebaseUid || null : null;

    const referralDocRef = db().collection('referrals').doc();

    await db().runTransaction(async (tx) => {
      const lockSnap = await tx.get(claimLockRef);
      if (lockSnap.exists) throw new Error('ALREADY_CLAIMED');

      tx.set(claimLockRef, {
        username: claimerUsername,
        code: codeInput,
        referrerUsername,
        claimedAt: admin.firestore.FieldValue.serverTimestamp()
      });

      tx.set(referralDocRef, {
        refBy: refData.userId || null,
        refByUsername: refData.username || null,
        refByFirebaseUid: referrerFbUid,
        userId: pi.uid || null,
        username: pi.username,
        firebaseUid: claimerFbUid,
        code: codeInput,
        hasTransacted: false,
        bonusGiven: REFERRER_BONUS,
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      });
    });

    // 3. Kredit kedua wallet lewat ledger terpusat (idempotent per txId,
    //    aman kalau request ini di-retry jaringan).
    await Promise.all([ensureWallet(claimerUsername), ensureWallet(referrerUsername)]);
    const claimTag = `referral_claim_${claimerUsername}`;
    const [claimerCredit] = await Promise.all([
      creditWallet(claimerUsername, CLAIMER_BONUS, `${claimTag}_claimer`, 'referral_welcome_bonus'),
      creditWallet(referrerUsername, REFERRER_BONUS, `${claimTag}_referrer`, `referral_bonus_from_${claimerUsername}`)
    ]);

    // 4. Update statistik referrer (best-effort, bukan bagian kritis)
    try {
      await db().collection('user_stats').doc(refData.userId || referrerUsername).set({
        totalReferrals: admin.firestore.FieldValue.increment(1),
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
    } catch (statErr) {
      console.error('[referral/claim] Gagal update user_stats (non-fatal):', statErr.message);
    }

    return res.status(200).json({
      success: true,
      sgtBalance: claimerCredit.balance,
      message: `+${CLAIMER_BONUS} SGT bonus referral! Terima kasih sudah bergabung`
    });
  } catch (err) {
    if (err.message === 'ALREADY_CLAIMED') {
      return res.status(400).json({ error: 'Kamu sudah menggunakan kode referral' });
    }
    console.error('[referral/claim] Error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}

// Kredit wallet lewat ledger terpusat, idempotent lewat txId — pola sama
// persis dengan transaksi di api/sgt/sync.js.
async function creditWallet(username, amount, txId, source) {
  const wRef = walletRef(username);
  const lRef = ledgerRef(txId);
  return db().runTransaction(async (tx) => {
    const ledgerSnap = await tx.get(lRef);
    if (ledgerSnap.exists) {
      const wSnap = await tx.get(wRef);
      return { balance: parseFloat((wSnap.data() || {}).sgtBalance) || 0 };
    }
    const wSnap = await tx.get(wRef);
    const prev = parseFloat((wSnap.data() || {}).sgtBalance) || 0;
    const next = prev + amount;
    tx.set(wRef, { sgtBalance: next, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
    tx.set(lRef, {
      txId, username, type: 'credit', amount, source, balanceAfter: next,
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });
    return { balance: next };
  });
}
