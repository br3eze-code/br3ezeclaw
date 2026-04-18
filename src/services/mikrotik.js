'use strict';

const { RouterOSClient } = require('routeros-client');
const crypto = require('crypto');

const VALID_USERNAME = /^[a-zA-Z0-9_-]{1,32}$/;
const VALID_PROFILE = /^[a-zA-Z0-9 _-]{1,64}$/;

class MikroTikService {
    constructor(config) {
        this.api = new RouterOSClient({
            host: config.host,
            user: config.user,
            password: config.password,
            port: config.port || 8728,
            timeout: config.timeout || 10000,
            tls: config.tls || false
        });
        this.conn = null;
        this.connected = false;
    }

    async connect() {
        this.conn = await this.api.connect();
        this.connected = true;
        return this.conn;
    }

    ensureConnected() {
        if (!this.connected || !this.conn) {
            throw new Error('MikroTik not connected. Call connect() first.');
        }
    }

    async addUser({ username, password, profile }) {
        this.ensureConnected();
        
        if (!username || !VALID_USERNAME.test(username)) {
            throw new Error('Invalid username. Use 1-32 chars: a-z, A-Z, 0-9, _, -');
        }
        if (!profile || !VALID_PROFILE.test(profile)) {
            throw new Error('Invalid profile name.');
        }
        
        const securePassword = password || crypto.randomBytes(8).toString('hex');
        
        return await this.conn.menu('/ip/hotspot/user').add({
            name: username,
            password: securePassword,
            profile
        });
    }

    async getActiveUsers() {
        this.ensureConnected();
        return await this.conn.menu('/ip/hotspot/active').get();
    }

    async kickUser({ username }) {
        this.ensureConnected();
        
        if (!username || !VALID_USERNAME.test(username)) {
            throw new Error('Invalid username.');
        }

        const active = await this.conn.menu('/ip/hotspot/active')
            .where('user', username).get();

        if (active.length === 0) {
            throw new Error(`User "${username}" is not currently active.`);
        }

        await this.conn.menu('/ip/hotspot/active').remove(active[0]['.id']);
        return { success: true, username, id: active[0]['.id'] };
    }

    async disconnect() {
        if (this.conn) {
            await this.conn.close();
            this.connected = false;
            this.conn = null;
        }
    }
}

module.exports = MikroTikService;
