/**
 * POST /api/payments/complete
 * Dipanggil saat Pi SDK memanggil onReadyForServerCompletion
 * Tugas: konfirmasi ke Pi Server bahwa transaksi blockchain sudah selesai
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

    const { paymentId, txid } = req.body;

    if (!paymentId || typeof paymentId !== 'string') {
        return res.status(400).json({ error: 'paymentId wajib diisi' });
    }
    if (!txid || typeof txid !== 'string') {
        return res.status(400).json({ error: 'txid wajib diisi' });
    }

    const apiKey = process.env.PI_API_KEY;
    if (!apiKey) {
        console.error('[Complete] PI_API_KEY belum diset di environment variables');
        return res.status(500).json({ error: 'Server konfigurasi error' });
    }

    try {
        console.log(`[Complete] Memproses paymentId: ${paymentId} | txid: ${txid}`);

        // Langkah 1: Verifikasi payment masih valid di Pi Server
        const getResponse = await fetch(`${PI_API_BASE}/v2/payments/${paymentId}`, {
            method: 'GET',
            headers: {
                'Authorization': `Key ${apiKey}`,
                'Content-Type': 'application/json'
            }
        });

        if (!getResponse.ok) {
            const errText = await getResponse.text();
            console.error(`[Complete] GET payment gagal ${getResponse.status}:`, errText);
            return res.status(getResponse.status).json({
                error: `Pi Server error: ${getResponse.status}`,
                detail: errText
            });
        }

        const paymentData = await getResponse.json();

        // Cek apakah sudah selesai sebelumnya (idempotent)
        if (paymentData.status?.developer_completed) {
            console.log(`[Complete] Payment sudah di-complete sebelumnya`);
            return res.status(200).json({
                success: true,
                message: 'Payment sudah selesai',
                payment: paymentData
            });
        }

        // Validasi txid cocok
        if (paymentData.transaction?.txid && paymentData.transaction.txid !== txid) {
            console.error(`[Complete] txid tidak cocok. Expected: ${paymentData.transaction?.txid}, Got: ${txid}`);
            return res.status(400).json({
                error: 'txid tidak cocok dengan catatan Pi Server'
            });
        }

        // Langkah 2: Complete payment ke Pi Server
        const completeResponse = await fetch(`${PI_API_BASE}/v2/payments/${paymentId}/complete`, {
            method: 'POST',
            headers: {
                'Authorization': `Key ${apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ txid })
        });

        if (!completeResponse.ok) {
            const errText = await completeResponse.text();
            console.error(`[Complete] COMPLETE gagal ${completeResponse.status}:`, errText);
            return res.status(completeResponse.status).json({
                error: `Complete gagal: ${completeResponse.status}`,
                detail: errText
            });
        }

        const completeData = await completeResponse.json();
        console.log(`[Complete] Berhasil complete paymentId: ${paymentId}`);

        return res.status(200).json({
            success: true,
            message: 'Payment berhasil diselesaikan',
            payment: completeData
        });

    } catch (err) {
        console.error('[Complete] Exception:', err.message);
        return res.status(500).json({
            error: 'Internal server error',
            message: err.message
        });
    }
}
