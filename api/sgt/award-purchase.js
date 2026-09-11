// api/sgt/award-purchase.js
// POST { accessToken, paymentId, network? }
//   → { success, sgtBalance, awarded, feeAmount, sosialAmount, alreadyProcessed }
//
// 🔒 BARU (SECURITY FIX) — menggantikan pola lama di mana browser
// menghitung sendiri reward SGT (base + tier bonus) lalu mengirim hasilnya
// sebagai `delta` mentah ke /api/sgt/sync. Itu memungkinkan siapa pun yang
// sudah login sah lewat Pi (accessToken valid milik akun sendiri) mengirim
// `delta` sembarang lewat curl/Postman dan mencetak SGT tanpa batas —
// TANPA benar-benar membeli apa pun.
//
// Endpoint ini membalik logikanya:
//   1. Verifikasi accessToken ke Pi Platform → dapatkan username asli.
//   2. Verifikasi paymentId LANGSUNG ke Pi Platform API (bukan dari field
//      apa pun yang dikirim client) → pastikan pembayaran itu nyata dan
//      sudah selesai (developer_completed / transaction_verified).
//   3. Hitung reward SGT SEPENUHNYA DI SERVER dari jumlah Pi yang
//      tercatat di Pi Platform (bukan dari angka yang diklaim client),
//      pakai tier user yang dibaca dari saldo tercatat SAAT INI di server.
//   4. Kredit atomik + idempotent lewat txId = `mart_cashback_${paymentId}`,
//      jadi retry/double-submit tidak pernah menggandakan reward.
//
// Client tinggal panggil endpoint ini dengan { accessToken, paymentId,
// network } setelah payment sukses — TIDAK PERLU dan TIDAK BOLEH lagi
// mengirim jumlah SGT dari browser.
import {
  admin, db, setCors, verifyPiToken, verifyPiPayment,
  walletRef, ledgerRef, ensureWallet
} from './_lib.js';

// Samakan dengan tokenomics yang sebelumnya ada di public/index.html —
// tapi sekarang jadi sumber kebenaran cuma satu: di server ini.
const SGT_TIERS = [
  { name: 'Bronze',   min: 0,    max: 499,      rate: 0.05 },
  { name: 'Silver',   min: 500,  max: 1999,     rate: 0.08 },
  { name: 'Gold',     min: 2000, max: 4999,     rate: 0.12 },
  { name: 'Platinum', min: 5000, max: Infinity, rate: 0.15 }
];
const SGT_FEE_RATE        = 0.03;   // 3% ke fee pool (dana APY staking)
const SGT_SOSIAL_RATE     = 0.05;   // 5% ke Baitul Maal / Yayasan
const SGT_HARD_CAP        = 100_000_000;
const DEFAULT_RATE_PER_PI = 100;    // dipakai kalau sgt_config/rate belum diset
const MIN_PURCHASE_PI     = 0.1;

