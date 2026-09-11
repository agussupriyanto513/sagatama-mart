// api/sgt/_lib.js
//
// Helper bersama untuk SEMUA endpoint SGT terpusat.
//
// PRINSIP KUNCI (baca ini sebelum edit apa pun di folder /api/sgt):
//
// 1. Kunci identitas wallet SGT adalah `username` Pi (huruf kecil semua),
//    BUKAN `uid`. Ini karena `uid` dari Pi SDK bersifat app-local — Pioneer
//    yang sama akan punya `uid` BERBEDA di Sagatama Mart, Sagatama Games,
//    dan Hidayatulamin. Kalau kita pakai `uid` sebagai kunci, saldo SGT
//    akan tetap kepecah per-app walau semua nulis ke Firestore yang sama.
//    Sumber: Pi Developer Guide — "the uid is specific to that Pioneer
//    and the app that requested it."
//
// 2. Semua penulisan saldo (credit/debit/transfer) HANYA boleh lewat
//    endpoint di folder ini. App lain (Mart/Games/Hidayatulamin) tidak
//    boleh lagi nulis field sgtBalance langsung ke Firestore mereka
//    sendiri — mereka manggil endpoint ini dari backend mereka
//    (server-to-server), pakai INTERNAL_SERVICE_SECRET.
//
// 3. Setiap operasi credit/debit WAJIB idempotent lewat `txId` unik
//    (mis. `mart_order_123`, `games_win_abc`, `hidayatulamin_spp_2026-06`).
//    Kalau txId sudah pernah diproses, endpoint akan mengembalikan hasil
//    yang sama tanpa memotong/menambah saldo dua kali (aman untuk retry
//    jaringan dari sisi client).
//
// 4. 🔒 SECURITY FIX (lihat PATCH-NOTES.md): jumlah SGT yang di-*kredit*
//    tidak boleh lagi datang mentah-mentah dari client (`delta` bebas).
//    Kredit dari pembelian sekarang WAJIB lewat award-purchase.js, yang
//    menghitung ulang jumlahnya di server berdasarkan pembayaran yang
//    diverifikasi langsung ke Pi Platform API — bukan klaim dari browser.

import crypto from 'crypto';
import { admin, getFirebaseApp } from '../../firebase-init.js';

getFirebaseApp();

const db = () => admin.firestore();

// ── Normalisasi username jadi kunci dokumen yang konsisten ──
function walletId(username) {
  if (!username || typeof username !== 'string') return null;
  return username.trim().toLowerCase();
}

function walletRef(username) {
  const id = walletId(username);
  if (!id) return null;
  return db().collection('sgt_wallets').doc(id);
}

function ledgerRef(txId) {
  return db().collection('sgt_ledger').doc(txId);
}

