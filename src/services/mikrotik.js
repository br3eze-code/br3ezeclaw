// src/services/mikrotik.js

const { RouterOSClient } = require('routeros-client');

class MikroTikService {
    constructor(config) {
        this.api = new RouterOSClient(config);
        this.conn = null;
    }

    async connect() {
        this.conn = await this.api.connect();
    }

    async addUser({ username, password, profile }) {
        return await this.conn.menu('/ip/hotspot/user').add({
            name: username,
            password,
            profile
        });
    }

    async getActiveUsers() {
        return await this.conn.menu('/ip/hotspot/active').get();
    }

    async kickUser({ username }) {
        if (!username) throw new Error('Username required to kick');
        const active = await this.conn.menu('/ip/hotspot/active')
            .where('user', username).get();

        if (active.length) {
            const id = active[0]['.id'];
            if (!id) throw new Error(`Could not resolve session ID for user: ${username}`);
            await this.conn.menu('/ip/hotspot/active').remove(id);
        }
    }
}

module.exports = MikroTikService;