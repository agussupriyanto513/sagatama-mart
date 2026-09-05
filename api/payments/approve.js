export default async function handler(req, res) {
  // 1. Pengaturan Header CORS (kompatibel untuk Pi Browser & Vercel)
  const allowedOrigin = process.env.ALLOWED_ORIGIN || '*';
  res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // Handle preflight request CORS dari browser
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Validasi Method
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { paymentId, network } = req.body || {};

  // 2. Validasi Payload
  if (!paymentId) {
    return res.status(400).json({ error: 'paymentId wajib diisi.' });
  }

  // 3. Pemilihan API Key sesuai Network (testnet vs mainnet)
  const rawKey = network === 'testnet'
    ? (process.env.PI_API_KEY_TESTNET || process.env.PI_API_KEY)
    : (process.env.PI_API_KEY_MAINNET || process.env.PI_API_KEY);

  if (!rawKey) {
    console.error(`[approve] PI_API_KEY untuk network="${network}" tidak ditemukan!`);
    return res.status(500).json({ 
      error: `Server config error: API key untuk network "${network}" belum di-set di environment Vercel.` 
    });
  }

  // Auto-trim whitespace tersembunyi
  const piApiKey = rawKey.trim();

  try {
    // 4. Pre-check payment ke Pi Server
    const checkResponse = await fetch(
      `https://api.minepi.com/v2/payments/${paymentId}`,
      { method: 'GET', headers: { Authorization: `Key ${piApiKey}` } }
    );

    if (!checkResponse.ok) {
      const checkData = await checkResponse.json().catch(() => ({}));
      console.error('[approve] Pre-check gagal. Network:', network, '| Status:', checkResponse.status);
      return res.status(400).json({
        error: checkResponse.status === 404
          ? `Payment tidak ditemukan di app ${network || 'mainnet'}. Pastikan API Key cocok dengan App ID tempat transaksi dibuat.`
          : 'Pi menolak permintaan verifikasi status payment.',
        status: checkResponse.status,
        detail: checkData
      });
    }

    // 5. Eksekusi Approve Payment
    const response = await fetch(
      `https://api.minepi.com/v2/payments/${paymentId}/approve`,
      {
        method: 'POST',
        headers: {
          Authorization: `Key ${piApiKey}`,
          'Content-Type': 'application/json'
        }
      }
    );

    const data = await response.json();

    if (!response.ok) {
      console.error('[approve] Approve gagal:', JSON.stringify(data));
      return res.status(400).json({
        error: data?.error_message || data?.error || 'Pi approval failed',
        status: response.status,
        detail: data
      });
    }

    // Berhasil di-approve
    return res.status(200).json(data);

  } catch (err) {
    console.error('[approve] Exception:', err.message);
    return res.status(500).json({ error: err.message });
  }
}