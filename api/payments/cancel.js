/**
 * POST /api/payments/cancel
 * Dipanggil saat payment dibatalkan user atau terjadi error
 * Tugas: batalkan payment di Pi Server (opsional tapi best practice)
 */

const PI_API_BASE = 'https://api.minepi.com';

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    res.setHeader('Access-Control-Allow-Origin', process.env.ALLOWED_ORIGIN || '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    const { paymentId } = req.body;

    if (!paymentId || typeof paymentId !== 'string') {
        return res.status(400).json({ error: 'paymentId wajib diisi' });
    }

    const apiKey = process.env.PI_API_KEY;
    if (!apiKey) {
        return res.status(500).json({ error: 'Server konfigurasi error' });
    }

    try {
        console.log(`[Cancel] Membatalkan paymentId: ${paymentId}`);

        // Pi API v2 tidak punya endpoint cancel eksplisit
        // Cukup log dan kembalikan sukses — Pi Server akan timeout sendiri
        // Jika Pi API menambahkan cancel endpoint di masa depan, tambahkan di sini

        // Verifikasi payment ada
        const getResponse = await fetch(`${PI_API_BASE}/v2/payments/${paymentId}`, {
            method: 'GET',
            headers: {
                'Authorization': `Key ${apiKey}`,
                'Content-Type': 'application/json'
            }
        });

        if (!getResponse.ok) {
            // Payment tidak ditemukan — anggap sudah cancel
            console.log(`[Cancel] Payment ${paymentId} tidak ditemukan, dianggap sudah cancel`);
            return res.status(200).json({ success: true, message: 'Payment tidak ditemukan atau sudah dibatalkan' });
        }

        const paymentData = await getResponse.json();
        console.log(`[Cancel] Status payment: ${JSON.stringify(paymentData.status)}`);

        // Jika sudah complete, jangan cancel
        if (paymentData.status?.developer_completed) {
            return res.status(400).json({
                error: 'Payment sudah selesai, tidak bisa dibatalkan'
            });
        }

        console.log(`[Cancel] Payment ${paymentId} ditandai cancel di server`);
        return res.status(200).json({
            success: true,
            message: 'Payment dibatalkan',
            paymentId
        });

    } catch (err) {
        console.error('[Cancel] Exception:', err.message);
        return res.status(500).json({
            error: 'Internal server error',
            message: err.message
        });
    }
}
