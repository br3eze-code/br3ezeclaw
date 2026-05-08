'use strict';
/**
 * Ollama LLM Provider (Local)
 */

const { BaseProvider } = require('./BaseProvider');
const { logger } = require('../../logger');
const crypto = require('crypto');

class OllamaProvider extends BaseProvider {
    static getMetadata() {
        return {
            name: 'Ollama (Local)',
            envKey: 'OLLAMA_BASE_URL',
            defaultModel: 'llama3',
            tier: 3
        };
    }

    constructor(config = {}) {
        super(config);
        this.model = config.model || process.env.OLLAMA_MODEL || 'llama3';
        this.base = config.baseURL || process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
        this.availableModels = [];
    }

    async initialize() {
        try {
            const response = await fetch(`${this.base}/api/tags`);
            if (!response.ok) throw new Error('Ollama not reachable');
            const data = await response.json();
            this.availableModels = data.models || [];
            const exists = this.availableModels.some(m => m.name.startsWith(this.model));
            if (!exists) {
                logger.warn(`Ollama model ${this.model} not found locally. Ensure it is pulled.`);
            }
        } catch (err) {
            logger.error(`Ollama connection error: ${err.message}`);
            throw new Error(`Ollama service unavailable at ${this.base}`);
        }
    }

    /**
     * Generate text or tool calls using the chat endpoint.
     */
    async generate(messages, tools = []) {
        const ollamaMessages = messages.map(m => {
            const mapped = {
                role: m.role,
                content: m.content || ''
            };

            if (Array.isArray(m.blocks)) {
                const textParts = m.blocks.filter(b => b.type === 'text').map(b => b.text);
                if (textParts.length > 0) {
                    mapped.content = textParts.join('\n');
                }

                const toolResults = m.blocks.filter(b => b.type === 'tool_result');
                if (toolResults.length > 0) {
                    mapped.role = 'tool';
                    mapped.content = toolResults.map(r => r.output).join('\n');
                }

                const toolUses = m.blocks.filter(b => b.type === 'tool_use');
                if (toolUses.length > 0) {
                    mapped.tool_calls = toolUses.map(u => ({
                        function: {
                            name: u.name,
                            arguments: u.input
                        }
                    }));
                }
            }

            return mapped;
        });

        const payload = {
            model: this.model,
            messages: ollamaMessages,
            stream: false,
            options: { temperature: 0.7 }
        };

        if (tools && tools.length > 0) {
            payload.tools = tools.map(t => ({
                type: 'function',
                function: {
                    name: t.name,
                    description: t.description,
                    parameters: t.parameters
                }
            }));
        }

        const response = await fetch(`${this.base}/api/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const responseData = await response.json();
        if (!response.ok) {
            throw new Error(responseData.error || 'Ollama API error');
        }

        const msg = responseData.message;
        const calls = msg?.tool_calls?.map(tc => ({
            name: tc.function.name,
            args: tc.function.arguments,
            id: crypto.randomBytes(4).toString('hex')
        }));

        return {
            text: msg?.content || '',
            calls: calls?.length ? calls : null,
            usage: {
                promptTokenCount: responseData.prompt_eval_count || 0,
                candidatesTokenCount: responseData.eval_count || 0
            }
        };
    }

    async validateKey() {
        try {
            const response = await fetch(`${this.base}/api/tags`);
            return { valid: response.ok, error: response.ok ? null : 'Ollama not reachable' };
        } catch (e) {
            return { valid: false, error: e.message };
        }
    }

    async embed(input) {
        const response = await fetch(`${this.base}/api/embeddings`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: this.model,
                prompt: typeof input === 'string' ? input : input[0]
            })
        });

        const data = await response.json();
        if (!response.ok) {
            throw new Error(data.error || 'Ollama embedding error');
        }

        return {
            embeddings: [data.embedding],
            usage: { promptTokenCount: data.prompt_eval_count || 0 }
        };
    }

    async listModels() {
        if (!this.availableModels.length) await this.initialize();
        return this.availableModels;
    }
}

BaseProvider.register('ollama', OllamaProvider);
BaseProvider.register('local', OllamaProvider);
module.exports = { OllamaProvider };
