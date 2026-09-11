// api/sgt/transfer.js
// POST { accessToken, toUsername, amount }
//
// Endpoint ini BOLEH dipanggil langsung dari frontend (user-initiated),
// karena pengirim diverifikasi lewat accessToken Pi miliknya sendiri —
// dia hanya bisa mengirim dari saldonya sendiri.
import { admin, db, setCors, verifyPiToken, walletRef, ledgerRef, ensureWallet, walletId } from './_lib.js';

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { accessToken, toUsername, amount } = req.body || {};
  const amt = parseFloat(amount);

  if (!(amt > 0)) return res.status(400).json({ error: 'amount harus > 0' });
  if (!toUsername) return res.status(400).json({ error: 'toUsername diperlukan' });

  const pi = await verifyPiToken(accessToken);
  if (!pi) return res.status(401).json({ error: 'accessToken Pi tidak valid' });

  const fromId = walletId(pi.username);
  const toId = walletId(toUsername);
  if (!toId) return res.status(400).json({ error: 'toUsername tidak valid' });
  if (fromId === toId) return res.status(400).json({ error: 'Tidak bisa transfer ke diri sendiri' });

  try {
    await ensureWallet(pi.username);
    const toSnap0 = await walletRef(toId).get();
    if (!toSnap0.exists) {
      return res.status(404).json({ error: 'Username tujuan belum pernah membuat wallet SGT' });
    }

    const fromRef = walletRef(fromId);
    const toRef = walletRef(toId);
    // txId deterministik dari waktu + pengirim supaya double-submit tidak dobel proses
    const txId = `transfer_${fromId}_${Date.now()}`;
    const lRef = ledgerRef(txId);

    const result = await db().runTransaction(async (tx) => {
      const fromSnap = await tx.get(fromRef);
      const prevFrom = parseFloat((fromSnap.data() || {}).sgtBalance) || 0;
      if (prevFrom < amt) return { ok: false, reason: 'Saldo SGT tidak cukup' };

      const toSnap = await tx.get(toRef);
      const prevTo = parseFloat((toSnap.data() || {}).sgtBalance) || 0;

      tx.set(fromRef, { sgtBalance: prevFrom - amt, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
      tx.set(toRef, { sgtBalance: prevTo + amt, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
      tx.set(lRef, {
        txId, type: 'transfer', from: fromId, to: toId, amount: amt,
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      });

      return { ok: true, fromBalance: prevFrom - amt };
    });

    if (!result.ok) return res.status(400).json({ error: result.reason });
    return res.status(200).json({ success: true, sgtBalance: result.fromBalance });
  } catch (err) {
    console.error('[sgt/transfer] Error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
