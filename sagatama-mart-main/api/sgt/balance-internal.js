// api/sgt/balance-internal.js
// POST (server-to-server, header X-Internal-Secret) { username }
//
// Beda dengan balance.js: endpoint itu untuk FRONTEND yang baru saja
// Pi.authenticate() dan punya accessToken segar. Endpoint INI untuk
// backend app lain yang identitas usernya sudah terverifikasi lewat
// jalur lain (mis. Hidayatulamin sudah tahu piUsername dari profil user
// yang login ke sistem sekolahnya sendiri), sehingga tidak selalu punya
// accessToken Pi yang fresh saat halaman dibuka.
//
// Karena endpoint ini tidak diverifikasi lewat Pi, WAJIB dilindungi
// internal secret — jangan pernah dipanggil langsung dari browser.
import { setCors, checkInternalSecret, walletRef } from './_lib.js';

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  if (!checkInternalSecret(req)) {
    return res.status(403).json({ error: 'Forbidden: internal secret tidak valid' });
  }

  const { username } = req.body || {};
  if (!username) return res.status(400).json({ error: 'username diperlukan' });

  try {
    const ref = walletRef(username);
    if (!ref) return res.status(400).json({ error: 'username tidak valid' });
    const snap = await ref.get();
    const balance = snap.exists ? parseFloat(snap.data().sgtBalance) || 0 : 0;
    return res.status(200).json({ success: true, username, sgtBalance: balance });
  } catch (err) {
    console.error('[sgt/balance-internal] Error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
