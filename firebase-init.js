// firebase-init.js — taruh di root project, import dari semua API handler
// di folder api/ yang butuh akses Firestore (termasuk api/sgt/*.js).
import admin from "firebase-admin";

function getFirebaseApp() {
  if (admin.apps.length) return admin.apps[0];

  // Cara 1 (disarankan, kebal dari masalah paste/newline): satu env var
  // FIREBASE_SERVICE_ACCOUNT_B64 berisi seluruh isi file JSON service
  // account yang di-encode base64.
  if (process.env.FIREBASE_SERVICE_ACCOUNT_B64) {
    const json = JSON.parse(
      Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT_B64, 'base64').toString('utf8')
    );
    return admin.initializeApp({
      credential: admin.credential.cert({
        projectId: json.project_id,
        clientEmail: json.client_email,
        privateKey: json.private_key
      })
    });
  }

  // Cara 2 (fallback lama): 3 env var terpisah — rawan rusak kalau
  // private key di-paste manual lewat form web.
  let privateKey = process.env.FIREBASE_PRIVATE_KEY || '';
  privateKey = privateKey.replace(/^["']|["']$/g, '');
  privateKey = privateKey.replace(/\\n/g, '\n');

  const projectId = (process.env.FIREBASE_PROJECT_ID || '').replace(/^["']|["']$/g, '');
  const clientEmail = (process.env.FIREBASE_CLIENT_EMAIL || '').replace(/^["']|["']$/g, '');

  return admin.initializeApp({
    credential: admin.credential.cert({ projectId, clientEmail, privateKey })
  });
}

// Verifikasi Firebase ID token dari header Authorization: Bearer <token>
async function verifyAuth(req) {
  try {
    const header = req.headers.authorization || '';
    const match = header.match(/^Bearer (.+)$/);
    if (!match) return null;
    const token = match[1].trim();
    if (!token) return null;
    getFirebaseApp();
    const decoded = await admin.auth().verifyIdToken(token);
    return decoded;
  } catch (e) {
    console.warn('[verifyAuth] Token tidak valid:', e.message);
    return null;
  }
}

export { admin, getFirebaseApp, verifyAuth };
