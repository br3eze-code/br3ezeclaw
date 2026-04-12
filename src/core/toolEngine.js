'use strict';
/**
 * ToolEngine — Permission-gated tool dispatcher
 *
 * All tool calls now pass through PermissionEnforcer before execution.
 * Emits structured events on deny/allow for audit log.
 */

const EventEmitter = require('events');
const { PermissionEnforcer, PermissionMode, PermissionDenial } = require('./permissions');
const { logger } = require('./logger');

class ToolEngine extends EventEmitter {
    /**
     * @param {object} opts
     * @param {string} opts.permissionMode  PermissionMode.PLAN | PROMPT | AUTO
     */
    constructor({ permissionMode = PermissionMode.PROMPT } = {}) {
        super();
        this.tools    = new Map();
        this.enforcer = new PermissionEnforcer(permissionMode);
        this.denials  = [];
    }

    /** Register a handler for a named tool */
    register(name, handler) {
        this.tools.set(name, handler);
        logger.debug(`ToolEngine: registered '${name}'`);
    }

    /**
     * Execute a tool with permission enforcement.
     * @param {string} name
     * @param {object} [params]
     * @returns {Promise<*>}
     * @throws {Error} if denied or not found
     */
    async execute(name, params = {}) {
        if (!this.tools.has(name)) {
            throw new Error(`Tool not found: ${name}. Available: ${this.list().join(', ')}`);
        }

        // ── Permission check ──
        const check = this.enforcer.check(name, params);

        if (!check.allowed) {
            const denial = new PermissionDenial(name, check.reason);
            this.denials.push(denial);
            this.emit('tool:denied', denial);
            logger.warn(`ToolEngine: denied '${name}' — ${check.reason}`);
            throw Object.assign(new Error(check.reason), { code: 'PERMISSION_DENIED', denial });
        }

        if (check.requiresConfirmation) {
            this.emit('tool:confirmation_required', { name, params, check });
            logger.info(`ToolEngine: '${name}' requires confirmation (PROMPT mode)`);
        }

        this.emit('tool:executing', { name, params });
        const startTime = Date.now();

        try {
            const result   = await this.tools.get(name)(params);
            const duration = Date.now() - startTime;
            this.emit('tool:executed', { name, params, result, duration });
            logger.debug(`ToolEngine: '${name}' completed in ${duration}ms`);
            return result;
        } catch (error) {
            this.emit('tool:error', { name, params, error });
            throw error;
        }
    }

    /** List all registered tool names */
    list() {
        return Array.from(this.tools.keys()).sort();
    }

    /** Switch permission mode at runtime */
    setPermissionMode(mode) {
        this.enforcer = new PermissionEnforcer(mode, this.enforcer.permissionContext);
        logger.info(`ToolEngine: permission mode → ${mode}`);
        this.emit('permission:mode_changed', mode);
    }

    /** Return a summary of denial history */
    denialSummary() {
        return this.denials.map(d => d.toJSON());
    }
}

module.exports = new ToolEngine();
