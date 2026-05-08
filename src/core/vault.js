'use strict';
/**
 * Vault Service — AES-256-GCM Encryption + OAuth Token Storage
 * Ported from 36.js §3.6 & §3.7
 */

const crypto = require('crypto');
const { createCipheriv, createDecipheriv, randomBytes, scryptSync } = crypto;
const { logger } = require('./logger');

class EncryptionVault {
    constructor(masterKey) {
        // Pad/truncate weak keys so scrypt always has material to work with
        const key = (masterKey || process.env.VAULT_MASTER_KEY || 'changeme-agentos-omni-2026').padEnd(16, '!');
        this.masterKey = scryptSync(key, 'AgentOS-Omni-Salt-v2026', 32);
        this.algorithm = 'aes-256-gcm';
    }

    encrypt(plaintext) {
        if (!plaintext) return null;
        const iv = randomBytes(16);
        const cipher = createCipheriv(this.algorithm, this.masterKey, iv);
        let encrypted = cipher.update(plaintext, 'utf8', 'hex');
        encrypted += cipher.final('hex');
        const tag = cipher.getAuthTag();
        return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted}`;
    }

    decrypt(ciphertext) {
        if (!ciphertext) return null;
        const [ivHex, tagHex, encrypted] = ciphertext.split(':');
        if (!ivHex || !tagHex || !encrypted) throw new Error('Invalid encrypted format');
        const iv = Buffer.from(ivHex, 'hex');
        const tag = Buffer.from(tagHex, 'hex');
        const decipher = createDecipheriv(this.algorithm, this.masterKey, iv);
        decipher.setAuthTag(tag);
        let decrypted = decipher.update(encrypted, 'hex', 'utf8');
        decrypted += decipher.final('utf8');
        return decrypted;
    }

    hash(data) {
        return crypto.createHmac('sha256', this.masterKey).update(data).digest('hex');
    }

    timingSafeCompare(a, b) {
        const bufA = Buffer.from(a);
        const bufB = Buffer.from(b);
        if (bufA.length !== bufB.length) return false;
        return crypto.timingSafeEqual(bufA, bufB);
    }
}

class OAuthVault {
    constructor(db, encryptionVault) {
        this.db = db;
        this.vault = encryptionVault;
        this.tokenCache = new Map();
        this.refreshTimers = new Map();
    }

    async storeTokens(provider, userId, tokens) {
        const encrypted = {
            accessToken: this.vault.encrypt(tokens.accessToken),
            refreshToken: tokens.refreshToken ? this.vault.encrypt(tokens.refreshToken) : null,
            expiresAt: tokens.expiresAt ? new Date(tokens.expiresAt).toISOString() : null,
            scope: tokens.scope,
            tokenType: tokens.tokenType || 'Bearer',
        };
        const record = { 
            userId, 
            provider, 
            encrypted, 
            createdAt: new Date().toISOString(), 
            updatedAt: new Date().toISOString() 
        };

        if (this.db && this.db.db) {
            await this.db.db.collection('oauth_tokens').doc(`${provider}_${userId}`).set(record);
        } else {
            // Local fallback handled by Database adapter if Firestore is missing
            await this.db.saveOAuthToken?.(provider, userId, record);
        }

        this.tokenCache.set(`${provider}_${userId}`, { ...tokens, cachedAt: Date.now() });
        
        if (tokens.expiresAt && tokens.refreshToken) {
            this._scheduleRefresh(provider, userId, tokens.expiresAt);
        }
        
        return true;
    }

    async getAccessToken(provider, userId) {
        const cacheKey = `${provider}_${userId}`;
        const cached = this.tokenCache.get(cacheKey);
        
        if (cached && cached.expiresAt > Date.now() + 60000) return cached.accessToken;
        
        let record;
        if (this.db && this.db.db) {
            const doc = await this.db.db.collection('oauth_tokens').doc(cacheKey).get();
            record = doc.exists ? doc.data() : null;
        } else {
            record = await this.db.getOAuthToken?.(provider, userId);
        }
        
        if (!record) throw new Error(`No tokens found for ${provider}/${userId}`);
        
        const tokens = {
            accessToken: this.vault.decrypt(record.encrypted.accessToken),
            refreshToken: record.encrypted.refreshToken ? this.vault.decrypt(record.encrypted.refreshToken) : null,
            expiresAt: record.encrypted.expiresAt ? new Date(record.encrypted.expiresAt).getTime() : null,
            scope: record.encrypted.scope,
        };
        
        if (tokens.expiresAt && tokens.expiresAt < Date.now() + 60000 && tokens.refreshToken) {
            const refreshed = await this._refreshToken(provider, userId, tokens.refreshToken);
            return refreshed.accessToken;
        }
        
        this.tokenCache.set(cacheKey, { ...tokens, cachedAt: Date.now() });
        return tokens.accessToken;
    }

    async _refreshToken(provider, userId, refreshToken) {
        // Implementation varies by provider (GitHub, Google, etc)
        logger.info(`Refreshing ${provider} token for ${userId}...`);
        // For now, this is a placeholder for provider-specific refresh logic
        return { accessToken: refreshToken }; // Mock
    }

    _scheduleRefresh(provider, userId, expiresAt) {
        const cacheKey = `${provider}_${userId}`;
        const refreshTime = new Date(expiresAt).getTime() - Date.now() - 300000; // 5 min before expiry
        
        if (refreshTime > 0) {
            if (this.refreshTimers.has(cacheKey)) clearTimeout(this.refreshTimers.get(cacheKey));
            this.refreshTimers.set(cacheKey, setTimeout(() => {
                this.getAccessToken(provider, userId).catch(err =>
                    logger.error(`Auto-refresh failed for ${cacheKey}: ${err.message}`)
                );
            }, refreshTime));
        }
    }
}

// Export singleton instances
const encVault = new EncryptionVault();
module.exports = {
    EncryptionVault,
    OAuthVault,
    vault: encVault
};
