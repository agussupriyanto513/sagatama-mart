// scripts/verify-sgt-migration.js
//
// TUJUAN: verifikasi OTOMATIS bahwa migrasi ke sgt_wallets sudah benar,
// tanpa perlu cek manual satu-satu akun.
//
// Yang dicek:
//   1. TOTAL saldo per sumber lama (users, players, hidayatulamin/sgt)
//      dibandingkan TOTAL sgtBalance di sgt_wallets — harus (hampir) sama.
//   2. Wallet "mencurigakan": ada di sgt_wallets tapi sgtBalance = 0 DAN
//      field migratedFrom TIDAK ADA — ini tanda wallet ke-generate
//      otomatis oleh ensure.js SEBELUM migrate --apply dijalankan,
//      padahal user itu punya saldo di sumber lama (kandidat "SGT hilang").
//   3. Username yang ADA di sumber lama tapi TIDAK ADA sama sekali di
//      sgt_wallets — berarti belum pernah ke-migrasi atau belum pernah login.
//   4. Selisih saldo per-username antara total sumber lama vs sgt_wallets,
//      untuk username yang jumlahnya beda dari yang diharapkan.
//
// Script ini HANYA MEMBACA — tidak menulis apa pun ke Firestore manapun.
//
// Jalankan dari root project (sama seperti migrate-sgt-wallets.js):
//   node scripts/verify-sgt-migration.js
//
// Env var yang dibutuhkan — SAMA PERSIS seperti migrate-sgt-wallets.js:
//   FIREBASE_SERVICE_ACCOUNT_JSON=./portal-sagatama-key.json
//   HIDAYATULAMIN_SERVICE_ACCOUNT_JSON=./hidayatulamin-key.json   (opsional)

import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import fs from 'fs';

