// api/sgt/credit.js
// POST (server-to-server, header X-Internal-Secret) {
//   username, amount, txId, source, meta?
// }
//
// `source` contoh: 'mart_cashback', 'games_win', 'games_topup',
//                   'hidayatulamin_spp_bonus', 'admin_manual'
// `txId` HARUS unik per kejadian nyata (mis. paymentId Pi, session_id game,
// atau `${app}_${orderId}`) — dipakai untuk mencegah double-credit kalau
// request di-retry.
//
// Endpoint ini TIDAK boleh dipanggil langsung dari browser Pioneer —
// hanya dari backend Mart/Games/Hidayatulamin sendiri, supaya amount tidak
// bisa dipalsukan dari sisi client.
import { admin, db, setCors, checkInternalSecret, walletRef, ledgerRef, ensureWallet } from './_lib.js';

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  if (!checkInternalSecret(req)) {
    return res.status(403).json({ error: 'Forbidden: internal secret tidak valid' });
  }

  const { username, amount, txId, source, meta } = req.body || {};
  const amt = parseFloat(amount);

  if (!username) return res.status(400).json({ error: 'username diperlukan' });
  if (!txId) return res.status(400).json({ error: 'txId diperlukan (untuk idempotensi)' });
  if (!(amt > 0)) return res.status(400).json({ error: 'amount harus > 0' });
  if (!source) return res.status(400).json({ error: 'source diperlukan (asal kredit)' });

  try {
    await ensureWallet(username);
    const wRef = walletRef(username);
    const lRef = ledgerRef(txId);

    const newBalance = await db().runTransaction(async (tx) => {
      const ledgerSnap = await tx.get(lRef);
      if (ledgerSnap.exists) {
        // Sudah pernah diproses — jangan kredit dua kali, kembalikan saldo saat ini
        const wSnap = await tx.get(wRef);
        return parseFloat((wSnap.data() || {}).sgtBalance) || 0;
      }

      const wSnap = await tx.get(wRef);
      const prev = parseFloat((wSnap.data() || {}).sgtBalance) || 0;
      const next = prev + amt;

      tx.set(wRef, {
        sgtBalance: next,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });

      tx.set(lRef, {
        txId, username: username.trim().toLowerCase(), type: 'credit',
        amount: amt, source, meta: meta || null,
        balanceAfter: next,
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      });

      return next;
    });

    return res.status(200).json({ success: true, username, sgtBalance: newBalance });
  } catch (err) {
    console.error('[sgt/credit] Error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
