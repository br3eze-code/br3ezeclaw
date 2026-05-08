'use strict';
/**
 * AskEngine — Tiered ReAct intelligence engine
 * Ported from main.js §8
 *
 * Tier 1: Direct keyword → tool map
 * Tier 2: Rule-based regex shortcuts
 * Tier 3: Gemini AI with function-calling ReAct loop (max 5 turns)
 * Tier 4: Fallback message
 */

const { logger } = require('./logger');
const { costTracker } = require('./cost-tracker');

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtBytes(b) {
    if (!b || b === 0) return '0 B';
    const k = 1024, sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(b) / Math.log(k));
    return `${parseFloat((b / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

function truncate(s, n = 3800) {
    return s && s.length > n ? s.slice(0, n) + '…' : s;
}

// ── Gemini function declarations (lowercase types as API requires) ─────────────

const FUNCTION_DECLARATIONS = [
    {
        name: 'manage_network',
        description: 'Execute a command on the MikroTik router or query hotspot state.',
        parameters: {
            type: 'object',
            properties: {
                action: {
                    type: 'string',
                    enum: ['users.active', 'users.all', 'system.stats', 'user.kick', 'user.status',
                        'firewall.block', 'firewall.unblock', 'system.reboot', 'system.logs',
                        'dhcp.leases', 'arp.table', 'interface.list', 'ip.addresses']
                },
                target: { type: 'string', description: 'Username, IP, or MAC address' },
            },
            required: ['action'],
        },
    },
    {
        name: 'manage_hotspot_user',
        description: 'Perform write operations on a MikroTik hotspot user: disable, enable, or permanently remove them.',
        parameters: {
            type: 'object',
            properties: {
                action: {
                    type: 'string',
                    enum: ['disable', 'enable', 'remove'],
                    description: 'disable — blocks login immediately (sets disabled=yes and kicks session); enable — restores access; remove — permanently deletes the user from the router'
                },
                username: { type: 'string', description: 'The hotspot username to act on' }
            },
            required: ['action', 'username']
        }
    },
    {
        name: 'manage_vouchers',
        description: 'Create top-up vouchers or query existing ones.',
        parameters: {
            type: 'object',
            properties: {
                action: { type: 'string', enum: ['create', 'stats', 'list', 'redeem'] },
                amount: { type: 'number', description: 'Amount/Value of the top-up voucher in credits' },
                code: { type: 'string', description: 'Voucher code to redeem' },
                userId: { type: 'string', description: 'User ID for redemption' }
            },
            required: ['action'],
        },
    },
    {
        name: 'manage_users',
        description: 'Query messaging users, balances, and hotspot profiles.',
        parameters: {
            type: 'object',
            properties: {
                action: { type: 'string', enum: ['get_balance', 'find_user', 'list_hotspot_profiles', 'list_active'] },
                target: { type: 'string', description: 'User ID, username, or phone number' }
            },
            required: ['action']
        }
    },
    {
        name: 'manage_finance',
        description: 'Query revenue, audits, and payment statuses.',
        parameters: {
            type: 'object',
            properties: {
                action: { type: 'string', enum: ['revenue_report', 'verify_payment', 'audit_log', 'trends', 'payment_link', 'transfer'] },
                target: { type: 'string', description: 'Payment ID, reference, or recipient username for transfer' },
                plan: { type: 'string', description: 'Plan name for payment link' },
                amount: { type: 'number', description: 'Amount for transfer or link' },
                from: { type: 'string', description: 'Sender username (optional, defaults to current)' }
            },
            required: ['action']
        }
    },
    {
        name: 'manage_discovery',
        description: 'Scan the network for active hosts or neighbors.',
        parameters: {
            type: 'object',
            properties: {
                action: { type: 'string', enum: ['scan', 'neighbors'] },
                interface: { type: 'string', description: 'Network interface (optional)' }
            },
            required: ['action']
        }
    }
];

// ── Tier-1 keyword → tool map ─────────────────────────────────────────────────

const TOOL_MAP = {
    'active users': { name: 'users.active', args: [] },
    'all users': { name: 'users.all', args: [] },
    'system stats': { name: 'system.stats', args: [] },
    'router status': { name: 'system.stats', args: [] },
    'reboot router': { name: 'system.reboot', args: [] },
    'dhcp leases': { name: 'dhcp.leases', args: [] },
    'arp table': { name: 'arp.table', args: [] },
    'interfaces': { name: 'interfaces', args: [] },
    'uptime': { name: 'system.stats', args: [] },
    'resources': { name: 'system.stats', args: [] },
    'who': { name: 'users.active', args: [] },
    'balance': { name: 'user.balance', args: [] },
    'my credits': { name: 'user.balance', args: [] },
    'scan network': { name: 'discovery.scan', args: [] },
    'show neighbors': { name: 'discovery.neighbors', args: [] }
};

// ── Voucher code generator (matches main.js voucherCode()) ───────────────────

function voucherCode() {
    const crypto = require('crypto');
    const part = () => crypto.randomBytes(2).toString('hex').toUpperCase();
    return `STAR-${part()}-${part()}`;
}

// ── AskEngine ─────────────────────────────────────────────────────────────────

class AskEngine {
    /**
     * @param {object} deps  { mikrotik, database, financial, llm }
     *   - mikrotik:  MikroTikManager instance
     *   - database:  DatabaseAdapter instance
     *   - financial: FinancialService instance (optional)
     *   - llm:       LLMCoordinator instance (optional — rule-only if absent)
     */
    constructor({ mikrotik, database, financial, billing, discovery, memory, llm } = {}) {
        this.mikrotik = mikrotik;
        this.database = database;
        this.financial = financial;
        this.billing = billing;
        this.discovery = discovery;
        this.memory = memory;
        this.llm = llm;

        this.isRuleOnly = !llm;
        if (this.isRuleOnly) {
            logger.warn('AskEngine starting in [RULE-ONLY] mode (no LLM coordinator provided)');
        }

        this._toolMap = { ...TOOL_MAP };
        this._declarations = FUNCTION_DECLARATIONS;
    }

    // ── Public: run() — returns { tier, type, result, [data], [turns], [sessionId] }

    async run(input) {
        // Tier 1 — direct keyword → tool
        const tier1 = this._matchTool(input);
        if (tier1 && this.mikrotik) {
            try {
                return { tier: 1, type: 'tool', result: await this.mikrotik.executeTool(tier1.name, ...tier1.args) };
            } catch (e) {
                return { tier: 1, type: 'error', result: e.message };
            }
        }

        // Tier 2 — rule-based shortcuts
        const rule = this._matchRule(input);
        if (rule) {
            try {
                return { tier: 2, type: 'rule', result: await rule() };
            } catch (e) {
                return { tier: 2, type: 'error', result: e.message };
            }
        }

        // Tier 3 — Unified LLM with function calling
        if (this.isRuleOnly || !this.llm) {
            return {
                tier: 0,
                type: 'fallback',
                result: '⚠️ *Rule-Only Mode Active*\nLLM Provider is not configured. I can only process direct tools and shortcuts (e.g. `who`, `kick name`).'
            };
        }

        try {
            // Broadcast thinking state to WebSocket clients if gateway is available
            if (global.gateway) global.gateway.broadcast({ type: 'ai.state', state: 'thinking' });
            const res = await this._runAI(input);
            if (global.gateway) global.gateway.broadcast({ type: 'ai.state', state: 'idle' });
            return res;
        } catch (e) {
            if (global.gateway) global.gateway.broadcast({ type: 'ai.state', state: 'idle' });
            logger.error(`AI reasoning failed: ${e.message}`);
            return { tier: 3, type: 'error', result: e.message };
        }
    }

    // ── Public: stream() — async generator of typed SSE events

    async *stream(input) {
        yield { type: 'message_start', input, ts: Date.now() };

        const tier1 = this._matchTool(input);
        if (tier1 && this.mikrotik) {
            yield { type: 'tool_match', tools: [tier1.name] };
            try {
                const result = await this.mikrotik.executeTool(tier1.name, ...tier1.args);
                yield { type: 'message_delta', text: this.formatResponse(result) };
                yield { type: 'message_stop', tier: 1, stop_reason: 'tool_completed' };
            } catch (e) {
                yield { type: 'error', message: e.message };
                yield { type: 'message_stop', tier: 1, stop_reason: 'error' };
            }
            return;
        }

        const rule = this._matchRule(input);
        if (rule) {
            yield { type: 'rule_match' };
            try {
                const result = await rule();
                yield { type: 'message_delta', text: this.formatResponse(result) };
                yield { type: 'message_stop', tier: 2, stop_reason: 'rule_completed' };
            } catch (e) {
                yield { type: 'error', message: e.message };
                yield { type: 'message_stop', tier: 2, stop_reason: 'error' };
            }
            return;
        }

        if (this.isRuleOnly || !this.llm) {
            yield { type: 'message_delta', text: '⚠️ Rule-Only Mode — no AI provider configured.' };
            yield { type: 'message_stop', tier: 0, stop_reason: 'rule_only' };
            return;
        }

        yield { type: 'ai_thinking' };
        if (global.gateway) global.gateway.broadcast({ type: 'ai.state', state: 'thinking' });
        try {
            const res = await this._runAI(input);
            if (global.gateway) global.gateway.broadcast({ type: 'ai.state', state: 'idle' });
            yield { type: 'message_delta', text: res.result };
            if (res.data) yield { type: 'tool_trace', trace: res.data };
            yield { type: 'message_stop', tier: 3, stop_reason: 'completed', turns: res.turns };
        } catch (e) {
            if (global.gateway) global.gateway.broadcast({ type: 'ai.state', state: 'idle' });
            yield { type: 'error', message: e.message };
            yield { type: 'message_stop', tier: 3, stop_reason: 'error' };
        }
    }


    // ── formatResponse() — Markdown renderer for tool results

    formatResponse(text) {
        if (!text) return 'No data available.';
        const s = (typeof text === 'object') ? JSON.stringify(text, null, 2) : String(text);
        const lower = s.toLowerCase();

        if (Array.isArray(text)) {
            if (text.length === 0) return 'Empty results.';
            const keys = Object.keys(text[0]).filter(k => k !== '.id');
            const header = `| ${keys.join(' | ')} |`;
            const sep = `| ${keys.map(() => '---').join(' | ')} |`;
            const rows = text.slice(0, 10).map(row => `| ${keys.map(k => row[k] ?? '').join(' | ')} |`);
            return `\n${header}\n${sep}\n${rows.join('\n')}${text.length > 10 ? '\n\n*(Truncated)*' : ''}`;
        }

        if (typeof text === 'object' && text['cpu-load'] !== undefined) {
            return `📊 **System Intelligence**\n` +
                `• **CPU Load:** ${text['cpu-load']}%\n` +
                `• **Free RAM:** ${fmtBytes(parseInt(text['free-memory']))}\n` +
                `• **Total RAM:** ${fmtBytes(parseInt(text['total-memory']))}\n` +
                `• **Uptime:** ${text.uptime}\n` +
                `• **Version:** ${text.version}`;
        }

        const isTech = ['/ip', '/system', '/tool', 'delay', 'set '].some(k => lower.includes(k));
        return (isTech && !s.includes('```'))
            ? `🖥️ **Configuration:**\n\`\`\`routeros\n${s.trim()}\n\`\`\``
            : s;
    }

    // ── Tier-1: keyword tool matching ─────────────────────────────────────────

    _matchTool(input) {
        const lower = input.toLowerCase();
        const key = Object.keys(this._toolMap).find(k => lower.includes(k));
        return key ? this._toolMap[key] : null;
    }

    // ── Tier-2: rule-based matching ───────────────────────────────────────────

    _matchRule(input) {
        const lower = input.trim().toLowerCase();

        if (lower.includes('voucher stats') || lower.includes('db stats')) {
            return () => this.database?.getStats();
        }

        // ── Hotspot user write operations (Tier-2 fast path) ──────────────────
        // Patterns: "disable user John", "disable John", "block user John"
        const disableMatch = lower.match(/(?:disable|suspend|block)\s+(?:user\s+)?([\w@.\-]+)/);
        if (disableMatch && this.mikrotik) {
            const uname = disableMatch[1];
            return async () => {
                const r = await this.mikrotik.disableHotspotUser(uname);
                return r.action === 'disabled'
                    ? `✅ User *${uname}* disabled and kicked from active sessions.`
                    : `⚠️ Could not disable *${uname}*: ${r.reason || 'unknown reason'}`;
            };
        }

        // Patterns: "enable user John", "unblock user John", "restore John"
        const enableMatch = lower.match(/(?:enable|unblock|restore|reactivate)\s+(?:user\s+)?([\w@.\-]+)/);
        if (enableMatch && this.mikrotik) {
            const uname = enableMatch[1];
            return async () => {
                const r = await this.mikrotik.enableHotspotUser(uname);
                return r.action === 'enabled'
                    ? `✅ User *${uname}* re-enabled.`
                    : `⚠️ Could not enable *${uname}*: ${r.reason || 'unknown reason'}`;
            };
        }

        // Patterns: "remove user John", "delete user John", "delete John"
        const removeMatch = lower.match(/(?:remove|delete)\s+(?:user\s+)?([\w@.\-]+)/);
        if (removeMatch && this.mikrotik) {
            const uname = removeMatch[1];
            return async () => {
                const r = await this.mikrotik.removeHotspotUser(uname);
                return r.action === 'removed'
                    ? `🗑️ User *${uname}* permanently removed from the router.`
                    : `⚠️ Remove skipped for *${uname}*: ${r.reason || 'unknown reason'}`;
            };
        }

        const kickMatch = lower.match(/^kick\s+(\w+)$/);
        if (kickMatch && this.mikrotik) return () => this.mikrotik.kickUser(kickMatch[1]);

        const blockMatch = lower.match(/^block\s+([\d.a-f:]+)$/);
        if (blockMatch && this.mikrotik) return () => this.mikrotik.addToBlockList(blockMatch[1]);

        const pingMatch = lower.match(/^ping\s+([\w.-]+)$/);
        if (pingMatch && this.mikrotik) return () => this.mikrotik.ping(pingMatch[1]);

        const genMatch = lower.match(/^(?:gen|create)\s+voucher\s+([a-zA-Z0-9_-]+)$/);
        if (genMatch && this.database) {
            return async () => {
                const plan = genMatch[1];
                const code = voucherCode();

                const { DEFAULT_PLANS } = require('./database');
                const dateUtils = require('../utils/date');

                const planObj = DEFAULT_PLANS[plan] || { name: 'Custom', deviceLimit: 1 };
                const expiresAt = planObj.durationValue && planObj.durationUnit ?
                    dateUtils.add(new Date(), planObj.durationValue, planObj.durationUnit).toISOString() : null;

                const loginUrl = `http://${this.mikrotik?.state?.host || '192.168.88.1'}/login?username=${code}&password=${code}`;

                const vData = {
                    plan,
                    planName: planObj.name || plan,
                    durationUnit: planObj.durationUnit || null,
                    durationValue: planObj.durationValue || null,
                    deviceLimit: planObj.deviceLimit || 1,
                    expiresAt,
                    loginUrl,
                    createdBy: 'ask-engine-rule'
                };

                await this.database.createVoucher(code, vData);

                if (this.mikrotik && this.mikrotik.state?.isConnected) {
                    const _durationToMikrotik = (p) => {
                        if (!p || !p.durationValue || !p.durationUnit) return null;
                        const v = p.durationValue;
                        switch (p.durationUnit) {
                            case 'weeks': return `${v}w`;
                            case 'days': return `${v}d`;
                            case 'hours': return `${String(v).padStart(2, '0')}:00:00`;
                            case 'minutes': return `${String(Math.floor(v / 60)).padStart(2, '0')}:${String(v % 60).padStart(2, '0')}:00`;
                            default: return null;
                        }
                    };
                    await this.mikrotik.addHotspotUser({
                        username: code, password: code, profile: plan,
                        sharedUsers: vData.deviceLimit,
                        ...(vData.expiresAt && { limitUptime: _durationToMikrotik(vData) })
                    }).catch(() => { });
                }

                return `Voucher created: ${code} (Plan: ${plan})`;
            };
        }

        const balanceMatch = lower.includes('balance') || lower.includes('credits');
        if (balanceMatch && this.database) {
            // This is just a shortcut, in a real scenario we need the userId from the context
            // But we can return a helper message
            return () => "I can check your balance if you provide your ID. Try 'my balance'."
        }

        return null;
    }

    // ── Tier-3: Gemini ReAct loop ─────────────────────────────────────────────

    async _runAI(input) {
        const messages = [{ role: 'user', content: input, blocks: [{ type: 'text', text: input }] }];
        const toolTrace = [];
        let turns = 0;
        const MAX_TURNS = 5;

        while (turns < MAX_TURNS) {
            const response = await this.llm.generate(messages, { tools: this._declarations });

            // Record usage
            if (response.usage) {
                costTracker.record(`${this.llm.providerType}-ask`, response.usage.promptTokenCount, response.usage.candidatesTokenCount);
            }

            // If no tool calls, return final text
            if (!response.calls || response.calls.length === 0) {
                if (toolTrace.length) {
                    return { tier: 3, type: 'ai_act', result: response.text, data: toolTrace, turns };
                }
                return { tier: 3, type: 'ai_chat', result: response.text };
            }

            // Execute tool calls
            const assistantTurn = {
                role: 'assistant',
                content: response.text,
                blocks: [
                    { type: 'text', text: response.text },
                    ...response.calls.map(c => ({ type: 'tool_use', ...c }))
                ]
            };
            messages.push(assistantTurn);

            const toolResults = [];
            for (const call of response.calls) {
                turns++;
                logger.debug(`AI ReAct turn ${turns}: ${call.name}(${JSON.stringify(call.args)})`);

                let toolResult;
                let isError = false;
                try {
                    toolResult = await this._dispatchFunctionCall(call);
                } catch (err) {
                    toolResult = { error: err.message };
                    isError = true;
                }

                const resultBlock = { type: 'tool_result', toolName: call.name, output: toolResult, toolUseId: call.id, isError };
                toolResults.push(resultBlock);
                toolTrace.push({ call: call.name, args: call.args, result: toolResult, isError });
            }

            messages.push({
                role: 'user', // Some providers use 'tool' or 'user' for results, but our providers map 'user' role with 'tool_result' blocks to the correct provider format
                blocks: toolResults
            });
        }

        return { tier: 3, type: 'error', result: 'Exceeded maximum ReAct turns (5).' };
    }


    async _dispatchFunctionCall({ name, args }) {
        const { action, plan, target, amount, code, userId, username } = args || {};

        // ── Hotspot user write actions (disable / enable / remove) ─────────────
        if (name === 'manage_hotspot_user' && this.mikrotik) {
            const uname = username || target;
            if (!uname) return { error: 'username is required' };

            if (action === 'disable') {
                const r = await this.mikrotik.disableHotspotUser(uname);
                return r.action === 'disabled'
                    ? { status: 'ok', message: `User '${uname}' disabled and session terminated.` }
                    : { status: 'skipped', ...r };
            }
            if (action === 'enable') {
                const r = await this.mikrotik.enableHotspotUser(uname);
                return r.action === 'enabled'
                    ? { status: 'ok', message: `User '${uname}' re-enabled.` }
                    : { status: 'skipped', ...r };
            }
            if (action === 'remove') {
                const r = await this.mikrotik.removeHotspotUser(uname);
                return r.action === 'removed'
                    ? { status: 'ok', message: `User '${uname}' permanently removed.` }
                    : { status: 'skipped', ...r };
            }
            return { error: `Unknown action '${action}' for manage_hotspot_user` };
        }

        if (name === 'manage_vouchers' && this.database) {
            if (action === 'create') return this.database.createVoucher(voucherCode(), { value: amount || 0 });
            if (action === 'redeem') return this.database.redeemVoucher(code, { userId });
            if (action === 'stats') return this.database.getStats();
            if (action === 'list') return this.database.listVouchers({ limit: 5 });
        }

        if (name === 'manage_network') {
            if (this.mikrotik) {
                if (action === 'users.list' && this.database) return this.database.getHotspotUsers();
                if (action === 'user.status') return this.mikrotik.getUserStatus(target);
                return this.mikrotik.executeTool(action, target);
            }
        }

        if (name === 'manage_users' && this.database) {
            if (action === 'get_balance') {
                const user = await this.database.getUser(target);
                return user ? { userId: target, balance: user.credits || 0 } : { error: 'User not found' };
            }
            if (action === 'find_user') return this.database.getUser(target);
            if (action === 'list_hotspot_profiles' && this.database) return this.database.getHotspotUsers();
            if (action === 'list_active' && this.mikrotik) return this.mikrotik.getActiveUsers();
        }

        if (name === 'manage_discovery' && this.discovery) {
            if (action === 'scan') return this.discovery.scanHosts(args.interface);
            if (action === 'neighbors') return this.discovery.discoverNeighbors();
        }

        if (name === 'manage_finance') {
            if (action === 'revenue_report' && this.database) return this.database.getRevenue(args.period || 'daily');
            if (action === 'revenue_report' && this.financial) return this.financial.getRevenueReport();
            if (action === 'verify_payment' && this.billing) return this.billing.verifyPayment(target);
            if (action === 'audit_log' && this.financial) return this.financial.auditTrail(5);
            if (action === 'trends' && this.financial) return this.financial.getTrends();
            if (action === 'payment_link' && this.billing) return this.billing.createPaymentLink({ plan, amount });
            if (action === 'transfer' && this.database) return this.database.p2pTransfer(args.from || 'system', target, args.amount);
        }

        return { error: 'Unknown function or missing dependency' };
    }
}

module.exports = AskEngine;
