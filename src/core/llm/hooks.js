'use strict';
/**
 * Hook Registry — Lifecycle hooks for tool execution
 * Ported from 36.js §4.5
 */

const { logger } = require('../logger');

class HookRegistry {
    constructor() {
        this._pre = new Map();
        this._post = new Map();
        this._error = new Map();
    }

    /**
     * Register a function to run BEFORE a tool is executed.
     */
    onBefore(toolName, fn) {
        if (!this._pre.has(toolName)) this._pre.set(toolName, []);
        this._pre.get(toolName).push(fn);
        return this;
    }

    /**
     * Register a function to run AFTER a tool is executed successfully.
     */
    onAfter(toolName, fn) {
        if (!this._post.has(toolName)) this._post.set(toolName, []);
        this._post.get(toolName).push(fn);
        return this;
    }

    /**
     * Register a function to run when a tool execution FAILS.
     */
    onError(toolName, fn) {
        if (!this._error.has(toolName)) this._error.set(toolName, []);
        this._error.get(toolName).push(fn);
        return this;
    }

    async runBefore(toolName, args) {
        const hooks = this._pre.get(toolName) || [];
        for (const fn of hooks) {
            try {
                await fn({ tool: toolName, args });
            } catch (err) {
                logger.error(`Error in before-hook for ${toolName}: ${err.message}`);
            }
        }
    }

    async runAfter(toolName, args, result) {
        const hooks = this._post.get(toolName) || [];
        for (const fn of hooks) {
            try {
                await fn({ tool: toolName, args, result });
            } catch (err) {
                logger.error(`Error in after-hook for ${toolName}: ${err.message}`);
            }
        }
    }

    async runError(toolName, args, error) {
        const hooks = this._error.get(toolName) || [];
        for (const fn of hooks) {
            try {
                await fn({ tool: toolName, args, error });
            } catch (err) {
                logger.error(`Error in error-hook for ${toolName}: ${err.message}`);
            }
        }
    }
}

module.exports = HookRegistry;
