// api/members/list.js
import { getDb } from '../utils/checkMember.js';

export default async function handler(req, res) {
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
    return res.status(500).json({ error: 'internal_error', detail: err.message });
  }
}
