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

import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import fs from 'fs';

function cleanKey(v) {
  return (v || '').replace(/^["']|["']$/g, '').replace(/\\n/g, '\n');
}

// Cara PALING aman: baca langsung dari file JSON service account yang
// kamu download dari Firebase Console (tidak perlu potong-potong private_key
// ke .env — itu sering rusak di Windows/Notepad karena \n ikut berubah jadi
// baris baru sungguhan). Set path filenya lewat env var, contoh di .env:
//   FIREBASE_SERVICE_ACCOUNT_JSON=./portal-sagatama-key.json
//   HIDAYATULAMIN_SERVICE_ACCOUNT_JSON=./hidayatulamin-key.json
function loadCredentialFromJsonFile(path) {
  const raw = fs.readFileSync(path, 'utf8');
  const json = JSON.parse(raw);
  return {
    projectId: json.project_id,
    clientEmail: json.client_email,
    privateKey: json.private_key // sudah dalam format \n yang benar dari JSON, tidak perlu cleanKey
  };
}

function initApp(name, opts) {
  const app = initializeApp({ credential: cert(opts) }, name);
  return getFirestore(app);
}

// Ambil kredensial dari file JSON (prioritas, paling aman) ATAU dari 3 env
// var terpisah (fallback, untuk yang sudah terlanjur isi manual di .env).
function resolveCredential(jsonPathEnv, projectIdEnv, clientEmailEnv, privateKeyEnv) {
  const jsonPath = process.env[jsonPathEnv];
  if (jsonPath) {
    console.log(`[migrate] Baca kredensial dari file JSON: ${jsonPath}`);
    return loadCredentialFromJsonFile(jsonPath);
  }
  if (process.env[projectIdEnv]) {
    return {
      projectId: cleanKey(process.env[projectIdEnv]),
      clientEmail: cleanKey(process.env[clientEmailEnv]),
      privateKey: cleanKey(process.env[privateKeyEnv])
    };
  }
  return null;
}

async function readSource(db, collectionName, balanceField, sourceLabel) {
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
  const martGamesCred = resolveCredential(
    'FIREBASE_SERVICE_ACCOUNT_JSON',
    'FIREBASE_PROJECT_ID', 'FIREBASE_CLIENT_EMAIL', 'FIREBASE_PRIVATE_KEY'
  );
  if (!martGamesCred) {
    throw new Error('Kredensial portal-sagatama tidak ditemukan. Set FIREBASE_SERVICE_ACCOUNT_JSON=./nama-file.json di .env');
  }
  const martGamesDb = initApp('portal-sagatama', martGamesCred);

  const rows = [];
  rows.push(...await readSource(martGamesDb, 'users', 'sgtBalance', 'mart'));
  rows.push(...await readSource(martGamesDb, 'players', 'sgtBalance', 'games'));

  const hidayatulaminCred = resolveCredential(
    'HIDAYATULAMIN_SERVICE_ACCOUNT_JSON',
    'HIDAYATULAMIN_PROJECT_ID', 'HIDAYATULAMIN_CLIENT_EMAIL', 'HIDAYATULAMIN_PRIVATE_KEY'
  );
  if (hidayatulaminCred) {
    const hidayatulaminDb = initApp('hidayatulamin-e6f22', hidayatulaminCred);
    rows.push(...await readSource(hidayatulaminDb, 'sgt', 'balance', 'hidayatulamin'));
  } else {
    console.warn('[migrate] Kredensial Hidayatulamin tidak diset — sumber Hidayatulamin dilewati.');
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
  const cred = resolveCredential(
    'FIREBASE_SERVICE_ACCOUNT_JSON',
    'FIREBASE_PROJECT_ID', 'FIREBASE_CLIENT_EMAIL', 'FIREBASE_PRIVATE_KEY'
  );
  if (!cred) {
    throw new Error('Kredensial portal-sagatama tidak ditemukan. Set FIREBASE_SERVICE_ACCOUNT_JSON=./nama-file.json di .env');
  }
  const db = initApp('portal-sagatama-apply', cred);

  let count = 0;
  for (const entry of report) {
    const ref = db.collection('sgt_wallets').doc(entry.username);
    await ref.set({
      username: entry.username,
      displayUsername: entry.username,
      sgtBalance: entry.proposedTotal,
      migratedFrom: entry.sources,
      migratedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp()
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
