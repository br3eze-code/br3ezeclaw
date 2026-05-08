require('dotenv').config();
const { initializeFirebase } = require('../src/core/firebase');

async function debugUsers() {
  console.log('--- Debugging Users and Firebase Auth ---');
  
  const { app, db } = initializeFirebase();
  if (!app) {
    console.error('Firebase not initialized. Check your .env file.');
    return;
  }

  try {
    const admin = require('firebase-admin');
    const auth = admin.auth();

    console.log('\nFetching users from Firestore...');
    const usersSnapshot = await db.collection('users').get();
    const firestoreUsers = [];
    usersSnapshot.forEach(doc => {
      firestoreUsers.push({ id: doc.id, ...doc.data() });
    });
    console.log(`Found ${firestoreUsers.length} users in Firestore.`);

    console.log('\nFetching users from Firebase Auth...');
    const authUsersResult = await auth.listUsers(1000);
    const authUsers = authUsersResult.users;
    console.log(`Found ${authUsers.length} users in Firebase Auth.`);

    const authUids = new Set(authUsers.map(u => u.uid));
    const firestoreUids = new Set(firestoreUsers.map(u => u.uid).filter(Boolean));
    const firestoreDocIds = new Set(firestoreUsers.map(u => u.id));

    console.log('\n--- Analysis ---');

    // 1. Firestore users missing 'uid' field
    const missingUidField = firestoreUsers.filter(u => !u.uid);
    if (missingUidField.length > 0) {
      console.log(`⚠️ ${missingUidField.length} Firestore docs missing 'uid' field:`);
      missingUidField.forEach(u => {
        const inAuth = authUids.has(u.id);
        console.log(` - DocID: ${u.id}, Username: ${u.username || 'N/A'}, In Auth? ${inAuth ? 'YES (DocID matches UID)' : 'NO'}`);
      });
    } else {
      console.log('✅ All Firestore users have a \'uid\' field.');
    }

    // 2. Firestore users not in Auth
    const notInAuth = firestoreUsers.filter(u => {
      const uid = u.uid || u.id;
      return !authUids.has(uid);
    });
    if (notInAuth.length > 0) {
      console.log(`\n❌ ${notInAuth.length} Firestore users NOT found in Firebase Auth:`);
      notInAuth.forEach(u => console.log(` - DocID: ${u.id}, UID Field: ${u.uid || 'NONE'}, Username: ${u.username || 'N/A'}`));
    } else {
      console.log('\n✅ All Firestore users exist in Firebase Auth.');
    }

    // 3. Auth users not in Firestore
    const notInFirestore = authUsers.filter(u => !firestoreDocIds.has(u.uid) && !firestoreUids.has(u.uid));
    if (notInFirestore.length > 0) {
      console.log(`\n⚠️ ${notInFirestore.length} Firebase Auth users NOT found in Firestore:`);
      notInFirestore.forEach(u => console.log(` - UID: ${u.uid}, Email: ${u.email || 'N/A'}`));
    } else {
      console.log('\n✅ All Firebase Auth users have a Firestore document.');
    }

  } catch (error) {
    console.error('Debug script failed:', error);
  } finally {
    process.exit(0);
  }
}

debugUsers();
