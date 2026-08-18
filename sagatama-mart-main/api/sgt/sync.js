// api/sgt/sync.js
// POST { accessToken, delta, txId? }  →  { success, sgtBalance }
//
// Dipakai KHUSUS oleh frontend Mart sendiri (public/index.html) untuk
// menyinkronkan saldo SGT lokal (yang berubah lewat gameplay/belanja di
// dalam satu sesi browser) ke ledger pusat, TANPA meng-expose
// SGT_INTERNAL_SECRET ke browser.
//
// `delta` boleh positif (nambah, mis. menang game / cashback) atau
// negatif (kurang, mis. kalah taruhan / beli item) — endpoint ini yang
// menerjemahkan ke credit/debit ke ledger pusat.
import { setCors, verifyPiToken, walletRef, ensureWallet, admin, db, ledgerRef } from './_lib.js';

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { accessToken, delta, txId } = req.body || {};
  const d = parseFloat(delta);
  if (isNaN(d)) return res.status(400).json({ error: 'delta tidak valid' });

  const pi = await verifyPiToken(accessToken);
  if (!pi) return res.status(401).json({ error: 'accessToken Pi tidak valid' });

  try {
    await ensureWallet(pi.username);
    if (d === 0) {
      const snap = await walletRef(pi.username).get();
      return res.status(200).json({ success: true, sgtBalance: parseFloat(snap.data().sgtBalance) || 0 });
    }

    const finalTxId = txId || `mart_sync_${pi.username}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const wRef = walletRef(pi.username);
    const lRef = ledgerRef(finalTxId);

    const result = await db().runTransaction(async (tx) => {
      const ledgerSnap = await tx.get(lRef);
      if (ledgerSnap.exists) {
        const wSnap = await tx.get(wRef);
        return { ok: true, balance: parseFloat((wSnap.data() || {}).sgtBalance) || 0 };
      }
      const wSnap = await tx.get(wRef);
      const prev = parseFloat((wSnap.data() || {}).sgtBalance) || 0;
      if (d < 0 && prev < -d) {
        return { ok: false, balance: prev, reason: 'Saldo SGT tidak cukup' };
      }
      const next = prev + d;
      tx.set(wRef, { sgtBalance: next, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
      tx.set(lRef, {
        txId: finalTxId, username: pi.username, type: d > 0 ? 'credit' : 'debit',
        amount: Math.abs(d), source: 'mart_gameplay_sync', balanceAfter: next,
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      });
      return { ok: true, balance: next };
    });

    if (!result.ok) return res.status(400).json({ error: result.reason, sgtBalance: result.balance });
    return res.status(200).json({ success: true, sgtBalance: result.balance });
  } catch (err) {
    console.error('[sgt/sync] Error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
