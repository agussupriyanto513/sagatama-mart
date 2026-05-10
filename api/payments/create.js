// /api/payments/create.js
import admin from 'firebase-admin';

if (!admin.apps.length) {
    admin.initializeApp();
}

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        // ── Auth: verifikasi Firebase token ─────────────────────────
        const token = req.headers.authorization?.split('Bearer ')[1];
        if (!token) return res.status(401).json({ error: 'Token tidak ada' });

        const decoded = await admin.auth().verifyIdToken(token);
        const db      = admin.firestore();

        const { cart, orderId } = req.body;

        if (!cart || cart.length === 0) {
            return res.status(400).json({ error: 'Cart kosong' });
        }

        // ── Ambil semua produk dari Firestore (jangan percaya harga dari client) ──
        let totalPi = 0;
        const items = [];

        for (const item of cart) {
            const prodSnap = await db.collection('products').doc(item.id || item.productId).get();

            if (!prodSnap.exists) {
                return res.status(404).json({ error: `Produk "${item.name}" tidak ditemukan` });
            }

            const p   = prodSnap.data();
            const qty = item.qty || item.quantity || 1;

            // Validasi stok awal sebelum order dibuat
            if (!p.stock || p.stock < qty) {
                return res.status(409).json({
                    error: `Stok "${p.name}" tidak cukup (sisa: ${p.stock || 0}, diminta: ${qty})`
                });
            }

            // ── Ambil harga dari DB — pricePi (bukan price) ─────────
            const pricePi = parseFloat(p.pricePi || p.price || 0);
            totalPi      += pricePi * qty;

            items.push({
                productId: prodSnap.id,
                id:        prodSnap.id,
                name:      p.name,
                pricePi,
                qty,
                quantity:  qty
            });
        }

        // ── Simpan order awal dengan status pending ──────────────────
        const finalOrderId = orderId || ('ORD_' + Date.now());
        await db.collection('orders').doc(finalOrderId).set({
            orderId:   finalOrderId,
            userId:    decoded.uid,
            items,
            totalPi,
            total:     totalPi,   // alias untuk kompatibilitas
            status:    'pending',
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });

        console.log(`[create] Order ${finalOrderId} dibuat. Total: ${totalPi} Pi | Items: ${items.length}`);

        return res.status(200).json({
            success: true,
            orderId: finalOrderId,
            totalPi,
            items
        });

    } catch (err) {
        console.error('[create] Error:', err.message);
        if (err.code === 'auth/argument-error' || err.code === 'auth/id-token-expired') {
            return res.status(401).json({ error: 'Token tidak valid atau expired' });
        }
        return res.status(500).json({ error: err.message });
    }
}
