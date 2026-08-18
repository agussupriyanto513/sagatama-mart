// /api/payments/create.js
import admin from "firebase-admin";

// Inisialisasi Firebase Admin hanya sekali (singleton pattern)
if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert({
            projectId:   process.env.FIREBASE_PROJECT_ID,
            clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
            // Ganti literal \n dari env var menjadi newline asli
            privateKey:  process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n')
        })
    });
}

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const token = req.headers.authorization?.split("Bearer ")[1];
        if (!token) return res.status(401).json({ error: 'Token tidak ada' });

        const decoded = await admin.auth().verifyIdToken(token);
        const { cart } = req.body;

        if (!cart || !Array.isArray(cart) || cart.length === 0) {
            return res.status(400).json({ error: 'Cart kosong atau tidak valid' });
        }

        const db = admin.firestore();
        let total = 0;
        const items = [];

        for (const item of cart) {
            const doc = await db.collection("products").doc(item.id).get();
            if (!doc.exists) throw new Error(`Produk ${item.id} tidak ditemukan`);

            const p = doc.data();
            const price = p.pricePi; // field harga Pi di Firestore
            const qty   = Math.max(1, parseInt(item.qty) || 1);

            // Cek stok
            const stock = parseInt(p.stock) || 0;
            if (stock < qty) throw new Error(`Stok ${p.name} tidak cukup`);

            total += price * qty;
            items.push({ id: item.id, name: p.name, price, qty });
        }

        // Simpan order ke Firestore (server-trusted)
        const orderRef = await db.collection("orders").add({
            userId:    decoded.uid,
            items,
            total,
            status:    "pending",
            createdAt: admin.firestore.FieldValue.serverTimestamp()
        });

        res.status(200).json({ success: true, orderId: orderRef.id, total });

    } catch (err) {
        console.error('[create.js]', err.message);
        res.status(500).json({ error: err.message });
    }
}
