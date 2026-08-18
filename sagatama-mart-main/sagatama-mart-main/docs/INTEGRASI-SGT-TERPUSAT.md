# Integrasi SGT Terpusat — Panduan untuk Games & Hidayatulamin

Central API sekarang ada di backend Sagatama Mart (`sagatama-backend.vercel.app/api/sgt/*`).
Games dan Hidayatulamin **berhenti menulis `sgtBalance` langsung ke Firestore mereka sendiri**
dan mulai memanggil endpoint ini dari backend masing-masing (server-to-server).

## 1. Environment variable baru (di ketiga project Vercel)

```
SGT_INTERNAL_SECRET=<string acak panjang, sama persis di Mart, Games, Hidayatulamin>
```
Generate sekali, misalnya: `openssl rand -hex 32`. Simpan sebagai secret di Vercel
(Settings → Environment Variables) untuk ketiga project.

## 2. Login — dapatkan username terverifikasi

Setelah `Pi.authenticate()` sukses di frontend manapun, panggil:

```js
const res = await fetch('https://sagatama-backend.vercel.app/api/sgt/ensure', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ accessToken: piAuthResult.accessToken })
});
const { username, sgtBalance } = await res.json();
// simpan `username` di session/local state — ini identitas SGT yang benar,
// BUKAN uid dari Pi.authenticate() (uid itu app-local, beda di tiap app)
```

## 3. Games — ganti `win.js` / `shop-buy.js` supaya manggil central API

Sebelumnya (`api/games/win.js`) langsung `tx.set(playerRef, {sgtBalance: ...})` ke
Firestore lokal. Ganti bagian update saldo dengan panggilan ke central API:

```js
// di dalam handler win.js, GANTI bagian runTransaction Firestore lokal dengan:
const SGT_BACKEND = 'https://sagatama-backend.vercel.app';

async function callSgt(endpoint, body) {
  const res = await fetch(`${SGT_BACKEND}/api/sgt/${endpoint}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Internal-Secret': process.env.SGT_INTERNAL_SECRET
    },
    body: JSON.stringify(body)
  });
  return res.json();
}

// net change bisa positif (menang) atau negatif (kalah) — pisah jadi 2 panggilan
// supaya ledger-nya jelas asalnya dari mana:
if (bet > 0) {
  await callSgt('debit', {
    username, amount: bet, txId: `games_bet_${game_session_id}`, source: 'games_bet'
  });
}
if (earn > 0) {
  await callSgt('credit', {
    username, amount: earn, txId: `games_win_${game_session_id}`, source: 'games_win'
  });
}
```

`games/win.js` masih boleh menyimpan `gameResults` dan `leaderboard` ke Firestore
lokal `portal-sagatama` seperti biasa — yang dipindah HANYA bagian `sgtBalance`.

## 4. Hidayatulamin — ganti `loadSGTBalance()` / `creditSGT()` di `pembayaran.html`

```js
const SGT_BACKEND = 'https://sagatama-backend.vercel.app';

async function loadSGTBalance() {
  try {
    const res = await fetch(`${SGT_BACKEND}/api/sgt/balance`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accessToken: currentPiAccessToken })
    });
    const data = await res.json();
    document.getElementById('topSGTBal').textContent =
      (data.sgtBalance || 0).toLocaleString('id-ID') + ' SGT';
  } catch (e) {
    document.getElementById('topSGTBal').textContent = '— SGT';
  }
}
```

`creditSGT()` (dipanggil server-side di `api/payments/complete.js` milik Hidayatulamin
setelah pembayaran SPP/donasi lunas) ganti jadi panggilan `credit` server-to-server,
persis pola di Games (poin 3), dengan `source: 'hidayatulamin_spp_bonus'` dan
`txId: `hidayatulamin_${paymentId}``.

## 5. Firestore lama — jangan dihapus dulu

Biarkan `users` (Mart), `players` (Games), `sgt` (Hidayatulamin) tetap ada sebagai
arsip/read-only sampai migrasi (`scripts/migrate-sgt-wallets.js`) selesai direview dan
kamu yakin `sgt_wallets` sudah benar. Baru hapus/nonaktifkan penulisan ke collection
lama setelah semua endpoint frontend terbukti pakai central API.

## 6. Urutan rilis yang disarankan

1. Deploy endpoint `/api/sgt/*` baru di Mart (tidak mengubah perilaku lama apa pun).
2. Jalankan `migrate-sgt-wallets.js --report`, review manual, lalu `--apply`.
3. Update Games untuk baca saldo dari central API dulu (read-only), bandingkan dengan
   saldo lama — pastikan sama sebelum switch penulisan.
4. Ulangi untuk Hidayatulamin.
5. Baru setelah ketiganya konsisten, matikan jalur tulis lama satu per satu.
