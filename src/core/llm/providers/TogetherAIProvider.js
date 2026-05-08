'use strict';
/**
 * Together AI LLM Provider
 */

const { BaseProvider } = require('./BaseProvider');
const { logger } = require('../../logger');

class TogetherAIProvider extends BaseProvider {
    static getMetadata() {
        return {
            name: 'Together AI (Open Models)',
            envKey: 'TOGETHER_AI_API_KEY',
            defaultModel: 'mistralai/Mixtral-8x7B-Instruct-v0.1',
            tier: 2
        };
    }

    constructor(config = {}) {
        super(config);
        this.model = config.model || process.env.TOGETHER_AI_MODEL || 'mistralai/Mixtral-8x7B-Instruct-v0.1';
        this.apiKey = config.apiKey || process.env.TOGETHER_AI_API_KEY;
        this.base = config.baseURL || 'https://api.together.xyz/v1';
    }

    async initialize() {
        if (!this.apiKey) {
            throw new Error('TOGETHER_AI_API_KEY not configured');
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
            throw new Error(data.error?.message || 'Together AI API error');
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
        const response = await fetch(`${this.base}/embeddings`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${this.apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: 'togethercomputer/m2-bert-80M-8k-retrieval',
                input: input
            }),
        });

        const data = await response.json();
        if (!response.ok) {
            throw new Error(data.error?.message || 'Together AI embedding error');
        }

        return {
            embeddings: data.data.map(d => d.embedding),
            usage: {
                promptTokenCount: data.usage?.prompt_tokens
            }
        };
    }
}

BaseProvider.register('together', TogetherAIProvider);
BaseProvider.register('togetherai', TogetherAIProvider);
module.exports = { TogetherAIProvider };
