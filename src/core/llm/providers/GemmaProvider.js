'use strict';
/**
 * Gemma LLM Provider (Google Open Models)
 */

const { BaseProvider } = require('./BaseProvider');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { logger } = require('../../logger');

class GemmaProvider extends BaseProvider {
    static getMetadata() {
        return {
            name: 'Google Gemma (Open Models)',
            envKey: 'GEMINI_API_KEY',
            defaultModel: 'gemma2-9b-it',
            tier: 3
        };
    }

    constructor(config = {}) {
        super(config);
        this.apiKey = config.apiKey || process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
        this.model = config.model || process.env.GEMMA_MODEL || 'gemma2-9b-it';
        this.isLocal = config.isLocal || (this.model.startsWith('local/'));
        this.client = null;
    }

    async validateKey() {
        if (this.isLocal) {
            const { OllamaProvider } = require('./OllamaProvider');
            return new OllamaProvider().validateKey();
        }
        const { GeminiProvider } = require('./GeminiProvider');
        return new GeminiProvider({ apiKey: this.apiKey }).validateKey();
    }

    async initialize() {
        if (!this.isLocal && !this.apiKey) {
            throw new Error('GEMINI_API_KEY/GOOGLE_API_KEY not configured for Gemma cloud');
        }
        if (!this.isLocal) {
            this.client = new GoogleGenerativeAI(this.apiKey);
        }
    }

    async generate(messages, tools = []) {
        if (this.isLocal) {
            const { OllamaProvider } = require('./OllamaProvider');
            const local = new OllamaProvider({ model: this.model.replace('local/', '') });
            return local.generate(messages, tools);
        }

        if (!this.client) await this.initialize();

        const model = this.client.getGenerativeModel({
            model: this.model,
            tools: tools.length ? [{ functionDeclarations: tools }] : []
        });

        const history = messages.slice(0, -1).map(m => ({
            role: m.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: m.content || '' }],
        }));

        const last = messages[messages.length - 1];
        const lastParts = [{ text: last.content || '' }];

        const chat = model.startChat({ history });
        const result = await chat.sendMessage(lastParts);
        const response = result.response;

        return {
            text: response.text() || '',
            calls: null,
            usage: {
                promptTokenCount: response.usageMetadata?.promptTokenCount,
                candidatesTokenCount: response.usageMetadata?.candidatesTokenCount
            }
        };
    }

    async embed(input) {
        if (this.isLocal) {
            const { OllamaProvider } = require('./OllamaProvider');
            const local = new OllamaProvider({ model: this.model.replace('local/', '') });
            return local.embed(input);
        }
        const { GeminiProvider } = require('./GeminiProvider');
        const gemini = new GeminiProvider({ apiKey: this.apiKey });
        return gemini.embed(input);
    }
}

BaseProvider.register('gemma', GemmaProvider);
BaseProvider.register('google-gemma', GemmaProvider);
module.exports = { GemmaProvider };
