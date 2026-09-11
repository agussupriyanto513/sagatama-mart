// api/sgt/sync.js
// POST { accessToken, delta, txId? }  →  { success, sgtBalance }
//
// Dipakai KHUSUS oleh frontend Mart sendiri (public/index.html) untuk
// menyinkronkan saldo SGT lokal ke ledger pusat.
//
// 🔒 SECURITY FIX — PENTING, BACA INI:
// Sebelumnya endpoint ini menerima `delta` POSITIF (menambah saldo) apa
// adanya dari client tanpa verifikasi apa pun. Karena `accessToken` yang
// dikirim adalah milik akun Pi si pengirim sendiri (jadi lolos verifikasi
// Pi), SIAPA SAJA bisa memanggil endpoint ini lewat curl/Postman dengan
// `delta` sebesar apa pun dan benar-benar menambah saldo SGT resminya di
// `sgt_wallets` — tanpa pernah membeli apa pun. Ini bug KRITIS.
//
// Fix-nya: endpoint ini sekarang HANYA menerima delta NEGATIF (mengurangi
// saldo — dipakai untuk taruhan/pembelian item dalam game/aplikasi).
// Semua penambahan saldo dari pembelian nyata WAJIB lewat
// /api/sgt/award-purchase, yang menghitung ulang jumlahnya sendiri di
// server berdasarkan status pembayaran yang diverifikasi ke Pi Platform —
// bukan dari angka yang dikirim client.
//
// Kalau Games/Hidayatulamin butuh kredit saldo (menang game, bonus SPP,
// dll), pola yang benar itu SUDAH ADA dan aman: backend mereka sendiri
// memanggil /api/sgt/credit server-to-server pakai X-Internal-Secret
// (lihat docs/INTEGRASI-SGT-TERPUSAT.md) — BUKAN lewat endpoint ini.
import { setCors, verifyPiToken, walletRef, ensureWallet, admin, db, ledgerRef } from './_lib.js';

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { accessToken, delta, txId } = req.body || {};
  const d = parseFloat(delta);
  if (isNaN(d)) return res.status(400).json({ error: 'delta tidak valid' });

  // 🔒 Titik kunci fix: tolak semua permintaan menambah saldo lewat jalur ini.
  if (d > 0) {
    return res.status(400).json({
      error: 'Menambah saldo lewat /api/sgt/sync tidak lagi diizinkan. ' +
             'Gunakan /api/sgt/award-purchase (untuk reward pembelian) atau ' +
             'minta backend app terkait memanggil /api/sgt/credit server-to-server.'
    });
  }

  const pi = await verifyPiToken(accessToken);
  if (!pi.ok) {
    // FIX: 503 untuk gangguan sesaat (client HARUS retry/antre ulang),
    // 401 hanya kalau Pi Platform memang menolak token-nya (final).
    const status = pi.transient ? 503 : 401;
    return res.status(status).json({
      error: pi.transient ? 'Pi Platform API sedang bermasalah, coba lagi' : 'accessToken Pi tidak valid',
      transient: !!pi.transient
    });
  }

  try {
    await ensureWallet(pi.username);
    if (d === 0) {
      const snap = await walletRef(pi.username).get();
      return res.status(200).json({ success: true, sgtBalance: parseFloat(snap.data().sgtBalance) || 0 });
    }

    const finalTxId = txId || `mart_sync_${pi.username}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const wRef = walletRef(pi.username);
    const lRef = ledgerRef(finalTxId);

    const result = await db().runTransaction(async (tx) => {
      const ledgerSnap = await tx.get(lRef);
      if (ledgerSnap.exists) {
        const wSnap = await tx.get(wRef);
        return { ok: true, balance: parseFloat((wSnap.data() || {}).sgtBalance) || 0 };
      }
      const wSnap = await tx.get(wRef);
      const prev = parseFloat((wSnap.data() || {}).sgtBalance) || 0;
      if (prev < -d) {
        return { ok: false, balance: prev, reason: 'Saldo SGT tidak cukup' };
      }
      const next = prev + d; // d selalu <= 0 di titik ini
      tx.set(wRef, { sgtBalance: next, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
      tx.set(lRef, {
        txId: finalTxId, username: pi.username, type: 'debit',
        amount: Math.abs(d), source: 'mart_gameplay_sync', balanceAfter: next,
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      });
      return { ok: true, balance: next };
    });

    if (!result.ok) return res.status(400).json({ error: result.reason, sgtBalance: result.balance });
    return res.status(200).json({ success: true, sgtBalance: result.balance });
  } catch (err) {
    console.error('[sgt/sync] Error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
