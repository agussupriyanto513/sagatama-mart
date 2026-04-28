/**
 * POST /api/payments/approve
 * Dipanggil saat Pi SDK memanggil onReadyForServerApproval
 * Tugas: konfirmasi ke Pi Server bahwa payment ini sah
 */

const PI_API_BASE = 'https://api.minepi.com';

export default async function handler(req, res) {
    // Hanya terima POST
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    // CORS — izinkan dari domain Vercel kamu
    res.setHeader('Access-Control-Allow-Origin', process.env.ALLOWED_ORIGIN || '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    // Handle preflight
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    const { paymentId } = req.body;

    // Validasi input
    if (!paymentId || typeof paymentId !== 'string') {
        return res.status(400).json({ error: 'paymentId wajib diisi' });
    }

    const apiKey = process.env.PI_API_KEY;
    if (!apiKey) {
        console.error('[Approve] PI_API_KEY belum diset di environment variables');
        return res.status(500).json({ error: 'Server konfigurasi error' });
    }

    try {
        console.log(`[Approve] Memproses paymentId: ${paymentId}`);

        // Langkah 1: Ambil detail payment dari Pi Server untuk verifikasi
        const getResponse = await fetch(`${PI_API_BASE}/v2/payments/${paymentId}`, {
            method: 'GET',
            headers: {
                'Authorization': `Key ${apiKey}`,
                'Content-Type': 'application/json'
            }
        });

        if (!getResponse.ok) {
            const errText = await getResponse.text();
            console.error(`[Approve] GET payment gagal ${getResponse.status}:`, errText);
            return res.status(getResponse.status).json({
                error: `Pi Server error: ${getResponse.status}`,
                detail: errText
            });
        }

        const paymentData = await getResponse.json();
        console.log(`[Approve] Payment data:`, JSON.stringify(paymentData));

        // Validasi status payment — harus pending_developer_approval
        if (paymentData.status?.developer_approved) {
            // Sudah pernah di-approve sebelumnya, kembalikan sukses
            console.log(`[Approve] Payment sudah di-approve sebelumnya`);
            return res.status(200).json({
                success: true,
                message: 'Payment sudah di-approve',
                payment: paymentData
            });
        }

        // Langkah 2: Approve payment ke Pi Server
        const approveResponse = await fetch(`${PI_API_BASE}/v2/payments/${paymentId}/approve`, {
            method: 'POST',
            headers: {
                'Authorization': `Key ${apiKey}`,
                'Content-Type': 'application/json'
            }
        });

        if (!approveResponse.ok) {
            const errText = await approveResponse.text();
            console.error(`[Approve] APPROVE gagal ${approveResponse.status}:`, errText);
            return res.status(approveResponse.status).json({
                error: `Approve gagal: ${approveResponse.status}`,
                detail: errText
            });
        }

        const approveData = await approveResponse.json();
        console.log(`[Approve] Berhasil approve paymentId: ${paymentId}`);

        return res.status(200).json({
            success: true,
            message: 'Payment berhasil di-approve',
            payment: approveData
        });

    } catch (err) {
        console.error('[Approve] Exception:', err.message);
        return res.status(500).json({
            error: 'Internal server error',
            message: err.message
        });
    }
}
