'use strict';

const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

async function check() {
    if (!admin.apps.length) {
        const saPath = process.env.FIREBASE_SERVICE_ACCOUNT || './serviceAccountKey.json';
        if (fs.existsSync(saPath)) admin.initializeApp({ credential: admin.credential.cert(require(path.resolve(saPath))) });
        else admin.initializeApp({ credential: admin.credential.applicationDefault() });
    }

    const db = admin.firestore();
    const plansRef = db.collection('plans');
    const snapshot = await plansRef.get();

    console.log(`Found ${snapshot.size} plans.`);
    snapshot.forEach(doc => {
        console.log(`- ${doc.id}: keys=[${Object.keys(doc.data()).join(', ')}]`);
    });
}

check().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
