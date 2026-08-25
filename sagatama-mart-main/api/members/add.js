// api/members/add.js
//
// Endpoint khusus admin untuk menambahkan UID baru ke whitelist member.
// POST dengan header: x-admin-secret: <ADMIN_SECRET>
// Body: { uid: string, username?: string, status?: 'active'|'pending'|'blocked' }

const { getDb } = require('../utils/checkMember');
const admin = require('firebase-admin');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  const secret = req.headers['x-admin-secret'];
  if (!secret || secret !== process.env.ADMIN_SECRET) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  try {
    const { uid, username, status } = req.body || {};

    if (!uid) {
      return res.status(400).json({ error: 'missing_uid' });
    }

    const validStatus = ['active', 'pending', 'blocked'].includes(status) ? status : 'active';

    const db = getDb();
    await db.collection('members').doc(uid).set(
      {
        uid,
        username: username || null,
        status: validStatus,
        addedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    return res.status(200).json({ success: true, uid, status: validStatus });
  } catch (err) {
    console.error('[members/add] ERROR:', err);
    return res.status(500).json({ error: 'internal_error' });
  }
};
