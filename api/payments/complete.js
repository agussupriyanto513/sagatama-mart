export default async function handler(req, res) {
  // CORS — pakai ALLOWED_ORIGIN kalau di-set di Vercel env, fallback ke '*'
  const allowedOrigin = process.env.ALLOWED_ORIGIN || '*';
  res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { paymentId, txid, network } = req.body || {};

  if (!paymentId || !txid) {
    return res.status(400).json({ error: 'paymentId dan txid diperlukan' });
  }

  // Sama seperti approve.js: pilih key sesuai jaringan yang aktif saat
  // payment ini dibuat, supaya complete tidak gagal gara-gara pakai key
  // App yang berbeda dari App tempat payment-nya berasal.
  const rawKey = network === 'testnet'
    ? (process.env.PI_API_KEY_TESTNET || process.env.PI_API_KEY)
    : (process.env.PI_API_KEY_MAINNET || process.env.PI_API_KEY);

  if (!rawKey) {
    console.error(`[complete] PI_API_KEY untuk network="${network}" tidak ditemukan di environment!`);
    return res.status(500).json({ error: `Server config error: API key untuk network "${network}" belum di-set` });
  }

  const piApiKey = rawKey.trim();
  if (piApiKey !== rawKey) {
    console.warn('[complete] PI_API_KEY punya whitespace tersembunyi — auto-trim diterapkan.');
  }

  try {
    const response = await fetch(
      `https://api.minepi.com/v2/payments/${paymentId}/complete`,
      {
        method: 'POST',
        headers: {
          Authorization: `Key ${piApiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ txid })
      }
    );

    const data = await response.json();
    console.log('[complete] network:', network, '| STATUS:', response.status);
    console.log('[complete] RESPONSE:', JSON.stringify(data));

    if (!response.ok) {
      return res.status(400).json({
        error: data?.error_message || data?.error || 'Pi complete failed',
        status: response.status,
        detail: data
      });
    }

    return res.status(200).json(data);

  } catch (err) {
    console.error('[complete] Exception:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
