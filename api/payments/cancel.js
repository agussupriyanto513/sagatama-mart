// /api/payments/cancel.js
export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const { paymentId } = req.body;
    const API_KEY = process.env.PI_API_KEY;

    try {
        const response = await fetch(`https://api.minepi.com/v2/payments/${paymentId}/cancel`, {
            method: 'POST',
            headers: {
                'Authorization': `Key ${API_KEY}`,
                'Content-Type': 'application/json'
            }
        });

        if (response.ok) {
            res.status(200).json({ success: true });
        } else {
            const error = await response.text();
            res.status(500).json({ error: error });
        }
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
}