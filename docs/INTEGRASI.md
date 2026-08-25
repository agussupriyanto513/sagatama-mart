# Panduan Integrasi Sistem Member (Whitelist)

## 1. File yang ditambahkan
```
api/utils/checkMember.js   -> fungsi shared cek status member
api/members/check.js       -> dipanggil frontend setelah login Pi
api/members/list.js        -> admin: lihat semua member
api/members/add.js         -> admin: tambah/aktifkan member
api/members/remove.js      -> admin: hapus/blokir member
admin-members.html         -> halaman admin (taruh di /public atau root, terserah struktur project)
```

## 2. Environment Variable baru
Tambahkan di Vercel (Project `sagatama-mart` dan project lain kalau perlu):

- `ADMIN_SECRET` — password untuk akses halaman admin & endpoint /api/members/*.
  Pilih string acak yang panjang, JANGAN dipakai ulang dari secret lain.

Kalau `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY`
belum ada (mis. `firebase-init.js` yang sudah ada pakai cara inisialisasi
berbeda), sesuaikan bagian `getDb()` di `api/utils/checkMember.js` supaya
konsisten dengan punya Budi — intinya cukup pastikan dia mengembalikan
instance Firestore dari project `portal-sagatama`.

## 3. Buat koleksi Firestore `members`
Tidak perlu dibuat manual — otomatis muncul begitu admin menambah member
pertama lewat `admin-members.html`. Struktur tiap dokumen:
```
members/{uid}
  uid: string
  username: string | null
  status: "active" | "pending" | "blocked"
  addedAt: Timestamp
```

## 4. Guard di frontend checkout (WAJIB tapi bukan satu-satunya lapisan)
Di file frontend Sagatama Mart, setelah proses login Pi Network berhasil
dan Budi punya `customerUid`, tambahkan pengecekan:

```js
async function checkMembership(uid) {
  try {
    const res = await fetch('/api/members/check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ uid }),
    });
    const data = await res.json();
    return data.isMember === true;
  } catch (e) {
    console.error('Gagal cek membership:', e);
    return false; // fail-closed: kalau error, anggap bukan member
  }
}

// Setelah login Pi sukses dan dapat authResult.user.uid:
const isMember = await checkMembership(authResult.user.uid);
const checkoutBtn = document.getElementById('checkoutBtn'); // sesuaikan id tombol asli

if (!isMember) {
  checkoutBtn.disabled = true;
  checkoutBtn.classList.add('opacity-50', 'cursor-not-allowed');
  checkoutBtn.title = 'Belum terdaftar sebagai member. Hubungi admin untuk didaftarkan.';
  // opsional: tampilkan banner/pesan di UI
}
```

## 5. Guard di backend — INI YANG PALING PENTING (security)
Cek membership di frontend saja BISA DIBYPASS (user tinggal edit JS lewat
DevTools). Supaya benar-benar aman, tambahkan pengecekan yang sama di
`api/payments/approve.js` (dan idealnya juga `complete.js`), SEBELUM
approve payment diproses:

```js
const { checkMemberStatus } = require('../utils/checkMember');

// ... di dalam handler approve, setelah dapat uid dari payment metadata/body:
const { isMember } = await checkMemberStatus(uid);

if (!isMember) {
  console.log('[approve] DITOLAK — bukan member:', uid);
  return res.status(403).json({ error: 'not_a_member', error_message: 'User is not a registered member' });
}

// lanjutkan proses approve seperti biasa...
```

Ganti `uid` di atas dengan variabel yang memang sudah dipakai di kode
approve Budi saat ini (biasanya `payment.user_uid` dari payload Pi, atau
`req.body.metadata.customerUid` — sesuaikan dengan yang sudah ada).

## 6. Cara pakai halaman admin
1. Deploy `admin-members.html` (misalnya jadi bisa diakses di
   `sagatama-mart.vercel.app/admin-members.html`).
2. Buka halaman itu, masukkan `ADMIN_SECRET` yang sama dengan di Vercel env var.
3. Tambah UID member baru — UID bisa didapat dari:
   - Log Vercel saat user pernah mencoba checkout (field `user_uid`)
   - Atau minta user login dulu (nanti keliatan gagal karena belum member),
     lalu Budi lihat UID-nya dari log, baru didaftarkan.
4. Setelah didaftarkan dengan status `active`, user itu bisa langsung checkout.

## 7. Yang perlu Budi putuskan sebelum deploy
- Halaman `admin-members.html` sebaiknya JANGAN ditaruh di navigasi/menu
  publik — cukup diakses lewat URL langsung yang hanya Budi tahu, supaya
  tidak gampang ditemukan orang lain (secara teknis sudah dilindungi
  `ADMIN_SECRET`, tapi tetap baiknya tidak dipublikasikan linknya).
- Pertimbangkan tambah rate-limit sederhana di `/api/members/check` kalau
  khawatir endpoint itu di-spam (opsional, bukan prioritas awal).
