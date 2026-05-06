// api/payments/approve.js
// Dipanggil frontend saat: onReadyForServerApproval(paymentId)
// Hit Pi API: POST https://api.minepi.com/v2/payments/{paymentId}/approve

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
      `https://api.minepi.com/v2/payments/${paymentId}/approve`,
      {
        method: "POST",
        headers: {
          Authorization: `Key ${process.env.PI_API_KEY}`,
          "Content-Type": "application/json",
        },
      }
    );

    const data = await response.json();

    if (!response.ok) {
      return res.status(400).json({
        error: "Pi approval failed",
        detail: data,
      });
    }

    // Update Firestore → approved
    const db = admin.firestore();
    const snap = await db
      .collection("pi_donations")
      .where("paymentId", "==", paymentId)
      .limit(1)
      .get();

    if (!snap.empty) {
      await snap.docs[0].ref.update({
        status:     "approved",
        approvedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    }

    res.status(200).json(data);

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
