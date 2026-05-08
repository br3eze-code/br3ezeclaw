'use strict';
/**
 * OpenAI LLM Provider
 */

const { BaseProvider } = require('./BaseProvider');
const { logger } = require('../../logger');

class OpenAIProvider extends BaseProvider {
    static getMetadata() {
        return {
            name: 'OpenAI (GPT-4o)',
            envKey: 'OPENAI_API_KEY',
            defaultModel: 'gpt-4o',
            tier: 1
        };
    }

    constructor(config = {}) {
        super(config);
        this.model = config.model || process.env.LLM_MODEL || 'gpt-4o';
        this.apiKey = config.apiKey || process.env.OPENAI_API_KEY;
        this.base = config.baseURL || 'https://api.openai.com/v1';
    }

    async initialize() {
        if (!this.apiKey) {
            throw new Error('OPENAI_API_KEY not configured');
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
                messages: messages.map(m => {
                    const mapped = {
                        role: m.role,
                        content: m.content || null
                    };

                    if (Array.isArray(m.blocks)) {
                        const text = m.blocks.filter(b => b.type === 'text').map(b => b.text).join('\n');
                        if (text) mapped.content = text;

                        const toolUses = m.blocks.filter(b => b.type === 'tool_use');
                        if (toolUses.length > 0) {
                            mapped.tool_calls = toolUses.map(u => ({
                                id: u.id,
                                type: 'function',
                                function: {
                                    name: u.name,
                                    arguments: typeof u.input === 'string' ? u.input : JSON.stringify(u.input)
                                }
                            }));
                        }

                        const toolResults = m.blocks.filter(b => b.type === 'tool_result');
                        if (toolResults.length > 0) {
                            const first = toolResults[0];
                            mapped.role = 'tool';
                            mapped.tool_call_id = first.toolUseId;
                            mapped.content = typeof first.output === 'string' ? first.output : JSON.stringify(first.output);
                        }
                    }

                    return mapped;
                }),
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
            throw new Error(data.error?.message || 'OpenAI API error');
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
                model: this.model.includes('gpt') ? 'text-embedding-3-small' : this.model,
                input: input
            }),
        });

        const data = await response.json();
        if (!response.ok) {
            throw new Error(data.error?.message || 'OpenAI embedding error');
        }

        return {
            embeddings: data.data.map(d => d.embedding),
            usage: {
                promptTokenCount: data.usage?.prompt_tokens
            }
        };
    }
}

BaseProvider.register('openai', OpenAIProvider);
BaseProvider.register('gpt', OpenAIProvider);
module.exports = { OpenAIProvider };
