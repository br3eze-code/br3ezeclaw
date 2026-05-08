'use strict';
/**
 * queryNetwork handler — MikroTik network query via A2A
 *
 * Capability: query_network
 * Routes to the network-agent's mikrotik capabilities.
 * Falls back to direct MikroTik API if network-agent is unavailable.
 */

const NETWORK_AGENT_SPIFFE = 'spiffe://br3eze.prod/agent/network-agent';

const QUERY_TYPE_MAP = {
    active_users: 'mikrotik.getActiveUsers',
    stats:        'mikrotik.getStats',
    interfaces:   'mikrotik.getInterfaces',
    dhcp:         'mikrotik.getDHCPLeases'
};

/**
 * @param {{ query_type: string }} parameters
 * @param {object} session
 * @param {string} senderSPIFFE
 * @param {object} a2aAdapter   - A2AProtocolAdapter instance
 */
module.exports = async function queryNetwork(parameters, session, senderSPIFFE, a2aAdapter) {
    const { query_type } = parameters;

    const capability = QUERY_TYPE_MAP[query_type];
    if (!capability) {
        throw new Error(`Unknown query_type "${query_type}". Valid: ${Object.keys(QUERY_TYPE_MAP).join(', ')}`);
    }

    // ── Prefer A2A delegation to network-agent ──────────────────────────
    if (a2aAdapter && a2aAdapter.isTrustedAgent(NETWORK_AGENT_SPIFFE)) {
        try {
            const result = await a2aAdapter.sendTask(NETWORK_AGENT_SPIFFE, {
                capability,
                parameters: { source: 'invoice-agent', requestedBy: senderSPIFFE },
                traceId:    session.traceId
            });
            return { source: 'network-agent', query_type, data: result };
        } catch (err) {
            console.warn('[queryNetwork] A2A delegation failed, trying direct fallback:', err.message);
        }
    }

    // ── Direct MikroTik fallback (when network-agent is unreachable) ────
    return _directMikroTikQuery(query_type);
};

async function _directMikroTikQuery(queryType) {
    // Lazy-load the MikroTik core module — it's in the main gateway process
    let MikroTikManager;
    try {
        ({ MikroTikManager } = require('../../../src/core/mikrotik'));
    } catch {
        throw new Error('Network-agent unavailable and MikroTikManager cannot be loaded from this context');
    }

    const mtk = new MikroTikManager({
        host:     process.env.MIKROTIK_IP   || '192.168.88.1',
        user:     process.env.MIKROTIK_USER || 'admin',
        password: process.env.MIKROTIK_PASS,
        port:     parseInt(process.env.MIKROTIK_PORT || '8728', 10)
    });

    await mtk.connect();
    try {
        switch (queryType) {
            case 'active_users': return { source: 'direct', query_type: queryType, data: await mtk.getActiveUsers() };
            case 'stats':        return { source: 'direct', query_type: queryType, data: await mtk.getSystemResources() };
            case 'interfaces':   return { source: 'direct', query_type: queryType, data: await mtk.getInterfaces() };
            case 'dhcp':         return { source: 'direct', query_type: queryType, data: await mtk.getDHCPLeases() };
            default:             throw new Error(`Unhandled query_type: ${queryType}`);
        }
    } finally {
        await mtk.disconnect().catch(() => {});
    }
}
