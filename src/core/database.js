const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');

const { STATE_PATH } = require('./config');
const { logger } = require('./logger');

class Database {
    constructor() {
        this.db = null;
        this.localFallback = new Map();
        this.dataPath = path.join(STATE_PATH, 'vouchers.json');
        this.init();
    }

    init() {
        try {
            if (process.env.FIREBASE_PROJECT_ID) {
                admin.initializeApp({
                    credential: admin.credential.cert({
                        projectId: process.env.FIREBASE_PROJECT_ID,
                        privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
                        clientEmail: process.env.FIREBASE_CLIENT_EMAIL
                    })
                });
                this.db = admin.firestore();
                logger.info('Firebase initialized');
            } else {
                logger.info('Using local file storage');
                this.loadLocalData();
            }
        } catch (error) {
            logger.error('Firebase init failed, using fallback:', error.message);
            this.loadLocalData();
        }
    }

    loadLocalData() {
        try {
            if (fs.existsSync(this.dataPath)) {
                const data = JSON.parse(fs.readFileSync(this.dataPath, 'utf8'));
                Object.entries(data).forEach(([k, v]) => this.localFallback.set(k, v));
                logger.info(`Loaded ${this.localFallback.size} vouchers from file`);
            }
        } catch (error) {
            logger.error('Failed to load local data:', error);
        }
    }

    saveLocalData() {
        if (!this.db) {
            try {
                const data = Object.fromEntries(this.localFallback);
                fs.writeFileSync(this.dataPath, JSON.stringify(data, null, 2));
            } catch (error) {
                logger.error('Failed to save local data:', error);
            }
        }
    }

    async getVoucher(code) {
        if (this.db) {
            const doc = await this.db.collection('vouchers').doc(code).get();
            return doc.exists ? doc.data() : null;
        }
        return this.localFallback.get(code) || null;
    }

    async createVoucher(code, data) {
        const voucherData = {
            ...data,
            createdAt: this.db
    ? admin.firestore.FieldValue.serverTimestamp()
    : new Date().toISOString(),
            used: false
        };

        if (this.db) {
            await this.db.collection('vouchers').doc(code).set(voucherData);
        } else {
            this.localFallback.set(code, voucherData);
            this.saveLocalData();
        }
        return voucherData;
    }

    async redeemVoucher(code, userData) {
        const updateData = {
            used: true,
            redeemedAt: admin.firestore?.FieldValue?.serverTimestamp() || new Date(),
            redeemedBy: userData
        };

        if (this.db) {
            await this.db.collection('vouchers').doc(code).update(updateData);
        } else {
            const voucher = this.localFallback.get(code);
            if (voucher) {
                this.localFallback.set(code, { ...voucher, ...updateData });
                this.saveLocalData();
            }
        }
    }

    async deleteVoucher(code) {
        if (this.db) {
            await this.db.collection('vouchers').doc(code).delete();
        } else {
            this.localFallback.delete(code);
            this.saveLocalData();
        }
    }

    async getStats() {
        const vouchers = this.db ?
            (await this.db.collection('vouchers').get()).docs.map(d => d.data()) :
            Array.from(this.localFallback.values());

        return {
            total: vouchers.length,
            used: vouchers.filter(v => v.used).length,
            active: vouchers.filter(v => !v.used).length
        };
    }

    async getRecentVouchers(limit = 10) {
        if (this.db) {
            const snapshot = await this.db.collection('vouchers')
                .orderBy('createdAt', 'desc')
                .limit(limit)
                .get();
            return snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
        }

        return Array.from(this.localFallback.entries())
            .sort((a, b) => (b[1].createdAt?.seconds || 0) - (a[1].createdAt?.seconds || 0))
            .slice(0, limit)
            .map(([id, data]) => ({ id, ...data }));
    }
}

let instance = null;

async function getDatabase() {
    if (!instance) instance = new Database();
    return instance;
}

module.exports = { getDatabase };
