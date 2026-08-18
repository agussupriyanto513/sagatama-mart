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

  if (!process.env.PI_API_KEY) {
    console.error('[approve] PI_API_KEY tidak ditemukan di environment!');
    return res.status(500).json({ error: 'Server config error: PI_API_KEY missing' });
  }

  try {
    const response = await fetch(
      `https://api.minepi.com/v2/payments/${paymentId}/approve`,
      {
        method: 'POST',
        headers: {
          Authorization: `Key ${process.env.PI_API_KEY}`,
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
        detail: data
      });
    }

    return res.status(200).json(data);

  } catch (err) {
    console.error('[approve] Exception:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
