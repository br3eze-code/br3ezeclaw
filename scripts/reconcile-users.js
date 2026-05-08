require('dotenv').config();
const { initializeFirebase } = require('../src/core/firebase');

async function reconcileUsers() {
  console.log('--- Reconciling Users: Firestore <-> Firebase Auth ---');
  
  const { app, db } = initializeFirebase();
  if (!app) {
    console.error('Firebase not initialized. Check your .env file.');
    return;
  }

  try {
    const admin = require('firebase-admin');
    const auth = admin.auth();

    console.log('\nFetching all Firebase Auth users...');
    const authUsersResult = await auth.listUsers(1000);
    const authUsers = authUsersResult.users;
    console.log(`Found ${authUsers.length} users in Firebase Auth.`);

    for (const authUser of authUsers) {
      const uid = authUser.uid;
      const email = authUser.email;
      console.log(`\nProcessing user: ${email || 'N/A'} (${uid})`);

      const userRef = db.collection('users').doc(uid);
      const userDoc = await userRef.get();

      if (!userDoc.exists) {
        console.log(` ➕ Creating missing Firestore document for UID: ${uid}`);
        await userRef.set({
          uid: uid,
          email: email || null,
          phoneNumber: authUser.phoneNumber || null,
          fullname: authUser.displayName || null,
          username: (email ? email.split('@')[0] : 'user_' + uid.substring(0, 5)),
          role: 'user',
          balance: 0,
          status: 'active',
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });
      } else {
        const userData = userDoc.data();
        if (!userData.uid) {
          console.log(` 🔧 Adding missing 'uid' field to existing document: ${uid}`);
          await userRef.update({
            uid: uid,
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
          });
        } else {
          console.log(` ✅ User document is correct.`);
        }
      }
    }

    console.log('\n--- Reconciliation Complete ---');

  } catch (error) {
    console.error('Reconciliation failed:', error);
  } finally {
    process.exit(0);
  }
}

reconcileUsers();
