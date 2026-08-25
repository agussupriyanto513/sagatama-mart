// api/utils/checkMember.js
//
// Menggunakan ulang firebase-init.js yang sudah ada di root project
// (sagatama-mart-main/firebase-init.js) — supaya konsisten dan tidak
// bikin inisialisasi Firebase Admin dobel.

import { getFirebaseApp, admin } from '../../firebase-init.js';

export function getDb() {
  getFirebaseApp();
  return admin.firestore();
}

/**
 * Cek apakah uid terdaftar sebagai member aktif.
 * @param {string} uid - customerUid dari Pi Network SDK
 * @returns {Promise<{ isMember: boolean, status: string|null, data: object|null }>}
 */
export async function checkMemberStatus(uid) {
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
