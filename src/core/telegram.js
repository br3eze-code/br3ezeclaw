'use strict';
/**
 * AgentOS Telegram Bot
 * @module core/telegram
 * @version 2026.04 — claw-code integration
 *
 */

const TelegramBot        = require('node-telegram-bot-api');
const QRCode             = require('qrcode');
const { logger }         = require('./logger');
const { getConfig }      = require('./config');
const { getMikroTikClient }  = require('./mikrotik');
const { getDatabase }        = require('./database');
const { getAgentRuntime }    = require('./agentRuntime');
const { getTaskRegistry, TaskStatus } = require('./taskRegistry');
const { PermissionMode } = require('./permissions');

const RATE_LIMIT_MAX    = 30;
const RATE_LIMIT_WINDOW = 60_000;

class AgentOSBot {
    constructor() {
        const config = getConfig().telegram;
        this.bot    = new TelegramBot(config.token, { polling: true, onlyFirstMatch: true });
        this.config = config;
        this.pendingActions = new Map();
        this.rateLimiter    = new Map();
        this.RATE_LIMIT     = RATE_LIMIT_MAX;

        this.runtime = getAgentRuntime({
            permissionMode: PermissionMode.PROMPT,
            maxTurns:       8
        });

        this.setupHandlers();
    }

    setupHandlers() {
        this.bot.onText(/\/start/,           this.handleStart.bind(this));
        this.bot.onText(/\/dashboard/,       this.handleDashboard.bind(this));
        this.bot.onText(/\/tools/,           this.handleTools.bind(this));
        this.bot.onText(/\/network/,         this.handleNetwork.bind(this));
        this.bot.onText(/\/users/,           this.handleUsers.bind(this));
        this.bot.onText(/\/voucher/,         this.handleVoucher.bind(this));
        this.bot.onText(/\/status/,          this.handleStatus.bind(this));
        this.bot.onText(/\/help/,            this.handleHelp.bind(this));
        // ── claw-code runtime commands ──
        this.bot.onText(/\/mode(?:\s+(.+))?/, this.handleMode.bind(this));
        this.bot.onText(/\/tasks/,            this.handleTasks.bind(this));
        this.bot.onText(/\/session/,          this.handleSession.bind(this));
        this.bot.onText(/\/run (.+)/,         this.handleRun.bind(this));

        this.bot.on('callback_query', this.handleCallback.bind(this));
        this.bot.on('polling_error',  (err) => logger.error('Telegram polling error:', err));
    }

    // ── Auth & Rate limit ─────────────────────────────────────────────────────

    checkAuth(msg) {
        const chatId = msg.chat.id.toString();
        if (this.config.allowedChats.length > 0 && !this.config.allowedChats.includes(chatId)) {
            this.bot.sendMessage(msg.chat.id, '⛔ *Unauthorized*', { parse_mode: 'Markdown' });
            return false;
        }
        return true;
    }

    checkRateLimit(chatId) {
        const now = Date.now();
        const key = chatId.toString();
        if (!this.rateLimiter.has(key)) {
            this.rateLimiter.set(key, { count: 1, resetTime: now + RATE_LIMIT_WINDOW });
            return true;
        }
        const limit = this.rateLimiter.get(key);
        if (now > limit.resetTime) { limit.count = 1; limit.resetTime = now + RATE_LIMIT_WINDOW; return true; }
        if (limit.count >= this.RATE_LIMIT) return false;
        limit.count++;
        return true;
    }

    // ── Existing handlers ─────────────────────────────────────────────────────

