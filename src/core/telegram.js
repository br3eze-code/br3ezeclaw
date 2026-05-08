'use strict';
/**
 * AgentOS Telegram Bot
 * @module core/telegram
 * @version 2026.04
 */

const TelegramBot = require('node-telegram-bot-api');
const QRCode = require('qrcode');
const { logger } = require('./logger');
const { getConfig } = require('./config');
const { getMikroTikClient } = require('./mikrotik');
const { getDatabase } = require('./database');
const { getAgentRuntime } = require('./agentRuntime');
const { getTaskRegistry, TaskStatus } = require('./taskRegistry');
const { PermissionMode } = require('./permissions');

const AskEngine = require('./ask-engine');
const RATE_LIMIT_MAX = 30;
const RATE_LIMIT_WINDOW = 60_000;
const ALERT_COOLDOWN = 300_000;

/** Enhanced rate limiting for Telegram chats */
class ChatRateLimiter {
    constructor(limit = RATE_LIMIT_MAX, windowMs = RATE_LIMIT_WINDOW) {
        this.limit = limit;
        this.windowMs = windowMs;
        this.clients = new Map();
    }
    check(chatId) {
        const now = Date.now();
        if (!this.clients.has(chatId)) {
            this.clients.set(chatId, { count: 1, reset: now + this.windowMs });
            return true;
        }
        const state = this.clients.get(chatId);
        if (now > state.reset) {
            state.count = 1;
            state.reset = now + this.windowMs;
            return true;
        }
        if (state.count >= this.limit) return false;
        state.count++;
        return true;
    }
}

class AgentOSBot {
    constructor() {
        const config = getConfig().telegram;
        // Polling set to false by default; started manually via initialize() if needed
        this.bot = new TelegramBot(config.token, { polling: false, onlyFirstMatch: true });
        this.config = config;
        this.pendingActions = new Map();
        this.pendingInputs = new Map();
        this.rateLimiter = new ChatRateLimiter(RATE_LIMIT_MAX, RATE_LIMIT_WINDOW);
        this._cooldown = new Map();
        this.askEngine = null; // set via setAskEngine()

        this.runtime = getAgentRuntime({
            permissionMode: PermissionMode.PROMPT,
            maxTurns: 8
        });

        this.setupHandlers();
    }

    /** Inject AskEngine after construction (avoids circular deps) */
    setAskEngine(engine) { this.askEngine = engine; }

    setupHandlers() {
        const on = (re, fn) => this.bot.onText(re, fn.bind(this));
        on(/\/start/, this.handleStart);
        on(/\/dashboard/, this.handleDashboard);
        on(/\/tools/, this.handleTools);
        on(/\/network/, this.handleNetwork);
        on(/\/users/, this.handleUsers);
        on(/\/voucher/, this.handleVoucher);
        on(/\/wallet/, this.handleWallet);
        on(/\/status/, this.handleStatus);
        on(/\/help/, this.handleHelp);
        on(/\/claim/, this.handleClaim);
        on(/\/setup_router/, this.handleSetupRouter);
        on(/\/token/, this.handleToken);
        on(/\/ask\s+(.+)/, this.handleAsk);
        on(/\/gen\s+(\S+)/, this.handleGen);
        on(/\/ping\s+(\S+)(?:\s+(\d+))?/, this.handlePing);
        on(/\/kick\s+(\w+)/, this.handleKick);
        on(/\/disable\s+([\w@.\-]+)/, this.handleDisableUser);
        on(/\/enable\s+([\w@.\-]+)/, this.handleEnableUser);
        on(/\/removeuser\s+([\w@.\-]+)/, this.handleRemoveUser);
        on(/\/logs/, this.handleLogs);
        on(/\/verify\s+(.+)/, this.handleVerify);
        // ── claw-code runtime commands ──
        on(/\/mode(?:\s+(.+))?/, this.handleMode);
        on(/\/tasks/, this.handleTasks);
        on(/\/session/, this.handleSession);
        on(/\/run (.+)/, this.handleRun);

        this.bot.on('message', this._onMessage.bind(this));
        this.bot.on('callback_query', this.handleCallback.bind(this));
        this.bot.on('polling_error', (err) => {
            const isConflict = err.code === 'ETELEGRAM' && err.response?.body?.description?.includes('Conflict');
            const facts = { code: err.code, isConflict, responseBody: err.response?.body, timestamp: new Date().toISOString() };
            if (isConflict) {
                logger.error('Telegram polling conflict — another instance running', facts);
            } else {
                logger.error(`Telegram polling error: ${err.message}`, facts);
            }
        });
    }

    // ── Auth & Rate limit ─────────────────────────────────────────────────────

    checkAuth(msg) {
        if (!this.bot) return false;
        const chatId = String(msg.chat.id);
        if (!this.rateLimiter.check(chatId)) {
            this.bot.sendMessage(chatId, '⏳ *Rate limit:* Too many commands.', { parse_mode: 'Markdown' }).catch(() => { });
            return false;
        }
        // Setup mode: no admins set
        if (!this.config.allowedChats?.length) {
            this.bot.sendMessage(chatId, '⚠️ *Setup Mode*\nNo admins configured. Use `/claim` to become admin.', { parse_mode: 'Markdown' });
            return false;
        }
        if (this.config.allowedChats.includes(chatId)) return true;
        this.bot.sendMessage(chatId, '⛔ *Unauthorised*', { parse_mode: 'Markdown' });
        return false;
    }


    // ── Existing handlers ─────────────────────────────────────────────────────

