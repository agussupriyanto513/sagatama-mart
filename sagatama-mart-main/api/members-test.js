// api/members-test.js
//
// FILE TES SEMENTARA — bukan bagian dari fitur member yang sebenarnya.
// Tujuannya cuma memastikan file BARU langsung di dalam folder /api
// (tanpa subfolder baru) bisa ke-build dan ke-deploy dengan benar oleh
// Vercel, sebelum kita bangun ulang seluruh fitur member.
//
// Setelah tes ini berhasil, file ini boleh dihapus.

export default async function handler(req, res) {
  return res.status(200).json({ ok: true, message: 'File tes berhasil jalan' });
}
