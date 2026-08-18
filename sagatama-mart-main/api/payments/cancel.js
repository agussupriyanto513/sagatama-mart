// /api/payments/cancel.js
export default async function handler(req, res) {
  // CORS — konsisten dengan approve.js dan complete.js
  res.setHeader('Access-Control-Allow-Origin', process.env.ALLOWED_ORIGIN || '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { paymentId } = req.body;

  if (!paymentId) {
    return res.status(400).json({ error: 'paymentId diperlukan' });
  }

  if (!process.env.PI_API_KEY) {
    console.error('[cancel] PI_API_KEY tidak ditemukan di environment!');
    return res.status(500).json({ error: 'Server config error: PI_API_KEY missing' });
  }

  try {
    const response = await fetch(
      `https://api.minepi.com/v2/payments/${paymentId}/cancel`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Key ${process.env.PI_API_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );

    const data = await response.json().catch(() => ({}));
    console.log('[cancel] STATUS:', response.status);
    console.log('[cancel] RESPONSE:', JSON.stringify(data));

    if (!response.ok) {
      return res.status(400).json({
        error: 'Pi cancel failed',
        status: response.status,
        detail: data
      });
    }

    return res.status(200).json({ success: true, data });

  } catch (err) {
    console.error('[cancel] Exception:', err.message);
    return res.status(500).json({ error: err.message });
  }
}