const TelegramBot = require('node-telegram-bot-api');
const QRCode = require('qrcode');
const { logger } = require('./logger');
const { getConfig } = require('./config');
const { getMikroTikClient } = require('./mikrotik');
const { getDatabase } = require('./database');

class AgentOSBot {
    constructor() {
        const config = getConfig().telegram;
        this.bot = new TelegramBot(config.token, {
            polling: true,
            onlyFirstMatch: true
        });
        this.config = config;
        this.pendingActions = new Map();
        this.setupHandlers();
    }

    setupHandlers() {
        // Commands
        this.bot.onText(/\/start/, this.handleStart.bind(this));
        this.bot.onText(/\/dashboard/, this.handleDashboard.bind(this));
        this.bot.onText(/\/tools/, this.handleTools.bind(this));
        this.bot.onText(/\/network/, this.handleNetwork.bind(this));
        this.bot.onText(/\/users/, this.handleUsers.bind(this));
        this.bot.onText(/\/voucher/, this.handleVoucher.bind(this));
        this.bot.onText(/\/status/, this.handleStatus.bind(this));
        this.bot.onText(/\/help/, this.handleHelp.bind(this));

        // Callbacks
        this.bot.on('callback_query', this.handleCallback.bind(this));

        // Errors
        this.bot.on('polling_error', (err) => logger.error('Telegram polling error:', err));
    }

    checkAuth(msg) {
        const chatId = msg.chat.id.toString();
        if (this.config.allowedChats.length > 0) {
            if (!this.config.allowedChats.includes(chatId)) {
                this.bot.sendMessage(msg.chat.id, "⛔ *Unauthorized*", { parse_mode: "Markdown" });
                return false;
            }
        }
        return true;
    }

    async handleStart(msg) {
        if (!this.checkAuth(msg)) return;

        const keyboard = {
            inline_keyboard: [
                [
                    { text: "📊 Dashboard", callback_data: "action:dashboard" },
                    { text: "🛠 Tools", callback_data: "action:tools" }
                ],
                [
                    { text: "👥 Users", callback_data: "action:users" },
                    { text: "🌐 Network", callback_data: "action:network" }
                ],
                [
                    { text: "🎫 Create Voucher", callback_data: "action:voucher" },
                    { text: "📈 Status", callback_data: "action:status" }
                ]
            ]
        };

        await this.bot.sendMessage(msg.chat.id,
            `🤖 *AgentOS*\n\nWelcome, ${msg.from.first_name}!`, {
            parse_mode: "Markdown",
            reply_markup: keyboard
        });
    }

    async handleDashboard(msg) {
        if (!this.checkAuth(msg)) return;

        try {
            const mikrotik = await getMikroTikClient();
            const db = await getDatabase();

            const [dbStats, routerStats] = await Promise.all([
                db.getStats(),
                mikrotik.getSystemStats()
            ]);

            const cpuLoad = routerStats ? parseInt(routerStats['cpu-load']) : 0;
            const cpuEmoji = cpuLoad > 80 ? '🔴' : cpuLoad > 50 ? '🟡' : '🟢';

            const text =
                `📊 *AgentOS Dashboard*\n\n` +
                `*Router:*\n` +
                `${cpuEmoji} CPU: ${routerStats?.['cpu-load'] || 'N/A'}%\n` +
                `🧠 Memory: ${this.formatBytes(routerStats?.['free-memory'] || 0)}\n` +
                `⏱ Uptime: ${routerStats?.uptime || 'N/A'}\n\n` +
                `*Vouchers:*\n` +
                `🎫 Total: ${dbStats.total} | ✅ Used: ${dbStats.used} | ⏳ Active: ${dbStats.active}`;

            await this.bot.sendMessage(msg.chat.id, text, {
                parse_mode: "Markdown",
                reply_markup: {
                    inline_keyboard: [[
                        { text: "🔄 Refresh", callback_data: "action:dashboard" }
                    ]]
                }
            });
        } catch (error) {
            this.bot.sendMessage(msg.chat.id, `❌ Error: ${error.message}`);
        }
    }

