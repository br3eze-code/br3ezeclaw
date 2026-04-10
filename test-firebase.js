require('dotenv').config();
const admin = require('firebase-admin');

try {
    admin.initializeApp({
        credential: admin.credential.cert({
            projectId: process.env.FIREBASE_PROJECT_ID,
            privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
            clientEmail: process.env.FIREBASE_CLIENT_EMAIL
        })
    });

    console.log('✅ Firebase connected!');
    console.log('Project:', process.env.FIREBASE_PROJECT_ID);

    // Test write
    const db = admin.firestore();
    db.collection('test').doc('connection').set({
        timestamp: new Date(),
        status: 'working'
    }).then(() => {
        console.log('✅ Write test passed!');
        process.exit(0);
    });

} catch (error) {
    console.error('❌ Firebase connection failed:', error.message);
    process.exit(1);
}