// api/members/check.js
//
// Dipanggil dari frontend setelah user login via Pi Network SDK.
// POST { uid: string } -> { isMember: boolean, status: 'active'|'pending'|'blocked'|null }
//
// Frontend memakai hasil ini untuk enable/disable tombol checkout.
// CATATAN: ini HANYA untuk UX (tampilkan/sembunyikan tombol). Pengecekan
// yang benar-benar menentukan (security) HARUS ada juga di
// api/payments/approve.js dan api/payments/complete.js — lihat
// INTEGRASI.md untuk contoh penambahannya.

const { checkMemberStatus } = require('../utils/checkMember');

module.exports = async (req, res) => {
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
      status: result.status, // 'active' | 'pending' | 'blocked' | null (belum terdaftar)
    });
  } catch (err) {
    console.error('[members/check] ERROR:', err);
    return res.status(500).json({ error: 'internal_error' });
  }
};
