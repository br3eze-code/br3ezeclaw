// src/core/database-enhanced.js
const admin = require('firebase-admin');
const { logger } = require('./logger');

class EnhancedDatabase {
  constructor() {
    this.db = null;
    this.localCache = new Map();
    this.syncQueue = [];
    this.isOnline = false;
    
    this._init();
  }

  _init() {
    try {
      if (process.env.FIREBASE_PROJECT_ID) {
        const serviceAccount = {
          projectId: process.env.FIREBASE_PROJECT_ID,
          privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
          clientEmail: process.env.FIREBASE_CLIENT_EMAIL
        };
        
        admin.initializeApp({
          credential: admin.credential.cert(serviceAccount)
        });
        
        this.db = admin.firestore();
        this.isOnline = true;
        
        // Setup real-time listeners
        this._setupSyncListeners();
        
        logger.info('Firebase connected - real-time sync active');
      } else {
        logger.warn('Firebase not configured - running in offline mode');
      }
    } catch (error) {
      logger.error('Firebase init failed:', error.message);
      this.isOnline = false;
    }
  }

  _setupSyncListeners() {
    // Listen for external voucher changes
    this.db.collection('vouchers').onSnapshot(snapshot => {
      snapshot.docChanges().forEach(change => {
        if (change.type === 'modified') {
          // Update local cache
          this.localCache.set(change.doc.id, change.doc.data());
        }
      });
    });
  }

  async createVoucher(code, data) {
    const voucher = {
      ...data,
      code,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      used: false,
      syncStatus: this.isOnline ? 'synced' : 'pending'
    };

    if (this.isOnline) {
      await this.db.collection('vouchers').doc(code).set(voucher);
    } else {
      this.localCache.set(code, voucher);
      this.syncQueue.push({ type: 'create', code, data: voucher });
    }

    // Also store in local backup
    this._persistLocal();
    
    logger.audit('voucher_created', { code, plan: data.plan });
    return voucher;
  }

  async redeemVoucher(code, userData) {
    const update = {
      used: true,
      redeemedBy: userData,
      redeemedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    };

    if (this.isOnline) {
      await this.db.collection('vouchers').doc(code).update(update);
    }

    // Update local cache
    const existing = this.localCache.get(code);
    if (existing) {
      this.localCache.set(code, { ...existing, ...update });
    }

    logger.audit('voucher_redeemed', { code, mac: userData.macAddress });
    return true;
  }

  async getVoucher(code) {
    // Check cache first
    if (this.localCache.has(code)) {
      return this.localCache.get(code);
    }

    if (this.isOnline) {
      const doc = await this.db.collection('vouchers').doc(code).get();
      if (doc.exists) {
        this.localCache.set(code, doc.data());
        return doc.data();
      }
    }

    return null;
  }

  async syncUserData(userId, data) {
    if (!this.isOnline) return false;
    
    await this.db.collection('users').doc(userId).set({
      ...data,
      lastSync: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
    
    return true;
  }

  async getStats() {
    const agg = await this.db.collection('vouchers')
      .where('createdAt', '>', new Date(Date.now() - 86400000))
      .get();
    
    const today = agg.size;
    const used = agg.docs.filter(d => d.data().used).length;
    
    return {
      today,
      used,
      active: today - used,
      revenue: today * 2 // Approximate
    };
  }

  _persistLocal() {
    // Persist to disk for offline recovery
    const fs = require('fs');
    const path = require('path');
    const file = path.join(process.cwd(), 'data', 'vouchers-backup.json');
    
    try {
      if (!fs.existsSync(path.dirname(file))) {
        fs.mkdirSync(path.dirname(file), { recursive: true });
      }
      fs.writeFileSync(file, JSON.stringify(Object.fromEntries(this.localCache), null, 2));
    } catch (e) {
      logger.error('Local persist failed:', e.message);
    }
  }
}

module.exports = new EnhancedDatabase();
