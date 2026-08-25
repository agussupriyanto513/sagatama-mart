// api/members/list.js
//
// Endpoint khusus admin (dipanggil dari admin-members.html) untuk
// menampilkan seluruh daftar member.
// GET dengan header: x-admin-secret: <ADMIN_SECRET>

const { getDb } = require('../utils/checkMember');

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  const secret = req.headers['x-admin-secret'];
  if (!secret || secret !== process.env.ADMIN_SECRET) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  try {
    const db = getDb();
    const snapshot = await db.collection('members').orderBy('addedAt', 'desc').get();

    const members = snapshot.docs.map((doc) => ({
      uid: doc.id,
      ...doc.data(),
    }));

    return res.status(200).json({ members });
  } catch (err) {
    console.error('[members/list] ERROR:', err);
    return res.status(500).json({ error: 'internal_error' });
  }
};
