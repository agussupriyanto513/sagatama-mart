// /api/payments/create.js
// Validasi cart & hitung total pembayaran di server (server-trusted),
// supaya client tidak bisa memanipulasi harga/total sebelum bikin Pi payment.
// CATATAN: endpoint ini TIDAK menulis dokumen order — order tetap disimpan
// oleh client (saveOrderToFirebase) memakai paymentId sebagai ID dokumen,
// seperti alur yang sudah berjalan. Endpoint ini murni validasi + harga.
import admin from "firebase-admin";

// Inisialisasi Firebase Admin hanya sekali (singleton pattern).
// PENTING: dibungkus try/catch — kalau env var (terutama FIREBASE_PRIVATE_KEY)
// salah format, initializeApp() bisa throw SAAT MODULE DI-LOAD (di luar handler),
// yang bikin seluruh function crash total (Vercel: "FUNCTION_INVOCATION_FAILED",
// tanpa body JSON sama sekali). Dengan try/catch ini, error-nya tetap tercatat
// dan handler() masih bisa jalan untuk mengembalikan pesan error yang jelas.
let initError = null;
if (!admin.apps.length) {
    try {
        const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');
        if (!process.env.FIREBASE_PROJECT_ID || !process.env.FIREBASE_CLIENT_EMAIL || !privateKey) {
            throw new Error(
                'Env var Firebase Admin belum lengkap: ' +
                ['FIREBASE_PROJECT_ID', 'FIREBASE_CLIENT_EMAIL', 'FIREBASE_PRIVATE_KEY']
                    .filter(k => !process.env[k]).join(', ') + ' kosong/tidak ada.'
            );
        }
        admin.initializeApp({
            credential: admin.credential.cert({
                projectId:   process.env.FIREBASE_PROJECT_ID,
                clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
                privateKey
            })
        });
    } catch (e) {
        initError = e.message;
        console.error('[create.js] Firebase Admin init GAGAL:', e.message);
    }
}

export default async function handler(req, res) {
    // CORS (jaga-jaga kalau suatu saat dipanggil dari origin lain)
    const allowedOrigin = process.env.ALLOWED_ORIGIN || '*';
    res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    // Kalau init Firebase Admin gagal tadi, jangan lanjut — balas error jelas
    if (initError) {
        return res.status(500).json({ error: 'Firebase Admin init gagal: ' + initError });
    }

    try {
        const token = req.headers.authorization?.split("Bearer ")[1];
        if (!token) return res.status(401).json({ error: 'Token tidak ada' });

        // verifyIdToken juga berlaku untuk user anonymous Firebase Auth
        const decoded = await admin.auth().verifyIdToken(token);
        const { cart } = req.body || {};

        if (!cart || !Array.isArray(cart) || cart.length === 0) {
            return res.status(400).json({ error: 'Cart kosong atau tidak valid' });
        }

        const db = admin.firestore();
        let total = 0;
        const items = [];

        for (const item of cart) {
            const docSnap = await db.collection("products").doc(item.id).get();
            if (!docSnap.exists) {
                return res.status(400).json({ error: `Produk ${item.id} tidak ditemukan` });
            }

            const p = docSnap.data();
            const price = parseFloat(p.pricePi) || 0; // field harga Pi di Firestore (server-trusted)
            const qty   = Math.max(1, parseInt(item.qty) || 1);

            // Cek stok
            const stock = parseInt(p.stock) || 0;
            if (stock < qty) {
                return res.status(400).json({ error: `Stok ${p.name} tidak cukup (tersisa ${stock})` });
            }

            total += price * qty;
            items.push({ id: item.id, name: p.name, price, qty });
        }

        // Tidak menulis apapun ke Firestore di sini — hanya validasi & harga.
        res.status(200).json({ success: true, uid: decoded.uid, total, items });

    } catch (err) {
        console.error('[create.js]', err.message);
        res.status(500).json({ error: err.message });
    }
}
