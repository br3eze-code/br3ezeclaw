'use strict';
/**
 * AgentRuntime
 *
 */

const EventEmitter       = require('events');
const { AgentEngine }    = require('./agentEngine');
const { PermissionMode, PermissionDenial } = require('./permissions');
const { getTaskRegistry, TaskStatus }    = require('./taskRegistry');
const { getMikroTikClient }  = require('./mikrotik');
const { logger }             = require('./logger');

// ── Tool manifest ─────────────────────────────────────────────────────────────

const TOOL_MANIFEST = [
    { name: 'system.stats',      keywords: ['stats', 'cpu', 'memory', 'resource', 'system', 'health'] },
    { name: 'system.logs',       keywords: ['log', 'logs', 'syslog', 'event'] },
    { name: 'system.reboot',     keywords: ['reboot', 'restart', 'reset', 'boot'] },
    { name: 'users.active',      keywords: ['active', 'online', 'connected', 'sessions'] },
    { name: 'users.all',         keywords: ['all', 'users', 'list', 'hotspot'] },
    { name: 'user.add',          keywords: ['add', 'create', 'new', 'register', 'user'] },
    { name: 'user.remove',       keywords: ['remove', 'delete', 'user'] },
    { name: 'user.kick',         keywords: ['kick', 'disconnect', 'eject'] },
    { name: 'user.status',       keywords: ['status', 'user', 'check', 'session'] },
    { name: 'ping',              keywords: ['ping', 'latency', 'reach', 'reachable'] },
    { name: 'traceroute',        keywords: ['trace', 'traceroute', 'route', 'path', 'hop'] },
    { name: 'firewall.list',     keywords: ['firewall', 'rules', 'filter', 'list'] },
    { name: 'firewall.block',    keywords: ['block', 'ban', 'blacklist', 'deny'] },
    { name: 'firewall.unblock',  keywords: ['unblock', 'unban', 'whitelist', 'allow'] },
    { name: 'dhcp.leases',       keywords: ['dhcp', 'lease', 'ip', 'address', 'lease'] },
    { name: 'interface.list',    keywords: ['interface', 'port', 'eth', 'wlan', 'network'] },
    { name: 'arp.table',         keywords: ['arp', 'mac', 'table', 'device', 'client'] }
];

// ── Scoring  ──────────────────────────────────────

function scorePrompt(tokens, toolEntry) {
    return toolEntry.keywords.filter(kw => tokens.has(kw)).length;
}

// ── RuntimeSession ────────────────────────────────────────────────────────────

class RuntimeSession {
    constructor({ prompt, engine, matchedTools, permissionDenials, taskId = null }) {
        this.prompt            = prompt;
        this.engine            = engine;
        this.matchedTools      = matchedTools;
        this.permissionDenials = permissionDenials;
        this.taskId            = taskId;
        this.createdAt         = new Date().toISOString();
    }

    asMarkdown() {
        const lines = [
            `# Runtime Session`,
            ``,
            `Prompt: ${this.prompt}`,
            `Session ID: ${this.engine.sessionId}`,
            ``,
            `## Matched Tools`,
            ...(this.matchedTools.length
                ? this.matchedTools.map(t => `- ${t}`)
                : ['- none']),
            ``,
            `## Permission Denials`,
            ...(this.permissionDenials.length
                ? this.permissionDenials.map(d => `- ${d.toolName}: ${d.reason}`)
                : ['- none']),
            ``,
            `## Agent State`,
            this.engine.renderSummary(),
            ``,
            ...(this.taskId ? [`Task ID: ${this.taskId}`] : [])
        ];
        return lines.join('\n');
    }
}

// ── AgentRuntime ──────────────────────────────────────────────────────────────

class AgentRuntime extends EventEmitter {
    constructor(config = {}) {
        super();
        this.defaultConfig = {
            permissionMode:   config.permissionMode   || PermissionMode.PROMPT,
            maxTurns:         config.maxTurns         || 8,
            maxBudgetTokens:  config.maxBudgetTokens  || 4000,
            compactAfterTurns: config.compactAfterTurns || 12
        };
    }

    // ── Prompt routing ────────────────────────────────────────────────────────

