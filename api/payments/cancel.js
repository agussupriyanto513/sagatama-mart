// api/payments/cancel.js
// Dipanggil saat: onCancel(paymentId)
// Hit Pi API: POST https://api.minepi.com/v2/payments/{paymentId}/cancel

import admin from "firebase-admin";

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId:   process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey:  process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
    }),
  });
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { paymentId } = req.body;

  if (!paymentId) {
    return res.status(400).json({ error: "paymentId wajib diisi" });
  }

  try {
    const response = await fetch(
      `https://api.minepi.com/v2/payments/${paymentId}/cancel`,
      {
        method: "POST",
        headers: {
          Authorization: `Key ${process.env.PI_API_KEY}`,
          "Content-Type": "application/json",
        },
      }
    );

    if (response.ok) {
      // Update Firestore → cancelled
      const db = admin.firestore();
      const snap = await db
        .collection("pi_donations")
        .where("paymentId", "==", paymentId)
        .limit(1)
        .get();

      if (!snap.empty && snap.docs[0].data().status !== "completed") {
        await snap.docs[0].ref.update({
          status:      "cancelled",
          cancelledAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      }
      res.status(200).json({ success: true });

    } else {
      const error = await response.text();
      res.status(500).json({ error });
    }

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
