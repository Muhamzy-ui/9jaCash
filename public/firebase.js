// firebase.js — 9jaCash
// Initialize Firebase and export _9jaCash global for all pages

const firebaseConfig = {
apiKey: "AIzaSyAojnW_iRXCk4mR9ihRz8GwQI4aPWIXepA",
  authDomain: "jacash-51c97.firebaseapp.com",
  databaseURL: "https://jacash-51c97-default-rtdb.firebaseio.com",
  projectId: "jacash-51c97",
  storageBucket: "jacash-51c97.firebasestorage.app",
  messagingSenderId: "662540432833",
  appId: "1:662540432833:web:244b7af8ea02ab56b76b40",
  measurementId: "G-CEN430143Z"
};


// Initialize Firebase
if (typeof firebase !== 'undefined') {
  firebase.initializeApp(firebaseConfig);
  console.log('Firebase initialized successfully');

  const dbInstance = typeof firebase.firestore === 'function' ? firebase.firestore() : null;
  if (dbInstance) {
    try {
      dbInstance.settings({ experimentalForceLongPolling: true });
      console.log('Firestore: long polling enabled');
    } catch(e) {
      console.warn('Firestore settings error:', e);
    }
  }

  // Create the _9jaCash global object that ALL pages expect
  window._9jaCash = {
    app: firebase.app(),
    db: dbInstance,
    auth: typeof firebase.auth === 'function' ? firebase.auth() : null,
    analytics: typeof firebase.analytics === 'function' ? firebase.analytics() : null
  };

  console.log('_9jaCash ready:', !!window._9jaCash.db);
} else {
  console.warn('Firebase SDK not loaded');
}

// Also keep old export for compatibility
window.firebaseApp = firebase;

// Create first admin account helper (run once in console)
async function createFirstAdmin(email, password) {
  try {
    const userCredential = await firebase.auth().createUserWithEmailAndPassword(email, password);
    const user = userCredential.user;
    
    await firebase.firestore().collection('admins').doc(user.uid).set({
      email: email,
      role: 'admin',
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      isActive: true
    });
    
    console.log('Admin created successfully:', user.uid);
    return user;
  } catch (error) {
    console.error('Error creating admin:', error);
  }
}

window.createFirstAdmin = createFirstAdmin;
