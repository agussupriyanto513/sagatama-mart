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
// 🔒 FIX: sebelumnya kode di sini memakai `if (!pi) return 401`. Tapi sejak
// verifyPiToken() diubah untuk SELALU mengembalikan objek (bukan `null`,
// lihat catatan di _lib.js), objek itu selalu truthy — jadi pengecekan
// `!pi` tidak pernah bernilai true, dan token yang tidak valid tidak
// pernah benar-benar ditolak di titik ini (baru gagal belakangan dengan
// error 500 yang membingungkan, saat username undefined dipakai). Sekarang
// diperbaiki jadi mengecek `pi.ok`, sama seperti di balance.js/sync.js.
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
  if (!pi.ok) {
    const status = pi.transient ? 503 : 401;
    return res.status(status).json({
      error: pi.transient ? 'Pi Platform API sedang bermasalah, coba lagi' : 'accessToken Pi tidak valid',
      transient: !!pi.transient
    });
  }

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