    routePrompt(prompt, limit = 5) {
        const tokens = new Set(
            prompt.toLowerCase()
                .replace(/[^a-z0-9\s]/g, ' ')
                .split(/\s+/)
                .filter(Boolean)
        );

        const scored = TOOL_MANIFEST
            .map(entry => ({ name: entry.name, score: scorePrompt(tokens, entry) }))
            .filter(m => m.score > 0)
            .sort((a, b) => b.score - a.score);

        return scored.slice(0, limit).map(m => m.name);
    }

    // ── Session bootstrap ─────────────────────────────────────────────────────

    async bootstrapSession(prompt, { sessionId = null, permissionMode = null } = {}) {
        const engine = sessionId
            ? AgentEngine.fromSession(sessionId)
            : AgentEngine.create({ ...this.defaultConfig, permissionMode: permissionMode || this.defaultConfig.permissionMode });

        const matchedTools = this.routePrompt(prompt);

        const denials = this._inferDenials(matchedTools, engine);

        logger.info(`AgentRuntime bootstrap — tools: [${matchedTools.join(', ')}] denials: ${denials.length}`);

        const session = new RuntimeSession({
            prompt,
            engine,
            matchedTools,
            permissionDenials: denials
        });

        this.emit('session:created', session);
        return session;
    }

    // ── Turn loop ─────────────────────────────────────────────────────────────

    async runTurnLoop(prompt, { maxTurns = null, sessionId = null, permissionMode = null } = {}) {
        const session  = await this.bootstrapSession(prompt, { sessionId, permissionMode });
        const { engine, matchedTools, permissionDenials } = session;
        const turns    = maxTurns || this.defaultConfig.maxTurns;
        const results  = [];

        for (let i = 0; i < turns; i++) {
            const turnPrompt = i === 0 ? prompt : `${prompt} [turn ${i + 1}]`;
            const result     = await engine.submitMessage(turnPrompt, matchedTools, permissionDenials);
            results.push(result);
            this.emit('turn', result);
            if (result.stopReason !== 'completed') break;
        }

        const sessionPath = engine.persistSession();
        logger.info(`Session persisted → ${sessionPath}`);

        return { results, session, sessionPath };
    }

    // ── Async task dispatch ───────────────────────────────────────────────────
  

    async dispatchTask(prompt, opts = {}) {
        const registry = getTaskRegistry();
        const task     = registry.create(prompt, { description: opts.description });

        registry.setStatus(task.taskId, TaskStatus.RUNNING);
        this.emit('task:dispatched', task);

      
        this._executeTask(task.taskId, prompt, opts).catch(err => {
            registry.setStatus(task.taskId, TaskStatus.FAILED, err.message);
            logger.error(`Task ${task.taskId} failed:`, err.message);
        });

        return task;
    }

    async _executeTask(taskId, prompt, opts) {
        const registry = getTaskRegistry();
        const { results } = await this.runTurnLoop(prompt, opts);
        for (const r of results) {
            registry.appendOutput(taskId, 'assistant', r.output);
        }
        const last = results[results.length - 1];
        registry.setStatus(taskId, last?.stopReason === 'completed' ? TaskStatus.COMPLETED : TaskStatus.FAILED);
    }

    // ── Permission denial inference ───────────────────────────────────────────


    _inferDenials(toolNames, engine) {
        const denials = [];
        for (const name of toolNames) {
            const check = engine.enforcer.check(name);
            if (!check.allowed) {
                denials.push(new PermissionDenial(name, check.reason));
            }
        }
        return denials;
    }

    // ── Tool manifest info (for /tools Telegram command) ─────────────────────

    listTools() {
        return TOOL_MANIFEST.map(t => t.name);
    }

    findTools(query) {
        const needle = query.toLowerCase();
        return TOOL_MANIFEST
            .filter(t => t.name.includes(needle) || t.keywords.some(k => k.includes(needle)))
            .map(t => t.name);
    }
}

// ── Singleton ─────────────────────────────────────────────────────────────────

let _runtime = null;
function getAgentRuntime(config = {}) {
    if (!_runtime) _runtime = new AgentRuntime(config);
    return _runtime;
}

module.exports = { AgentRuntime, RuntimeSession, getAgentRuntime, TOOL_MANIFEST };