    async handleStart(msg) {
        if (!this.checkRateLimit(msg.chat.id)) {
            return this.bot.sendMessage(msg.chat.id, '⏳ Rate limit exceeded. Please slow down.');
        }
        if (!this.checkAuth(msg)) return;

        const keyboard = {
            inline_keyboard: [
                [{ text: '📊 Dashboard', callback_data: 'action:dashboard' }, { text: '🛠 Tools', callback_data: 'action:tools' }],
                [{ text: '👥 Users', callback_data: 'action:users' }, { text: '🌐 Network', callback_data: 'action:network' }],
                [{ text: '🎫 Voucher', callback_data: 'action:voucher' }, { text: '📈 Status', callback_data: 'action:status' }],
                [{ text: '🤖 Run Agent', callback_data: 'action:run' }, { text: '📋 Tasks', callback_data: 'action:tasks' }]
            ]
        };
        await this.bot.sendMessage(msg.chat.id, `🤖 *AgentOS*\n\nWelcome, ${msg.from.first_name}!`, {
            parse_mode: 'Markdown', reply_markup: keyboard
        });
    }

    async handleDashboard(msg) {
        if (!this.checkAuth(msg)) return;
        try {
            const mikrotik = getMikroTikClient();
            const db = await getDatabase();
            const [dbStats, routerStats] = await Promise.all([
                db.getStats(),
                mikrotik.executeTool('system.stats')
            ]);
            const cpuLoad = routerStats ? parseInt(routerStats['cpu-load'], 10) : 0;
            const cpuEmoji = cpuLoad > 80 ? '🔴' : cpuLoad > 50 ? '🟡' : '🟢';
            const taskSum = getTaskRegistry().summary();

            const text =
                `📊 *AgentOS Dashboard*\n\n` +
                `*Router:*\n` +
                `${cpuEmoji} CPU: ${routerStats?.['cpu-load'] ?? 'N/A'}%\n` +
                `🧠 Memory: ${this.formatBytes(routerStats?.['free-memory'] ?? 0)}\n` +
                `⏱ Uptime: ${routerStats?.uptime ?? 'N/A'}\n\n` +
                `*Vouchers:*\n🎫 ${dbStats.total} total | ✅ ${dbStats.used} used | ⏳ ${dbStats.active} active\n\n` +
                `*Tasks:*\n🏃 ${taskSum.running} running | ✅ ${taskSum.completed} done | ❌ ${taskSum.failed} failed`;

            await this.bot.sendMessage(msg.chat.id, text, {
                parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: [[{ text: '🔄 Refresh', callback_data: 'action:dashboard' }]] }
            });
        } catch (error) {
            this.bot.sendMessage(msg.chat.id, `❌ Error: ${error.message}`);
        }
    }

    async handleTools(msg) {
        if (!this.checkAuth(msg)) return;
        const tools = this.runtime.listTools();
        const buttons = tools.map(t => ({ text: `🔧 ${t}`, callback_data: `tool:${t}` }));
        const chunked = [];
        for (let i = 0; i < buttons.length; i += 2) chunked.push(buttons.slice(i, i + 2));
        await this.bot.sendMessage(msg.chat.id, `🛠 *Available Tools (${tools.length})*\n\nSelect a tool:`, {
            parse_mode: 'Markdown', reply_markup: { inline_keyboard: chunked }
        });
    }

    async handleNetwork(msg) {
        if (!this.checkAuth(msg)) return;
        const keyboard = {
            inline_keyboard: [
                [{ text: '📡 Ping', callback_data: 'net:ping' }, { text: '🛤 Traceroute', callback_data: 'net:traceroute' }],
                [{ text: '🔥 Firewall', callback_data: 'net:firewall' }, { text: '🚫 Block IP', callback_data: 'net:block' }],
                [{ text: '📊 Bandwidth', callback_data: 'net:bandwidth' }, { text: '⚡ Reboot', callback_data: 'net:reboot' }]
            ]
        };
        await this.bot.sendMessage(msg.chat.id, `🌐 *Network Operations*\n\nSelect action:`, {
            parse_mode: 'Markdown', reply_markup: keyboard
        });
    }

    async handleUsers(msg) {
        if (!this.checkAuth(msg)) return;
        const keyboard = {
            inline_keyboard: [
                [{ text: '👁 View Active', callback_data: 'users:active' }, { text: '📋 All Users', callback_data: 'users:all' }],
                [{ text: '➕ Add User', callback_data: 'users:add' }, { text: '🚫 Kick User', callback_data: 'users:kick' }],
                [{ text: '🔕 Disable User', callback_data: 'users:disable' }, { text: '🗑 Remove User', callback_data: 'users:remove' }],
                [{ text: '🔔 Enable User', callback_data: 'users:enableuser' }]
            ]
        };
        await this.bot.sendMessage(msg.chat.id, `👥 *User Management*\n\nSelect action:`, {
            parse_mode: 'Markdown', reply_markup: keyboard
        });
    }

    async handleVoucher(msg, match) {
        if (!this.checkAuth(msg)) return;
        if (!match?.[1]) {
            const keyboard = {
                inline_keyboard: [
                    [{ text: '⏱ 1 Hour', callback_data: 'voucher:1h' }, { text: '📅 1 Day', callback_data: 'voucher:1d' }],
                    [{ text: '📆 1 Week', callback_data: 'voucher:1w' }, { text: '🌙 1 Month', callback_data: 'voucher:1m' }]
                ]
            };
            return this.bot.sendMessage(msg.chat.id, `🎫 *Create Voucher*\n\nSelect duration:`, {
                parse_mode: 'Markdown', reply_markup: keyboard
            });
        }
        await this.createVoucher(msg.chat.id, match[1]);
    }

    async handleWallet(msg) {
        if (!this.checkAuth(msg)) return;
        try {
            const db = await getDatabase();
            const wallet = await db.getWallet?.(msg.chat.id) || { balance: 0, currency: 'Ksh' };
            await this.bot.sendMessage(msg.chat.id,
                `💳 *AgentOS Wallet*\n\n` +
                `Balance: \`${wallet.balance} ${wallet.currency}\`\n\n` +
                `Use /pay to top up or buy vouchers.`,
                { parse_mode: 'Markdown' }
            );
        } catch (e) { this.bot.sendMessage(msg.chat.id, `❌ Wallet error: ${e.message}`); }
    }

    async handleSetupRouter(msg) {
        if (!this.checkAuth(msg)) return;
        this.pendingInputs.set(msg.chat.id, { action: 'setup_step1' });
        await this.bot.sendMessage(msg.chat.id,
            `⚙️ *Router Quick Setup*\n\n` +
            `Please enter your MikroTik IP address (e.g. 192.168.88.1):`,
            { reply_markup: { force_reply: true }, parse_mode: 'Markdown' }
        );
    }

    async handleHelp(msg) {
        if (!this.checkAuth(msg)) return;
        await this.bot.sendMessage(msg.chat.id,
            `🤖 *AgentOS Commands*\n\n` +
            `/start — Main menu\n` +
            `/dashboard — System overview\n` +
            `/tools — Available tools\n` +
            `/network — Network ops\n` +
            `/users — User management\n` +
            `/voucher — Create voucher\n` +
            `/status — System health\n` +
            `/kick <user> — Kick active session\n` +
            `/disable <user> — Disable hotspot user\n` +
            `/enable <user> — Re-enable hotspot user\n` +
            `/removeuser <user> — Permanently remove user\n` +
            `/run <prompt> — Natural language agent\n` +
            `/tasks — View async tasks\n` +
            `/session — Agent session info\n` +
            `/mode [plan|prompt|auto] — Switch permission mode\n` +
            `/help — This message`,
            { parse_mode: 'Markdown' }
        );
    }

    // ── Runtime commands ────────────────────────────────────────────

    async handleRun(msg, match) {
        if (!this.checkAuth(msg)) return;
        const prompt = match?.[1]?.trim();
        if (!prompt) return this.bot.sendMessage(msg.chat.id, '❌ Usage: /run <your prompt>');

        const matchedTools = this.runtime.routePrompt(prompt);
        await this.bot.sendMessage(msg.chat.id,
            `🤖 *Routing prompt...*\n\n` +
            `Prompt: \`${prompt}\`\n` +
            `Matched tools: ${matchedTools.length ? matchedTools.join(', ') : 'none (general query)'}`,
            { parse_mode: 'Markdown' }
        );

        const task = await this.runtime.dispatchTask(prompt, {
            description: `Telegram: ${msg.from.first_name} — ${prompt.slice(0, 50)}`
        });

        await this.bot.sendMessage(msg.chat.id,
            `⚡ *Task dispatched*\n\nID: \`${task.taskId}\`\nUse /tasks to monitor progress.`,
            { parse_mode: 'Markdown' }
        );
    }

    async handleTasks(msg) {
        if (!this.checkAuth(msg)) return;
        const registry = getTaskRegistry();
        const summary = registry.summary();
        const recent = registry.list().slice(-5).reverse();

        const lines = [
            `📋 *Task Registry*`,
            ``,
            `Total: ${summary.total} | 🏃 ${summary.running} | ✅ ${summary.completed} | ❌ ${summary.failed}`,
            ``
        ];

        if (recent.length === 0) {
            lines.push('_No tasks yet. Use /run to dispatch one._');
        } else {
            for (const t of recent) {
                const emoji = {
                    [TaskStatus.CREATED]: '🕐',
                    [TaskStatus.RUNNING]: '🏃',
                    [TaskStatus.COMPLETED]: '✅',
                    [TaskStatus.FAILED]: '❌',
                    [TaskStatus.STOPPED]: '⛔'
                }[t.status] || '?';
                lines.push(`${emoji} \`${t.taskId.slice(0, 8)}\` — ${t.description || t.prompt.slice(0, 40)}`);
            }
        }

        await this.bot.sendMessage(msg.chat.id, lines.join('\n'), { parse_mode: 'Markdown' });
    }

    async handleSession(msg) {
        if (!this.checkAuth(msg)) return;
        const engine = AgentRuntime._sharedEngine;
        if (!engine) {
            return this.bot.sendMessage(msg.chat.id, '_No active session. Use /run to start one._', { parse_mode: 'Markdown' });
        }
        await this.bot.sendMessage(msg.chat.id,
            `🧠 *Agent Session*\n\n\`\`\`\n${engine.renderSummary()}\n\`\`\``,
            { parse_mode: 'Markdown' }
        );
    }

    async handleMode(msg, match) {
        if (!this.checkAuth(msg)) return;
        const requested = match?.[1]?.trim().toLowerCase();

        if (!requested) {
            const current = this.runtime.defaultConfig.permissionMode;
            return this.bot.sendMessage(msg.chat.id,
                `🔐 *Permission Mode*\n\nCurrent: \`${current}\`\n\n` +
                `📖 \`plan\` — read-only, no side effects\n` +
                `🔔 \`prompt\` — confirm before mutations (default)\n` +
                `⚡ \`auto\` — fully autonomous\n\n` +
                `Usage: /mode plan`,
                { parse_mode: 'Markdown' }
            );
        }

        const validModes = Object.values(PermissionMode);
        if (!validModes.includes(requested)) {
            return this.bot.sendMessage(msg.chat.id, `❌ Invalid mode. Valid: ${validModes.join(', ')}`);
        }

        this.runtime.defaultConfig.permissionMode = requested;
        const emoji = { plan: '📖', prompt: '🔔', auto: '⚡' }[requested];

        await this.bot.sendMessage(msg.chat.id,
            `${emoji} Permission mode set to \`${requested}\``,
            { parse_mode: 'Markdown' }
        );
    }

    // ── Callback router ───────────────────────────────────────────────────────

    async handleCallback(query) {
        const chatId = query.message.chat.id;
        const data = query.data;
        try {
            await this.bot.answerCallbackQuery(query.id);
            const [category, action] = data.split(':');
            switch (category) {
                case 'action': await this.handleActionButton(chatId, action, query); break;
                case 'voucher': await this.handleVoucherButton(chatId, action); break;
                case 'wallet': await this.handleWalletButton(chatId, action); break;
                case 'tool': await this.handleToolButton(chatId, action); break;
                case 'net': await this.handleNetworkButton(chatId, action); break;
                case 'users': await this.handleUsersButton(chatId, action); break;
                case 'confirm': await this.handleConfirmation(chatId, action, query); break;
                default: logger.warn(`Unknown callback category: ${category}`, { data, chatId });
            }
        } catch (error) {
            logger.error('Callback error:', { error: error.message, data: query.data, user: query.from?.id, stack: error.stack });
            await this.bot.sendMessage(chatId, `❌ Error: ${error.message}`);
        }
    }

    async handleActionButton(chatId, action, query) {
        const fakeMsg = { chat: { id: chatId }, from: query.from || { first_name: 'User' } };
        const map = {
            dashboard: () => this.handleDashboard(fakeMsg),
            tools: () => this.handleTools(fakeMsg),
            network: () => this.handleNetwork(fakeMsg),
            users: () => this.handleUsers(fakeMsg),
            voucher: () => this.handleVoucher(fakeMsg, null),
            wallet: () => this.handleWallet(fakeMsg),
            status: () => this.handleStatus(fakeMsg),
            run: () => this.bot.sendMessage(chatId, '📝 Send: /run your prompt here'),
            tasks: () => this.handleTasks(fakeMsg)
        };
        if (map[action]) await map[action]();
    }

    async handleToolButton(chatId, toolName) {
        this.pendingInputs.set(chatId, { action: `tool_args:${toolName}` });
        await this.bot.sendMessage(chatId, `🔧 *Tool: ${toolName}*\n\nEnter arguments as JSON or text:`, {
            reply_markup: { force_reply: true }, parse_mode: 'Markdown'
        });
    }

    async handleWalletButton(chatId, action) {
        if (action === 'topup') {
            await this.bot.sendMessage(chatId, '💳 Enter amount to top up:');
        }
    }


    async handleVoucherButton(chatId, duration) {
        const planMap = { '1h': '1hour', '1d': '1day', '1w': '1week', '1m': '1month' };
        await this.createVoucher(chatId, planMap[duration] || 'default', duration);
    }

    async handleNetworkButton(chatId, action) {
        if (action === 'reboot') {
            await this.bot.sendMessage(chatId, `⚠️ *Confirm Reboot?*\nAll users will disconnect.`, {
                parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: [[{ text: '✅ Yes', callback_data: 'confirm:reboot' }, { text: '❌ No', callback_data: 'confirm:cancel' }]] }
            });
        } else {
            await this.bot.sendMessage(chatId, `🚧 ${action} — use /run ${action} for natural language dispatch`);
        }
    }

    async handleUsersButton(chatId, action) {
        try {
            const mikrotik = getMikroTikClient();
            if (action === 'active') {
                const users = await mikrotik.executeTool('users.active');
                const list = users.map(u => `• ${u.user} (${u.address})`).join('\n') || '_No active users_';
                await this.bot.sendMessage(chatId, `👥 *Active Users (${users.length})*\n\n${list}`, { parse_mode: 'Markdown' });
            } else if (action === 'kick') {
                this.pendingInputs.set(chatId, { action: 'kick' });
                await this.bot.sendMessage(chatId, `🚫 Enter username to *kick* (disconnect session):`, {
                    reply_markup: { force_reply: true }, parse_mode: 'Markdown'
                });
            } else if (action === 'disable') {
                this.pendingInputs.set(chatId, { action: 'disable' });
                await this.bot.sendMessage(chatId, `🔕 Enter username to *disable* (blocks login + kicks session):`, {
                    reply_markup: { force_reply: true }, parse_mode: 'Markdown'
                });
            } else if (action === 'enableuser') {
                this.pendingInputs.set(chatId, { action: 'enableuser' });
                await this.bot.sendMessage(chatId, `🔔 Enter username to *re-enable*:`, {
                    reply_markup: { force_reply: true }, parse_mode: 'Markdown'
                });
            } else if (action === 'remove') {
                this.pendingInputs.set(chatId, { action: 'removeuser' });
                await this.bot.sendMessage(chatId,
                    `⚠️ *Remove User*\n\nEnter username to *permanently delete* from the router:`,
                    { reply_markup: { force_reply: true }, parse_mode: 'Markdown' }
                );
            } else if (action === 'add') {
                this.pendingInputs.set(chatId, { action: 'adduser' });
                await this.bot.sendMessage(chatId, `➕ Enter: \`username password profile\` (e.g. \`john pass1 1Day\`):`, {
                    reply_markup: { force_reply: true }, parse_mode: 'Markdown'
                });
            } else {
                await this.bot.sendMessage(chatId, `Use /run list ${action} users for natural language dispatch`);
            }
        } catch (error) {
            await this.bot.sendMessage(chatId, `❌ Error: ${error.message}`);
        }
    }

    async handleConfirmation(chatId, action, query) {
        const editBase = { chat_id: chatId, message_id: query.message.message_id };
        if (action === 'reboot') {
            try {
                await this.bot.editMessageText('🔄 Rebooting...', editBase);
                await getMikroTikClient().executeTool('system.reboot');
                await this.bot.sendMessage(chatId, '✅ Reboot command sent');
            } catch (error) {
                await this.bot.sendMessage(chatId, `❌ Failed: ${error.message}`);
            }
        } else if (action.startsWith('removeuser:')) {
            const username = action.split(':')[1];
            try {
                await this.bot.editMessageText(`🗑 Removing *${username}*...`, { ...editBase, parse_mode: 'Markdown' });
                const r = await getMikroTikClient().removeHotspotUser(username);
                const text = r.action === 'removed'
                    ? `🗑 User *${username}* permanently removed.`
                    : `⚠️ Remove skipped: ${r.reason || 'unknown'}`;
                await this.bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
            } catch (err) {
                await this.bot.sendMessage(chatId, `❌ Remove failed: ${err.message}`);
            }
        } else if (action === 'cancel') {
            await this.bot.editMessageText('❌ Cancelled', editBase);
        }
    }

    // ── Voucher creation ──────────────────────────────────────────────────────

    async createVoucher(chatId, plan, duration = '') {
        try {
            const db = await getDatabase();
            const crypto = require('crypto');
            const code = `AGENT-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
            const { DEFAULT_PLANS } = require('./database');
            const dateUtils = require('../utils/date');
            
            const mikrotik = getMikroTikClient();
            
            const planObj = DEFAULT_PLANS[plan] || { name: 'Custom', deviceLimit: 1 };
            const expiresAt = planObj.durationValue && planObj.durationUnit ?
                dateUtils.add(new Date(), planObj.durationValue, planObj.durationUnit).toISOString() : null;
            const loginUrl = `http://${mikrotik?.state?.host || 'hotspot.local'}/login?username=${code}&password=${code}`;
            
            const vData = { 
                plan,
                planName: planObj.name || plan,
                durationUnit: planObj.durationUnit || null,
                durationValue: planObj.durationValue || null,
                deviceLimit: planObj.deviceLimit || 1,
                expiresAt,
                loginUrl,
                createdBy: 'telegram' 
            };
            
            await db.createVoucher(code, vData);
            
            if (mikrotik && mikrotik.state.isConnected) {
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
                await mikrotik.addHotspotUser({
                    username: code, password: code, profile: plan,
                    sharedUsers: vData.deviceLimit,
                    ...(vData.expiresAt && { limitUptime: _durationToMikrotik(vData) })
                }).catch(() => { });
            }

            // Auto-print voucher
            try {
                const { printVoucher } = require('./printer');
                printVoucher({
                    username: code,
                    password: code,
                    profile: planObj.name || plan,
                    loginUrl: loginUrl
                }).catch(e => logger.warn('Thermal print failed', { error: e.message, code, plan }));
            } catch (err) {
                logger.warn('Could not trigger thermal print', { error: err.message, code, plan });
            }
            const qrBuffer = await QRCode.toBuffer(JSON.stringify({ code, plan }));
            await this.bot.sendPhoto(chatId, qrBuffer, {
                caption:
                    `🎟 *AgentOS Voucher*\n\n` +
                    `Code: \`${code}\`\nPlan: ${plan}\n` +
                    (duration ? `Duration: ${duration}\n` : '') +
                    `\n_Scan or enter manually_`,
                parse_mode: 'Markdown'
            });
            logger.info('Voucher created via Telegram', { code, plan, chatId });
        } catch (error) {
            await this.bot.sendMessage(chatId, `❌ Failed: ${error.message}`);
        }
    }

    formatBytes(bytes) {
        if (!bytes || bytes === 0) return '0 B';
        const k = 1024, sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
    }

    // ── Broadcast & Alert (used by Orchestrator/Monitor) ─────────────────────

    sendToAll(text, opts = {}) {
        if (!this.bot) return;
        (this.config.allowedChats || []).forEach(chatId =>
            this.bot.sendMessage(chatId, text, { parse_mode: 'Markdown', ...opts }).catch(() => { })
        );
    }

    alertOnce(key, text, buttons = null) {
        const now = Date.now();
        const last = this._cooldown.get(key) || 0;
        if (now - last < ALERT_COOLDOWN) return false;
        this._cooldown.set(key, now);
        if (this._cooldown.size > 1000) this._cooldown.clear();
        this.sendToAll(text, buttons ? { reply_markup: { inline_keyboard: buttons } } : {});
        return true;
    }

    promptUser(chatId, text, action) {
        if (!this.bot) return;
        this.pendingInputs.set(chatId, { action });
        this.bot.sendMessage(chatId, text, {
            reply_markup: { force_reply: true, selective: true },
            parse_mode: 'Markdown',
        });
    }

    // ── Free-form message routing (AI chat) ──────────────────────────────────

    async _onMessage(msg) {
        if (!msg.text || !this.checkAuth(msg)) return;
        if (msg.text.startsWith('/')) { this.pendingInputs.delete(msg.chat.id); return; }

        const pending = this.pendingInputs.get(msg.chat.id);
        if (pending) {
            await this._handlePendingInput(msg.chat.id, msg.text.trim(), pending);
            return;
        }

        // Free-form AI chat
        if (this.askEngine) {
            try {
                const resp = await this.askEngine.run(msg.text);
                const out = ['ai_chat', 'ai_act', 'fallback', 'error'].includes(resp.type)
                    ? resp.result
                    : `⚙️ *Tier ${resp.tier}:*\n\`\`\`json\n${JSON.stringify(resp.result, null, 2).slice(0, 3900)}\n\`\`\``;
                this.bot.sendMessage(msg.chat.id, out, { parse_mode: 'Markdown' }).catch(() => { });
            } catch (e) {
                this.bot.sendMessage(msg.chat.id, `❌ Error: ${e.message}`);
            }
        }
    }

    async _handlePendingInput(chatId, input, pending) {
        this.pendingInputs.delete(chatId);
        const { action } = pending;

        if (action.startsWith('tool_args:')) {
            const toolName = action.split(':')[1];
            return this._executeToolWithArgs(chatId, toolName, input);
        }

        switch (action) {
            case 'setup_step1':
                this.pendingInputs.set(chatId, { action: 'setup_step2', ip: input });
                await this.bot.sendMessage(chatId, `🌐 IP set to \`${input}\`\n\nEnter RouterOS username (default: admin):`, { reply_markup: { force_reply: true }, parse_mode: 'Markdown' });
                break;
            case 'setup_step2':
                this.pendingInputs.set(chatId, { action: 'setup_step3', ip: pending.ip, user: input });
                await this.bot.sendMessage(chatId, `👤 User set to \`${input}\`\n\nEnter RouterOS password:`, { reply_markup: { force_reply: true }, parse_mode: 'Markdown' });
                break;
            case 'setup_step3':
                await this._finalizeSetup(chatId, pending.ip, pending.user, input);
                break;
            default:
                await this._executePending(chatId, input, action);
        }
    }

    async _executeToolWithArgs(chatId, toolName, input) {
        try {
            let args = {};
            try { args = JSON.parse(input); } catch {
                // If not JSON, maybe it's just a single string arg? 
                // We'll try to guess or just pass as { query: input }
                args = { query: input };
            }
            const res = await getMikroTikClient().executeTool(toolName, args);
            this.bot.sendMessage(chatId, `✅ *Tool: ${toolName}*\n\`\`\`json\n${JSON.stringify(res, null, 2).slice(0, 3900)}\n\`\`\``, { parse_mode: 'Markdown' });
        } catch (e) {
            this.bot.sendMessage(chatId, `❌ Tool failed: ${e.message}`);
        }
    }

    async _finalizeSetup(chatId, ip, user, pass) {
        await this.bot.sendMessage(chatId, `⏳ Testing connection to \`${ip}\`...`, { parse_mode: 'Markdown' });
        try {
            const mikrotik = getMikroTikClient();
            // This is a bit of a hack since MikroTikManager might already be initialized
            // We should ideally update its config and reconnect
            await mikrotik.updateConfig({ host: ip, user, pass });
            const connected = await mikrotik.connect();
            if (connected) {
                await this.bot.sendMessage(chatId, `✅ *Setup Complete!*\nConnected to MikroTik at \`${ip}\`.`, { parse_mode: 'Markdown' });
            } else {
                throw new Error('Connection failed — check credentials and network.');
            }
        } catch (e) {
            await this.bot.sendMessage(chatId, `❌ Setup failed: ${e.message}\n\nTry /setup_router again.`);
        }
    }

    async _executePending(chatId, input, action) {
        try {
            await this.bot.sendChatAction(chatId, 'typing');
            const mikrotik = getMikroTikClient();
            switch (action) {
                case 'ping': {
                    const res = await mikrotik.ping(input);
                    this.bot.sendMessage(chatId, `📡 *Ping: ${input}*\n\`\`\`json\n${JSON.stringify(res, null, 2)}\n\`\`\``, { parse_mode: 'Markdown' });
                    break;
                }
                case 'kick': {
                    const res = await mikrotik.kickUser(input);
                    this.bot.sendMessage(chatId, res.kicked ? `🚫 *${input}* kicked.` : `⚠️ *${input}* not active.`, { parse_mode: 'Markdown' });
                    break;
                }
                case 'disable': {
                    const r = await mikrotik.disableHotspotUser(input);
                    const msg = r.action === 'disabled'
                        ? `🔕 User *${input}* disabled and session terminated.`
                        : r.reason === 'not_found'
                            ? `⚠️ User *${input}* not found on router.`
                            : `⚠️ Could not disable *${input}*: ${r.reason || 'unknown'}`;
                    this.bot.sendMessage(chatId, msg, { parse_mode: 'Markdown' });
                    break;
                }
                case 'enableuser': {
                    const r = await mikrotik.enableHotspotUser(input);
                    const msg = r.action === 'enabled'
                        ? `🔔 User *${input}* re-enabled.`
                        : r.reason === 'not_found'
                            ? `⚠️ User *${input}* not found on router.`
                            : `⚠️ Could not enable *${input}*: ${r.reason || 'unknown'}`;
                    this.bot.sendMessage(chatId, msg, { parse_mode: 'Markdown' });
                    break;
                }
                case 'removeuser': {
                    const r = await mikrotik.removeHotspotUser(input);
                    const msg = r.action === 'removed'
                        ? `🗑 User *${input}* permanently removed from the router.`
                        : r.reason === 'not_found'
                            ? `⚠️ User *${input}* not found on router.`
                            : `⚠️ Remove skipped for *${input}*: ${r.reason || 'unknown'}`;
                    this.bot.sendMessage(chatId, msg, { parse_mode: 'Markdown' });
                    break;
                }
                case 'block':
                    await mikrotik.addToBlockList(input, 'blocked');
                    this.bot.sendMessage(chatId, `🚫 *${input}* blocked.`, { parse_mode: 'Markdown' });
                    break;
                case 'adduser': {
                    const [u, p, pr = 'default'] = input.split(' ');
                    await mikrotik.addHotspotUser(u, p, pr);
                    this.bot.sendMessage(chatId, `✅ User *${u}* created.`, { parse_mode: 'Markdown' });
                    break;
                }
            }
        } catch (err) {
            this.bot.sendMessage(chatId, `❌ Failed: ${err.message}`);
        }
    }

    // ── /claim — first-admin setup ───────────────────────────────────────────

    async handleClaim(msg) {
        if (this.config.allowedChats?.length > 0) {
            return this.bot.sendMessage(msg.chat.id, '❌ Admin already claimed.');
        }
        const chatId = String(msg.chat.id);
        if (!this.config.allowedChats) this.config.allowedChats = [];
        this.config.allowedChats.push(chatId);
        this.bot.sendMessage(chatId,
            `🎉 *Success!* You are now the primary admin (\`${chatId}\`).\n` +
            `Update your \`.env\` with \`ALLOWED_CHAT_IDS=${chatId}\` to persist.`,
            { parse_mode: 'Markdown' }
        );
    }

    async handleToken(msg) {
        if (!this.checkAuth(msg)) return;
        const gwToken = process.env.AGENTOS_GATEWAY_TOKEN || process.env.GATEWAY_TOKEN || 'not-set';
        this.bot.sendMessage(msg.chat.id, `🔑 *Gateway Token*\n\n\`${gwToken}\``, { parse_mode: 'Markdown' });
    }

    // ── /ask — AI agent query ────────────────────────────────────────────────
    
    async handleVerify(msg, match) {
        if (!this.checkAuth(msg)) return;
        const identifier = match?.[1]?.trim();
        if (!identifier) return this.bot.sendMessage(msg.chat.id, '❌ Usage: /verify <email|phone|username|uid>');

        try {
            const db = await getDatabase();
            // Pass 'telegram' as context so resolveUser can check channels and link if needed
            const user = await db.resolveUser(identifier, 'telegram'); 
            
            if (user) {
                const facts = user._resolveFacts || {};
                let authInfo = '';
                let verificationStatus = '✅ *User Verified*';
                let warnings = [];

                if (user.uid) {
                    const { admin } = require('./firebase');
                    if (admin && admin.auth) {
                        try {
                            const authRec = await admin.auth().getUser(user.uid);
                            
                            // Cross-check email if both exist
                            if (user.email && authRec.email && user.email.toLowerCase() !== authRec.email.toLowerCase()) {
                                warnings.push(`⚠️ *Email Mismatch:* Firestore has \`${user.email}\` but Auth has \`${authRec.email}\``);
                            }
                            
                            authInfo = `\n🔥 *Firebase Auth:*` +
                                     `\n  Email: \`${authRec.email || 'N/A'}\`` +
                                     `\n  Phone: \`${authRec.phoneNumber || 'N/A'}\`` +
                                     `\n  Verified: ${authRec.emailVerified ? 'Yes' : 'No'}` +
                                     `\n  Last Sign-in: ${authRec.metadata.lastSignInTime || 'Never'}`;
                        } catch(e) {
                            if (e.code === 'auth/user-not-found') {
                                warnings.push(`⚠️ *Auth Missing:* User has UID \`${user.uid}\` in Firestore but is missing from Firebase Auth.`);
                            } else {
                                authInfo = `\n🔥 *Firebase Auth Error:* ${e.message}`;
                            }
                        }
                    }
                } else if (!user.email && !user.phoneNumber) {
                    warnings.push('⚠️ *Incomplete Profile:* User has no UID, Email, or Phone linked.');
                }

                const warningBlock = warnings.length > 0 ? `\n\n${warnings.join('\n')}` : '';
                const resolveBlock = `\n\n🔍 *Resolution Facts:*` +
                                   `\n  Found via: \`${facts.source || 'direct'}\`` +
                                   `\n  Identity: \`${facts.identifier || 'N/A'}\`` +
                                   `\n  Synced: ${facts.isAuthSynced ? 'Yes' : 'No'}`;

                await this.bot.sendMessage(msg.chat.id, 
                    `${verificationStatus}\n\n` +
                    `*Firestore Record:*\n` +
                    `  ID: \`${user.id}\`\n` +
                    `  UID: \`${user.uid || 'N/A'}\`\n` +
                    `  Username: \`${user.username || 'N/A'}\`\n` +
                    `  Email: \`${user.email || 'N/A'}\`\n` +
                    `  Role: \`${user.role || 'user'}\`\n` +
                    `  Credits: \`${user.credits || 0}\`` +
                    `${authInfo}${resolveBlock}${warningBlock}`,
                    { parse_mode: 'Markdown' }
                );
            } else {
                await this.bot.sendMessage(msg.chat.id, 
                    `⚠️ *User Not Found*\n\n` +
                    `The identifier \`${identifier}\` did not match any:\n` +
                    `• Firestore ID / UID\n` +
                    `• Username / Phone / Email\n` +
                    `• Telegram/WhatsApp Channel IDs\n` +
                    `• Firebase Auth (Email/Phone/UID)`, 
                    { parse_mode: 'Markdown' }
                );
            }
        } catch(error) {
            logger.error('Verification error', { identifier, error: error.message });
            await this.bot.sendMessage(msg.chat.id, `❌ *Verification Failed*\n\n${error.message}`);
        }
    }

    async handleAsk(msg, match) {
        if (!this.checkAuth(msg)) return;
        if (!this.askEngine) return this.bot.sendMessage(msg.chat.id, '❌ AskEngine not initialized');
        const query = match[1];
        const chatId = msg.chat.id;
        const status = await this.bot.sendMessage(chatId, '⏳ `[ AgentOS thinking… ]`', { parse_mode: 'Markdown' });
        try {
            const resp = await this.askEngine.run(query);
            const icon = resp.type === 'error' ? '❌' : '✅';
            const formatted = this.askEngine.formatResponse(resp.result);
            await this.bot.editMessageText(`${icon} *AgentOS Response:*\n\n${formatted}`, {
                chat_id: chatId, message_id: status.message_id, parse_mode: 'Markdown',
            });
        } catch (e) {
            this.bot.editMessageText(`❌ *AI Error:* ${e.message}`, {
                chat_id: chatId, message_id: status.message_id, parse_mode: 'Markdown'
            }).catch(() => { });
        }
    }

    async handleGen(msg, match) {
        if (!this.checkAuth(msg)) return;
        const plan = match[1];
        this.bot.sendMessage(msg.chat.id, `⚠️ *Confirm:* Generate **${plan}** voucher?`, {
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [[{ text: '✅ Confirm', callback_data: `action:gen_confirm:${plan}` }, { text: '❌ Cancel', callback_data: 'action:cancel_ai' }]] }
        });
    }

    async handlePing(msg, match) {
        if (!this.checkAuth(msg)) return;
        try {
            const res = await getMikroTikClient().ping(match[1], parseInt(match[2]) || 4);
            this.bot.sendMessage(msg.chat.id, `📡 *Ping: ${match[1]}*\n\`\`\`json\n${JSON.stringify(res, null, 2)}\n\`\`\``, { parse_mode: 'Markdown' });
        } catch (e) { this.bot.sendMessage(msg.chat.id, `❌ ${e.message}`); }
    }

    async handleKick(msg, match) {
        if (!this.checkAuth(msg)) return;
        try {
            const res = await getMikroTikClient().kickUser(match[1]);
            this.bot.sendMessage(msg.chat.id, res.kicked ? `🚫 Kicked *${match[1]}*` : `⚠️ *${match[1]}* not active`, { parse_mode: 'Markdown' });
        } catch (e) { this.bot.sendMessage(msg.chat.id, `❌ ${e.message}`); }
    }

    async handleDisableUser(msg, match) {
        if (!this.checkAuth(msg)) return;
        try {
            const r = await getMikroTikClient().disableHotspotUser(match[1]);
            const text = r.action === 'disabled'
                ? `🔕 User *${match[1]}* disabled and session terminated.`
                : r.reason === 'not_found'
                    ? `⚠️ User *${match[1]}* not found on router.`
                    : `⚠️ Could not disable *${match[1]}*: ${r.reason || 'unknown'}`;
            this.bot.sendMessage(msg.chat.id, text, { parse_mode: 'Markdown' });
        } catch (e) { this.bot.sendMessage(msg.chat.id, `❌ ${e.message}`); }
    }

    async handleEnableUser(msg, match) {
        if (!this.checkAuth(msg)) return;
        try {
            const r = await getMikroTikClient().enableHotspotUser(match[1]);
            const text = r.action === 'enabled'
                ? `🔔 User *${match[1]}* re-enabled.`
                : r.reason === 'not_found'
                    ? `⚠️ User *${match[1]}* not found on router.`
                    : `⚠️ Could not enable *${match[1]}*: ${r.reason || 'unknown'}`;
            this.bot.sendMessage(msg.chat.id, text, { parse_mode: 'Markdown' });
        } catch (e) { this.bot.sendMessage(msg.chat.id, `❌ ${e.message}`); }
    }

    async handleRemoveUser(msg, match) {
        if (!this.checkAuth(msg)) return;
        const username = match[1];
        // Guard: require explicit confirm via inline button before deleting
        await this.bot.sendMessage(msg.chat.id,
            `⚠️ *Confirm permanent removal of user \`${username}\`?*\n\nThis deletes the user from the router. Cannot be undone.`,
            {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [[
                        { text: '🗑 Yes, Remove', callback_data: `confirm:removeuser:${username}` },
                        { text: '❌ Cancel', callback_data: 'confirm:cancel' }
                    ]]
                }
            }
        );
    }

    async handleLogs(msg) {
        if (!this.checkAuth(msg)) return;
        try {
            const logs = await getMikroTikClient().getLogs(10);
            const text = logs.map(l => `• ${l.time || ''} ${l.message || JSON.stringify(l)}`).join('\n');
            this.bot.sendMessage(msg.chat.id, `📋 *Router Logs*\n\n${text || 'No logs'}`, { parse_mode: 'Markdown' });
        } catch (e) { this.bot.sendMessage(msg.chat.id, `❌ ${e.message}`); }
    }

    stop() { this.bot.stopPolling(); }
}

module.exports = { AgentOSBot };
