// Endpoint debug sementara: menerima log dari browser (Pi Browser di HP)
// dan menuliskannya ke Vercel Logs, supaya bisa dibaca dari laptop tanpa
// perlu akses console di HP. Aman dihapus lagi setelah selesai debugging.
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { msg, ua } = req.body || {};
    console.log('[CLIENT-LOG]', msg, ua ? ('| UA: ' + ua) : '');
    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error('[debug-log] Error:', e.message);
    return res.status(500).json({ error: e.message });
  }
}
