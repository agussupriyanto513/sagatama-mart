// ================================================================
// FIREBASE CLOUD FUNCTION untuk Sagatama Mart - Pi Payment
// File: functions/index.js
// ================================================================
// CARA DEPLOY:
// 1. npm install -g firebase-tools
// 2. firebase login
// 3. Buat folder "functions" di project, copy file ini ke functions/index.js
// 4. cd functions && npm install firebase-functions axios
// 5. firebase functions:config:set pi.serverkey="ISI_SERVER_KEY_DARI_PI_DEVELOPER_PORTAL"
// 6. firebase deploy --only functions
// ================================================================

const functions = require('firebase-functions');
const axios     = require('axios');

// Pi Network Server API Key — di-set via: firebase functions:config:set pi.serverkey="..."
// Dapatkan dari: https://developers.minepi.com → App → API Keys → Server-Side Key
const PI_SERVER_KEY = functions.config().pi?.serverkey || process.env.PI_SERVER_KEY || '';

// Validasi konfigurasi saat startup
if (!PI_SERVER_KEY) {
    console.error('⚠️  PI_SERVER_KEY tidak dikonfigurasi! Jalankan:');
    console.error('   firebase functions:config:set pi.serverkey="l7qurexyafoqorzaikws6xw7maokynqhbl7zswetejazo1k517hvhvbiipgia5qt"');
}

/**
 * piPaymentAction — dipanggil dari frontend via httpsCallable
 * Meneruskan request approve/complete ke Pi Platform API
 * dengan Server API Key (aman karena ada di server)
 */
exports.piPaymentAction = functions
    .region('asia-southeast1') // Jakarta — paling dekat dengan Indonesia
    .https.onCall(async (data, context) => {

        const { endpoint, method = 'POST', body = {} } = data;

        // Validasi: hanya izinkan endpoint payments
        if (!endpoint || !endpoint.startsWith('/payments/')) {
            throw new functions.https.HttpsError('invalid-argument', 'Endpoint tidak valid');
        }
        // Validasi: hanya approve dan complete
        if (!endpoint.includes('/approve') && !endpoint.includes('/complete')) {
            throw new functions.https.HttpsError('invalid-argument', 'Action tidak diizinkan');
        }

        if (!PI_SERVER_KEY) {
            throw new functions.https.HttpsError('failed-precondition', 'PI_SERVER_KEY belum dikonfigurasi di Firebase');
        }

        const url = 'https://api.minepi.com/v2' + endpoint;
        console.log('[Pi API] Calling:', method, url);

        try {
            const response = await axios({
                method,
                url,
                data: body,
                headers: {
                    'Authorization': 'Key ' + PI_SERVER_KEY,
                    'Content-Type': 'application/json'
                },
                timeout: 15000 // 15 detik timeout
            });

            console.log('[Pi API] Response:', response.status, JSON.stringify(response.data).substring(0, 200));
            return { success: true, status: response.status, data: response.data };

        } catch (err) {
            const status = err.response?.status || 500;
            const errData = err.response?.data || { message: err.message };
            console.error('[Pi API] Error:', status, JSON.stringify(errData));
            throw new functions.https.HttpsError('internal', 
                'Pi API error ' + status + ': ' + JSON.stringify(errData)
            );
        }
    });
