// /api/payments/approve.js
import admin from 'firebase-admin';

if (!admin.apps.length) {
    admin.initializeApp();
}

const PI_API_KEY  = process.env.PI_API_KEY;
const PI_BASE_URL = 'https://api.minepi.com';

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const { paymentId, orderId } = req.body;

    if (!paymentId) {
        return res.status(400).json({ error: 'paymentId wajib ada' });
    }

    try {
        // ── 1. Verifikasi pembayaran ke Pi Network dulu ──────────────
        const piRes  = await fetch(`${PI_BASE_URL}/v2/payments/${paymentId}`, {
            headers: { Authorization: `Key ${PI_API_KEY}` }
        });
        const piData = await piRes.json();

        if (!piRes.ok) {
            return res.status(400).json({ error: 'Gagal ambil data payment dari Pi', detail: piData });
        }

        // ── 2. Cek belum pernah di-approve sebelumnya ────────────────
        if (piData.status?.developer_approved) {
            return res.status(400).json({ error: 'Payment sudah di-approve sebelumnya' });
        }
        if (piData.status?.cancelled) {
            return res.status(400).json({ error: 'Payment sudah dibatalkan' });
        }

        // ── 3. Validasi amount vs order di Firestore (jika orderId ada) ──
        if (orderId) {
            const db       = admin.firestore();
            const orderSnap = await db.collection('orders').doc(orderId).get();

            if (orderSnap.exists) {
                const order       = orderSnap.data();
                const expectedAmt = parseFloat(order.totalPi || order.total || 0);
                const receivedAmt = parseFloat(piData.amount || 0);

                // Toleransi 0.000001 Pi untuk floating point
                if (Math.abs(expectedAmt - receivedAmt) > 0.000001) {
                    console.error(`[approve] Amount mismatch: expected ${expectedAmt}, got ${receivedAmt}`);
                    return res.status(400).json({ error: 'Amount tidak sesuai order' });
                }
            }
        }

        // ── 4. Approve ke Pi Network ─────────────────────────────────
        const approveRes  = await fetch(`${PI_BASE_URL}/v2/payments/${paymentId}/approve`, {
            method:  'POST',
            headers: { Authorization: `Key ${PI_API_KEY}`, 'Content-Type': 'application/json' }
        });
        const approveData = await approveRes.json();

        console.log('[approve] Status:', approveRes.status, '| PaymentId:', paymentId);

        if (!approveRes.ok) {
            return res.status(400).json({ error: 'Pi approval gagal', detail: approveData });
        }

        // ── 5. Update status order jadi payment_approved ─────────────
        if (orderId) {
            try {
                const db = admin.firestore();
                await db.collection('orders').doc(orderId).set({
                    paymentId,
                    status:    'payment_approved',
                    updatedAt: admin.firestore.FieldValue.serverTimestamp()
                }, { merge: true });
            } catch (dbErr) {
                console.warn('[approve] DB update non-kritis:', dbErr.message);
            }
        }

        return res.status(200).json({ success: true, ...approveData });

    } catch (err) {
        console.error('[approve] Error:', err.message);
        return res.status(500).json({ error: err.message });
    }
}
