// api/members/remove.js
import { getDb } from '../utils/checkMember.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  const secret = req.headers['x-admin-secret'];
  if (!secret || secret !== process.env.ADMIN_SECRET) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  try {
    const { uid, mode } = req.body || {};

    if (!uid) {
      return res.status(400).json({ error: 'missing_uid' });
    }

    const db = getDb();

    if (mode === 'block') {
      await db.collection('members').doc(uid).set({ status: 'blocked' }, { merge: true });
      return res.status(200).json({ success: true, uid, status: 'blocked' });
    }

    await db.collection('members').doc(uid).delete();
    return res.status(200).json({ success: true, uid, deleted: true });
  } catch (err) {
    console.error('[members/remove] ERROR:', err);
    return res.status(500).json({ error: 'internal_error', detail: err.message });
  }
}
