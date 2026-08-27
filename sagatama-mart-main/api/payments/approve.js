export default async function handler(req, res) {
  // CORS — izinkan request dari GitHub Pages atau domain manapun
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { paymentId } = req.body;

  if (!paymentId) {
    return res.status(400).json({ error: 'paymentId diperlukan' });
  }

  // DIAGNOSTIK: log paymentId persis apa adanya (pakai kutip) supaya
  // ketahuan kalau ada spasi/karakter tersembunyi yang ikut terkirim
  // dari frontend.
  console.log('[approve] paymentId diterima (raw):', JSON.stringify(paymentId));
  console.log('[approve] paymentId length:', paymentId.length);

  const rawKey = process.env.PI_API_KEY;
  if (!rawKey) {
    console.error('[approve] PI_API_KEY tidak ditemukan di environment!');
    return res.status(500).json({ error: 'Server config error: PI_API_KEY missing' });
  }

  // DIAGNOSTIK: deteksi spasi/newline tersembunyi di PI_API_KEY, yang sering
  // ke-paste tanpa sengaja dan bikin header Authorization jadi tidak valid.
  const piApiKey = rawKey.trim();
  if (piApiKey !== rawKey) {
    console.warn('[approve] ⚠️ PI_API_KEY punya whitespace/newline tersembunyi! Auto-trim diterapkan. Panjang asli:', rawKey.length, '→ setelah trim:', piApiKey.length);
  }
  // Log 6 karakter pertama saja (aman, tidak membocorkan key penuh) supaya
  // kamu bisa cocokkan ini dengan key yang kamu copy dari Developer Portal.
  console.log('[approve] PI_API_KEY prefix (6 char):', piApiKey.slice(0, 6) + '...', '| panjang:', piApiKey.length);

  try {
    // LANGKAH DIAGNOSTIK BARU: cek dulu status payment ini langsung ke Pi
    // (GET, bukan approve) SEBELUM mencoba approve. Ini akan menunjukkan
    // apakah Pi memang sama sekali tidak kenal payment ini (mengonfirmasi
    // App/Key salah), atau payment-nya ada tapi statusnya sudah berubah
    // (misal sudah di-cancel/expired duluan).
    const checkResponse = await fetch(
      `https://api.minepi.com/v2/payments/${paymentId}`,
      {
        method: 'GET',
        headers: { Authorization: `Key ${piApiKey}` }
      }
    );
    const checkData = await checkResponse.json().catch(() => ({}));
    console.log('[approve] CEK STATUS dulu — STATUS:', checkResponse.status, '| RESPONSE:', JSON.stringify(checkData));

    if (!checkResponse.ok) {
      // Kalau GET saja sudah gagal "not found", ini konfirmasi kuat:
      // App/Key yang dipakai server TIDAK melihat payment ini sama sekali —
      // artinya App URL atau PI_API_KEY tidak cocok dengan App yang
      // sebenarnya dipakai Pi Browser untuk membuat payment ini.
      console.error('[approve] ❌ Payment tidak ditemukan bahkan lewat GET biasa. Ini konfirmasi App/Key mismatch, bukan soal timing/retry.');
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
    console.log('[approve] STATUS:', response.status);
    console.log('[approve] RESPONSE:', JSON.stringify(data));

    if (!response.ok) {
      return res.status(400).json({
        error: 'Pi approval failed',
        status: response.status,
        detail: data,
        // Info tambahan untuk debugging — aman ditampilkan, tidak berisi secret
        debug: {
          paymentIdLength: paymentId.length,
          apiKeyPrefix: piApiKey.slice(0, 6),
          preCheckStatus: checkResponse.status,
          preCheckOk: checkResponse.ok
        }
      });
    }

    return res.status(200).json(data);

  } catch (err) {
    console.error('[approve] Exception:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
