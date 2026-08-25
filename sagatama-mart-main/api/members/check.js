// api/members/check.js
import { checkMemberStatus } from '../utils/checkMember.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  try {
    const { uid } = req.body || {};

    if (!uid) {
      return res.status(400).json({ error: 'missing_uid' });
    }

    const result = await checkMemberStatus(uid);

    return res.status(200).json({
      isMember: result.isMember,
      status: result.status,
    });
  } catch (err) {
    console.error('[members/check] ERROR:', err);
    return res.status(500).json({ error: 'internal_error', detail: err.message });
  }
}
