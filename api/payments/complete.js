// /api/payments/complete.js
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

    const { paymentId, txid, orderId, items, amount } = req.body;

    if (!paymentId || !txid) {
        return res.status(400).json({ error: 'paymentId dan txid wajib ada' });
    }

    const db = admin.firestore();

    try {
        // ── 1. Verifikasi ulang ke Pi Network — pastikan txid valid ──
        const piRes  = await fetch(`${PI_BASE_URL}/v2/payments/${paymentId}`, {
            headers: { Authorization: `Key ${PI_API_KEY}` }
        });
        const piData = await piRes.json();

        if (!piRes.ok) {
            return res.status(400).json({ error: 'Gagal verifikasi payment dari Pi', detail: piData });
        }

        // TxID harus cocok persis
        if (piData.transaction?.txid !== txid) {
            return res.status(400).json({ error: 'TxID tidak cocok dengan catatan Pi Network' });
        }

        // Pastikan belum completed
        if (piData.status?.developer_completed) {
            // Sudah pernah diproses — idempotent, kembalikan sukses
            return res.status(200).json({ success: true, alreadyCompleted: true });
        }

        // ── 2. Atomic: kurangi stok + simpan transaksi di Firestore ──
        const cartItems = items || [];

        await db.runTransaction(async (t) => {
            // ── Baca semua produk dulu (wajib: semua read sebelum write) ──
            const productRefs  = cartItems.map(i => db.collection('products').doc(i.productId || i.id));
            const productSnaps = await Promise.all(productRefs.map(ref => t.get(ref)));

            // ── Validasi stok ──────────────────────────────────────────
            for (let i = 0; i < productSnaps.length; i++) {
                const snap = productSnaps[i];
                const item = cartItems[i];

                if (!snap.exists) {
                    throw new Error(`Produk ${item.name || item.productId} tidak ditemukan`);
                }

                const currentStock = snap.data().stock || 0;
                const qty          = item.quantity || item.qty || 1;

                if (currentStock < qty) {
                    throw new Error(`Stok "${snap.data().name}" tidak cukup (sisa: ${currentStock}, diminta: ${qty})`);
                }
            }

            // ── Cek order belum diproses (cegah double-processing) ────
            if (orderId) {
                const orderSnap = await t.get(db.collection('orders').doc(orderId));
                if (orderSnap.exists && orderSnap.data().status === 'completed') {
                    throw new Error('Order sudah diproses sebelumnya');
                }
            }

            // ── Write: kurangi stok semua item ───────────────────────
            for (let i = 0; i < productSnaps.length; i++) {
                const snap         = productSnaps[i];
                const item         = cartItems[i];
                const qty          = item.quantity || item.qty || 1;
                const currentStock = snap.data().stock || 0;
                const newStock     = Math.max(0, currentStock - qty);

                t.update(productRefs[i], {
                    stock:     newStock,
                    updatedAt: admin.firestore.FieldValue.serverTimestamp()
                });
            }

            // ── Write: simpan record transaksi ────────────────────────
            const txRef = db.collection('transactions').doc(paymentId);
            t.set(txRef, {
                paymentId,
                txid,
                orderId:     orderId || null,
                amount:      piData.amount || amount || 0,
                items:       cartItems,
                createdAt:   admin.firestore.FieldValue.serverTimestamp(),
                explorerUrl: `https://blockexplorer.minepi.com/tx/${txid}`
            });

            // ── Write: update status order ────────────────────────────
            if (orderId) {
                t.set(db.collection('orders').doc(orderId), {
                    status:      'paid',
                    txid,
                    paymentId,
                    completedAt: admin.firestore.FieldValue.serverTimestamp(),
                    updatedAt:   admin.firestore.FieldValue.serverTimestamp()
                }, { merge: true });
            }
        });

        console.log(`[complete] Stok dikurangi atomic. PaymentId: ${paymentId} | TxID: ${txid}`);

        // ── 3. Konfirmasi complete ke Pi Network ─────────────────────
        const completeRes  = await fetch(`${PI_BASE_URL}/v2/payments/${paymentId}/complete`, {
            method:  'POST',
            headers: { Authorization: `Key ${PI_API_KEY}`, 'Content-Type': 'application/json' },
            body:    JSON.stringify({ txid })
        });
        const completeData = await completeRes.json();

        if (!completeRes.ok) {
            // Stok sudah dikurangi, tapi Pi complete gagal → log untuk manual review
            console.error('[complete] Pi complete gagal setelah stock deducted:', completeData);
            return res.status(400).json({
                error:        'Pi complete gagal — stok sudah dikurangi, hubungi support',
                detail:       completeData,
                requiresReview: true
            });
        }

        return res.status(200).json({
            success:     true,
            txid,
            explorerUrl: `https://blockexplorer.minepi.com/tx/${txid}`,
            ...completeData
        });

    } catch (err) {
        console.error('[complete] Error:', err.message);

        // Error stok tidak cukup → kembalikan 409 agar client tampilkan pesan jelas
        if (err.message.includes('tidak cukup') || err.message.includes('tidak ditemukan')) {
            return res.status(409).json({ error: err.message });
        }

        return res.status(500).json({ error: err.message });
    }
}