function cleanKey(v) {
  return (v || '').replace(/^["']|["']$/g, '').replace(/\\n/g, '\n');
}

function loadCredentialFromJsonFile(path) {
  const raw = fs.readFileSync(path, 'utf8');
  const json = JSON.parse(raw);
  return {
    projectId: json.project_id,
    clientEmail: json.client_email,
    privateKey: json.private_key
  };
}

function resolveCredential(jsonPathEnv, projectIdEnv, clientEmailEnv, privateKeyEnv) {
  const jsonPath = process.env[jsonPathEnv];
  if (jsonPath) return loadCredentialFromJsonFile(jsonPath);
  if (process.env[projectIdEnv]) {
    return {
      projectId: cleanKey(process.env[projectIdEnv]),
      clientEmail: cleanKey(process.env[clientEmailEnv]),
      privateKey: cleanKey(process.env[privateKeyEnv])
    };
  }
  return null;
}

function initApp(name, opts) {
  const app = initializeApp({ credential: cert(opts) }, name);
  return getFirestore(app);
}

async function readSource(db, collectionName, balanceField, sourceLabel) {
  const snap = await db.collection(collectionName).get();
  const rows = [];
  snap.forEach(doc => {
    const d = doc.data();
    const username = (d.username || d.piUsername || '').trim().toLowerCase();
    const balance = parseFloat(d[balanceField]) || 0;
    if (!username) return; // sudah di-warn oleh migrate-sgt-wallets.js --report
    rows.push({ source: sourceLabel, docId: doc.id, username, balance });
  });
  return rows;
}

async function readWallets(db) {
  const snap = await db.collection('sgt_wallets').get();
  const wallets = {};
  snap.forEach(doc => {
    const d = doc.data();
    wallets[doc.id] = {
      sgtBalance: parseFloat(d.sgtBalance) || 0,
      hasMigratedFrom: Array.isArray(d.migratedFrom) && d.migratedFrom.length > 0,
      createdAt: d.createdAt || null
    };
  });
  return wallets;
}

const fmt = (n) => n.toLocaleString('id-ID', { maximumFractionDigits: 4 });

async function main() {
  const martGamesCred = resolveCredential(
    'FIREBASE_SERVICE_ACCOUNT_JSON',
    'FIREBASE_PROJECT_ID', 'FIREBASE_CLIENT_EMAIL', 'FIREBASE_PRIVATE_KEY'
  );
  if (!martGamesCred) {
    throw new Error('Kredensial portal-sagatama tidak ditemukan. Set FIREBASE_SERVICE_ACCOUNT_JSON=./nama-file.json di .env');
  }
  const martGamesDb = initApp('portal-sagatama-verify', martGamesCred);

  const oldRows = [];
  oldRows.push(...await readSource(martGamesDb, 'users', 'sgtBalance', 'mart'));
  oldRows.push(...await readSource(martGamesDb, 'players', 'sgtBalance', 'games'));

  const hidayatulaminCred = resolveCredential(
    'HIDAYATULAMIN_SERVICE_ACCOUNT_JSON',
    'HIDAYATULAMIN_PROJECT_ID', 'HIDAYATULAMIN_CLIENT_EMAIL', 'HIDAYATULAMIN_PRIVATE_KEY'
  );
  let hidayatulaminChecked = false;
  if (hidayatulaminCred) {
    const hidayatulaminDb = initApp('hidayatulamin-e6f22-verify', hidayatulaminCred);
    oldRows.push(...await readSource(hidayatulaminDb, 'sgt', 'balance', 'hidayatulamin'));
    hidayatulaminChecked = true;
  } else {
    console.warn('[verify] Kredensial Hidayatulamin tidak diset — sumber Hidayatulamin DILEWATI dari verifikasi ini.\n');
  }

  // Kelompokkan saldo lama per username
  const oldByUsername = {};
  for (const r of oldRows) {
    if (!oldByUsername[r.username]) oldByUsername[r.username] = { total: 0, sources: [] };
    oldByUsername[r.username].total += r.balance;
    oldByUsername[r.username].sources.push(`${r.source}:${fmt(r.balance)}`);
  }

  const wallets = await readWallets(martGamesDb);

  const oldTotal = Object.values(oldByUsername).reduce((s, v) => s + v.total, 0);
  const newTotal = Object.values(wallets).reduce((s, v) => s + v.sgtBalance, 0);

  console.log('========================================');
  console.log(' VERIFIKASI MIGRASI SGT');
  console.log('========================================\n');

  console.log(`Sumber lama dibaca   : mart, games${hidayatulaminChecked ? ', hidayatulamin' : ' (hidayatulamin DILEWATI)'}`);
  console.log(`Username unik (lama) : ${Object.keys(oldByUsername).length}`);
  console.log(`Wallet di sgt_wallets: ${Object.keys(wallets).length}\n`);

  console.log(`TOTAL saldo lama     : ${fmt(oldTotal)} SGT`);
  console.log(`TOTAL saldo baru     : ${fmt(newTotal)} SGT`);
  const diff = newTotal - oldTotal;
  if (Math.abs(diff) < 0.0001) {
    console.log('✅ Total cocok — migrasi tampak lengkap dan akurat.\n');
  } else {
    console.log(`⚠️  SELISIH TOTAL: ${diff > 0 ? '+' : ''}${fmt(diff)} SGT ${diff < 0 ? '(saldo baru LEBIH KECIL dari lama — cek detail di bawah)' : '(saldo baru lebih besar — cek duplikasi)'}\n`);
  }

  // Kandidat "wallet ke-generate 0 sebelum migrasi" (bug ensure.js)
  const suspiciousZero = [];
  for (const [username, w] of Object.entries(wallets)) {
    if (w.sgtBalance === 0 && !w.hasMigratedFrom && oldByUsername[username] && oldByUsername[username].total > 0) {
      suspiciousZero.push({ username, expected: oldByUsername[username].total, sources: oldByUsername[username].sources });
    }
  }
  if (suspiciousZero.length > 0) {
    console.log(`🚨 ${suspiciousZero.length} akun kemungkinan KENA BUG "saldo 0 sebelum migrasi":`);
    console.log('   (wallet ada, sgtBalance = 0, tidak ada migratedFrom, padahal punya saldo di sumber lama)\n');
    for (const s of suspiciousZero.slice(0, 20)) {
      console.log(`   - ${s.username}: seharusnya ${fmt(s.expected)} SGT (${s.sources.join(', ')})`);
    }
    if (suspiciousZero.length > 20) console.log(`   ... dan ${suspiciousZero.length - 20} lainnya (lihat verify-report.json untuk daftar lengkap)`);
    console.log('   → Perbaikan: jalankan ulang migrate-sgt-wallets.js --report lalu --apply,');
    console.log('     script apply akan overwrite sgtBalance yang salah ini dengan angka yang benar.\n');
  } else {
    console.log('✅ Tidak ada wallet yang kena bug "saldo 0 sebelum migrasi".\n');
  }

  // Username lama yang belum sama sekali punya wallet baru
  const missingWallet = Object.keys(oldByUsername).filter(u => !wallets[u]);
  if (missingWallet.length > 0) {
    console.log(`ℹ️  ${missingWallet.length} username punya saldo di sumber lama tapi BELUM PUNYA wallet sama sekali di sgt_wallets:`);
    for (const u of missingWallet.slice(0, 20)) {
      console.log(`   - ${u}: ${fmt(oldByUsername[u].total)} SGT (${oldByUsername[u].sources.join(', ')})`);
    }
    if (missingWallet.length > 20) console.log(`   ... dan ${missingWallet.length - 20} lainnya`);
    console.log('   → Ini wajar kalau migrate --apply belum pernah dijalankan sama sekali,');
    console.log('     atau user itu belum pernah login lagi sejak migrasi.\n');
  }

  // Username yang saldonya beda (bukan nol, tapi juga bukan sama persis)
  const mismatched = [];
  for (const [username, old] of Object.entries(oldByUsername)) {
    const w = wallets[username];
    if (!w) continue; // sudah dilaporkan di missingWallet
    if (Math.abs(w.sgtBalance - old.total) > 0.0001 && !(w.sgtBalance === 0 && !w.hasMigratedFrom)) {
      mismatched.push({ username, old: old.total, new: w.sgtBalance, sources: old.sources });
    }
  }
  if (mismatched.length > 0) {
    console.log(`⚠️  ${mismatched.length} username punya saldo BEDA antara lama vs sgt_wallets (di luar kasus bug di atas):`);
    for (const m of mismatched.slice(0, 20)) {
      console.log(`   - ${m.username}: lama=${fmt(m.old)} (${m.sources.join(', ')}) → sekarang=${fmt(m.new)}`);
    }
    if (mismatched.length > 20) console.log(`   ... dan ${mismatched.length - 20} lainnya`);
    console.log('');
  }

  const report = {
    generatedAt: new Date().toISOString(),
    hidayatulaminChecked,
    oldTotal, newTotal, diff,
    suspiciousZeroCount: suspiciousZero.length,
    suspiciousZero,
    missingWalletCount: missingWallet.length,
    missingWallet: missingWallet.map(u => ({ username: u, ...oldByUsername[u] })),
    mismatchedCount: mismatched.length,
    mismatched
  };
  fs.writeFileSync('verify-report.json', JSON.stringify(report, null, 2));
  console.log('📄 Detail lengkap ditulis ke verify-report.json');

  if (!hidayatulaminChecked) {
    console.log('\n⚠️  INGAT: sumber Hidayatulamin tidak ikut diverifikasi karena kredensialnya');
    console.log('    tidak diset. Jalankan lagi dengan HIDAYATULAMIN_SERVICE_ACCOUNT_JSON diisi');
    console.log('    supaya verifikasi benar-benar lengkap.');
  }
}

main().catch(e => { console.error(e); process.exit(1); });
