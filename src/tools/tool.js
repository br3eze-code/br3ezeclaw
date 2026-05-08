// ==========================================
// AgentOS Tool Registry
// Low-level MikroTik command wrappers
// consumed by the WebSocket gateway
// ==========================================

'use strict';

/**
 * Each tool receives the live RouterOS connection object
 * (this.conn from MikroTikManager) as its first argument,
 * followed by any positional parameters from the caller.
 */
const tools = {

    // ── Users ──────────────────────────────────────────────

    'user.add': async (conn, username, password, profile = 'default') => {
        const existing = await conn.menu('/ip/hotspot/user').where('name', username).get();
        if (existing.length > 0) {
            const id = typeof existing[0] === 'object' ? (existing[0]['.id'] || existing[0].id) : existing[0];
            await conn.menu('/ip/hotspot/user').update(id, { password, profile, disabled: 'no' });
            return { action: 'updated', username, profile };
        }
        await conn.menu('/ip/hotspot/user').add({ name: username, password, profile });
        return { action: 'created', username, profile };
    },

    'user.remove': async (conn, username) => {
        if (!username) throw new Error('Username required for removal');
        const users = await conn.menu('/ip/hotspot/user').where('name', username).get();
        if (!users.length) throw new Error(`User not found: ${username}`);
        const id = typeof users[0] === 'object' ? (users[0]['.id'] || users[0].id) : users[0];
        if (!id) throw new Error(`Could not resolve router ID for user: ${username}. Got: ${JSON.stringify(users[0])}`);
        await conn.menu('/ip/hotspot/user').remove(id);
        return { action: 'removed', username };
    },

    'user.kick': async (conn, username) => {
        if (!username) throw new Error('Username required to kick');
        const active = await conn.menu('/ip/hotspot/active').where('user', username).get();
        if (!active.length) return { kicked: false, username, reason: 'not active' };
        const id = typeof active[0] === 'object' ? (active[0]['.id'] || active[0].id) : active[0];
        if (!id) throw new Error(`Could not resolve session ID for user: ${username}. Got: ${JSON.stringify(active[0])}`);
        await conn.menu('/ip/hotspot/active').remove(id);
        return { kicked: true, username };
    },

    'user.status': async (conn, username) => {
        const active = await conn.menu('/ip/hotspot/active').where('user', username).get();
        const account = await conn.menu('/ip/hotspot/user').where('name', username).get();
        return {
            online: active.length > 0,
            session: active[0] || null,
            account: account[0] || null
        };
    },

    'users.active': async (conn) => conn.menu('/ip/hotspot/active').get(),

    'users.all': async (conn) => conn.menu('/ip/hotspot/user').get(),

    // ── System ─────────────────────────────────────────────

    'system.stats': async (conn) => {
        const [res] = await conn.menu('/system/resource').get();
        return res;
    },

    'system.identity': async (conn) => {
        const [id] = await conn.menu('/system/identity').get();
        return id;
    },

    'system.logs': async (conn, lines = 10) => {
        const logs = await conn.menu('/log').get();
        return logs.slice(-Number(lines));
    },

    'system.reboot': async (conn) => {
        await conn.menu('/system').exec('reboot');
        return { status: 'rebooting' };
    },

    // ── Network ────────────────────────────────────────────

    'ping': async (conn, host, count = 4) =>
        conn.menu('/ping').exec({ address: host, count: String(count) }),

    'traceroute': async (conn, host) =>
        conn.menu('/tool/traceroute').exec({ address: host, count: '1' }),

    'dhcp.leases': async (conn) =>
        conn.menu('/ip/dhcp-server/lease').get(),

    'arp.table': async (conn) =>
        conn.menu('/ip/arp').get(),

    'interfaces': async (conn) =>
        conn.menu('/interface').get(),

    // ── Firewall ───────────────────────────────────────────

    'firewall.list': async (conn, type = 'filter') =>
        conn.menu(`/ip/firewall/${type}`).get(),

    'firewall.block': async (conn, address, list = 'blocked', comment = 'Blocked via AgentOS') => {
        await conn.menu('/ip/firewall/address-list').add({ list, address, comment });
        return { action: 'blocked', address, list };
    },

    'firewall.unblock': async (conn, address, list = 'blocked') => {
        const entries = await conn.menu('/ip/firewall/address-list')
            .where('list', list)
            .where('address', address)
            .get();
        if (!entries.length) throw new Error(`${address} not found in list "${list}"`);
        const id = typeof entries[0] === 'object' ? (entries[0]['.id'] || entries[0].id) : entries[0];
        if (!id) throw new Error(`Could not resolve entry ID for address: ${address}. Got: ${JSON.stringify(entries[0])}`);
        await conn.menu('/ip/firewall/address-list').remove(id);
        return { action: 'unblocked', address };
    }
};

module.exports = tools;