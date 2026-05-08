'use strict';
/**
 * NodeRegistry — migrated from ss35.js §5
 * Manages multi-router mesh: connect, fan-out, per-node execution.
 */
const EventEmitter = require('events');
const { logger }   = require('./logger');

class NodeRegistry extends EventEmitter {
    constructor() {
        super();
        this._nodes = new Map();   // name → MikroTikManager instance
    }

    /**
     * Register a named node. Disconnects existing node with same name if present.
     * @param {string} name
     * @param {string} ip
     * @param {string} user
     * @param {string} pass
     * @param {number} port
     * @returns {MikroTikManager}
     */
    add(name, ip, user, pass, port = 8728) {
        if (this._nodes.has(name)) {
            try { this._nodes.get(name).destroy?.(); } catch { /* ignore */ }
        }

        // Lazy-require to avoid circular deps at startup
        const { getManager } = require('./mikrotik');
        const node = getManager({ host: ip, port, username: user, password: pass });
        this._nodes.set(name, node);
        logger.info(`NodeRegistry: registered "${name}" (${ip}:${port})`);
        this.emit('nodeAdded', { name, ip });
        return node;
    }

    /** Get a node manager by name */
    get(name) {
        return this._nodes.get(name) || null;
    }

    /** Summary of all registered nodes */
    getAll() {
        return [...this._nodes.entries()].map(([name, node]) => ({
            name,
            ip:        node._config?.host || 'unknown',
            port:      node._config?.port || 8728,
            connected: node.isConnected ?? false,
        }));
    }

    /** Connect all registered nodes and return per-node results */
    async connectAll() {
        const results = [];
        for (const [name, node] of this._nodes) {
            try {
                await node.connect();
                results.push({ name, status: 'connected' });
                this.emit('nodeConnected', { name });
            } catch (err) {
                results.push({ name, status: 'failed', error: err.message });
                this.emit('nodeError', { name, error: err.message });
            }
        }
        return results;
    }

    /** Execute a named tool on a specific node */
    async executeOnNode(name, tool, ...args) {
        const node = this._nodes.get(name);
        if (!node) throw new Error(`Node not found: ${name}`);
        return node.executeTool(tool, ...args);
    }

    /**
     * Fan-out a tool call across ALL connected nodes.
     * Returns { nodeName: result | { error } }
     */
    async executeOnAll(tool, ...args) {
        const results = {};
        for (const [name, node] of this._nodes) {
            if (!(node.isConnected ?? false)) {
                results[name] = { error: 'offline' };
                continue;
            }
            try {
                results[name] = await node.executeTool(tool, ...args);
            } catch (err) {
                results[name] = { error: err.message };
            }
        }
        return results;
    }

    /** Disconnect and remove a node */
    remove(name) {
        const node = this._nodes.get(name);
        if (node) {
            try { node.destroy?.(); } catch { /* ignore */ }
            this._nodes.delete(name);
            this.emit('nodeRemoved', { name });
        }
    }

    /** Disconnect all nodes (graceful shutdown) */
    disconnectAll() {
        for (const node of this._nodes.values()) {
            try { node.destroy?.(); } catch { /* ignore */ }
        }
        this._nodes.clear();
    }
}

// Singleton
module.exports = new NodeRegistry();
