// api/utils/checkMember.js
//
// Utility function untuk cek apakah sebuah UID Pi Network terdaftar
// sebagai member aktif. Dipakai oleh:
//   - api/members/check.js  (dipanggil dari frontend saat login)
//   - api/payments/approve.js & api/payments/complete.js (enforcement backend,
//     WAJIB ditambahkan supaya user tidak bisa bypass dengan edit JS di browser)
//
// Menggunakan firebase-admin. Sesuaikan cara inisialisasi `db` di bawah
// dengan firebase-init.js yang sudah ada di project Sagatama Mart kalau
// caranya berbeda (misal sudah ada helper getFirestore() sendiri).

const admin = require('firebase-admin');

function getDb() {
  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        // Private key di env var Vercel biasanya perlu replace \\n -> \n
        privateKey: (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
      }),
    });
  }
  return admin.firestore();
}

/**
 * Cek apakah uid terdaftar sebagai member aktif.
 * @param {string} uid - customerUid dari Pi Network SDK
 * @returns {Promise<{ isMember: boolean, status: string|null, data: object|null }>}
 */
async function checkMemberStatus(uid) {
  if (!uid) {
    return { isMember: false, status: null, data: null };
  }

  const db = getDb();
  const doc = await db.collection('members').doc(uid).get();

  if (!doc.exists) {
    return { isMember: false, status: null, data: null };
  }

  const data = doc.data();
  const isActive = data.status === 'active';

  return { isMember: isActive, status: data.status, data };
}

module.exports = { checkMemberStatus, getDb };
