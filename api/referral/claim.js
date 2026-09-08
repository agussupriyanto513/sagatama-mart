// api/referral/claim.js
// POST { accessToken, code } → { success, sgtBalance, message }
//
// CATATAN: file ini direkonstruksi ulang (aslinya sempat terhapus),
// disusun mengikuti kontrak yang sudah dipakai claimReferral() di
// index.html — payload, bentuk response, dan nama koleksi Firestore
// (referral_codes, referral_claims, referrals) disamakan persis supaya
// tidak perlu ubah kode frontend.
//
// Alur:
// 1. Verifikasi accessToken Pi → dapatkan username asli si pengklaim
//    (jangan percaya username mentah dari client).
// 2. Idempotency: referral_claims/{usernameLower} dipakai sebagai penanda
//    "sudah pernah klaim" — dicek di luar transaksi (biar cepat menolak
//    double-klik) DAN di dalam transaksi (biar aman dari race condition).
// 3. Cari pemilik kode di referral_codes/{CODE}. Tolak kalau kode sendiri.
// 4. Kredit SGT ke kedua pihak lewat sgt_wallets (kunci = username Pi,
//    SAMA seperti /api/sgt/sync & /api/sgt/balance) + catat di sgt_ledger
//    supaya konsisten dengan seluruh sistem SGT terpusat.
// 5. Tulis referrals/{claimer_referrer} untuk daftar teman & statistik
//    yang dibaca loadReferralData() di frontend (field `refBy` diisi
//    userId pemilik kode, sesuai query where('refBy','==',currentUser.uid)).

import {
  admin, db, walletRef, ledgerRef,
  verifyPiToken, setCors, ensureWallet
} from '../sgt/_lib.js';

const CLAIMER_BONUS  = 100; // sesuai teks toast di index.html ("+100 SGT bonus referral")
const REFERRER_BONUS = 200; // sesuai fallback tampilan "+200 SGT" di daftar teman

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { accessToken, code } = req.body || {};
  if (!accessToken) return res.status(400).json({ error: 'accessToken diperlukan' });
  if (!code || typeof code !== 'string') {
    return res.status(400).json({ error: 'code diperlukan' });
  }

  const pi = await verifyPiToken(accessToken);
  if (!pi) return res.status(401).json({ error: 'accessToken Pi tidak valid' });

  const claimerUsernameLower = pi.username.trim().toLowerCase();
  const codeNormalized = code.trim().toUpperCase();

  try {
    // Cek cepat di luar transaksi — supaya double-klik langsung ditolak
    // tanpa perlu buka transaksi Firestore.
    const claimRef = db().collection('referral_claims').doc(claimerUsernameLower);
    const existingClaim = await claimRef.get();
    if (existingClaim.exists) {
      return res.status(400).json({ error: 'Kamu sudah pernah klaim kode referral sebelumnya' });
    }

    // Cari pemilik kode
    const codeSnap = await db().collection('referral_codes').doc(codeNormalized).get();
    if (!codeSnap.exists) {
      return res.status(400).json({ error: 'Kode referral tidak ditemukan' });
    }
    const codeData = codeSnap.data();
    const referrerUsername = codeData.username || '';
    const referrerUsernameLower = referrerUsername.trim().toLowerCase();

    if (!referrerUsernameLower) {
      return res.status(400).json({ error: 'Data pemilik kode referral tidak valid' });
    }
    if (referrerUsernameLower === claimerUsernameLower) {
      return res.status(400).json({ error: 'Tidak bisa memakai kode referral sendiri' });
    }

    // Pastikan kedua wallet ada sebelum masuk transaksi
    await ensureWallet(pi.username);
    await ensureWallet(referrerUsername);

    const claimerWalletRef  = walletRef(pi.username);
    const referrerWalletRef = walletRef(referrerUsername);
    const claimerLedgerRef  = ledgerRef(`referral_claim_${claimerUsernameLower}`);
    const referrerLedgerRef = ledgerRef(`referral_bonus_${claimerUsernameLower}_to_${referrerUsernameLower}`);
    const referralDocRef    = db().collection('referrals').doc(`${claimerUsernameLower}_${referrerUsernameLower}`);

    const result = await db().runTransaction(async (tx) => {
      // Cek idempotency SEKALI LAGI di dalam transaksi (aman dari race condition
      // kalau dua request datang nyaris bersamaan).
      const claimSnap = await tx.get(claimRef);
      if (claimSnap.exists) {
        return { alreadyClaimed: true };
      }

      const claimerSnap  = await tx.get(claimerWalletRef);
      const referrerSnap = await tx.get(referrerWalletRef);

      const claimerPrev  = parseFloat((claimerSnap.data()  || {}).sgtBalance) || 0;
      const referrerPrev = parseFloat((referrerSnap.data() || {}).sgtBalance) || 0;

      const claimerNext  = claimerPrev  + CLAIMER_BONUS;
      const referrerNext = referrerPrev + REFERRER_BONUS;

      tx.set(claimerWalletRef, {
        sgtBalance: claimerNext,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });

      tx.set(referrerWalletRef, {
        sgtBalance: referrerNext,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });

      tx.set(claimerLedgerRef, {
        txId: `referral_claim_${claimerUsernameLower}`,
        username: pi.username,
        type: 'credit',
        amount: CLAIMER_BONUS,
        source: 'referral_claim_bonus',
        balanceAfter: claimerNext,
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      });

      tx.set(referrerLedgerRef, {
        txId: `referral_bonus_${claimerUsernameLower}_to_${referrerUsernameLower}`,
        username: referrerUsername,
        type: 'credit',
        amount: REFERRER_BONUS,
        source: 'referral_referrer_bonus',
        balanceAfter: referrerNext,
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      });

      // Penanda "sudah klaim" — dibaca client via getDoc(doc(db,'referral_claims',usernameLower))
      tx.set(claimRef, {
        code: codeNormalized,
        claimedBy: pi.username,
        referrer: referrerUsername,
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      });

      // Entri untuk daftar teman & statistik di tab Referral (loadReferralData)
      tx.set(referralDocRef, {
        refBy: codeData.userId || null,
        refByUsername: referrerUsername,
        username: pi.username,
        code: codeNormalized,
        hasTransacted: false,
        bonusGiven: REFERRER_BONUS,
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });

      return { alreadyClaimed: false, sgtBalance: claimerNext };
    });

    if (result.alreadyClaimed) {
      return res.status(400).json({ error: 'Kamu sudah pernah klaim kode referral sebelumnya' });
    }

    return res.status(200).json({
      success: true,
      sgtBalance: result.sgtBalance,
      message: `🎁 +${CLAIMER_BONUS} SGT bonus referral! Terima kasih sudah bergabung`
    });
  } catch (err) {
    console.error('[referral/claim] Error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
