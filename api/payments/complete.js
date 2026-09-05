export default async function handler(req, res) {
  // 1. Pengaturan Header CORS (sama seperti approve.js)
  const allowedOrigin = process.env.ALLOWED_ORIGIN || '*';
  res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { paymentId, txid, network } = req.body || {};

  // 2. Validasi Payload
  if (!paymentId) {
    return res.status(400).json({ error: 'paymentId wajib diisi.' });
  }
  if (!txid) {
    return res.status(400).json({ error: 'txid wajib diisi.' });
  }

  // 3. Pemilihan API Key sesuai Network (testnet vs mainnet) — sama seperti approve.js
  const rawKey = network === 'testnet'
    ? (process.env.PI_API_KEY_TESTNET || process.env.PI_API_KEY)
    : (process.env.PI_API_KEY_MAINNET || process.env.PI_API_KEY);

  if (!rawKey) {
    console.error(`[complete] PI_API_KEY untuk network="${network}" tidak ditemukan!`);
    return res.status(500).json({
      error: `Server config error: API key untuk network "${network}" belum di-set di environment Vercel.`
    });
  }

  const piApiKey = rawKey.trim();

  try {
    // 4. Eksekusi Complete Payment ke Pi Server
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

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      console.error('[complete] Complete gagal:', JSON.stringify(data));
      return res.status(400).json({
        error: data?.error_message || data?.error || 'Pi completion failed',
        status: response.status,
        detail: data
      });
    }

    // Berhasil di-complete
    return res.status(200).json(data);

  } catch (err) {
    console.error('[complete] Exception:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