// ── Verifikasi accessToken Pi langsung ke Pi Platform API ──
// Dipakai saat user login di salah satu app dan kita perlu tahu
// username asli mereka (bukan yang dikirim mentah-mentah dari client).
//
// PENTING (fix bug "SGT hilang"): sebelumnya fungsi ini mengembalikan
// `null` baik untuk (a) token yang MEMANG tidak valid maupun (b) Pi
// Platform API yang cuma lagi lambat/timeout/error 5xx sesaat. Endpoint
// pemanggil (sync.js/balance.js) lalu selalu membalas 401 untuk kedua
// kasus itu. Client tidak bisa membedakan "token salah, jangan diulang"
// dari "coba lagi nanti", dan reward yang gagal ter-sync dari sisi
// server bisa hilang permanen kalau client mengira itu error final.
// Sekarang fungsi ini SELALU mengembalikan objek dengan flag `ok` dan
// `transient` — SEMUA pemanggil WAJIB cek `pi.ok`, bukan `!pi`
// (objeknya sendiri selalu truthy, jadi `if (!pi)` tidak pernah berhasil
// menangkap token tidak valid — ini bug yang sudah diperbaiki di
// ensure.js dan transfer.js pada patch ini).
async function verifyPiToken(accessToken) {
  if (!accessToken) return { ok: false, transient: false, reason: 'no_token' };
  try {
    const resp = await fetch('https://api.minepi.com/v2/me', {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    if (resp.status === 401 || resp.status === 403) {
      // Pi Platform sendiri yang bilang token ini tidak sah — final, jangan retry.
      return { ok: false, transient: false, reason: 'invalid_token' };
    }
    if (!resp.ok) {
      // Status lain (429 rate-limit, 5xx, dsb) — bukan berarti token salah,
      // Pi Platform-nya yang lagi bermasalah. Ini TRANSIENT, boleh di-retry.
      return { ok: false, transient: true, reason: 'pi_api_status_' + resp.status };
    }
    const data = await resp.json();
    if (!data || !data.username) return { ok: false, transient: false, reason: 'no_username' };
    return { ok: true, uid: data.uid, username: data.username };
  } catch (e) {
    console.error('[sgt/_lib] verifyPiToken error:', e.message);
    // Network/timeout saat menghubungi Pi Platform — TRANSIENT, boleh di-retry.
    return { ok: false, transient: true, reason: 'network_error' };
  }
}

// ── 🔒 BARU: Verifikasi status pembayaran LANGSUNG ke Pi Platform API ──
// Dipakai oleh award-purchase.js dan decrement-stock.js supaya kredit SGT
// dan pengurangan stok HANYA terjadi untuk paymentId yang benar-benar
// sudah selesai dibayar menurut Pi sendiri — bukan menurut klaim/field
// apa pun yang dikirim dari browser (yang bisa dipalsukan).
async function verifyPiPayment(paymentId, network) {
  const rawKey = network === 'testnet'
    ? (process.env.PI_API_KEY_TESTNET || process.env.PI_API_KEY)
    : (process.env.PI_API_KEY_MAINNET || process.env.PI_API_KEY);

  if (!rawKey) return { ok: false, transient: false, reason: 'no_api_key' };
  const piApiKey = rawKey.trim();

  try {
    const resp = await fetch(`https://api.minepi.com/v2/payments/${paymentId}`, {
      headers: { Authorization: `Key ${piApiKey}` }
    });

    if (resp.status === 404) {
      return { ok: false, transient: false, reason: 'not_found' };
    }
    if (!resp.ok) {
      // 429/5xx dari Pi — bukan berarti paymentId salah, transient.
      return { ok: false, transient: true, reason: 'pi_api_status_' + resp.status };
    }

    const data = await resp.json();
    const status = data?.status || {};
    const completed = !!(status.developer_completed || status.transaction_verified);
    const cancelled = !!(status.cancelled || status.user_cancelled);

    if (cancelled) return { ok: false, transient: false, reason: 'cancelled', data };
    if (!completed) return { ok: false, transient: false, reason: 'not_completed_yet', data };

    return { ok: true, data };
  } catch (e) {
    console.error('[sgt/_lib] verifyPiPayment error:', e.message);
    return { ok: false, transient: true, reason: 'network_error' };
  }
}

// ── Auth server-to-server: Mart/Games/Hidayatulamin backend manggil ──
// endpoint credit/debit/transfer pakai header ini, BUKAN accessToken user,
// supaya secret Pi user tidak perlu diteruskan-teruskan antar service.
//
// 🔒 FIX: dulu pakai `provided === expected` (perbandingan string biasa),
// yang secara teori bisa dieksploitasi lewat timing attack (waktu respons
// sedikit berbeda tergantung berapa banyak karakter awal yang cocok).
// Sekarang pakai crypto.timingSafeEqual supaya waktu perbandingan selalu
// konstan berapa pun kecocokannya.
function checkInternalSecret(req) {
  const provided = String(req.headers['x-internal-secret'] || '');
  const expected = String(process.env.SGT_INTERNAL_SECRET || '');
  if (!expected) return false;

  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) {
    // Tetap jalankan timingSafeEqual terhadap dirinya sendiri supaya waktu
    // respons untuk kasus "panjang beda" tidak jadi sinyal terpisah.
    crypto.timingSafeEqual(a, a);
    return false;
  }
  return crypto.timingSafeEqual(a, b);
}

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Internal-Secret');
}

// ── Ambil (atau buat) dokumen wallet ──
async function ensureWallet(username, extra = {}) {
  const ref = walletRef(username);
  if (!ref) throw new Error('username tidak valid');
  const snap = await ref.get();
  if (!snap.exists) {
    await ref.set({
      username: walletId(username),
      displayUsername: username,
      sgtBalance: 0,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      ...extra
    });
    return { sgtBalance: 0, username: walletId(username) };
  }
  return snap.data();
}

export {
  admin, db, walletId, walletRef, ledgerRef,
  verifyPiToken, verifyPiPayment, checkInternalSecret, setCors, ensureWallet
};
