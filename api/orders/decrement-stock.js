// api/orders/decrement-stock.js
// POST { paymentId, items: [{ productId, qty }], network? } → { success, results }
//
// KENAPA endpoint ini ada:
// Sebelumnya frontend (public/index.html) mengurangi stok produk dengan
// updateDoc() LANGSUNG dari browser pembeli — gagal diam-diam karena
// Firestore Rules membatasi tulis 'products' hanya untuk admin. Endpoint
// ini pakai Firebase Admin SDK (server-to-server) supaya tidak terikat
// Firestore Rules, dan mengurangi stok dalam transaksi atomik per produk.
//
// 🔒 SECURITY FIX — PENTING:
// Versi sebelumnya menerima `paymentId` + `items` apa adanya dari client
// dan LANGSUNG memotong stok — TANPA pernah mengecek ke Pi Platform bahwa
// paymentId itu nyata dan benar-benar sudah dibayar. Siapa saja bisa
// mengirim paymentId karangan + daftar produk manapun ke endpoint ini
// lewat curl/Postman dan menghabiskan stok toko tanpa membayar sepeser
// pun. Ini bug KRITIS.
//
// Fix-nya: sekarang endpoint ini WAJIB memverifikasi status pembayaran
// LANGSUNG ke Pi Platform API (fungsi sama yang dipakai award-purchase.js)
// sebelum menyentuh stok sama sekali. Kalau pembayaran belum terverifikasi
// selesai, permintaan ditolak — stok tidak berkurang.
import { getFirebaseApp, admin, verifyPiPayment } from '../../api/sgt/_lib.js';

getFirebaseApp();
const db = () => admin.firestore();

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { paymentId, items, network } = req.body || {};
  if (!paymentId) return res.status(400).json({ error: 'paymentId diperlukan' });
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'items diperlukan (array)' });
  }

  // 🔒 Titik kunci fix: verifikasi dulu ke Pi Platform, jangan percaya
  // klaim client bahwa paymentId ini sudah lunas.
  const payVerify = await verifyPiPayment(paymentId, network);
  if (!payVerify.ok) {
    const status = payVerify.transient ? 503 : 400;
    return res.status(status).json({
      error: 'Pembayaran belum terverifikasi selesai di Pi Platform, stok tidak dikurangi',
      reason: payVerify.reason,
      transient: !!payVerify.transient
    });
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
