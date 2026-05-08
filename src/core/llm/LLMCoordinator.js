'use strict';
/**
 * LLM Coordinator — Orchestrates multiple LLM providers
 */

const fs = require('fs');
const path = require('path');
const { logger } = require('../logger');
const { BaseProvider } = require('./providers/BaseProvider');

class LLMCoordinator {
    constructor(providerType = process.env.LLM_PROVIDER || 'gemini', config = {}) {
        this._loadProviders();
        this.providerType = providerType;
        this.provider = this.createProvider(providerType, config);
        this.hooks = config.hooks || new (require('./hooks'))();
    }

    /**
     * Dynamically loads all provider files to ensure self-registration
     */
    _loadProviders() {
        const providersDir = path.join(__dirname, 'providers');
        try {
            const files = fs.readdirSync(providersDir);
            for (const file of files) {
                if (file.endsWith('Provider.js') && file !== 'BaseProvider.js') {
                    try {
                        require(path.join(providersDir, file));
                        logger.debug(`LLMCoordinator: Loaded provider ${file}`);
                    } catch (err) {
                        logger.error(`LLMCoordinator: Failed to load provider ${file}:`, err.message);
                    }
                }
            }
        } catch (err) {
            logger.error('LLMCoordinator: Error reading providers directory:', err.message);
        }
    }

    createProvider(type, config = {}) {
        try {
            // Handle tiered selection
            if (type.startsWith('tier-')) {
                const tier = parseInt(type.split('-')[1]);
                const resolution = this.resolveTier(tier);
                type = resolution.provider;
                config.model = resolution.model;
            }

            const registry = BaseProvider.getRegistry();
            const ProviderClass = registry[type.toLowerCase()];

            if (!ProviderClass) {
                logger.warn(`Unknown LLM provider: ${type}, defaulting to gemini`);
                return new registry['gemini'](config);
            }

            return new ProviderClass(config);
        } catch (err) {
            logger.error(`Failed to create LLM provider ${type}: ${err.message}`);
            throw err;
        }
    }

    resolveTier(tier) {
        switch (tier) {
            case 1: // Best/Large
                return {
                    provider: process.env.TIER1_PROVIDER || 'gemini',
                    model: process.env.TIER1_MODEL || 'gemini-1.5-pro'
                };
            case 2: // Balanced/Flash
                return {
                    provider: process.env.TIER2_PROVIDER || 'gemini',
                    model: process.env.TIER2_MODEL || 'gemini-2.0-flash'
                };
            case 3: // Small/Open
                return {
                    provider: process.env.TIER3_PROVIDER || 'together',
                    model: process.env.TIER3_MODEL || 'mistralai/Mixtral-8x7B-Instruct-v0.1'
                };
            default:
                return {
                    provider: 'gemini',
                    model: 'gemini-1.5-flash'
                };
        }
    }

    async initialize() {
        return this.provider.initialize();
    }

    /**
     * @param {Array|string} messages - Conversation history or single prompt
     * @param {Object} options - Generation options (tools, temperature, etc)
     */
    async generate(messages, options = {}) {
        // Convert single string prompt to messages format if needed
        const msgs = typeof messages === 'string' 
            ? [{ role: 'user', content: messages }] 
            : messages;
            
        await this.hooks.trigger('pre_llm', { messages: msgs, options });
        
        try {
            const result = await this.provider.generate(msgs, options.tools || []);
            await this.hooks.trigger('post_llm', { messages: msgs, result });
            return result;
        } catch (err) {
            await this.hooks.trigger('llm_error', { messages: msgs, error: err });
            throw err;
        }
    }

    async classify(text, categories) {
        const prompt = `Classify the following text into one of these categories: ${categories.join(', ')}\n\nText: "${text}"\n\nRespond with only the category name.`;
        const result = await this.generate(prompt);
        return result.text.trim().toLowerCase();
    }

    async extractEntities(text, schema) {
        const prompt = `Extract entities from the following text according to this schema:\n${JSON.stringify(schema, null, 2)}\n\nText: "${text}"\n\nRespond with JSON only.`;
        const result = await this.generate(prompt);
        try {
            return JSON.parse(result.text);
        } catch (err) {
            logger.error(`Failed to parse entity extraction result: ${err.message}`);
            return {};
        }
    }

    /**
     * Generate embeddings for the given input
     * @param {string|string[]} input 
     */
    async embed(input) {
        if (typeof this.provider.embed !== 'function') {
            throw new Error(`Provider ${this.providerType} does not support embeddings`);
        }
        return this.provider.embed(input);
    }
}

module.exports = LLMCoordinator;