    async handleTools(msg) {
        if (!this.checkAuth(msg)) return;

        const mikrotik = await getMikroTikClient();
        const tools = mikrotik.getAvailableTools();

        const buttons = tools.map(tool => ({
            text: `🔧 ${tool}`,
            callback_data: `tool:${tool}`
        }));

        const chunked = [];
        for (let i = 0; i < buttons.length; i += 2) {
            chunked.push(buttons.slice(i, i + 2));
        }

        await this.bot.sendMessage(msg.chat.id,
            `🛠 *Available Tools*\n\nSelect a tool:`, {
            parse_mode: "Markdown",
            reply_markup: { inline_keyboard: chunked }
        });
    }

    async handleNetwork(msg) {
        if (!this.checkAuth(msg)) return;

        const keyboard = {
            inline_keyboard: [
                [
                    { text: "📡 Ping", callback_data: "net:ping" },
                    { text: "🛤 Traceroute", callback_data: "net:traceroute" }
                ],
                [
                    { text: "🔥 Firewall", callback_data: "net:firewall" },
                    { text: "🚫 Block IP", callback_data: "net:block" }
                ],
                [
                    { text: "📊 Bandwidth", callback_data: "net:bandwidth" },
                    { text: "⚡ Reboot", callback_data: "net:reboot" }
                ]
            ]
        };

        await this.bot.sendMessage(msg.chat.id,
            `🌐 *Network Operations*\n\nSelect action:`, {
            parse_mode: "Markdown",
            reply_markup: keyboard
        });
    }

    async handleUsers(msg) {
        if (!this.checkAuth(msg)) return;

        const keyboard = {
            inline_keyboard: [
                [
                    { text: "👁 View Active", callback_data: "users:active" },
                    { text: "📋 All Users", callback_data: "users:all" }
                ],
                [
                    { text: "➕ Add User", callback_data: "users:add" },
                    { text: "🚫 Kick User", callback_data: "users:kick" }
                ]
            ]
        };

        await this.bot.sendMessage(msg.chat.id,
            `👥 *User Management*\n\nSelect action:`, {
            parse_mode: "Markdown",
            reply_markup: keyboard
        });
    }

    async handleVoucher(msg, match) {
        if (!this.checkAuth(msg)) return;

        if (!match || !match[1]) {
            const keyboard = {
                inline_keyboard: [
                    [
                        { text: "⏱ 1 Hour", callback_data: "voucher:1h" },
                        { text: "📅 1 Day", callback_data: "voucher:1d" }
                    ],
                    [
                        { text: "📆 1 Week", callback_data: "voucher:1w" },
                        { text: "🌙 1 Month", callback_data: "voucher:1m" }
                    ]
                ]
            };

            return this.bot.sendMessage(msg.chat.id,
                `🎫 *Create Voucher*\n\nSelect duration:`, {
                parse_mode: "Markdown",
                reply_markup: keyboard
            });
        }

        await this.createVoucher(msg.chat.id, match[1]);
    }

    async handleStatus(msg) {
        if (!this.checkAuth(msg)) return;
        // Implementation similar to dashboard
        await this.handleDashboard(msg);
    }

    async handleHelp(msg) {
        if (!this.checkAuth(msg)) return;

        await this.bot.sendMessage(msg.chat.id,
            `🤖 *AgentOS Commands*\n\n` +
            `/start - Main menu\n` +
            `/dashboard - System overview\n` +
            `/tools - Available tools\n` +
            `/network - Network ops\n` +
            `/users - User management\n` +
            `/voucher - Create voucher\n` +
            `/status - System health\n` +
            `/help - This message`, {
            parse_mode: "Markdown"
        });
    }

    async handleCallback(query) {
        const chatId = query.message.chat.id;
        const data = query.data;

        try {
            await this.bot.answerCallbackQuery(query.id);
            const [category, action] = data.split(':');

            switch (category) {
                case 'action':
                    await this.handleActionButton(chatId, action);
                    break;
                case 'voucher':
                    await this.handleVoucherButton(chatId, action);
                    break;
                case 'net':
                    await this.handleNetworkButton(chatId, action);
                    break;
                case 'users':
                    await this.handleUsersButton(chatId, action);
                    break;
                case 'confirm':
                    await this.handleConfirmation(chatId, action, query);
                    break;
            }
        } catch (error) {
            logger.error('Callback error:', error);
            await this.bot.sendMessage(chatId, `❌ Error: ${error.message}`);
        }
    }

