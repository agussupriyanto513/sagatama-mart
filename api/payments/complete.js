export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { paymentId, txid } = req.body;

  try {
    const response = await fetch(
      `https://api.minepi.com/v2/payments/${paymentId}/complete`,
      {
        method: "POST",
        headers: {
          Authorization: `Key ${process.env.PI_API_KEY}`, // 🔥 FIX DISINI
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ txid })
      }
    );

    const data = await response.json();

    if (!response.ok) {
      return res.status(400).json({
        error: "Pi complete failed",
        detail: data
      });
    }

    res.status(200).json(data);

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}