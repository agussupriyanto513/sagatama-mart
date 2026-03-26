export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { paymentId } = req.body;

  try {
    const response = await fetch(
      `https://api.minepi.com/v2/payments/${paymentId}/approve`,
      {
        method: "POST",
        headers: {
          Authorization: `Key ${process.env.PI_API_KEY}`, // 🔥 FIX DISINI
          "Content-Type": "application/json"
        }
      }
    );

    const data = await response.json();

    console.log("STATUS:", response.status);
    console.log("RESPONSE:", data);

    if (!response.ok) {
      return res.status(400).json({
        error: "Pi approval failed",
        detail: data
      });
    }

    res.status(200).json(data);

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}