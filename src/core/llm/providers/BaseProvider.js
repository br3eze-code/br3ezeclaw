'use strict';
/**
 * Base LLM Provider
 */

const { logger } = require('../../logger');

class BaseProvider {
    static registry = new Map();

    static register(type, cls) {
        this.registry.set(type.toLowerCase(), cls);
        logger.debug(`LLM Provider registered: ${type}`);
    }

    static getMetadata() {
        return {
            name: 'Base Provider',
            envKey: 'API_KEY',
            defaultModel: 'unknown',
            tier: 1
        };
    }

    static getRegisteredTypes() {
        return Array.from(this.registry.keys());
    }

    static getRegistry() {
        const obj = {};
        for (const [key, val] of this.registry.entries()) {
            obj[key] = val;
        }
        return obj;
    }

    constructor(config = {}) {
        this.config = config;
    }

    async initialize() {
        throw new Error('initialize() not implemented');
    }

    async validateKey() {
        return { valid: !!(this.apiKey || this.config.apiKey), error: null };
    }

    async generate(messages, tools = []) {
        throw new Error('generate() not implemented');
    }

    async embed(input) {
        throw new Error('embed() not implemented');
    }
}

module.exports = { BaseProvider };
