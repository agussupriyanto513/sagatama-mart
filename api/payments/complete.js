export default async function handler(req, res) {
  // CORS — izinkan request dari GitHub Pages atau domain manapun
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { paymentId, txid } = req.body;

  if (!paymentId || !txid) {
    return res.status(400).json({ error: 'paymentId dan txid diperlukan' });
  }

  if (!process.env.PI_API_KEY) {
    console.error('[complete] PI_API_KEY tidak ditemukan di environment!');
    return res.status(500).json({ error: 'Server config error: PI_API_KEY missing' });
  }

  try {
    const response = await fetch(
      `https://api.minepi.com/v2/payments/${paymentId}/complete`,
      {
        method: 'POST',
        headers: {
          Authorization: `Key ${process.env.PI_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ txid })
      }
    );

    const data = await response.json();
    console.log('[complete] STATUS:', response.status);
    console.log('[complete] RESPONSE:', JSON.stringify(data));

    if (!response.ok) {
      return res.status(400).json({
        error: 'Pi complete failed',
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
