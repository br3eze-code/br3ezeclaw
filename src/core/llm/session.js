'use strict';
/**
 * LLM Conversation Session — Tracks history, usage, and transcripts
 * Ported from 36.js §4.1
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { logger } = require('../logger');

const MessageRole = Object.freeze({ 
    USER: 'user', 
    ASSISTANT: 'assistant', 
    TOOL: 'tool',
    SYSTEM: 'system'
});

class ContentBlock {
    static text(text) { return { type: 'text', text }; }
    static toolUse(id, name, input) { return { type: 'tool_use', id, name, input }; }
    static toolResult(toolUseId, toolName, output, isError = false) {
        return { 
            type: 'tool_result', 
            toolUseId, 
            toolName, 
            output: typeof output === 'string' ? output : JSON.stringify(output), 
            isError 
        };
    }
}

class TranscriptStore {
    constructor() { 
        this.entries = []; 
    }
    append(role, text) { 
        this.entries.push({ role, text, ts: Date.now() }); 
    }
    compact(keepLast = 20) { 
        if (this.entries.length > keepLast) this.entries = this.entries.slice(-keepLast); 
    }
    replay() { 
        return [...this.entries]; 
    }
}

class UsageTracker {
    constructor() { 
        this.inputTokens = 0; 
        this.outputTokens = 0; 
    }
    record(input, output) { 
        this.inputTokens += input; 
        this.outputTokens += output; 
    }
    snapshot() { 
        return { inputTokens: this.inputTokens, outputTokens: this.outputTokens }; 
    }
}

class ConversationSession {
    constructor(sessionId = crypto.randomUUID()) {
        this.sessionId = sessionId;
        this.messages = [];
        this.transcript = new TranscriptStore();
        this.usage = new UsageTracker();
        this.dataDir = path.join(process.cwd(), 'data', 'sessions');
        this._path = path.join(this.dataDir, `${sessionId}.json`);
        
        if (!fs.existsSync(this.dataDir)) {
            fs.mkdirSync(this.dataDir, { recursive: true });
        }
    }

    addUser(text) {
        this.messages.push({ role: MessageRole.USER, blocks: [ContentBlock.text(text)] });
        this.transcript.append('user', text);
    }

    addAssistant(blocks, usageMeta = null) {
        const msg = { role: MessageRole.ASSISTANT, blocks };
        if (usageMeta) {
            this.usage.record(usageMeta.promptTokenCount || 0, usageMeta.candidatesTokenCount || 0);
        }
        this.messages.push(msg);
        
        const textOnly = blocks.filter(b => b.type === 'text').map(b => b.text).join(' ');
        if (textOnly) this.transcript.append('assistant', textOnly);
    }

    addToolResult(toolUseId, toolName, output, isError = false) {
        this.messages.push({
            role: MessageRole.TOOL,
            blocks: [ContentBlock.toolResult(toolUseId, toolName, output, isError)],
        });
    }

    compactIfNeeded(threshold = 100_000) {
        // Simple heuristic: 1 token approx 4 chars
        let chars = JSON.stringify(this.messages).length;
        if (chars > threshold * 4 && this.messages.length > 10) {
            // Keep first system message if exists, and last 10 messages
            const first = this.messages[0].role === MessageRole.SYSTEM ? this.messages[0] : null;
            this.messages = [
                ...(first ? [first] : []),
                ...this.messages.slice(-10)
            ];
            this.transcript.compact(10);
            logger.info(`Session ${this.sessionId} auto-compacted due to size.`);
        }
    }

    persist() {
        try {
            fs.writeFileSync(this._path, JSON.stringify({
                sessionId: this.sessionId,
                messages: this.messages,
                usage: this.usage.snapshot(),
                updatedAt: new Date().toISOString(),
            }, null, 2));
        } catch (err) { 
            logger.error(`Session persist failed: ${err.message}`); 
        }
    }

    static load(sessionId) {
        const p = path.join(process.cwd(), 'data', 'sessions', `${sessionId}.json`);
        if (!fs.existsSync(p)) return null;
        try {
            const data = JSON.parse(fs.readFileSync(p, 'utf8'));
            const s = new ConversationSession(data.sessionId);
            s.messages = data.messages || [];
            return s;
        } catch { 
            return null; 
        }
    }

    toGeminiHistory() {
        return this.messages.map(msg => {
            if (msg.role === MessageRole.USER) {
                return { role: 'user', parts: msg.blocks.map(b => ({ text: b.text || '' })) };
            }
            if (msg.role === MessageRole.ASSISTANT) {
                const parts = msg.blocks.map(b => {
                    if (b.type === 'text') return { text: b.text };
                    if (b.type === 'tool_use') return { functionCall: { name: b.name, args: b.input } };
                    return null;
                }).filter(Boolean);
                return { role: 'model', parts };
            }
            if (msg.role === MessageRole.TOOL) {
                const block = msg.blocks[0];
                return { 
                    role: 'user', 
                    parts: [{ 
                        functionResponse: { 
                            name: block.toolName, 
                            response: { content: block.output } 
                        } 
                    }] 
                };
            }
            return null;
        }).filter(Boolean);
    }
}

module.exports = {
    MessageRole,
    ContentBlock,
    ConversationSession
};