    async handleActionButton(chatId, action) {
        const fakeMsg = { chat: { id: chatId }, from: { first_name: 'User' } };

        switch (action) {
            case 'dashboard': await this.handleDashboard(fakeMsg); break;
            case 'tools': await this.handleTools(fakeMsg); break;
            case 'network': await this.handleNetwork(fakeMsg); break;
            case 'users': await this.handleUsers(fakeMsg); break;
            case 'voucher': await this.handleVoucher(fakeMsg, null); break;
            case 'status': await this.handleStatus(fakeMsg); break;
        }
    }

    async handleVoucherButton(chatId, duration) {
        const planMap = {
            '1h': '1hour', '1d': '1day', '1w': '1week', '1m': '1month'
        };
        await this.createVoucher(chatId, planMap[duration] || 'default', duration);
    }

    async handleNetworkButton(chatId, action) {
        switch (action) {
            case 'reboot':
                await this.bot.sendMessage(chatId,
                    `⚠️ *Confirm Reboot?*\nAll users will disconnect.`, {
                    parse_mode: "Markdown",
                    reply_markup: {
                        inline_keyboard: [[
                            { text: "✅ Yes", callback_data: "confirm:reboot" },
                            { text: "❌ No", callback_data: "confirm:cancel" }
                        ]]
                    }
                });
                break;
            default:
                await this.bot.sendMessage(chatId, `🚧 ${action} - use CLI for this operation`);
        }
    }

    async handleUsersButton(chatId, action) {
        try {
            const mikrotik = await getMikroTikClient();

            switch (action) {
                case 'active':
                    const users = await mikrotik.getActiveUsers();
                    const list = users.map(u => `• ${u.user} (${u.address})`).join('\n');
                    await this.bot.sendMessage(chatId,
                        `👥 *Active Users (${users.length})*\n\n${list}`, {
                        parse_mode: "Markdown"
                    });
                    break;
                default:
                    await this.bot.sendMessage(chatId, `Use CLI: agentos users ${action}`);
            }
        } catch (error) {
            await this.bot.sendMessage(chatId, `❌ Error: ${error.message}`);
        }
    }

    async handleConfirmation(chatId, action, query) {
        if (action === 'reboot') {
            try {
                await this.bot.editMessageText('🔄 Rebooting...', {
                    chat_id: chatId,
                    message_id: query.message.message_id
                });

                const mikrotik = await getMikroTikClient();
                await mikrotik.reboot();

                await this.bot.sendMessage(chatId, '✅ Reboot command sent');
            } catch (error) {
                await this.bot.sendMessage(chatId, `❌ Failed: ${error.message}`);
            }
        } else if (action === 'cancel') {
            await this.bot.editMessageText('❌ Cancelled', {
                chat_id: chatId,
                message_id: query.message.message_id
            });
        }
    }

    async createVoucher(chatId, plan, duration = '') {
        try {
            const db = await getDatabase();
            const code = `AGENT-${Math.random().toString(36).substr(2, 6).toUpperCase()}`;

            await db.createVoucher(code, {
                plan,
                duration,
                createdBy: 'telegram',
                createdAt: new Date()
            });

            const qrData = JSON.stringify({ code, plan });
            const qrBuffer = await QRCode.toBuffer(qrData);

            await this.bot.sendPhoto(chatId, qrBuffer, {
                caption:
                    `🎟 *AgentOS Voucher*\n\n` +
                    `Code: \`${code}\`\n` +
                    `Plan: ${plan}\n` +
                    (duration ? `Duration: ${duration}\n` : '') +
                    `\n_Scan or enter manually_`,
                parse_mode: "Markdown"
            });

            logger.info('Voucher created via Telegram', { code, plan, chatId });
        } catch (error) {
            await this.bot.sendMessage(chatId, `❌ Failed: ${error.message}`);
        }
    }

    formatBytes(bytes) {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    stop() {
        this.bot.stopPolling();
    }
}

module.exports = { AgentOSBot };