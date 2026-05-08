'use strict';
/**
 * Anthropic LLM Provider (Claude)
 */

const { BaseProvider } = require('./BaseProvider');
const { logger } = require('../../logger');

class AnthropicProvider extends BaseProvider {
    static getMetadata() {
        return {
            name: 'Anthropic (Claude)',
            envKey: 'ANTHROPIC_API_KEY',
            defaultModel: 'claude-3-5-sonnet-20241022',
            tier: 1
        };
    }

    constructor(config = {}) {
        super(config);
        this.model = config.model || process.env.ANTHROPIC_MODEL || 'claude-3-5-sonnet-20241022';
        this.apiKey = config.apiKey || process.env.ANTHROPIC_API_KEY;
        this.base = config.baseURL || 'https://api.anthropic.com/v1';
    }

    async initialize() {
        if (!this.apiKey) {
            throw new Error('ANTHROPIC_API_KEY not configured');
        }
    }

    async generate(messages, tools = []) {
        const anthropicMessages = messages.map(m => ({
            role: m.role === 'user' ? 'user' : 'assistant',
            content: m.content || (Array.isArray(m.blocks) ? m.blocks.map(b => {
                if (b.type === 'text') return { type: 'text', text: b.text };
                if (b.type === 'tool_use') return { type: 'tool_use', id: b.id, name: b.name, input: b.input };
                if (b.type === 'tool_result') return { type: 'tool_result', tool_use_id: b.toolUseId, content: b.output };
                return null;
            }).filter(Boolean) : [])
        }));

        const system = messages.find(m => m.role === 'system')?.content;

        const response = await fetch(`${this.base}/messages`, {
            method: 'POST',
            headers: {
                'x-api-key': this.apiKey,
                'anthropic-version': '2023-06-01',
                'content-type': 'application/json'
            },
            body: JSON.stringify({
                model: this.model,
                system: system,
                messages: anthropicMessages.filter(m => m.role !== 'system'),
                max_tokens: 4096,
                tools: tools.length ? tools.map(t => ({
                    name: t.name,
                    description: t.description,
                    input_schema: t.parameters
                })) : undefined
            }),
        });

        const data = await response.json();
        if (!response.ok) {
            throw new Error(data.error?.message || 'Anthropic API error');
        }

        let text = '';
        const calls = [];

        for (const content of data.content) {
            if (content.type === 'text') text += content.text;
            if (content.type === 'tool_use') {
                calls.push({
                    id: content.id,
                    name: content.name,
                    args: content.input
                });
            }
        }

        return {
            text: text,
            calls: calls.length ? calls : null,
            usage: {
                promptTokenCount: data.usage?.input_tokens,
                candidatesTokenCount: data.usage?.output_tokens
            }
        };
    }

    async validateKey() {
        try {
            const response = await fetch(`${this.base}/messages`, {
                method: 'POST',
                headers: {
                    'x-api-key': this.apiKey,
                    'anthropic-version': '2023-06-01',
                    'content-type': 'application/json'
                },
                body: JSON.stringify({
                    model: this.model,
                    max_tokens: 1,
                    messages: [{ role: 'user', content: 'hi' }]
                }),
            });
            return { valid: response.ok || response.status === 400, error: response.ok || response.status === 400 ? null : 'Invalid API key' };
        } catch (e) {
            return { valid: false, error: e.message };
        }
    }

    async embed(input) {
        // Anthropic does not provide an embedding API yet
        throw new Error('Anthropic does not support embeddings. Use Gemini or OpenAI.');
    }
}

BaseProvider.register('anthropic', AnthropicProvider);
BaseProvider.register('claude', AnthropicProvider);
module.exports = { AnthropicProvider };
