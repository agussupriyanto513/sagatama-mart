// api/sgt/ensure.js
// POST { accessToken }
//
// Dipanggil dari FRONTEND (bukan server-to-server) setelah Pi.authenticate()
// sukses, di app manapun (Mart, Games, atau Hidayatulamin) — asal ketiganya
// mengarah ke BACKEND_URL yang sama (sagatama-backend.vercel.app).
//
// Endpoint ini:
//  1. Verifikasi accessToken langsung ke Pi Platform API (jangan percaya
//     username/uid yang dikirim mentah dari client).
//  2. Pastikan dokumen sgt_wallets/{username} ada.
//  3. Kembalikan saldo SGT terkini.
//
// Response: { success, username, sgtBalance }
import { setCors, verifyPiToken, ensureWallet } from './_lib.js';

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { accessToken } = req.body || {};
  if (!accessToken) return res.status(400).json({ error: 'accessToken diperlukan' });

  const pi = await verifyPiToken(accessToken);
  if (!pi) return res.status(401).json({ error: 'accessToken Pi tidak valid' });

  try {
    const wallet = await ensureWallet(pi.username);
    return res.status(200).json({
      success: true,
      username: pi.username,
      sgtBalance: parseFloat(wallet.sgtBalance) || 0
    });
  } catch (err) {
    console.error('[sgt/ensure] Error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
