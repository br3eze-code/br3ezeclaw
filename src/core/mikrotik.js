const { RouterOSClient } = require('routeros-client');
const { logger } = require('./logger');
const { getConfig } = require('./config');
const eventBus = require('../core/eventBus');
const config = require('../core/config');


class MikroTikAgent {
    constructor() {
        this.client = new RouterOSClient({
            host: config.mikrotik.host,
            user: config.mikrotik.user,
            password: config.mikrotik.pass
        });
        this.conn = null;
    }

    async connect() {
        this.conn = await this.client.connect();
        console.log('✅ MikroTik Connected');
    }

    async getActiveUsers() {
        return await this.conn.menu('/ip/hotspot/active').get();
    }

    async addUser(username, password, profile) {
        await this.conn.menu('/ip/hotspot/user').add({
            name: username,
            password,
            profile
        });

        eventBus.emit('user.created', { username });
    }
}

module.exports = new MikroTikAgent();

class MikroTikManager {
    constructor() {
        this.conn = null;
        this.isConnected = false;
        this.reconnectAttempts = 0;
        this.config = getConfig().mikrotik;
        this.tools = new Map();
        this.registerTools();
    }

    registerTools() {
        this.tools.set('user.add', this.addHotspotUser.bind(this));
        this.tools.set('user.remove', this.removeHotspotUser.bind(this));
        this.tools.set('user.kick', this.kickUser.bind(this));
        this.tools.set('user.status', this.getUserStatus.bind(this));
        this.tools.set('users.active', this.getActiveUsers.bind(this));
        this.tools.set('users.all', this.getAllHotspotUsers.bind(this));
        this.tools.set('system.stats', this.getSystemStats.bind(this));
        this.tools.set('system.logs', this.getLogs.bind(this));
        this.tools.set('system.reboot', this.reboot.bind(this));
        this.tools.set('ping', this.ping.bind(this));
        this.tools.set('traceroute', this.traceroute.bind(this));
        this.tools.set('firewall.list', this.getFirewallRules.bind(this));
        this.tools.set('firewall.block', this.addToBlockList.bind(this));
        this.tools.set('dhcp.leases', this.getDhcpLeases.bind(this));
    }

    async connect() {
        try {
            const api = new RouterOSClient({
                host: this.config.ip,
                user: this.config.user,
                password: this.config.pass,
                port: this.config.port,
                timeout: 10000
            });

            this.conn = await api.connect();
            this.isConnected = true;
            this.reconnectAttempts = 0;
            logger.info('MikroTik connected');
            this.monitorConnection();
            return true;
        } catch (error) {
            this.isConnected = false;
            logger.error('MikroTik connection failed:', error.message);
            this.scheduleReconnect();
            return false;
        }
    }

    monitorConnection() {
        setInterval(async () => {
            try {
                if (this.conn) {
                    await this.conn.menu('/system/resource').get();
                }
            } catch (error) {
                logger.warn('MikroTik connection lost, reconnecting...');
                this.isConnected = false;
                this.connect();
            }
        }, 30000);
    }

    scheduleReconnect() {
        if (this.reconnectAttempts < this.config.maxReconnectAttempts) {
            this.reconnectAttempts++;
            logger.info(`Reconnecting to MikroTik (attempt ${this.reconnectAttempts})...`);
            setTimeout(() => this.connect(), this.config.reconnectInterval);
        } else {
            logger.error('Max reconnection attempts reached');
        }
    }

    // === TOOL IMPLEMENTATIONS ===

    async addHotspotUser(username, password, profile) {
        if (!this.isConnected) throw new Error('MikroTik not connected');

        const existing = await this.conn.menu('/ip/hotspot/user').where('name', username).get();
        if (existing.length > 0) {
            await this.conn.menu('/ip/hotspot/user').update(existing[0]['.id'], {
                password: password,
                profile: profile,
                disabled: 'no'
            });
            return { action: 'updated', username };
        } else {
            await this.conn.menu('/ip/hotspot/user').add({
                name: username,
                password: password,
                profile: profile
            });
            return { action: 'created', username };
        }
    }

    async removeHotspotUser(username) {
        if (!this.isConnected) throw new Error('MikroTik not connected');

        const users = await this.conn.menu('/ip/hotspot/user').where('name', username).get();
        if (users.length > 0) {
            await this.conn.menu('/ip/hotspot/user').remove(users[0]['.id']);
            return { action: 'removed', username };
        }
        throw new Error('User not found');
    }

    async getAllHotspotUsers() {
        if (!this.isConnected) return [];
        return await this.conn.menu('/ip/hotspot/user').get();
    }

    async getActiveUsers() {
        if (!this.isConnected) return [];
        return await this.conn.menu('/ip/hotspot/active').get();
    }

    async getUserStatus(username) {
        if (!this.isConnected) return null;
        const active = await this.conn.menu('/ip/hotspot/active').where('user', username).get();
        return active.length > 0 ? active[0] : null;
    }

    async kickUser(username) {
        if (!this.isConnected) throw new Error('MikroTik not connected');
        const active = await this.conn.menu('/ip/hotspot/active').where('user', username).get();
        if (active.length > 0) {
            await this.conn.menu('/ip/hotspot/active').remove(active[0]['.id']);
            return true;
        }
        return false;
    }

    async getSystemStats() {
        if (!this.isConnected) return null;
        const resources = await this.conn.menu('/system/resource').get();
        return resources[0];
    }

    async getLogs(lines = 10) {
        if (!this.isConnected) return [];
        const logs = await this.conn.menu('/log').get();
        return logs.slice(-lines);
    }

