const axios = require('axios');
const https = require('https');

class MikroTikAPI {
    constructor() {
        this.baseURL = process.env.MIKROTIK_API_URL; // e.g., https://10.5.50.1/rest
        this.username = process.env.MIKROTIK_USER;
        this.password = process.env.MIKROTIK_PASSWORD;

        // Create axios instance with SSL verification disabled (for self-signed certs)
        this.client = axios.create({
    httpsAgent: new https.Agent({
        rejectUnauthorized: process.env.NODE_ENV === 'production'
            }),
            auth: {
                username: this.username,
                password: this.password
            },
            timeout: 10000
        });
    }

    async createUser(username, password, profile = 'default', attributes = {}) {
        try {
            // Check if user exists
            const exists = await this.userExists(username);

            const payload = {
                name: username,
                password: password,
                profile: profile,
                comment: attributes.comment || `Firebase-${attributes.email || ''}`,
                'shared-users': attributes.sharedUsers || 1
            };

            if (exists) {
                // Update existing user
                const response = await this.client.patch(
                    `${this.baseURL}/ip/hotspot/user/${username}`,
                    payload
                );
                return response.data;
            } else {
                // Create new user
                const response = await this.client.put(
                    `${this.baseURL}/ip/hotspot/user`,
                    payload
                );
                return response.data;
            }
        } catch (error) {
            console.error('MikroTik create user error:', error.message);
            throw error;
        }
    }

    async createGuestUser(username, password, mac, limits = {}) {
        const payload = {
            name: username,
            password: password,
            profile: 'guest',
            'mac-address': mac,
            comment: limits.comment || 'Guest user',
            'limit-uptime': limits.limitUptime || '1h',
            'limit-bytes-total': limits.limitBytes || '500M',
            'shared-users': 1
        };

        try {
            const response = await this.client.put(
                `${this.baseURL}/ip/hotspot/user`,
                payload
            );
            return response.data;
        } catch (error) {
            console.error('MikroTik create guest error:', error.message);
            throw error;
        }
    }

    async userExists(username) {
        try {
            const response = await this.client.get(
                `${this.baseURL}/ip/hotspot/user?name=${username}`
            );
            return response.data.length > 0;
        } catch (error) {
            return false;
        }
    }

    async getActiveSessions() {
        try {
            const response = await this.client.get(
                `${this.baseURL}/ip/hotspot/active`
            );
            return response.data;
        } catch (error) {
            console.error('Get active sessions error:', error.message);
            return [];
        }
    }

    async disconnectUser(username) {
        try {
            // Find active session for user
            const sessions = await this.getActiveSessions();
            const userSession = sessions.find(s => s.user === username);

            if (userSession) {
                await this.client.delete(
                    `${this.baseURL}/ip/hotspot/active/${userSession['.id']}`
                );
                return true;
            }
            return false;
        } catch (error) {
            console.error('Disconnect user error:', error.message);
            throw error;
        }
    }

    async getUserStats(username) {
        try {
            const response = await this.client.get(
                `${this.baseURL}/ip/hotspot/user?name=${username}`
            );

            if (response.data.length > 0) {
                const user = response.data[0];
                return {
                    uptime: user.uptime,
                    bytesIn: user['bytes-in'],
                    bytesOut: user['bytes-out'],
                    packetsIn: user['packets-in'],
                    packetsOut: user['packets-out']
                };
            }
            return null;
        } catch (error) {
            console.error('Get user stats error:', error.message);
            return null;
        }
    }
}

module.exports = new MikroTikAPI();
