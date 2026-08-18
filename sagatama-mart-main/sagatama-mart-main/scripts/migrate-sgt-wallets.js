// scripts/migrate-sgt-wallets.js
//
// TUJUAN: konsolidasi saldo SGT lama yang tersebar di 3 tempat berbeda:
//   1. portal-sagatama  / collection "users"   (Sagatama Mart)   → field sgtBalance
//   2. portal-sagatama  / collection "players" (Sagatama Games)  → field sgtBalance
//   3. hidayatulamin-e6f22 / collection "sgt"  (Hidayatulamin)   → field balance
// ke collection baru terpusat:
//   portal-sagatama / collection "sgt_wallets" / doc = username (lowercase)
//
// KENAPA TIDAK LANGSUNG DIJUMLAH OTOMATIS:
// Karena identitas lama disimpan per-uid (app-local), bukan per-username,
// ada kemungkinan satu Pioneer punya SATU baris di tiap app tapi juga
// mungkin ada baris "sampah" (akun test, uid ganda karena bug, dll).
// Menjumlahkan otomatis TANPA review bisa menciptakan saldo yang salah
// dan mengejutkan Pioneer (lebih besar atau lebih kecil dari yang mereka
// kira). Jadi alurnya dua tahap:
//
//   STEP 1 (default): node migrate-sgt-wallets.js --report
//     → Membaca 3 sumber, mengelompokkan per-username, TIDAK menulis apa-apa.
//     → Menghasilkan file migration-report.json berisi tiap username +
//       rincian saldo dari tiap sumber + saldo gabungan yang DIUSULKAN.
//
//   STEP 2 (setelah kamu/admin review & edit manual migration-report.json
//   kalau ada yang janggal):
//     node migrate-sgt-wallets.js --apply migration-report.json
//     → Menulis ke sgt_wallets sesuai isi file itu. Idempotent — aman
//       dijalankan ulang, akan overwrite ke nilai yang sama.
//
// Jalankan dari root project sagatama-mart-main:
//   node scripts/migrate-sgt-wallets.js --report
//
// Environment variables yang dibutuhkan (isi di .env sebelum run):
//   FIREBASE_PROJECT_ID / FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY
//     → kredensial project portal-sagatama (Mart + Games)
//   HIDAYATULAMIN_PROJECT_ID / HIDAYATULAMIN_CLIENT_EMAIL / HIDAYATULAMIN_PRIVATE_KEY
//     → kredensial project hidayatulamin-e6f22 (service account TERPISAH,
//       generate dari Firebase Console project itu sendiri)

import admin from 'firebase-admin';
import fs from 'fs';

function cleanKey(v) {
  return (v || '').replace(/^["']|["']$/g, '').replace(/\\n/g, '\n');
}

function initApp(name, projectId, clientEmail, privateKey) {
  return admin.initializeApp({
    credential: admin.credential.cert({
      projectId: cleanKey(projectId),
      clientEmail: cleanKey(clientEmail),
      privateKey: cleanKey(privateKey)
    })
  }, name);
}

async function readSource(app, collectionName, balanceField, sourceLabel) {
  const db = admin.firestore(app);
  const snap = await db.collection(collectionName).get();
  const rows = [];
  snap.forEach(doc => {
    const d = doc.data();
    const username = (d.username || d.piUsername || '').trim().toLowerCase();
    const balance = parseFloat(d[balanceField]) || 0;
    if (!username) {
      console.warn(`[${sourceLabel}] Dokumen ${doc.id} tidak punya field username — dilewati, cek manual.`);
      return;
    }
    rows.push({ source: sourceLabel, docId: doc.id, username, balance });
  });
  return rows;
}

async function buildReport() {
  const martGamesApp = initApp(
    'portal-sagatama',
    process.env.FIREBASE_PROJECT_ID,
    process.env.FIREBASE_CLIENT_EMAIL,
    process.env.FIREBASE_PRIVATE_KEY
  );

  const rows = [];
  rows.push(...await readSource(martGamesApp, 'users', 'sgtBalance', 'mart'));
  rows.push(...await readSource(martGamesApp, 'players', 'sgtBalance', 'games'));

  if (process.env.HIDAYATULAMIN_PROJECT_ID) {
    const hidayatulaminApp = initApp(
      'hidayatulamin-e6f22',
      process.env.HIDAYATULAMIN_PROJECT_ID,
      process.env.HIDAYATULAMIN_CLIENT_EMAIL,
      process.env.HIDAYATULAMIN_PRIVATE_KEY
    );
    rows.push(...await readSource(hidayatulaminApp, 'sgt', 'balance', 'hidayatulamin'));
  } else {
    console.warn('[migrate] HIDAYATULAMIN_PROJECT_ID tidak diset — sumber Hidayatulamin dilewati.');
  }

  // Kelompokkan per username
  const byUsername = {};
  for (const r of rows) {
    if (!byUsername[r.username]) byUsername[r.username] = { username: r.username, sources: [], proposedTotal: 0 };
    byUsername[r.username].sources.push({ source: r.source, docId: r.docId, balance: r.balance });
    byUsername[r.username].proposedTotal += r.balance;
  }

  const report = Object.values(byUsername).sort((a, b) => b.proposedTotal - a.proposedTotal);

  fs.writeFileSync('migration-report.json', JSON.stringify(report, null, 2));
  console.log(`\n✅ migration-report.json dibuat — ${report.length} username unik ditemukan.`);
  console.log('⚠️  REVIEW dulu file ini sebelum apply, terutama username dengan saldo dari >1 sumber');
  console.log('    yang nilainya jomplang jauh (kemungkinan bug/duplikat lama).\n');

  const multi = report.filter(r => r.sources.length > 1);
  console.log(`ℹ️  ${multi.length} username punya saldo di lebih dari 1 app — ini kandidat utama untuk direview manual.`);
}

async function applyReport(reportPath) {
  const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  const app = initApp(
    'portal-sagatama-apply',
    process.env.FIREBASE_PROJECT_ID,
    process.env.FIREBASE_CLIENT_EMAIL,
    process.env.FIREBASE_PRIVATE_KEY
  );
  const db = admin.firestore(app);

  let count = 0;
  for (const entry of report) {
    const ref = db.collection('sgt_wallets').doc(entry.username);
    await ref.set({
      username: entry.username,
      displayUsername: entry.username,
      sgtBalance: entry.proposedTotal,
      migratedFrom: entry.sources,
      migratedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
    count++;
  }
  console.log(`✅ ${count} wallet ditulis ke sgt_wallets.`);
}

const args = process.argv.slice(2);
if (args.includes('--report')) {
  buildReport().catch(e => { console.error(e); process.exit(1); });
} else if (args.includes('--apply')) {
  const path = args[args.indexOf('--apply') + 1] || 'migration-report.json';
  applyReport(path).catch(e => { console.error(e); process.exit(1); });
} else {
  console.log('Gunakan: node migrate-sgt-wallets.js --report');
  console.log('     atau: node migrate-sgt-wallets.js --apply migration-report.json');
}
