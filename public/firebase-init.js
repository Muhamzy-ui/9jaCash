// firebase-init.js — 9jaCash SQL-backed Mock Firebase API (Zero Firebase SDK Overhead)

const BASE_API_URL = window.location.origin;

class DocumentReference {
  constructor(collectionName, docId) {
    this.collectionName = collectionName;
    this.docId = docId;
  }

  async get() {
    let url = '';
    if (this.collectionName === 'settings') {
      url = `/api/settings/${this.docId}`;
    } else if (this.collectionName === 'users') {
      url = `/api/user/details?phone=${encodeURIComponent(this.docId)}`;
    } else {
      url = `/api/receipts/list`;
    }

    try {
      const res = await fetch(url);
      if (!res.ok) return { exists: false, data: () => null };
      const data = await res.json();
      
      if (this.collectionName === 'settings') {
        return { exists: true, data: () => data.value || {} };
      } else if (this.collectionName === 'users') {
        return { exists: data.status && !!data.user, data: () => data.user || null };
      } else {
        // Find receipt by id
        const list = data.receipts || [];
        const found = list.find(r => r.id === this.docId);
        return { exists: !!found, data: () => found || null };
      }
    } catch (e) {
      console.error('Error in Mock DocumentReference get:', e);
      return { exists: false, data: () => null };
    }
  }

  async update(data) {
    let url = '';
    let payload = {};

    if (this.collectionName === 'users') {
      if ('payoutKey' in data) {
        url = '/api/user/update-payout-key';
        payload = { phone: this.docId, payoutKey: data.payoutKey };
      } else {
        url = '/api/user/update-details';
        payload = { phone: this.docId, ...data };
      }
    } else if (this.collectionName === 'settings') {
      url = `/api/settings/${this.docId}`;
      payload = { value: data };
    } else {
      url = '/api/receipts/update-status';
      payload = { id: this.docId, status: data.status };
    }

    if (!url) return;

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      return await res.json();
    } catch (e) {
      console.error('Error in Mock DocumentReference update:', e);
      throw e;
    }
  }

  async set(data) {
    return this.update(data);
  }

  onSnapshot(callback) {
    const runCheck = async () => {
      try {
        const snap = await this.get();
        callback(snap);
      } catch (e) {
        console.error('Error in onSnapshot listener:', e);
      }
    };
    runCheck();
    const interval = setInterval(runCheck, 4000);
    return () => clearInterval(interval);
  }
}

class CollectionReference {
  constructor(collectionName) {
    this.collectionName = collectionName;
    this.filters = [];
  }

  doc(docId) {
    return new DocumentReference(this.collectionName, docId);
  }

  where(field, operator, value) {
    this.filters.push({ field, operator, value });
    return this;
  }

  async get() {
    try {
      if (this.collectionName === 'paymentReceipts' || this.collectionName === 'verifications' || this.collectionName === 'receipts') {
        const res = await fetch('/api/receipts/list');
        const data = await res.json();
        
        let receipts = data.receipts || [];
        
        if (this.collectionName === 'paymentReceipts') {
          receipts = receipts.filter(r => r.type !== 'verification');
        } else if (this.collectionName === 'verifications') {
          receipts = receipts.filter(r => r.type === 'verification');
        }

        this.filters.forEach(f => {
          if (f.field === 'email' || f.field === 'phone') {
            receipts = receipts.filter(r => r.phone === f.value || r.email === f.value);
          }
        });

        return {
          empty: receipts.length === 0,
          docs: receipts.map(r => ({
            id: r.id,
            ref: new DocumentReference(this.collectionName, r.id),
            data: () => r
          }))
        };
      } else if (this.collectionName === 'users') {
        const emailFilter = this.filters.find(f => f.field === 'email');
        if (emailFilter) {
          const res = await fetch(`/api/user/details?phone=${encodeURIComponent(emailFilter.value)}`);
          const data = await res.json();
          if (data.status && data.user) {
            return {
              empty: false,
              docs: [{ id: data.user.phone, data: () => data.user }]
            };
          }
        }
        return { empty: true, docs: [] };
      }
      return { empty: true, docs: [] };
    } catch (e) {
      console.error('Error in Mock CollectionReference get:', e);
      return { empty: true, docs: [] };
    }
  }

  async add(data) {
    let type = this.collectionName === 'verifications' ? 'verification' : (data.flowType || 'upgrade');
    const payload = {
      phone: data.userId || data.phone || localStorage.getItem('9jaCashPhone'),
      userName: data.userName || 'User',
      type: type,
      planName: data.plan || data.planName || null,
      amount: data.amount || data.feeAmount || 0,
      receiptImage: data.receiptImage || data.proofImage
    };

    try {
      const res = await fetch('/api/receipts/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const resData = await res.json();
      if (resData.status) {
        return { id: resData.id };
      } else {
        throw new Error(resData.error || 'Failed to submit receipt');
      }
    } catch (e) {
      console.error('Error in Mock CollectionReference add:', e);
      throw e;
    }
  }
}

class WriteBatch {
  constructor() {
    this.operations = [];
  }
  delete(docRef) {
    this.operations.push({ type: 'delete', ref: docRef });
  }
  async commit() {
    try {
      const res = await fetch('/api/receipts/purge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      const data = await res.json();
      if (!data.status) throw new Error(data.error);
      return true;
    } catch (e) {
      console.error('Error committing Mock WriteBatch:', e);
      throw e;
    }
  }
}

class MockFirestore {
  collection(name) {
    return new CollectionReference(name);
  }
  batch() {
    return new WriteBatch();
  }
}

const mockDb = new MockFirestore();

// Mock Auth system connected to Express SQL auth
const mockAuth = {
  currentUser: null,
  _listener: null,
  signOut: async () => {
    localStorage.removeItem('9jaCashUser');
    mockAuth.currentUser = null;
    if (mockAuth._listener) mockAuth._listener(null);
    return true;
  },
  signInWithEmailAndPassword: async (email, password) => {
    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phoneOrEmail: email, password: password })
      });
      const data = await res.json();
      if (data.status) {
        mockAuth.currentUser = { uid: data.user.phone, email: data.user.email };
        localStorage.setItem('9jaCashUser', JSON.stringify(data.user));
        if (mockAuth._listener) mockAuth._listener(mockAuth.currentUser);
        return { user: mockAuth.currentUser };
      } else {
        throw new Error(data.error || 'Login failed');
      }
    } catch (e) {
      console.error('Mock login error:', e);
      throw e;
    }
  },
  onAuthStateChanged: (callback) => {
    mockAuth._listener = callback;
    const cached = localStorage.getItem('9jaCashUser');
    if (cached) {
      try {
        const u = JSON.parse(cached);
        mockAuth.currentUser = { uid: u.phone, email: u.email };
        callback(mockAuth.currentUser);
      } catch (e) {
        callback(null);
      }
    } else {
      callback(null);
    }
  }
};

window.firebase = {
  app: () => ({}),
  auth: () => mockAuth,
  firestore: () => mockDb
};

window._9jaCash = {
  db: mockDb,
  auth: mockAuth
};

window.db = mockDb;
window.auth = mockAuth;
window.firebaseApp = window.firebase;
console.log('🔌 SQL-backed Mock Firebase client fully initialized.');
