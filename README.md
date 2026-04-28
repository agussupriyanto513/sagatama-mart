# Sagatama Mart — Vercel Backend Setup

## Struktur folder

```
sagatama-vercel/
├── api/
│   └── payments/
│       ├── approve.js    ← POST /api/payments/approve
│       ├── complete.js   ← POST /api/payments/complete
│       └── cancel.js     ← POST /api/payments/cancel
├── public/
│   └── index.html        ← pindahkan index.html kamu ke sini
├── vercel.json
└── README.md
```

## Langkah deploy

### 1. Siapkan folder
Pindahkan `index.html` kamu ke dalam folder `public/`.

### 2. Dapatkan Pi Server API Key
- Buka https://developers.minepi.com
- Login → pilih app Sagatama Mart
- Salin **Server API Key** (bukan App ID)

### 3. Deploy ke Vercel

**Cara A — via Vercel CLI (recommended):**
```bash
npm install -g vercel
cd sagatama-vercel
vercel
```
Ikuti instruksi, pilih project baru.

**Cara B — via GitHub:**
1. Upload folder ini ke GitHub repo
2. Buka https://vercel.com → New Project → Import repo
3. Vercel otomatis detect struktur dan deploy

### 4. Set Environment Variables di Vercel

Setelah deploy, buka **Vercel Dashboard → Project → Settings → Environment Variables**:

| Key | Value |
|-----|-------|
| `PI_API_KEY` | Server API Key dari developers.minepi.com |
| `ALLOWED_ORIGIN` | URL app kamu, contoh: `https://sagatama-mart.vercel.app` |

Klik **Save**, lalu **Redeploy** project.

### 5. Test endpoint

```bash
curl -X POST https://your-app.vercel.app/api/payments/approve \
  -H "Content-Type: application/json" \
  -d '{"paymentId": "test123"}'
```

Harusnya dapat respons JSON (bukan 404).

## Catatan penting

- `PI_API_KEY` **jangan pernah** dimasukkan ke `index.html` — harus di environment variable server
- Endpoint ini otomatis berjalan sebagai serverless function di Vercel
- Tidak perlu server VPS atau Node.js sendiri
