// api/sgt/debit.js
// POST (server-to-server, header X-Internal-Secret) {
//   username, amount, txId, source, meta?, allowNegative? (default false)
// }
//
// Sama seperti credit.js tapi mengurangi saldo. Menolak transaksi jika
// saldo tidak cukup (kecuali allowNegative=true, dipakai kalau memang ada
// kasus sengaja mis. penalti admin).
import { admin, db, setCors, checkInternalSecret, walletRef, ledgerRef, ensureWallet } from './_lib.js';

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  if (!checkInternalSecret(req)) {
    return res.status(403).json({ error: 'Forbidden: internal secret tidak valid' });
  }

  const { username, amount, txId, source, meta, allowNegative } = req.body || {};
  const amt = parseFloat(amount);

  if (!username) return res.status(400).json({ error: 'username diperlukan' });
  if (!txId) return res.status(400).json({ error: 'txId diperlukan (untuk idempotensi)' });
  if (!(amt > 0)) return res.status(400).json({ error: 'amount harus > 0' });
  if (!source) return res.status(400).json({ error: 'source diperlukan (asal debit)' });

  try {
    await ensureWallet(username);
    const wRef = walletRef(username);
    const lRef = ledgerRef(txId);

    const result = await db().runTransaction(async (tx) => {
      const ledgerSnap = await tx.get(lRef);
      if (ledgerSnap.exists) {
        const wSnap = await tx.get(wRef);
        return { ok: true, balance: parseFloat((wSnap.data() || {}).sgtBalance) || 0 };
      }

      const wSnap = await tx.get(wRef);
      const prev = parseFloat((wSnap.data() || {}).sgtBalance) || 0;

      if (!allowNegative && prev < amt) {
        return { ok: false, balance: prev, reason: 'Saldo SGT tidak cukup' };
      }

      const next = prev - amt;

      tx.set(wRef, {
        sgtBalance: next,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });

      tx.set(lRef, {
        txId, username: username.trim().toLowerCase(), type: 'debit',
        amount: amt, source, meta: meta || null,
        balanceAfter: next,
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      });

      return { ok: true, balance: next };
    });

    if (!result.ok) {
      return res.status(400).json({ error: result.reason, sgtBalance: result.balance });
    }
    return res.status(200).json({ success: true, username, sgtBalance: result.balance });
  } catch (err) {
    console.error('[sgt/debit] Error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
