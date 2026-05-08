'use strict';
/**
 * Groq LLM Provider
 */

const { BaseProvider } = require('./BaseProvider');
const { logger } = require('../../logger');

class GroqProvider extends BaseProvider {
    static getMetadata() {
        return {
            name: 'Groq (Ultra Fast)',
            envKey: 'GROQ_API_KEY',
            defaultModel: 'llama3-70b-8192',
            tier: 2
        };
    }

    constructor(config = {}) {
        super(config);
        this.model = config.model || process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';
        this.apiKey = config.apiKey || process.env.GROQ_API_KEY;
        this.base = config.baseURL || 'https://api.groq.com/openai/v1';
    }

    async initialize() {
        if (!this.apiKey) {
            throw new Error('GROQ_API_KEY not configured');
        }
    }

    async generate(messages, tools = []) {
        const response = await fetch(`${this.base}/chat/completions`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${this.apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: this.model,
                messages: messages.map(m => ({
                    role: m.role,
                    content: m.content || (Array.isArray(m.blocks) ? m.blocks.filter(b => b.type === 'text').map(b => b.text).join('\n') : '')
                })),
                tools: tools.length ? tools.map(t => ({
                    type: 'function',
                    function: {
                        name: t.name,
                        description: t.description,
                        parameters: t.parameters
                    }
                })) : undefined,
            }),
        });

        const data = await response.json();
        if (!response.ok) {
            throw new Error(data.error?.message || 'Groq API error');
        }

        const msg = data.choices[0].message;
        const calls = msg.tool_calls?.map(tc => ({
            name: tc.function.name,
            args: JSON.parse(tc.function.arguments || '{}'),
            id: tc.id
        }));

        return {
            text: msg.content || '',
            calls: calls?.length ? calls : null,
            usage: {
                promptTokenCount: data.usage?.prompt_tokens,
                candidatesTokenCount: data.usage?.completion_tokens
            }
        };
    }

    async validateKey() {
        try {
            const res = await fetch(`${this.base}/models`, {
                headers: { 'Authorization': `Bearer ${this.apiKey}` }
            });
            return { valid: res.ok, error: res.ok ? null : 'Invalid API key' };
        } catch (e) {
            return { valid: false, error: e.message };
        }
    }

    async embed(input) {
        throw new Error('Groq does not support embeddings.');
    }
}

BaseProvider.register('groq', GroqProvider);
module.exports = { GroqProvider };
