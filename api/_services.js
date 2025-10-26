const admin = require('firebase-admin');
const { google } = require('@googleapis/sheets');

let firebaseApp = null;
let sheetsClient = null;
let sheetsAuth = null;

function buildFirebaseCredential() {
  const projectId =
    process.env.FIREBASE_PROJECT_ID ||
    process.env.GOOGLE_SERVICE_ACCOUNT_PROJECT_ID ||
    process.env.GCP_PROJECT ||
    process.env.GOOGLE_CLOUD_PROJECT;
  const clientEmail =
    process.env.FIREBASE_CLIENT_EMAIL || process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  let privateKey =
    process.env.FIREBASE_PRIVATE_KEY || process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY;

  if (projectId && clientEmail && privateKey) {
    privateKey = privateKey.replace(/\\n/g, '\n');
    return admin.credential.cert({
      projectId,
      clientEmail,
      privateKey,
    });
  }

  try {
    return admin.credential.applicationDefault();
  } catch (error) {
    return null;
  }
}

function getFirebaseApp() {
  if (firebaseApp) {
    return firebaseApp;
  }
  if (admin.apps.length) {
    firebaseApp = admin.app();
    return firebaseApp;
  }

  const credential = buildFirebaseCredential();
  if (!credential) {
    throw new Error('Missing Firebase service account configuration.');
  }

  firebaseApp = admin.initializeApp({ credential });

  return firebaseApp;
}

function getFirestore() {
  return getFirebaseApp().firestore();
}

function getAuth() {
  return getFirebaseApp().auth();
}

async function verifyIdToken(idToken) {
  if (!idToken) {
    throw new Error('Missing Firebase ID token.');
  }
  const auth = getAuth();
  return auth.verifyIdToken(idToken);
}

async function getSheetsClient() {
  if (sheetsClient) {
    return sheetsClient;
  }

  const clientEmail =
    process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || process.env.FIREBASE_CLIENT_EMAIL;
  let privateKey =
    process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY || process.env.FIREBASE_PRIVATE_KEY;

  if (clientEmail && privateKey) {
    privateKey = privateKey.replace(/\\n/g, '\n');

    sheetsAuth = new google.auth.JWT({
      email: clientEmail,
      key: privateKey,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    await sheetsAuth.authorize();
  } else {
    try {
      const googleAuth = new google.auth.GoogleAuth({
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
      });
      sheetsAuth = await googleAuth.getClient();
    } catch (error) {
      throw new Error('Missing Google Sheets service account credentials.');
    }
  }

  sheetsClient = google.sheets({ version: 'v4', auth: sheetsAuth });
  return sheetsClient;
}

async function appendSheetRow(range, values) {
  const spreadsheetId = process.env.GOOGLE_SHEETS_ID;
  if (!spreadsheetId) {
    throw new Error('GOOGLE_SHEETS_ID is not configured.');
  }
  const sheets = await getSheetsClient();
  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range,
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    requestBody: {
      values: [values],
    },
  });
}

module.exports = {
  getFirebaseApp,
  getFirestore,
  getAuth,
  verifyIdToken,
  appendSheetRow,
};