    async reboot() {
        if (!this.isConnected) throw new Error('MikroTik not connected');
        await this.conn.menu('/system').call('reboot');
        return { status: 'rebooting' };
    }

    async ping(host, count = 4) {
        if (!this.isConnected) throw new Error('MikroTik not connected');
        return await this.conn.menu('/ping').call({
            address: host,
            count: count.toString()
        });
    }

    async traceroute(host) {
        if (!this.isConnected) throw new Error('MikroTik not connected');
        return await this.conn.menu('/tool/traceroute').call({
            address: host,
            count: '1'
        });
    }

    async getFirewallRules(type = 'filter') {
        if (!this.isConnected) return [];
        return await this.conn.menu(`/ip/firewall/${type}`).get();
    }

    async addToBlockList(target, list = 'blocked', comment = 'Blocked via AgentOS') {
        if (!this.isConnected) throw new Error('MikroTik not connected');
        await this.conn.menu('/ip/firewall/address-list').add({
            list: list,
            address: target,
            comment: comment
        });
        return { action: 'blocked', target };
    }

    async removeFromBlockList(target, list = 'blocked') {
        if (!this.isConnected) throw new Error('MikroTik not connected');
        const items = await this.conn.menu('/ip/firewall/address-list')
            .where('list', list)
            .where('address', target)
            .get();

        for (const item of items) {
            await this.conn.menu('/ip/firewall/address-list').remove(item['.id']);
        }
        return { action: 'unblocked', target, count: items.length };
    }

    async getDhcpLeases() {
        if (!this.isConnected) return [];
        return await this.conn.menu('/ip/dhcp-server/lease').get();
    }

    async executeTool(toolName, ...args) {
        const tool = this.tools.get(toolName);
        if (!tool) throw new Error(`Tool not found: ${toolName}`);
        return await tool(...args);
    }

    getAvailableTools() {
        return Array.from(this.tools.keys());
    }

    disconnect() {
        if (this.conn) {
            this.conn.close();
            this.isConnected = false;
        }
    }
}

// Singleton instance
let instance = null;

async function getMikroTikClient() {
    if (!instance) {
        instance = new MikroTikManager();
        await instance.connect();
    }
    return instance;
}

async function testMikroTikConnection(customConfig = null) {
    const config = customConfig || getConfig().mikrotik;
    const api = new RouterOSClient({
        host: config.ip,
        user: config.user,
        password: config.pass,
        port: config.port,
        timeout: 5000
    });

    const conn = await api.connect();
    await conn.menu('/system/resource').get();
    await conn.close();
}

let client = null;

async function getMikroTikClient() {
    if (client && client.isConnected) return client;

    const { CONFIG_PATH } = global.AGENTOS;
    const fs = require('fs');
    const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));

    const api = new RouterOSClient({
        host: config.mikrotik.ip,
        user: config.mikrotik.user,
        password: config.mikrotik.pass,
        port: config.mikrotik.port,
        timeout: 10000
    });

    client = {
        conn: await api.connect(),
        isConnected: true,

        // Tool implementations
        ping: async (host, count) => {
            // Implementation
            return [{ host, time: '1ms', received: 1 }];
        },

        getDhcpLeases: async () => {
            return await client.conn.menu('/ip/dhcp-server/lease').get();
        },

        getFirewallRules: async (type) => {
            return await client.conn.menu(`/ip/firewall/${type}`).get();
        },

        addToBlockList: async (target, reason) => {
            await client.conn.menu('/ip/firewall/address-list').add({
                list: 'blocked',
                address: target,
                comment: reason
            });
        },

        removeFromBlockList: async (target) => {
            const items = await client.conn.menu('/ip/firewall/address-list')
                .where('address', target).get();
            for (const item of items) {
                await client.conn.menu('/ip/firewall/address-list').remove(item['.id']);
            }
        },

        getAllHotspotUsers: async () => {
            return await client.conn.menu('/ip/hotspot/user').get();
        },

        getActiveUsers: async () => {
            return await client.conn.menu('/ip/hotspot/active').get();
        },

        kickUser: async (username) => {
            const active = await client.conn.menu('/ip/hotspot/active')
                .where('user', username).get();
            if (active.length > 0) {
                await client.conn.menu('/ip/hotspot/active').remove(active[0]['.id']);
                return true;
            }
            return false;
        },

        addHotspotUser: async (username, password, profile) => {
            const existing = await client.conn.menu('/ip/hotspot/user')
                .where('name', username).get();
            if (existing.length > 0) {
                await client.conn.menu('/ip/hotspot/user').update(existing[0]['.id'], {
                    password, profile, disabled: 'no'
                });
            } else {
                await client.conn.menu('/ip/hotspot/user').add({
                    name: username, password, profile
                });
            }
        },

        removeHotspotUser: async (username) => {
            const users = await client.conn.menu('/ip/hotspot/user')
                .where('name', username).get();
            if (users.length > 0) {
                await client.conn.menu('/ip/hotspot/user').remove(users[0]['.id']);
            }
        },

        getUserStatus: async (username) => {
            const active = await client.conn.menu('/ip/hotspot/active')
                .where('user', username).get();
            return active.length > 0 ? active[0] : null;
        },

        getSystemStats: async () => {
            const res = await client.conn.menu('/system/resource').get();
            return res[0];
        }
    };

    return client;
}

async function testMikroTikConnection(config) {
    const api = new RouterOSClient({
        host: config.ip,
        user: config.user,
        password: config.pass,
        port: config.port,
        timeout: 5000
    });

    const conn = await api.connect();
    await conn.menu('/system/resource').get();
    await conn.close();
}

module.exports = {
    MikroTikManager,
    getMikroTikClient,
    testMikroTikConnection
};
