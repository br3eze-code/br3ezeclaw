/**
 * AgentOS WiFi Manager - Storage Module
 * Version: 2026.5.0
 * Features: IndexedDB wrapper for local data persistence
 */

class SecureStorage {
    constructor() {
        this.dbName = 'AgentOS_DB';
        this.dbVersion = 1;
        this.db = null;
        this.ready = false;
    }

    async initialize() {
        if (this.ready) return;

        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.dbName, this.dbVersion);

            request.onerror = () => {
                console.error('[Storage] Database open failed');
                reject(request.error);
            };

            request.onsuccess = () => {
                this.db = request.result;
                this.ready = true;
                console.log('[Storage] Database initialized');
                resolve();
            };

            request.onupgradeneeded = (event) => {
                const db = event.target.result;

                // Create object stores
                if (!db.objectStoreNames.contains('vouchers')) {
                    db.createObjectStore('vouchers', { keyPath: 'code' });
                }

                if (!db.objectStoreNames.contains('activity')) {
                    db.createObjectStore('activity', { keyPath: 'id', autoIncrement: true });
                }

                if (!db.objectStoreNames.contains('ledger')) {
                    db.createObjectStore('ledger', { keyPath: 'id' });
                }

                if (!db.objectStoreNames.contains('settings')) {
                    db.createObjectStore('settings', { keyPath: 'key' });
                }

                if (!db.objectStoreNames.contains('cache')) {
                    db.createObjectStore('cache', { keyPath: 'key' });
                }

                console.log('[Storage] Object stores created');
            };
        });
    }

    async save(storeName, data) {
        await this.initialize();

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([storeName], 'readwrite');
            const store = transaction.objectStore(storeName);

            // Handle both single items and arrays
            if (Array.isArray(data)) {
                const clearRequest = store.clear();
                clearRequest.onsuccess = () => {
                    data.forEach(item => store.put(item));
                };
            } else {
                store.put(data);
            }

            transaction.oncomplete = () => resolve(true);
            transaction.onerror = () => reject(transaction.error);
        });
    }

    async load(storeName, key = null) {
        await this.initialize();

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([storeName], 'readonly');
            const store = transaction.objectStore(storeName);

            if (key) {
                const request = store.get(key);
                request.onsuccess = () => resolve(request.result);
                request.onerror = () => reject(request.error);
            } else {
                const request = store.getAll();
                request.onsuccess = () => resolve(request.result);
                request.onerror = () => reject(request.error);
            }
        });
    }

    async delete(storeName, key) {
        await this.initialize();

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([storeName], 'readwrite');
            const store = transaction.objectStore(storeName);
            const request = store.delete(key);

            request.onsuccess = () => resolve(true);
            request.onerror = () => reject(request.error);
        });
    }

    async clear(storeName) {
        await this.initialize();

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([storeName], 'readwrite');
            const store = transaction.objectStore(storeName);
            const request = store.clear();

            request.onsuccess = () => resolve(true);
            request.onerror = () => reject(request.error);
        });
    }

    // Convenience methods for specific stores

    async saveVouchers(vouchers) {
        return this.save('vouchers', vouchers);
    }

    async loadVouchers() {
        return this.load('vouchers');
    }

    async addActivity(activity) {
        await this.initialize();
        const record = {
            ...activity,
            timestamp: Date.now()
        };
        return this.save('activity', record);
    }

    async loadActivity(limit = 50) {
        const activities = await this.load('activity');
        return activities.slice(-limit).reverse();
    }

    async saveSettings(settings) {
        return this.save('settings', settings);
    }

    async loadSettings() {
        const settings = await this.load('settings');
        return settings || {};
    }

    async getSetting(key) {
        const settings = await this.loadSetting(key);
        return settings?.value;
    }

    async loadSetting(key) {
        return this.load('settings', key);
    }

    async saveSetting(key, value) {
        return this.save('settings', { key, value });
    }

    // Cache methods with TTL
    async setCache(key, value, ttl = CONFIG.CACHE_TTL) {
        await this.initialize();
        const record = {
            key,
            value,
            expiresAt: Date.now() + ttl
        };
        return this.save('cache', record);
    }

    async getCache(key) {
        const record = await this.load('cache', key);
        if (!record) return null;
        if (Date.now() > record.expiresAt) {
            await this.delete('cache', key);
            return null;
        }
        return record.value;
    }
}

// Global storage instance
const storage = new SecureStorage();

// Export for use in other modules
if (typeof window !== 'undefined') {
    window.SecureStorage = SecureStorage;
    window.storage = storage;
}