    async handleStart(msg) {
        if (!this.checkRateLimit(msg.chat.id)) {
            return this.bot.sendMessage(msg.chat.id, '⏳ Rate limit exceeded. Please slow down.');
        }
        if (!this.checkAuth(msg)) return;

        const keyboard = {
            inline_keyboard: [
                [{ text: '📊 Dashboard', callback_data: 'action:dashboard' }, { text: '🛠 Tools',   callback_data: 'action:tools'   }],
                [{ text: '👥 Users',     callback_data: 'action:users'    }, { text: '🌐 Network', callback_data: 'action:network' }],
                [{ text: '🎫 Voucher',   callback_data: 'action:voucher'  }, { text: '📈 Status',  callback_data: 'action:status'  }],
                [{ text: '🤖 Run Agent', callback_data: 'action:run'      }, { text: '📋 Tasks',   callback_data: 'action:tasks'   }]
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
            const db       = await getDatabase();
            const [dbStats, routerStats] = await Promise.all([
                db.getStats(),
                mikrotik.executeTool('system.stats')
            ]);
            const cpuLoad  = routerStats ? parseInt(routerStats['cpu-load'], 10) : 0;
            const cpuEmoji = cpuLoad > 80 ? '🔴' : cpuLoad > 50 ? '🟡' : '🟢';
            const taskSum  = getTaskRegistry().summary();

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
        const tools   = this.runtime.listTools();
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
                [{ text: '➕ Add User',    callback_data: 'users:add'    }, { text: '🚫 Kick User', callback_data: 'users:kick' }]
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
                    [{ text: '⏱ 1 Hour', callback_data: 'voucher:1h' }, { text: '📅 1 Day',   callback_data: 'voucher:1d' }],
                    [{ text: '📆 1 Week', callback_data: 'voucher:1w' }, { text: '🌙 1 Month', callback_data: 'voucher:1m' }]
                ]
            };
            return this.bot.sendMessage(msg.chat.id, `🎫 *Create Voucher*\n\nSelect duration:`, {
                parse_mode: 'Markdown', reply_markup: keyboard
            });
        }
        await this.createVoucher(msg.chat.id, match[1]);
    }

    async handleStatus(msg) {
        if (!this.checkAuth(msg)) return;
        await this.handleDashboard(msg);
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
        const summary  = registry.summary();
        const recent   = registry.list().slice(-5).reverse();

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
                    [TaskStatus.CREATED]:   '🕐',
                    [TaskStatus.RUNNING]:   '🏃',
                    [TaskStatus.COMPLETED]: '✅',
                    [TaskStatus.FAILED]:    '❌',
                    [TaskStatus.STOPPED]:   '⛔'
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
        const data   = query.data;
        try {
            await this.bot.answerCallbackQuery(query.id);
            const [category, action] = data.split(':');
            switch (category) {
                case 'action':  await this.handleActionButton(chatId, action, query); break;
                case 'voucher': await this.handleVoucherButton(chatId, action); break;
                case 'net':     await this.handleNetworkButton(chatId, action); break;
                case 'users':   await this.handleUsersButton(chatId, action); break;
                case 'confirm': await this.handleConfirmation(chatId, action, query); break;
                default: logger.warn(`Unknown callback category: ${category}`);
            }
        } catch (error) {
            logger.error('Callback error:', error);
            await this.bot.sendMessage(chatId, `❌ Error: ${error.message}`);
        }
    }

    async handleActionButton(chatId, action, query) {
        const fakeMsg = { chat: { id: chatId }, from: { first_name: 'User' } };
        const map = {
            dashboard: () => this.handleDashboard(fakeMsg),
            tools:     () => this.handleTools(fakeMsg),
            network:   () => this.handleNetwork(fakeMsg),
            users:     () => this.handleUsers(fakeMsg),
            voucher:   () => this.handleVoucher(fakeMsg, null),
            status:    () => this.handleStatus(fakeMsg),
            run:       () => this.bot.sendMessage(chatId, '📝 Send: /run your prompt here'),
            tasks:     () => this.handleTasks(fakeMsg)
        };
        if (map[action]) await map[action]();
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
                const list  = users.map(u => `• ${u.user} (${u.address})`).join('\n') || '_No active users_';
                await this.bot.sendMessage(chatId, `👥 *Active Users (${users.length})*\n\n${list}`, { parse_mode: 'Markdown' });
            } else {
                await this.bot.sendMessage(chatId, `Use CLI or: /run list ${action} users`);
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
        } else if (action === 'cancel') {
            await this.bot.editMessageText('❌ Cancelled', editBase);
        }
    }

    // ── Voucher creation ──────────────────────────────────────────────────────

    async createVoucher(chatId, plan, duration = '') {
        try {
            const db   = await getDatabase();
            const crypto = require('crypto');
            const code = `AGENT-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
            await db.createVoucher(code, { plan, duration, createdBy: 'telegram', createdAt: new Date() });
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

    stop() { this.bot.stopPolling(); }
}

module.exports = { AgentOSBot };
