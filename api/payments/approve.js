export default async function handler(req, res) {
  // CORS — pakai ALLOWED_ORIGIN kalau di-set di Vercel env, fallback ke '*'
  // supaya tetap kompatibel dengan Pi Browser in-app webview.
  const allowedOrigin = process.env.ALLOWED_ORIGIN || '*';
  res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { paymentId, network } = req.body || {};

  if (!paymentId) {
    return res.status(400).json({ error: 'paymentId diperlukan' });
  }

  // Pilih key sesuai jaringan yang dipakai frontend saat itu (testnet/mainnet).
  // App Testnet dan App Mainnet di Pi Developer Portal punya API key yang
  // BERBEDA — pakai key yang salah = Pi selalu menolak approve, meski
  // kodenya sendiri benar. Kalau PI_API_KEY_TESTNET / PI_API_KEY_MAINNET
  // belum di-set di Vercel, fallback ke PI_API_KEY lama (kompatibel dengan
  // setup sebelumnya).
  const rawKey = network === 'testnet'
    ? (process.env.PI_API_KEY_TESTNET || process.env.PI_API_KEY)
    : (process.env.PI_API_KEY_MAINNET || process.env.PI_API_KEY);

  if (!rawKey) {
    console.error(`[approve] PI_API_KEY untuk network="${network}" tidak ditemukan di environment!`);
    return res.status(500).json({ error: `Server config error: API key untuk network "${network}" belum di-set` });
  }

  // Auto-trim: whitespace/newline tersembunyi di PI_API_KEY sering ke-paste
  // tanpa sengaja dan bikin header Authorization jadi tidak valid.
  const piApiKey = rawKey.trim();
  if (piApiKey !== rawKey) {
    console.warn('[approve] PI_API_KEY punya whitespace tersembunyi — auto-trim diterapkan.');
  }

  try {
    // Cek dulu (GET, bukan approve) apakah Pi mengenal payment ini di App
    // yang sama dengan pemilik PI_API_KEY ini. Kalau 404 di sini, approve
    // pasti akan gagal juga — jadi langsung dihentikan dengan pesan yang
    // jelas, tanpa perlu memanggil endpoint approve yang sia-sia.
    const checkResponse = await fetch(
      `https://api.minepi.com/v2/payments/${paymentId}`,
      { method: 'GET', headers: { Authorization: `Key ${piApiKey}` } }
    );

    if (!checkResponse.ok) {
      const checkData = await checkResponse.json().catch(() => ({}));
      console.error('[approve] Payment tidak dikenali oleh App/Key ini. Network:', network, '| Status:', checkResponse.status, '| Response:', JSON.stringify(checkData));
      return res.status(400).json({
        error: checkResponse.status === 404
          ? `Payment tidak ditemukan di app ${network || 'mainnet'} — PI_API_KEY untuk network ini kemungkinan tidak cocok dengan app yang membuat payment.`
          : 'Pi menolak permintaan status payment',
        status: checkResponse.status,
        detail: checkData
      });
    }

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
    console.log('[approve] network:', network, '| STATUS:', response.status);

    if (!response.ok) {
      console.error('[approve] Approve gagal:', JSON.stringify(data));
      return res.status(400).json({
        error: data?.error_message || data?.error || 'Pi approval failed',
        status: response.status,
        detail: data
      });
    }

    return res.status(200).json(data);

  } catch (err) {
    console.error('[approve] Exception:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