function tierFor(balance) {
  return SGT_TIERS.find(t => balance >= t.min && balance <= t.max) || SGT_TIERS[0];
}

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { accessToken, paymentId, network } = req.body || {};
  if (!paymentId) return res.status(400).json({ error: 'paymentId diperlukan' });

  const pi = await verifyPiToken(accessToken);
  if (!pi.ok) {
    const status = pi.transient ? 503 : 401;
    return res.status(status).json({
      error: pi.transient ? 'Pi Platform API sedang bermasalah, coba lagi' : 'accessToken Pi tidak valid',
      transient: !!pi.transient
    });
  }

  // 🔒 Titik kunci: jangan pernah percaya jumlah/amount dari body request.
  // Ambil kebenaran langsung dari Pi Platform berdasarkan paymentId.
  const payVerify = await verifyPiPayment(paymentId, network);
  if (!payVerify.ok) {
    const status = payVerify.transient ? 503 : 400;
    return res.status(status).json({
      error: 'Pembayaran belum terverifikasi selesai di Pi Platform',
      reason: payVerify.reason,
      transient: !!payVerify.transient
    });
  }

  const piAmount = parseFloat(payVerify.data?.amount) || 0;
  if (piAmount < MIN_PURCHASE_PI) {
    return res.status(200).json({ success: true, awarded: 0, note: 'Di bawah minimum reward' });
  }

  const txId = `mart_cashback_${paymentId}`;

  try {
    await ensureWallet(pi.username);
    const wRef      = walletRef(pi.username);
    const lRef      = ledgerRef(txId);
    const supplyRef = db().collection('sgt_config').doc('supply');
    const rateRef   = db().collection('sgt_config').doc('rate');

    const result = await db().runTransaction(async (tx) => {
      const ledgerSnap = await tx.get(lRef);
      if (ledgerSnap.exists) {
        // Sudah pernah diproses (retry/double-submit) — jangan kredit dua kali.
        const wSnap = await tx.get(wRef);
        const prev = ledgerSnap.data() || {};
        return {
          alreadyProcessed: true,
          balance: parseFloat((wSnap.data() || {}).sgtBalance) || 0,
          awarded: prev.amount || 0,
          feeAmount: prev.meta?.feeAmount || 0,
          sosialAmount: prev.meta?.sosialAmt || 0
        };
      }

      const wSnap = await tx.get(wRef);
      const prevBalance = parseFloat((wSnap.data() || {}).sgtBalance) || 0;

      const rateSnap = await tx.get(rateRef);
      const ratePerPi = (rateSnap.exists && rateSnap.data().mintRate > 0)
        ? rateSnap.data().mintRate
        : DEFAULT_RATE_PER_PI;

      const tier      = tierFor(prevBalance);
      const baseSGT   = Math.floor(piAmount * ratePerPi);
      const tierBonus = Math.floor(baseSGT * tier.rate);
      const feeAmount = Math.floor(baseSGT * SGT_FEE_RATE);
      const sosialAmt = Math.floor(baseSGT * SGT_SOSIAL_RATE);
      let userShare   = (baseSGT - feeAmount - sosialAmt) + tierBonus;

      if (userShare <= 0) {
        return { balance: prevBalance, awarded: 0, feeAmount: 0, sosialAmount: 0 };
      }

      // Hard cap supply — dihitung & ditulis di SERVER (dulu ini juga
      // bisa ditulis langsung dari browser, sekarang tidak lagi perlu,
      // dan tetap konsisten karena satu transaksi Firestore yang sama).
      const supplySnap  = await tx.get(supplyRef);
      const circulating = supplySnap.exists ? (supplySnap.data().circulating || 0) : 0;
      let totalMint = userShare + feeAmount + sosialAmt;

      if (circulating + totalMint > SGT_HARD_CAP) {
        const remaining = Math.max(0, SGT_HARD_CAP - circulating);
        if (remaining <= 0) {
          return { balance: prevBalance, awarded: 0, feeAmount: 0, sosialAmount: 0, hardCapHit: true };
        }
        const ratio = remaining / totalMint;
        userShare = Math.floor(userShare * ratio);
        totalMint = remaining;
      }

      const nextBalance = prevBalance + userShare;

      tx.set(wRef, {
        sgtBalance: nextBalance,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });

      tx.set(lRef, {
        txId, username: pi.username, type: 'credit', amount: userShare,
        source: 'mart_cashback',
        meta: { paymentId, piAmount, tier: tier.name, baseSGT, tierBonus, feeAmount, sosialAmt },
        balanceAfter: nextBalance,
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      });

      tx.set(supplyRef, {
        circulating: circulating + totalMint,
        hardCap: SGT_HARD_CAP,
        lastMintAt: admin.firestore.FieldValue.serverTimestamp(),
        lastMintRecipient: pi.username
      }, { merge: true });

      return { balance: nextBalance, awarded: userShare, feeAmount, sosialAmount: sosialAmt };
    });

    return res.status(200).json({
      success: true,
      sgtBalance: result.balance,
      awarded: result.awarded,
      feeAmount: result.feeAmount || 0,
      sosialAmount: result.sosialAmount || 0,
      alreadyProcessed: !!result.alreadyProcessed
    });
  } catch (err) {
    console.error('[sgt/award-purchase] Error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
