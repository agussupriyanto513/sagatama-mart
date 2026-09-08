// api/sgt/balance.js
// POST { accessToken }  →  { success, username, sgtBalance }
//
// Selalu verifikasi lewat accessToken Pi (bukan terima username mentah dari
// query string) supaya orang tidak bisa intip saldo Pioneer lain dengan
// menebak-nebak username di URL.
import { setCors, verifyPiToken, walletRef } from './_lib.js';

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { accessToken } = req.body || {};
  if (!accessToken) return res.status(400).json({ error: 'accessToken diperlukan' });

  const pi = await verifyPiToken(accessToken);
  if (!pi.ok) {
    const status = pi.transient ? 503 : 401;
    return res.status(status).json({
      error: pi.transient ? 'Pi Platform API sedang bermasalah, coba lagi' : 'accessToken Pi tidak valid',
      transient: !!pi.transient
    });
  }

  try {
    const ref = walletRef(pi.username);
    const snap = await ref.get();
    const balance = snap.exists ? parseFloat(snap.data().sgtBalance) || 0 : 0;
    return res.status(200).json({ success: true, username: pi.username, sgtBalance: balance });
  } catch (err) {
    console.error('[sgt/balance] Error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
