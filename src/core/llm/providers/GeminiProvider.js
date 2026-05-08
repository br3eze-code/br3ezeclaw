'use strict';
/**
 * Gemini LLM Provider
 * Ported from 36.js §2.5
 */

const { BaseProvider } = require('./BaseProvider');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { logger } = require('../../logger');

class GeminiProvider extends BaseProvider {
    static getMetadata() {
        return {
            name: 'Google Gemini (Pro/Flash)',
            envKey: 'GEMINI_API_KEY',
            defaultModel: 'gemini-1.5-pro',
            tier: 1
        };
    }

    constructor(config = {}) {
        super(config);
        this.apiKey = config.apiKey || process.env.GEMINI_API_KEY;
        this.model = config.model || process.env.LLM_MODEL || 'gemini-2.0-flash';
        this.client = null;
    }

    async initialize() {
        if (!this.apiKey) {
            throw new Error('GEMINI_API_KEY not configured');
        }
        this.client = new GoogleGenerativeAI(this.apiKey);
    }

    async generate(messages, tools = []) {
        if (!this.client) await this.initialize();

        const model = this.client.getGenerativeModel({
            model: this.model,
            tools: tools.length ? [{ functionDeclarations: tools }] : []
        });

        const history = messages.slice(0, -1).map(m => ({
            role: m.role === 'assistant' ? 'model' : 'user',
            parts: Array.isArray(m.blocks)
                ? m.blocks.map(b => {
                    if (b.type === 'text') return { text: b.text };
                    if (b.type === 'tool_result') return { functionResponse: { name: b.toolName, response: { content: b.output } } };
                    if (b.type === 'tool_use') return { functionCall: { name: b.name, args: b.input } };
                    return null;
                }).filter(Boolean)
                : [{ text: m.content || '' }],
        }));

        const last = messages[messages.length - 1];
        const lastParts = Array.isArray(last.blocks)
            ? last.blocks.map(b => {
                if (b.type === 'text') return { text: b.text };
                if (b.type === 'tool_result') return { functionResponse: { name: b.toolName, response: { content: b.output } } };
                return null;
            }).filter(Boolean)
            : [{ text: last.content || '' }];

        const chat = model.startChat({ history });
        const result = await chat.sendMessage(lastParts);
        const response = result.response;

        const calls = response.candidates[0].content.parts
            .filter(p => p.functionCall)
            .map(p => ({
                name: p.functionCall.name,
                args: p.functionCall.args,
                id: require('crypto').randomBytes(4).toString('hex') 
            }));

        return {
            text: response.text() || '',
            calls: calls.length ? calls : null,
            usage: {
                promptTokenCount: response.usageMetadata?.promptTokenCount,
                candidatesTokenCount: response.usageMetadata?.candidatesTokenCount
            }
        };
    }

    async validateKey() {
        try {
            if (!this.client) await this.initialize();
            // Try to list models as a health check
            await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${this.apiKey}`);
            // Actually check with the SDK if possible or just use fetch
            const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${this.apiKey}`);
            return { valid: res.ok, error: res.ok ? null : 'Invalid API key' };
        } catch (e) {
            return { valid: false, error: e.message };
        }
    }

    async embed(input) {
        if (!this.client) await this.initialize();
        const model = this.client.getGenerativeModel({ model: 'text-embedding-004' });
        
        if (Array.isArray(input)) {
            const result = await model.batchEmbedContents({
                requests: input.map(text => ({ content: { parts: [{ text }] } }))
            });
            return {
                embeddings: result.embeddings.map(e => e.values),
                usage: { promptTokenCount: 0 }
            };
        } else {
            const result = await model.embedContent(input);
            return {
                embeddings: [result.embedding.values],
                usage: { promptTokenCount: 0 }
            };
        }
    }
}

BaseProvider.register('gemini', GeminiProvider);
module.exports = { GeminiProvider };