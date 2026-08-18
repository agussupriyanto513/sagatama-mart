// api/orders/decrement-stock.js
// POST { paymentId, items: [{ productId, qty }] } → { success, results }
//
// KENAPA endpoint ini ada:
// Sebelumnya frontend (public/index.html) mengurangi stok produk dengan
// updateDoc() LANGSUNG dari browser pembeli. Ini gagal diam-diam kalau
// Firestore Rules membatasi tulis koleksi 'products' hanya untuk admin
// (praktik keamanan yang benar — pembeli seharusnya memang tidak boleh
// menulis langsung ke data produk). Akibatnya stok tidak pernah berkurang,
// tanpa error yang terlihat.
//
// Endpoint ini pakai Firebase Admin SDK (server-to-server), jadi tidak
// terikat Firestore Rules sama sekali, dan mengurangi stok dalam transaksi
// atomik per produk (aman dari race condition kalau ada pembeli lain
// checkout bersamaan). Idempotent lewat `paymentId` + `productId` supaya
// retry jaringan dari client tidak memotong stok dua kali.
import { getFirebaseApp, admin } from '../../firebase-init.js';

getFirebaseApp();
const db = () => admin.firestore();

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { paymentId, items } = req.body || {};
  if (!paymentId) return res.status(400).json({ error: 'paymentId diperlukan' });
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'items diperlukan (array)' });
  }

  const results = [];

  for (const item of items) {
    const productId = item?.productId || item?.id;
    const qty = parseInt(item?.qty || item?.quantity || 1) || 1;
    if (!productId) { results.push({ productId: null, ok: false, reason: 'productId kosong' }); continue; }

    const ledgerId = `${paymentId}_${productId}`;
    const ledgerRef = db().collection('stock_ledger').doc(ledgerId);
    const productRef = db().collection('products').doc(productId);

    try {
      const outcome = await db().runTransaction(async (tx) => {
        const ledgerSnap = await tx.get(ledgerRef);
        if (ledgerSnap.exists) {
          // Sudah pernah diproses sebelumnya (retry) — jangan potong lagi.
          return { alreadyProcessed: true, newStock: ledgerSnap.data().newStock };
        }
        const productSnap = await tx.get(productRef);
        if (!productSnap.exists) {
          return { notFound: true };
        }
        const currentStock = parseInt(productSnap.data().stock) || 0;
        const newStock = Math.max(0, currentStock - qty);
        tx.update(productRef, {
          stock: newStock,
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });
        tx.set(ledgerRef, {
          paymentId, productId, qty, newStock,
          createdAt: admin.firestore.FieldValue.serverTimestamp()
        });
        return { newStock };
      });

      if (outcome.notFound) {
        results.push({ productId, ok: false, reason: 'Produk tidak ditemukan' });
      } else {
        results.push({ productId, ok: true, newStock: outcome.newStock, alreadyProcessed: !!outcome.alreadyProcessed });
      }
    } catch (e) {
      console.error('[decrement-stock] Gagal untuk', productId, ':', e.message);
      results.push({ productId, ok: false, reason: e.message });
    }
  }

  return res.status(200).json({ success: true, results });
}
