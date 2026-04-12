'use strict';
/**
 * AgentEngine
 */

const { v4: uuidv4 }        = require('uuid');
const EventEmitter           = require('events');
const { TranscriptStore }    = require('./transcript');
const { saveSession, loadSession } = require('./sessionStore');
const { PermissionMode, PermissionEnforcer, PermissionDenial } = require('./permissions');
const { getMikroTikClient }  = require('./mikrotik');
const { logger }             = require('./logger');

// ── Config ────────────────────────────────────────────────────────────────────

const DEFAULT_CONFIG = Object.freeze({
    maxTurns:         8,
    maxBudgetTokens:  4000, 
    compactAfterTurns: 12,
    structuredOutput: false,
    permissionMode:   PermissionMode.PROMPT
});

// ── UsageSummary ──────────────────────────────────────────────────────────────

class UsageSummary {
    constructor(inputTokens = 0, outputTokens = 0) {
        this.inputTokens  = inputTokens;
        this.outputTokens = outputTokens;
    }
    get total() { return this.inputTokens + this.outputTokens; }
    addTurn(prompt, output) {
        return new UsageSummary(
            this.inputTokens  + prompt.split(/\s+/).length,
            this.outputTokens + output.split(/\s+/).length
        );
    }
    toJSON() { return { inputTokens: this.inputTokens, outputTokens: this.outputTokens }; }
}

// ── TurnResult ────────────────────────────────────────────────────────────────

class TurnResult {
    constructor({ prompt, output, matchedTools = [], permissionDenials = [], usage, stopReason = 'completed' }) {
        this.prompt             = prompt;
        this.output             = output;
        this.matchedTools       = matchedTools;
        this.permissionDenials  = permissionDenials;
        this.usage              = usage;
        this.stopReason         = stopReason;
        this.timestamp          = new Date().toISOString();
    }
    toJSON() {
        return {
            prompt:            this.prompt,
            output:            this.output,
            matchedTools:      this.matchedTools,
            permissionDenials: this.permissionDenials.map(d => d.toJSON?.() ?? d),
            usage:             this.usage.toJSON(),
            stopReason:        this.stopReason,
            timestamp:         this.timestamp
        };
    }
}

// ── AgentEngine ───────────────────────────────────────────────────────────────

class AgentEngine extends EventEmitter {
    constructor(config = {}, sessionId = null) {
        super();
        this.config         = { ...DEFAULT_CONFIG, ...config };
        this.sessionId      = sessionId || uuidv4().replace(/-/g, '');
        this.messages       = [];          // mutable turn log (compacted)
        this.permissionDenials = [];
        this.totalUsage     = new UsageSummary();
        this.transcriptStore = new TranscriptStore();
        this.enforcer       = new PermissionEnforcer(this.config.permissionMode);
    }

    // ── Factory ───────────────────────────────────────────────────────────────

    static create(config = {}) {
        return new AgentEngine(config);
    }

    static fromSession(sessionId) {
        const stored  = loadSession(sessionId);
        const engine  = new AgentEngine({}, sessionId);
        engine.messages = [...stored.messages];
        engine.totalUsage = new UsageSummary(stored.inputTokens, stored.outputTokens);
        engine.transcriptStore = new TranscriptStore({ entries: [...stored.messages] });
        logger.info(`AgentEngine restored session ${sessionId} (${stored.messages.length} turns)`);
        return engine;
    }

    // ── Core turn loop ────────────────────────────────────────────────────────

