// /api/payments/cancel.js
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
        // ── 1. Cancel ke Pi Network ──────────────────────────────────
        const piRes = await fetch(`${PI_BASE_URL}/v2/payments/${paymentId}/cancel`, {
            method:  'POST',
            headers: { Authorization: `Key ${PI_API_KEY}`, 'Content-Type': 'application/json' }
        });

        if (!piRes.ok) {
            const errText = await piRes.text();
            return res.status(500).json({ error: 'Pi cancel gagal', detail: errText });
        }

        console.log(`[cancel] Payment ${paymentId} dibatalkan`);

        // ── 2. Update status order di Firestore (non-kritis) ────────
        if (orderId) {
            try {
                const db = admin.firestore();
                await db.collection('orders').doc(orderId).set({
                    status:      'cancelled',
                    cancelledAt: admin.firestore.FieldValue.serverTimestamp(),
                    updatedAt:   admin.firestore.FieldValue.serverTimestamp()
                }, { merge: true });
            } catch (dbErr) {
                console.warn('[cancel] DB update non-kritis:', dbErr.message);
            }
        }

        return res.status(200).json({ success: true });

    } catch (err) {
        console.error('[cancel] Error:', err.message);
        return res.status(500).json({ error: err.message });
    }
}
