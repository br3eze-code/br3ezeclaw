'use strict';
/**
 * ConversationSession — Manages user session state for LLM interactions.
 * Ported from ss35.js
 */
const fs = require('fs');
const crypto = require('crypto');
const { logger } = require('./logger');
const { costTracker } = require('./cost-tracker');

const MessageRole = Object.freeze({ USER: 'user', ASSISTANT: 'assistant', TOOL: 'tool' });

class ContentBlock {
    static text(text) { return { type: 'text', text }; }
    static toolUse(id, name, input) { return { type: 'tool_use', id, name, input }; }
    static toolResult(toolUseId, toolName, output, isError = false) {
        return { type: 'tool_result', toolUseId, toolName, output: typeof output === 'string' ? output : JSON.stringify(output), isError };
    }
}

class TranscriptStore {
    constructor() { this.entries = []; this.flushed = false; }
    append(entry) { this.entries.push(entry); this.flushed = false; }
    compact(keepLast = 12) { if (this.entries.length > keepLast) this.entries = this.entries.slice(-keepLast); }
    replay() { return [...this.entries]; }
    flush() { this.flushed = true; }
}

class UsageTracker {
    constructor() { this.inputTokens = 0; this.outputTokens = 0; }
    record(input, output) { this.inputTokens += input; this.outputTokens += output; }
    snapshot() { return { inputTokens: this.inputTokens, outputTokens: this.outputTokens }; }
    estimatedContextTokens(messages) {
        let chars = 0;
        for (const msg of messages)
            for (const block of msg.blocks || [])
                chars += (block.text || block.output || block.input || '').length;
        return Math.ceil(chars / 4);
    }
}

class ConversationSession {
    constructor(sessionId = crypto.randomUUID()) {
        this.sessionId = sessionId;
        this.messages = [];
        this.transcript = new TranscriptStore();
        this.usage = new UsageTracker();
        this._path = `./data/sessions/${sessionId}.json`;
    }

    addUser(text) {
        this.messages.push({ role: MessageRole.USER, blocks: [ContentBlock.text(text)] });
        this.transcript.append(text);
    }

    addAssistant(blocks, usageMeta = null) {
        const msg = { role: MessageRole.ASSISTANT, blocks };
        if (usageMeta) {
            this.usage.record(usageMeta.promptTokenCount || 0, usageMeta.candidatesTokenCount || 0);
            costTracker.record('gemini', usageMeta.promptTokenCount || 0, usageMeta.candidatesTokenCount || 0);
            msg.usage = { input: usageMeta.promptTokenCount, output: usageMeta.candidatesTokenCount };
        }
        this.messages.push(msg);
    }

    addToolResult(toolUseId, toolName, output, isError = false) {
        this.messages.push({
            role: MessageRole.TOOL,
            blocks: [ContentBlock.toolResult(toolUseId, toolName, output, isError)],
        });
    }

    compactIfNeeded(threshold = 200_000) {
        const est = this.usage.estimatedContextTokens(this.messages);
        if (est > threshold && this.messages.length > 4) {
            const anchor = this.messages[0];
            this.messages = [anchor, ...this.messages.slice(-8)];
            this.transcript.compact(8);
            logger.info(`Session ${this.sessionId}: auto-compacted (est ${est} tokens)`);
        }
    }

    persist() {
        try {
            if (!fs.existsSync('./data/sessions')) fs.mkdirSync('./data/sessions', { recursive: true });
            fs.writeFileSync(this._path, JSON.stringify({
                sessionId: this.sessionId,
                messages: this.messages,
                usage: this.usage.snapshot(),
                savedAt: new Date().toISOString(),
            }, null, 2));
        } catch (err) { logger.error(`Session persist failed: ${err.message}`); }
    }

    static load(sessionId) {
        const p = `./data/sessions/${sessionId}.json`;
        if (!fs.existsSync(p)) return null;
        try {
            const data = JSON.parse(fs.readFileSync(p, 'utf8'));
            const s = new ConversationSession(data.sessionId);
            s.messages = data.messages || [];
            return s;
        } catch { return null; }
    }

    toGeminiHistory() {
        return this.messages.map(msg => {
            if (msg.role === MessageRole.USER)
                return { role: 'user', parts: msg.blocks.map(b => ({ text: b.text || '' })) };
            if (msg.role === MessageRole.ASSISTANT) {
                const parts = msg.blocks.map(b => {
                    if (b.type === 'text') return { text: b.text };
                    if (b.type === 'tool_use') return { functionCall: { name: b.name, args: JSON.parse(b.input || '{}') } };
                    return null;
                }).filter(Boolean);
                return { role: 'model', parts };
            }
            if (msg.role === MessageRole.TOOL) {
                const block = msg.blocks[0];
                return { role: 'user', parts: [{ functionResponse: { name: block.toolName, response: { content: block.output } } }] };
            }
            return null;
        }).filter(Boolean);
    }
}

module.exports = { ConversationSession, MessageRole, ContentBlock, TranscriptStore, UsageTracker };