    async submitMessage(prompt, toolNames = [], deniedTools = []) {
        if (this.messages.length >= this.config.maxTurns) {
            logger.warn(`AgentEngine[${this.sessionId}] max turns reached`);
            return new TurnResult({
                prompt,
                output:    `Max turns (${this.config.maxTurns}) reached before processing prompt.`,
                matchedTools: toolNames,
                permissionDenials: deniedTools,
                usage:     this.totalUsage,
                stopReason: 'max_turns_reached'
            });
        }

        const finalDenials = [...deniedTools];
        const allowedTools = [];
        for (const toolName of toolNames) {
            const result = this.enforcer.check(toolName);
            if (!result.allowed) {
                finalDenials.push(new PermissionDenial(toolName, result.reason));
                logger.warn(`Permission denied: ${toolName} — ${result.reason}`);
            } else {
                allowedTools.push(toolName);
            }
        }

        // Execute allowed tools against MikroTik
        const toolOutputs = [];
        const mikrotik = getMikroTikClient();
        for (const toolName of allowedTools) {
            try {
                const out = await mikrotik.executeTool(toolName);
                toolOutputs.push({ tool: toolName, result: out });
            } catch (err) {
                toolOutputs.push({ tool: toolName, error: err.message });
                logger.error(`Tool execution error [${toolName}]:`, err.message);
            }
        }

        // Synthesise output
        const lines = [
            `Prompt: ${prompt}`,
            toolOutputs.length ? `Tools executed: ${allowedTools.join(', ')}` : 'No tools executed',
            ...toolOutputs.map(t => t.error
                ? `  ✗ ${t.tool}: ${t.error}`
                : `  ✓ ${t.tool}: ${JSON.stringify(t.result).slice(0, 120)}`
            ),
            finalDenials.length ? `Permission denials: ${finalDenials.map(d => d.toolName).join(', ')}` : null
        ].filter(Boolean);

        const output = lines.join('\n');
        const projectedUsage = this.totalUsage.addTurn(prompt, output);

        let stopReason = 'completed';
        if (projectedUsage.total > this.config.maxBudgetTokens) {
            stopReason = 'max_budget_reached';
            logger.warn(`AgentEngine[${this.sessionId}] budget exceeded — compacting`);
        }

        // Update state
        this.messages.push(prompt);
        this.transcriptStore.append(prompt);
        this.permissionDenials.push(...finalDenials);
        this.totalUsage = projectedUsage;

        this._compactIfNeeded();

        const turn = new TurnResult({
            prompt,
            output,
            matchedTools:      allowedTools,
            permissionDenials: finalDenials,
            usage:             this.totalUsage,
            stopReason
        });

        this.emit('turn', turn);
        return turn;
    }

    async *streamSubmitMessage(prompt, toolNames = [], deniedTools = []) {
        yield { type: 'message_start', sessionId: this.sessionId, prompt };
        if (toolNames.length)  yield { type: 'tool_match',  tools:   toolNames };
        if (deniedTools.length) yield { type: 'permission_denial', denials: deniedTools.map(d => d.toolName) };

        const result = await this.submitMessage(prompt, toolNames, deniedTools);

        yield { type: 'message_delta', text: result.output };
        yield {
            type:           'message_stop',
            usage:          result.usage.toJSON(),
            stopReason:     result.stopReason,
            transcriptSize: this.transcriptStore.size
        };
    }

    // ── Session persistence ───────────────────────────────────────────────────

    persistSession() {
        this.transcriptStore.flush();
        return saveSession({
            sessionId:    this.sessionId,
            messages:     [...this.messages],
            inputTokens:  this.totalUsage.inputTokens,
            outputTokens: this.totalUsage.outputTokens,
            createdAt:    new Date().toISOString(),
            updatedAt:    new Date().toISOString()
        });
    }

    // ── Compaction ────────────────────────────────────────────────────────────

    _compactIfNeeded() {
        if (this.messages.length > this.config.compactAfterTurns) {
            this.messages = this.messages.slice(-this.config.compactAfterTurns);
            this.transcriptStore.compact(this.config.compactAfterTurns);
            logger.debug(`AgentEngine[${this.sessionId}] compacted to ${this.config.compactAfterTurns} turns`);
        }
    }

    // ── Summary ───────────────────────────────────────────────────────────────

    renderSummary() {
        return [
            `Session: ${this.sessionId}`,
            `Turns: ${this.messages.length} / ${this.config.maxTurns}`,
            `Usage: in=${this.totalUsage.inputTokens} out=${this.totalUsage.outputTokens}`,
            `Denials: ${this.permissionDenials.length}`,
            `Mode: ${this.config.permissionMode}`,
            `Transcript flushed: ${this.transcriptStore.flushed}`
        ].join('\n');
    }
}

module.exports = { AgentEngine, TurnResult, UsageSummary };
