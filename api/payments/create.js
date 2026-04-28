// /api/payments/create.js

import admin from "firebase-admin";

export default async function handler(req, res) {
  try {
    const token = req.headers.authorization?.split("Bearer ")[1];
    const decoded = await admin.auth().verifyIdToken(token);

    const { cart } = req.body;

    // 🔥 AMBIL DATA PRODUK DARI FIRESTORE (JANGAN PERCAYA CLIENT)
    const db = admin.firestore();

    let total = 0;
    const items = [];

    for (const item of cart) {
      const doc = await db.collection("products").doc(item.id).get();
      if (!doc.exists) throw new Error("Produk tidak ditemukan");

      const p = doc.data();

      const price = p.price; // 🔥 AMBIL DARI DB
      const qty = item.qty;

      total += price * qty;

      items.push({
        id: item.id,
        name: p.name,
        price,
        qty
      });
    }

    // 🔥 SIMPAN ORDER (SERVER TRUSTED)
    const orderRef = await db.collection("orders").add({
      userId: decoded.uid,
      items,
      total,
      status: "pending",
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });

    // 🔥 RETURN KE CLIENT
    res.json({
      success: true,
      orderId: orderRef.id,
      total
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}