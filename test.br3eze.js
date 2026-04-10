#!/usr/bin/env node
// ==========================================
// AGENTOS - Agent Operating System
// Version: 2026.3.27
// Features: WebSocket Gateway, Interactive Buttons, RouterOS Integration
// ==========================================

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const WebSocket = require('ws');
const http = require('http');
const tools = require('./src/tools');
const TelegramBot = require('node-telegram-bot-api');
const { RouterOSClient } = require('routeros-client');
const QRCode = require('qrcode');
const admin = require('firebase-admin');
const winston = require('winston');
const Joi = require('joi');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

// ==========================================
// BRANDING & CONFIGURATION
// ==========================================

const BRAND = {
    name: 'AgentOS',
    version: '2026.3.27',
    emoji: '🤖',
    tagline: "Network Intelligence, Simplified",
    colors: {
        primary: '#00D4FF',
        success: '#00FF88',
        warning: '#FFB800',
        danger: '#FF4757',
        info: '#5F27CD'
    }
};

const CONFIG = {
    MIKROTIK: {
        IP: process.env.MIKROTIK_IP || '192.168.88.1',
        USER: process.env.MIKROTIK_USER || 'admin',
        PASS: process.env.MIKROTIK_PASS,
        PORT: process.env.MIKROTIK_PORT || 8728,
        RECONNECT_INTERVAL: 5000,
        MAX_RECONNECT_ATTEMPTS: 10
    },
    TELEGRAM: {
        TOKEN: process.env.TELEGRAM_TOKEN,
        ALLOWED_CHATS: process.env.ALLOWED_CHAT_IDS ? process.env.ALLOWED_CHAT_IDS.split(',') : [],
        BOT_USERNAME: process.env.TELEGRAM_BOT_USERNAME || 'AgentOSBot'
    },
    GATEWAY: {
        PORT: process.env.GATEWAY_PORT || 19876,
        HOST: process.env.GATEWAY_HOST || '127.0.0.1',
        TOKEN: process.env.AGENTOS_GATEWAY_TOKEN || require('crypto').randomBytes(32).toString('hex'),
        WS_PATH: '/ws'
    },
    SERVER: {
        PORT: process.env.PORT || 3000,
        HOST: process.env.HOST || '0.0.0.0',
        NODE_ENV: process.env.NODE_ENV || 'development'
    },
    SECURITY: {
        RATE_LIMIT_WINDOW: 15 * 60 * 1000,
        RATE_LIMIT_MAX: 100,
        VOUCHER_RATE_LIMIT: 5
    }
};

// Validate critical config
if (!CONFIG.MIKROTIK.PASS) throw new Error('MIKROTIK_PASS environment variable required');
if (!CONFIG.TELEGRAM.TOKEN) throw new Error('TELEGRAM_TOKEN environment variable required');

// ==========================================
// LOGGER SETUP
// ==========================================

const logger = winston.createLogger({
    level: CONFIG.SERVER.NODE_ENV === 'production' ? 'info' : 'debug',
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.errors({ stack: true }),
        winston.format.json()
    ),
    transports: [
        new winston.transports.File({ filename: 'logs/error.log', level: 'error' }),
        new winston.transports.File({ filename: 'logs/combined.log' }),
        new winston.transports.Console({
            format: winston.format.combine(
                winston.format.colorize(),
                winston.format.printf(({ level, message, timestamp, ...metadata }) => {
                    return `${BRAND.emoji} [${BRAND.name}] ${level}: ${message}`;
                })
            )
        })
    ]
});

// ==========================================
// DATABASE LAYER (Firebase + Local Fallback)
// ==========================================

class Database {
    constructor() {
        this.db = null;
        this.localFallback = new Map();
        this.init();
    }

    init() {
        try {
            if (process.env.FIREBASE_PROJECT_ID) {
                admin.initializeApp({
                    credential: admin.credential.cert({
                        projectId: process.env.FIREBASE_PROJECT_ID,
                        privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
                        clientEmail: process.env.FIREBASE_CLIENT_EMAIL
                    })
                });
                this.db = admin.firestore();
                logger.info('Firebase initialized');
            } else {
                logger.warn('Firebase not configured, using in-memory + file fallback');
                this.loadLocalData();
            }
        } catch (error) {
            logger.error('Firebase init failed, using fallback:', error.message);
            this.loadLocalData();
        }
    }

    loadLocalData() {
        try {
            const dataPath = './data/vouchers.json';
            if (fs.existsSync(dataPath)) {
                const data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
                Object.entries(data).forEach(([k, v]) => this.localFallback.set(k, v));
                logger.info(`Loaded ${this.localFallback.size} vouchers from file`);
            }
        } catch (error) {
            logger.error('Failed to load local data:', error);
        }
    }

    saveLocalData() {
        if (!this.db) {
            try {
                if (!fs.existsSync('./data')) fs.mkdirSync('./data');
                const data = Object.fromEntries(this.localFallback);
                fs.writeFileSync('./data/vouchers.json', JSON.stringify(data, null, 2));
            } catch (error) {
                logger.error('Failed to save local data:', error);
            }
        }
    }

    async getVoucher(code) {
        if (this.db) {
            const doc = await this.db.collection('vouchers').doc(code).get();
            return doc.exists ? doc.data() : null;
        }
        return this.localFallback.get(code) || null;
    }

    async createVoucher(code, data) {
        const voucherData = {
            ...data,
            createdAt: admin.firestore?.FieldValue?.serverTimestamp() || new Date(),
            used: false
        };

        if (this.db) {
            await this.db.collection('vouchers').doc(code).set(voucherData);
        } else {
            this.localFallback.set(code, voucherData);
            this.saveLocalData();
        }
        return voucherData;
    }

    async redeemVoucher(code, userData) {
        const updateData = {
            used: true,
            redeemedAt: admin.firestore?.FieldValue?.serverTimestamp() || new Date(),
            redeemedBy: userData
        };

        if (this.db) {
            await this.db.collection('vouchers').doc(code).update(updateData);
        } else {
            const voucher = this.localFallback.get(code);
            if (voucher) {
                this.localFallback.set(code, { ...voucher, ...updateData });
                this.saveLocalData();
            }
        }
    }

    async getStats() {
        if (this.db) {
            const snapshot = await this.db.collection('vouchers').get();
            const vouchers = snapshot.docs.map(d => d.data());
            return {
                total: vouchers.length,
                used: vouchers.filter(v => v.used).length,
                active: vouchers.filter(v => !v.used).length
            };
        }
        const vouchers = Array.from(this.localFallback.values());
        return {
            total: vouchers.length,
            used: vouchers.filter(v => v.used).length,
            active: vouchers.filter(v => !v.used).length
        };
    }

    async getRecentVouchers(limit = 10) {
        if (this.db) {
            const snapshot = await this.db.collection('vouchers')
                .orderBy('createdAt', 'desc')
                .limit(limit)
                .get();
            return snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
        }
        return Array.from(this.localFallback.entries())
            .sort((a, b) => (b[1].createdAt?.seconds || 0) - (a[1].createdAt?.seconds || 0))
            .slice(0, limit)
            .map(([id, data]) => ({ id, ...data }));
    }

    async deleteVoucher(code) {
        if (this.db) {
            await this.db.collection('vouchers').doc(code).delete();
        } else {
            this.localFallback.delete(code);
            this.saveLocalData();
        }
    }
}

const database = new Database();

// ==========================================
// MIKROTIK MANAGER (Enhanced with Tools)
// ==========================================

class MikroTikManager {
    constructor() {
        this.conn = null;
        this.isConnected = false;
        this.reconnectAttempts = 0;
        this.api = new RouterOSClient({
            host: CONFIG.MIKROTIK.IP,
            user: CONFIG.MIKROTIK.USER,
            password: CONFIG.MIKROTIK.PASS,
            port: CONFIG.MIKROTIK.PORT,
            timeout: 10000
        });
        this.tools = new Map();
        this.registerTools();
    }

    registerTools() {
        this.tools.set('user.add', this.addHotspotUser.bind(this));
        this.tools.set('user.remove', this.removeHotspotUser.bind(this));
        this.tools.set('user.kick', this.kickUser.bind(this));
        this.tools.set('user.status', this.getUserStatus.bind(this));
        this.tools.set('users.active', this.getActiveUsers.bind(this));
        this.tools.set('users.all', this.getAllHotspotUsers.bind(this));
        this.tools.set('system.stats', this.getSystemStats.bind(this));
        this.tools.set('system.logs', this.getLogs.bind(this));
        this.tools.set('system.reboot', this.reboot.bind(this));
        this.tools.set('ping', this.ping.bind(this));
        this.tools.set('traceroute', this.traceroute.bind(this));
        this.tools.set('firewall.list', this.getFirewallRules.bind(this));
        this.tools.set('firewall.block', this.addToBlockList.bind(this));
    }

    async connect() {
        try {
            this.conn = await this.api.connect();
            this.isConnected = true;
            this.reconnectAttempts = 0;
            logger.info('MikroTik connected');
            this.monitorConnection();
        } catch (error) {
            this.isConnected = false;
            logger.error('MikroTik connection failed:', error.message);
            this.scheduleReconnect();
        }
    }

    monitorConnection() {
        setInterval(async () => {
            try {
                if (this.conn) {
                    await this.conn.menu('/system/resource').get();
                }
            } catch (error) {
                logger.warn('MikroTik connection lost, reconnecting...');
                this.isConnected = false;
                this.connect();
            }
        }, 30000);
    }

    scheduleReconnect() {
        if (this.reconnectAttempts < CONFIG.MIKROTIK.MAX_RECONNECT_ATTEMPTS) {
            this.reconnectAttempts++;
            logger.info(`Reconnecting to MikroTik (attempt ${this.reconnectAttempts})...`);
            setTimeout(() => this.connect(), CONFIG.MIKROTIK.RECONNECT_INTERVAL);
        } else {
            logger.error('Max reconnection attempts reached');
        }
    }

    async addHotspotUser(username, password, profile) {
        if (!this.isConnected) throw new Error('MikroTik not connected');
        const existing = await this.conn.menu('/ip/hotspot/user').where('name', username).get();
        if (existing.length > 0) {
            await this.conn.menu('/ip/hotspot/user').update(existing[0]['.id'], {
                password, profile, disabled: 'no'
            });
            return { action: 'updated', username };
        } else {
            await this.conn.menu('/ip/hotspot/user').add({ name: username, password, profile });
            return { action: 'created', username };
        }
    }

    async removeHotspotUser(username) {
        if (!this.isConnected) throw new Error('MikroTik not connected');
        const users = await this.conn.menu('/ip/hotspot/user').where('name', username).get();
        if (users.length > 0) {
            await this.conn.menu('/ip/hotspot/user').remove(users[0]['.id']);
            return { action: 'removed', username };
        }
        throw new Error('User not found');
    }

    async getAllHotspotUsers() {
        if (!this.isConnected) return [];
        return await this.conn.menu('/ip/hotspot/user').get();
    }

    async getActiveUsers() {
        if (!this.isConnected) return [];
        return await this.conn.menu('/ip/hotspot/active').get();
    }

    async getUserStatus(username) {
        if (!this.isConnected) return null;
        const active = await this.conn.menu('/ip/hotspot/active').where('user', username).get();
        return active.length > 0 ? active[0] : null;
    }

    async kickUser(username) {
        if (!this.isConnected) throw new Error('MikroTik not connected');
        const active = await this.conn.menu('/ip/hotspot/active').where('user', username).get();
        if (active.length > 0) {
            await this.conn.menu('/ip/hotspot/active').remove(active[0]['.id']);
            return true;
        }
        return false;
    }

    async getSystemStats() {
        if (!this.isConnected) return null;
        const resources = await this.conn.menu('/system/resource').get();
        return resources[0];
    }

    async getLogs(lines = 10) {
        if (!this.isConnected) return [];
        const logs = await this.conn.menu('/log').get();
        return logs.slice(-lines);
    }

    async reboot() {
        if (!this.isConnected) throw new Error('MikroTik not connected');
        await this.conn.menu('/system').call('reboot');
        return { status: 'rebooting' };
    }

    async ping(host, count = 4) {
        if (!this.isConnected) throw new Error('MikroTik not connected');
        return await this.conn.menu('/ping').call({ address: host, count: count.toString() });
    }

    async traceroute(host) {
        if (!this.isConnected) throw new Error('MikroTik not connected');
        return await this.conn.menu('/tool/traceroute').call({ address: host, count: '1' });
    }

    async getFirewallRules(type = 'filter') {
        if (!this.isConnected) return [];
        return await this.conn.menu(`/ip/firewall/${type}`).get();
    }

    async addToBlockList(target, list = 'blocked') {
        if (!this.isConnected) throw new Error('MikroTik not connected');
        await this.conn.menu('/ip/firewall/address-list').add({
            list, address: target, comment: 'Blocked via AgentOS'
        });
        return { action: 'blocked', target };
    }

    async executeTool(toolName, ...args) {
        const tool = this.tools.get(toolName);
        if (!tool) throw new Error(`Tool not found: ${toolName}`);
        return await tool(...args);
    }

    getAvailableTools() {
        return Array.from(this.tools.keys());
    }
}

const mikrotik = new MikroTikManager();

// ==========================================
// WEBSOCKET GATEWAY
// ==========================================

class AgentOSGateway {
    constructor(server) {
        this.wss = new WebSocket.Server({
            server,
            path: CONFIG.GATEWAY.WS_PATH,
            verifyClient: this.verifyClient.bind(this)
        });
        this.clients = new Map();
        this.setupHandlers();
        logger.info(`WebSocket Gateway initialized on ${CONFIG.GATEWAY.WS_PATH}`);
    }

    verifyClient(info, callback) {
        const url = new URL(info.req.url, `http://${info.req.headers.host}`);
        const token = url.searchParams.get('token') || info.req.headers['x-agentos-token'];

        const verifyTimeout = setTimeout(() => {
            callback(false, 408, 'Verification timeout');
        }, 5000);

        if (token === CONFIG.GATEWAY.TOKEN) {
            clearTimeout(verifyTimeout);
            callback(true);
        } else {
            clearTimeout(verifyTimeout);
            callback(false, 401, 'Invalid token');
        }
    }

    setupHandlers() {
        this.wss.on('connection', (ws, req) => {
            const clientId = require('crypto').randomUUID();
            this.clients.set(clientId, { ws, authenticated: true, role: 'client' });

            logger.info(`Client connected: ${clientId}`);

            this.send(ws, {
                type: 'hello',
                payload: {
                    service: BRAND.name,
                    version: BRAND.version,
                    timestamp: new Date().toISOString()
                }
            });

            ws.on('message', (data) => this.handleMessage(clientId, data));
            ws.on('close', () => this.handleDisconnect(clientId));
            ws.on('error', (err) => logger.error(`WS error for ${clientId}:`, err));
        });
    }

    handleMessage(clientId, data) {
        try {
            const message = JSON.parse(data);
            const client = this.clients.get(clientId);

            switch (message.type) {
                case 'ping':
                    this.send(client.ws, { type: 'pong', timestamp: Date.now() });
                    break;
                case 'tool.invoke':
                    this.handleToolInvoke(client, message);
                    break;
                case 'status':
                    this.sendStatus(client);
                    break;
                case 'broadcast':
                    this.broadcast(message.payload);
                    break;
                case 'tool.discovery':
                    this.send(client.ws, {
                        type: 'discovery.result',
                        tools: [
                            {
                                name: 'mikrotik.addHotspotUser',
                                description: 'Creates or updates a hotspot voucher',
                                params: ['username', 'password', 'profile'],
                                required: true
                            },
                            {
                                name: 'mikrotik.kickUser',
                                description: 'Disconnects an active user from the network',
                                params: ['username'],
                                required: true
                            },
                            {
                                name: 'mikrotik.ping',
                                description: 'Pings a host from the router',
                                params: ['host', 'count'],
                                defaults: { count: 4 }
                            }
                        ],
                        system: {
                            version: BRAND.version,
                            uptime: process.uptime()
                        }
                    });
                    break;
                default:
                    this.send(client.ws, {
                        type: 'error',
                        error: 'Unknown message type',
                        received: message.type
                    });
            }
        } catch (error) {
            logger.error('WS message handling error:', error);
        }
    }

    async handleToolInvoke(client, message) {
        const { tool, params, id } = message;
        try {
            if (tool.startsWith('mikrotik.')) {
                const mikrotikTool = tool.replace('mikrotik.', '');
                const result = await mikrotik.executeTool(mikrotikTool, ...params);
                this.send(client.ws, { type: 'tool.result', id, result, success: true });
            } else {
                throw new Error(`Unknown tool: ${tool}`);
            }
        } catch (error) {
            this.send(client.ws, { type: 'tool.error', id, error: error.message, success: false });
        }
    }

    sendStatus(client) {
        this.send(client.ws, {
            type: 'status',
            payload: {
                mikrotik: mikrotik.isConnected ? 'connected' : 'disconnected',
                database: database.db ? 'firebase' : 'local',
                clients: this.clients.size,
                tools: mikrotik.getAvailableTools()
            }
        });
    }

    send(ws, data) {
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify(data));
        }
    }

    broadcast(payload) {
        this.clients.forEach(({ ws }) => {
            this.send(ws, { type: 'broadcast', payload });
        });
    }

    handleDisconnect(clientId) {
        this.clients.delete(clientId);
        logger.info(`Client disconnected: ${clientId}`);
    }
}

// ==========================================
// TELEGRAM BOT WITH INTERACTIVE BUTTONS
// ==========================================

class AgentOSBot {
    constructor() {
        this.bot = new TelegramBot(CONFIG.TELEGRAM.TOKEN, {
            polling: true,
            onlyFirstMatch: true
        });
        this.pendingActions = new Map();
        this.setupHandlers();
    }

    setupHandlers() {
        this.bot.onText(/\/start/, this.handleStart.bind(this));
        this.bot.onText(/\/dashboard/, this.handleDashboard.bind(this));
        this.bot.onText(/\/tools/, this.handleTools.bind(this));
        this.bot.onText(/\/network/, this.handleNetwork.bind(this));
        this.bot.onText(/\/users/, this.handleUsers.bind(this));
        this.bot.onText(/\/voucher/, this.handleVoucher.bind(this));
        this.bot.onText(/\/status/, this.handleStatus.bind(this));
        this.bot.onText(/\/help/, this.handleHelp.bind(this));

        this.bot.onText(/\/gen (.+)/, async (msg, match) => {
            const plan = match[1];
            const code = await this.generateVoucherCode(plan);
            this.bot.sendMessage(msg.chat.id, `🎫 Voucher Generated: \`${code}\``, { parse_mode: 'Markdown' });
        });

        this.bot.onText(/\/logs/, async (msg) => {
            if (!this.checkAuth(msg)) return;
            try {
                const logs = await mikrotik.getLogs(10);
                const formatted = logs.map(log =>
                    `• ${log.time || ''} ${log.message || JSON.stringify(log)}`
                ).join('\n');
                await this.bot.sendMessage(msg.chat.id,
                    `📋 *Router Logs*\n\n${formatted || 'No logs available'}`,
                    { parse_mode: 'Markdown' }
                );
            } catch (error) {
                await this.bot.sendMessage(msg.chat.id, `❌ Failed to fetch logs: ${error.message}`);
            }
        });

        this.bot.on('callback_query', this.handleCallback.bind(this));
        this.bot.on('polling_error', (err) => logger.error('Telegram polling error:', err));
    }

    checkAuth(msg) {
        const chatId = msg.chat.id.toString();
        if (CONFIG.TELEGRAM.ALLOWED_CHATS.length > 0) {
            if (!CONFIG.TELEGRAM.ALLOWED_CHATS.includes(chatId)) {
                this.bot.sendMessage(msg.chat.id, "⛔ *Unauthorized*", { parse_mode: "Markdown" });
                return false;
            }
        }
        return true;
    }

    // FIX #6: sendToAll — broadcasts a message to all allowed chats
    sendToAll(text) {
        const targets = CONFIG.TELEGRAM.ALLOWED_CHATS.length > 0
            ? CONFIG.TELEGRAM.ALLOWED_CHATS
            : [];
        targets.forEach(chatId => {
            this.bot.sendMessage(chatId, text, { parse_mode: 'Markdown' }).catch(err =>
                logger.error(`sendToAll failed for chat ${chatId}:`, err)
            );
        });
    }

    // ==================== COMMAND HANDLERS ====================

    async handleStart(msg) {
        if (!this.checkAuth(msg)) return;

        const welcomeText =
            `${BRAND.emoji} *${BRAND.name} ${BRAND.version}*\n` +
            `_"${BRAND.tagline}"_\n\n` +
            `Welcome, ${msg.from.first_name}! I'm your network intelligence assistant.\n\n` +
            `🔧 *Quick Actions:*`;

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

        await this.bot.sendMessage(msg.chat.id, welcomeText, {
            parse_mode: "Markdown",
            reply_markup: keyboard
        });
    }

    async handleDashboard(msg) {
        if (!this.checkAuth(msg)) return;
        try {
            const [dbStats, routerStats] = await Promise.all([
                database.getStats(),
                mikrotik.getSystemStats()
            ]);

            const cpuLoad = routerStats ? parseInt(routerStats['cpu-load']) : 0;
            const cpuEmoji = cpuLoad > 80 ? '🔴' : cpuLoad > 50 ? '🟡' : '🟢';

            const text =
                `📊 *${BRAND.name} Dashboard*\n\n` +
                `*Router (${CONFIG.MIKROTIK.IP}):*\n` +
                `${cpuEmoji} CPU: ${routerStats?.['cpu-load'] || 'N/A'}%\n` +
                `🧠 Memory: ${this.formatBytes(routerStats?.['free-memory'] || 0)}\n` +
                `⏱ Uptime: ${routerStats?.uptime || 'N/A'}\n\n` +
                `*Vouchers:*\n` +
                `🎫 Total: ${dbStats.total} | ✅ Used: ${dbStats.used} | ⏳ Active: ${dbStats.active}\n\n` +
                `*Gateway:*\n` +
                `🔌 WS: ${CONFIG.SERVER.HOST}:${CONFIG.SERVER.PORT}${CONFIG.GATEWAY.WS_PATH}\n` +
                `👥 Connected Clients: ${gateway?.clients?.size || 0}`;

            const keyboard = {
                inline_keyboard: [
                    [
                        { text: "🔄 Refresh", callback_data: "action:dashboard" },
                        { text: "📋 Full Status", callback_data: "action:status" }
                    ],
                    [
                        { text: "🔧 Router Tools", callback_data: "action:network" },
                        { text: "👥 Manage Users", callback_data: "action:users" }
                    ]
                ]
            };

            await this.bot.sendMessage(msg.chat.id, text, {
                parse_mode: "Markdown",
                reply_markup: keyboard
            });
        } catch (error) {
            this.bot.sendMessage(msg.chat.id, `❌ Error: ${error.message}`);
        }
    }

    async handleTools(msg) {
        if (!this.checkAuth(msg)) return;

        const toolList = mikrotik.getAvailableTools();
        const toolButtons = toolList.map(tool => ({
            text: `🔧 ${tool}`,
            callback_data: `tool:${tool}`
        }));

        const chunked = [];
        for (let i = 0; i < toolButtons.length; i += 2) {
            chunked.push(toolButtons.slice(i, i + 2));
        }

        await this.bot.sendMessage(msg.chat.id,
            `${BRAND.emoji} *Available Tools*\n\nSelect a tool to execute:`, {
            parse_mode: "Markdown",
            reply_markup: { inline_keyboard: chunked }
        });
    }

    async handleNetwork(msg) {
        if (!this.checkAuth(msg)) return;

        const keyboard = {
            inline_keyboard: [
                [
                    { text: "📡 Ping Test", callback_data: "net:ping" },
                    { text: "🛤 Traceroute", callback_data: "net:traceroute" }
                ],
                [
                    { text: "🔥 Firewall Rules", callback_data: "net:firewall" },
                    { text: "🚫 Block IP", callback_data: "net:block" }
                ],
                [
                    { text: "📊 Bandwidth Test", callback_data: "net:bandwidth" },
                    { text: "📋 DHCP Leases", callback_data: "net:dhcp" }
                ],
                [
                    { text: "🔍 Scan Network", callback_data: "net:scan" },
                    { text: "⚡ Reboot Router", callback_data: "net:reboot" }
                ]
            ]
        };

        await this.bot.sendMessage(msg.chat.id,
            `🌐 *Network Operations*\n\nSelect an action:`, {
            parse_mode: "Markdown",
            reply_markup: keyboard
        });
    }

    async handleUsers(msg) {
        if (!this.checkAuth(msg)) return;
        try {
            const activeUsers = await mikrotik.getActiveUsers();

            const keyboard = {
                inline_keyboard: [
                    [
                        { text: "👁 View Active", callback_data: "users:active" },
                        { text: "📋 All Users", callback_data: "users:all" }
                    ],
                    [
                        { text: "➕ Add User", callback_data: "users:add" },
                        { text: "🚫 Kick User", callback_data: "users:kick" }
                    ],
                    [
                        { text: "🔍 Check Status", callback_data: "users:status" },
                        { text: "🎫 Gen Voucher", callback_data: "action:voucher" }
                    ]
                ]
            };

            await this.bot.sendMessage(msg.chat.id,
                `👥 *User Management*\n\n` +
                `Currently active: *${activeUsers.length}* users\n\n` +
                `Select an action:`, {
                parse_mode: "Markdown",
                reply_markup: keyboard
            });
        } catch (error) {
            this.bot.sendMessage(msg.chat.id, `❌ Error: ${error.message}`);
        }
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
                        { text: "📆 7 Day", callback_data: "voucher:7d" },
                        { text: "🌙 30 Day", callback_data: "voucher:30d" }
                    ],
                    [
                        { text: "⚡ Custom", callback_data: "voucher:custom" }
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
        try {
            const statusEmoji = mikrotik.isConnected ? '🟢' : '🔴';

            await this.bot.sendMessage(msg.chat.id,
                `${BRAND.emoji} *${BRAND.name} Status*\n\n` +
                `${statusEmoji} *MikroTik:* ${mikrotik.isConnected ? 'Connected' : 'Disconnected'}\n` +
                `💾 *Database:* ${database.db ? 'firebase' : 'local'}\n` +
                `⏰ *Timestamp:* ${new Date().toISOString()}\n\n` +
                `*Available Tools:* ${mikrotik.getAvailableTools().length}\n` +
                `*WS Clients:* ${gateway?.clients?.size || 0}`, {
                parse_mode: "Markdown",
                reply_markup: {
                    inline_keyboard: [[
                        { text: "🔄 Refresh", callback_data: "action:status" },
                        { text: "📊 Dashboard", callback_data: "action:dashboard" }
                    ]]
                }
            });
        } catch (error) {
            this.bot.sendMessage(msg.chat.id, `❌ Error: ${error.message}`);
        }
    }

    async handleHelp(msg) {
        if (!this.checkAuth(msg)) return;

        const helpText =
            `${BRAND.emoji} *${BRAND.name} Commands*\n\n` +
            `*/start* - Main menu with action buttons\n` +
            `*/dashboard* - System overview\n` +
            `*/tools* - List available tools\n` +
            `*/network* - Network operations\n` +
            `*/users* - User management\n` +
            `*/voucher* [plan] - Create access voucher\n` +
            `*/status* - System health\n` +
            `*/help* - This message\n\n` +
            `_All commands use interactive buttons for safety._`;

        await this.bot.sendMessage(msg.chat.id, helpText, { parse_mode: "Markdown" });
    }

    // ==================== CALLBACK HANDLER ====================

    // FIX #2: Removed dead/unreachable code block that referenced undefined `msg`
    async handleCallback(query) {
        const chatId = query.message.chat.id;
        const data = query.data;
        const messageId = query.message.message_id;

        try {
            await this.bot.answerCallbackQuery(query.id);

            const [category, action] = data.split(':');

            switch (category) {
                case 'action':
                    await this.handleActionButton(chatId, action, messageId);
                    break;
                case 'tool':
                    await this.handleToolButton(chatId, action);
                    break;
                case 'net':
                    await this.handleNetworkButton(chatId, action);
                    break;
                case 'users':
                    await this.handleUsersButton(chatId, action);
                    break;
                case 'voucher':
                    await this.handleVoucherButton(chatId, action);
                    break;
                case 'confirm':
                    await this.handleConfirmation(chatId, action, query);
                    break;
                default:
                    await this.bot.sendMessage(chatId, `❓ Unknown action: ${data}`);
            }
        } catch (error) {
            logger.error('Callback handling error:', error);
            await this.bot.sendMessage(chatId, `❌ Error: ${error.message}`);
        }
    }

    async handleActionButton(chatId, action, messageId) {
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

    async handleToolButton(chatId, toolName) {
        const toolConfig = {
            'user.status': { params: ['username'], desc: 'Check user status' },
            'user.kick': { params: ['username'], desc: 'Kick active user' },
            'system.stats': { params: [], desc: 'Router statistics' },
            'system.logs': { params: ['lines'], desc: 'View logs' }
        };

        const config = toolConfig[toolName];

        if (!config || config.params.length === 0) {
            try {
                const result = await mikrotik.executeTool(toolName);
                await this.bot.sendMessage(chatId,
                    `✅ *Tool Result: ${toolName}*\n\n` +
                    `\`\`\`json\n${JSON.stringify(result, null, 2)}\n\`\`\``, {
                    parse_mode: "Markdown"
                });
            } catch (error) {
                await this.bot.sendMessage(chatId, `❌ Tool failed: ${error.message}`);
            }
        } else {
            await this.bot.sendMessage(chatId,
                `🔧 *Tool: ${toolName}*\n\n` +
                `Description: ${config.desc}\n` +
                `Parameters needed: ${config.params.join(', ')}\n\n` +
                `Please use command format:\n` +
                `/tool ${toolName} ${config.params.map(p => `[${p}]`).join(' ')}`);
        }
    }

    async handleNetworkButton(chatId, action) {
        switch (action) {
            case 'ping':
                await this.bot.sendMessage(chatId,
                    `📡 *Ping Test*\n\nPlease send:\n/ping <host> [count]`);
                break;
            case 'traceroute':
                await this.bot.sendMessage(chatId,
                    `🛤 *Traceroute*\n\nPlease send:\n/traceroute <host>`);
                break;
            case 'firewall':
                try {
                    const rules = await mikrotik.getFirewallRules('filter');
                    await this.bot.sendMessage(chatId,
                        `🔥 *Firewall Rules (${rules.length})*\n\n` +
                        rules.slice(0, 5).map(r =>
                            `• ${r.chain}: ${r.action} (${r.comment || 'no comment'})`
                        ).join('\n'));
                } catch (error) {
                    await this.bot.sendMessage(chatId, `❌ Error: ${error.message}`);
                }
                break;
            case 'block':
                await this.bot.sendMessage(chatId,
                    `🚫 *Block IP/MAC*\n\nPlease send:\n/block <ip-or-mac> [reason]`);
                break;
            case 'reboot':
                await this.bot.sendMessage(chatId,
                    `⚠️ *Confirm Router Reboot*\n\n` +
                    `This will disconnect all users. Are you sure?`, {
                    parse_mode: "Markdown",
                    reply_markup: {
                        inline_keyboard: [[
                            { text: "✅ Yes, Reboot", callback_data: "confirm:reboot" },
                            { text: "❌ Cancel", callback_data: "confirm:cancel" }
                        ]]
                    }
                });
                break;
            default:
                await this.bot.sendMessage(chatId, `🚧 ${action} not implemented yet`);
        }
    }

    async handleUsersButton(chatId, action) {
        switch (action) {
            case 'active':
                try {
                    const users = await mikrotik.getActiveUsers();
                    if (users.length === 0) {
                        await this.bot.sendMessage(chatId, "📭 No active users");
                    } else {
                        const list = users.map(u =>
                            `• *${u.user}* | ${u.address} | ⏱ ${u.uptime}`
                        ).join('\n');
                        await this.bot.sendMessage(chatId,
                            `👥 *Active Users (${users.length})*\n\n${list}`, {
                            parse_mode: "Markdown"
                        });
                    }
                } catch (error) {
                    await this.bot.sendMessage(chatId, `❌ Error: ${error.message}`);
                }
                break;
            case 'all':
                try {
                    const users = await mikrotik.getAllHotspotUsers();
                    await this.bot.sendMessage(chatId,
                        `📋 *All Hotspot Users (${users.length})*\n\n` +
                        users.slice(0, 10).map(u => `• ${u.name} (${u.profile})`).join('\n'));
                } catch (error) {
                    await this.bot.sendMessage(chatId, `❌ Error: ${error.message}`);
                }
                break;
            case 'add':
                await this.bot.sendMessage(chatId,
                    `➕ *Add User*\n\nFormat:\n/adduser <username> <password> <profile>`);
                break;
            case 'kick':
                await this.bot.sendMessage(chatId,
                    `🚫 *Kick User*\n\nFormat:\n/kick <username>`);
                break;
            case 'status':
                await this.bot.sendMessage(chatId,
                    `🔍 *Check User Status*\n\nFormat:\n/status <username>`);
                break;
        }
    }

    async handleVoucherButton(chatId, duration) {
        const planMap = {
            '1h': { plan: '1hour', duration: '1h' },
            '1d': { plan: '1Day', duration: '1d' },
            '7d': { plan: '7Day', duration: '7d' },
            '30d': { plan: '30Day', duration: '30d' },
            'custom': { plan: 'custom', duration: '' }
        };

        const config = planMap[duration];
        if (config) {
            await this.createVoucher(chatId, config.plan, config.duration);
        }
    }

    // FIX #1: handleConfirmation removed from AgentOSGateway and kept only here (correct class)
    async handleConfirmation(chatId, action, query) {
        if (action === 'reboot') {
            try {
                await this.bot.editMessageText('🔄 Rebooting router...', {
                    chat_id: chatId,
                    message_id: query.message.message_id
                });
                await mikrotik.reboot();
                await this.bot.sendMessage(chatId,
                    `✅ *Reboot Command Sent*\n\nRouter will restart in 30 seconds.`);
                logger.warn('Router reboot initiated via Telegram', { by: query.from.id });
            } catch (error) {
                await this.bot.sendMessage(chatId, `❌ Reboot failed: ${error.message}`);
            }
        } else if (action === 'cancel') {
            await this.bot.editMessageText('❌ Action cancelled', {
                chat_id: chatId,
                message_id: query.message.message_id
            });
        }
    }

    // ==================== HELPER METHODS ====================

    // FIX #3: Renamed from generateVoucher (conflict) to generateVoucherCode for /gen command
    async generateVoucherCode(plan) {
        const code = "STAR-" + Math.random().toString(36).substr(2, 6).toUpperCase();
        await database.createVoucher(code, { plan, createdBy: 'telegram', createdAt: new Date() });
        return code;
    }

    async createVoucher(chatId, plan, duration = '') {
        try {
            const code = "STAR-" + Math.random().toString(36).substr(2, 6).toUpperCase();

            await database.createVoucher(code, {
                plan, duration, createdBy: 'telegram', createdAt: new Date()
            });

            const qrData = JSON.stringify({
                code, plan,
                url: `${process.env.SERVER_URL || 'http://localhost:3000'}/login.html?code=${code}`
            });

            const qrBuffer = await QRCode.toBuffer(qrData);

            await this.bot.sendPhoto(chatId, qrBuffer, {
                caption:
                    `🎟 *${BRAND.name} Voucher*\n\n` +
                    `Code: \`${code}\`\n` +
                    `Plan: ${plan}\n` +
                    (duration ? `Duration: ${duration}\n` : '') +
                    `\n_Scan QR code or enter manually_`,
                parse_mode: "Markdown",
                reply_markup: {
                    inline_keyboard: [[
                        { text: "🎫 Create Another", callback_data: "action:voucher" },
                        { text: "📊 Dashboard", callback_data: "action:dashboard" }
                    ]]
                }
            });

            logger.info('Voucher created via Telegram', { code, plan, chatId });
        } catch (error) {
            await this.bot.sendMessage(chatId, `❌ Failed to create voucher: ${error.message}`);
        }
    }

    formatBytes(bytes) {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    // Text command handlers for parameter input
    setupTextHandlers() {
        this.bot.onText(/\/ping\s+([^\s]+)(?:\s+(\d+))?/, async (msg, match) => {
            if (!this.checkAuth(msg)) return;
            const host = match[1];
            const count = parseInt(match[2]) || 4;
            try {
                await this.bot.sendChatAction(msg.chat.id, 'typing');
                const result = await mikrotik.ping(host, count);
                await this.bot.sendMessage(msg.chat.id,
                    `📡 *Ping Results: ${host}*\n\n` +
                    `\`\`\`\n${JSON.stringify(result, null, 2)}\n\`\`\``, {
                    parse_mode: "Markdown",
                    reply_markup: {
                        inline_keyboard: [[
                            { text: "🔄 Ping Again", callback_data: "net:ping" },
                            { text: "🛤 Traceroute", callback_data: "net:traceroute" }
                        ]]
                    }
                });
            } catch (error) {
                await this.bot.sendMessage(msg.chat.id, `❌ Ping failed: ${error.message}`);
            }
        });

        this.bot.onText(/\/kick\s+(\w+)/, async (msg, match) => {
            if (!this.checkAuth(msg)) return;
            const username = match[1];
            try {
                const kicked = await mikrotik.kickUser(username);
                if (kicked) {
                    await this.bot.sendMessage(msg.chat.id,
                        `🚫 User *${username}* kicked successfully.`, {
                        parse_mode: "Markdown",
                        reply_markup: {
                            inline_keyboard: [[
                                { text: "👥 View Users", callback_data: "users:active" },
                                { text: "🎫 Create Voucher", callback_data: "action:voucher" }
                            ]]
                        }
                    });
                } else {
                    await this.bot.sendMessage(msg.chat.id,
                        `⚠️ User *${username}* not active.`, { parse_mode: "Markdown" });
                }
            } catch (error) {
                await this.bot.sendMessage(msg.chat.id, `❌ Error: ${error.message}`);
            }
        });
    }
}

// ==========================================
// AGENT OS ORCHESTRATOR
// ==========================================

// FIX #4 & #5: AgentOS now receives resolved instances instead of referencing
// uninitialized outer variables; also properly instantiated in startServer()
class AgentOS {
    constructor(mikrotikInstance, dbInstance, gatewayInstance, botInstance) {
        this.mikrotik = mikrotikInstance;
        this.db = dbInstance;
        this.gateway = gatewayInstance;
        this.bot = botInstance;
        this.init();
    }

    init() {
        this.setupSystemListeners();
        this.setupGatewayListeners();
        this.setupBotListeners();
    }

    // FIX #7: Use mikrotik.getSystemStats() instead of tools["network.resource"]
    setupSystemListeners() {
        setInterval(async () => {
            if (this.mikrotik.isConnected) {
                try {
                    const stats = await this.mikrotik.getSystemStats();
                    if (stats && parseInt(stats['cpu-load']) > 90) {
                        this.broadcastAlert(`⚠️ High CPU Load: ${stats['cpu-load']}%`);
                    }
                } catch (err) {
                    logger.error('System monitor error:', err.message);
                }
            }
        }, 10000);
    }

    setupGatewayListeners() {
        this.gateway.wss.on('connection', (ws) => {
            ws.on('message', async (data) => {
                let msg;
                try { msg = JSON.parse(data); } catch { return; }

                if (msg.type === 'discover') {
                    ws.send(JSON.stringify({ type: 'tools', list: Object.keys(tools) }));
                }

                if (msg.type === 'call' && tools[msg.tool]) {
                    try {
                        const result = await tools[msg.tool](this.mikrotik.conn, ...msg.params);
                        ws.send(JSON.stringify({ type: 'result', id: msg.id, data: result }));
                    } catch (e) {
                        ws.send(JSON.stringify({ type: 'error', id: msg.id, message: e.message }));
                    }
                }
            });
        });
    }

    setupBotListeners() {
        this.bot.bot.on('callback_query', async (query) => {
            const [category, action] = query.data.split(':');
            if (category === 'net' && action === 'reboot') {
                await this.bot.bot.sendMessage(query.message.chat.id, "Confirming reboot...");
                await this.mikrotik.reboot();
            }
        });
    }

    // FIX #6: this.bot.sendToAll() now works — method defined on AgentOSBot
    broadcastAlert(text) {
        this.bot.sendToAll(text);
        this.gateway.broadcast({ type: 'alert', text });
    }
}

// ==========================================
// EXPRESS HTTP API
// ==========================================

const app = express();

app.use(helmet());
app.use(cors({
    origin: process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',') : '*',
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

const standardLimiter = rateLimit({
    windowMs: CONFIG.SECURITY.RATE_LIMIT_WINDOW,
    max: CONFIG.SECURITY.RATE_LIMIT_MAX,
    message: { error: 'Too many requests, please try again later' }
});

app.use(express.json({ limit: '10mb' }));
app.use(standardLimiter);
app.use((req, res, next) => {
    logger.info(`${req.method} ${req.path}`, { ip: req.ip });
    next();
});

app.use(express.static('public'));

app.get('/health', async (req, res) => {
    const dbStats = await database.getStats();
    res.json({
        status: 'ok',
        service: BRAND.name,
        version: BRAND.version,
        timestamp: new Date().toISOString(),
        services: {
            mikrotik: mikrotik.isConnected ? 'connected' : 'disconnected',
            database: database.db ? 'firebase' : 'local',
            telegram: 'active',
            gateway: 'active'
        },
        stats: dbStats,
        // FIX #8: correct WS URL — gateway runs on the HTTP server port
        gateway: {
            ws: `ws://${CONFIG.SERVER.HOST}:${CONFIG.SERVER.PORT}${CONFIG.GATEWAY.WS_PATH}`,
            token: CONFIG.GATEWAY.TOKEN.substring(0, 8) + '...'
        }
    });
});

app.post('/voucher/redeem', async (req, res) => {
    try {
        const schema = Joi.object({
            code: Joi.string().pattern(/^STAR-[A-Z0-9]{6}$/).required(),
            user: Joi.string().alphanum().min(3).max(20).required()
        });

        const { error, value } = schema.validate(req.body);
        if (error) return res.status(400).json({ error: error.details[0].message });

        const { code, user } = value;

        const voucher = await database.getVoucher(code);
        if (!voucher) return res.status(404).json({ error: "Voucher not found" });
        if (voucher.used) return res.status(400).json({ error: "Voucher already used" });
        if (!mikrotik.isConnected) return res.status(503).json({ error: "Router temporarily unavailable" });

        await mikrotik.addHotspotUser(user, user, voucher.plan);
        await database.redeemVoucher(code, { username: user, ip: req.ip });

        logger.info(`Voucher redeemed`, { code, user, plan: voucher.plan });
        res.json({ status: "activated", plan: voucher.plan, message: `Access granted for plan: ${voucher.plan}` });

    } catch (err) {
        logger.error('Redeem error:', err);
        res.status(500).json({ error: "Failed to activate voucher" });
    }
});

app.get('/voucher/:code/qr', async (req, res) => {
    try {
        const { code } = req.params;
        const voucher = await database.getVoucher(code);
        if (!voucher) return res.status(404).json({ error: "Voucher not found" });

        const qrData = JSON.stringify({
            code, plan: voucher.plan,
            url: `${req.protocol}://${req.get('host')}/login.html?code=${code}`
        });

        const qrImage = await QRCode.toDataURL(qrData);
        res.json({ qr: qrImage, code, plan: voucher.plan });

    } catch (error) {
        logger.error('QR generation error:', error);
        res.status(500).json({ error: "Could not generate QR code" });
    }
});

app.post('/tool/execute', async (req, res) => {
    try {
        const { tool, params } = req.body;
        if (!tool || !mikrotik.getAvailableTools().includes(tool)) {
            return res.status(400).json({ error: "Invalid or unknown tool" });
        }
        const result = await mikrotik.executeTool(tool, ...(params || []));
        res.json({ success: true, result });
    } catch (error) {
        logger.error('Tool execution error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.use((req, res) => res.status(404).json({ error: "Not found" }));
app.use((err, req, res, next) => {
    logger.error('Unhandled error:', err);
    res.status(500).json({ error: "Internal server error" });
});

// ==========================================
// SERVER INITIALIZATION
// ==========================================

let gateway;
let telegramBot;
let agentOS;

async function startServer() {
    let connected = false;
    let attempts = 0;
    const maxAttempts = 5;

    while (!connected && attempts < maxAttempts) {
        try {
            await mikrotik.connect();
            connected = true;
        } catch (error) {
            attempts++;
            logger.warn(`MikroTik connection attempt ${attempts}/${maxAttempts} failed: ${error.message}`);
            if (attempts < maxAttempts) {
                await new Promise(resolve => setTimeout(resolve, 2000 * attempts));
            }
        }
    }

    if (!connected) {
        logger.warn('Starting in limited mode — MikroTik unreachable. Will retry in background.');
    }

    const server = http.createServer(app);

    // FIX #8: WS runs on the HTTP server (port 3000), not a separate port
    gateway = new AgentOSGateway(server);

    telegramBot = new AgentOSBot();
    telegramBot.setupTextHandlers();

    // FIX #4 & #5: AgentOS instantiated here, after all dependencies are ready,
    // with explicit injection instead of relying on outer variable timing
    agentOS = new AgentOS(mikrotik, database, gateway, telegramBot);

    server.listen(CONFIG.SERVER.PORT, CONFIG.SERVER.HOST, () => {
        logger.info(`${BRAND.name} v${BRAND.version} running on ${CONFIG.SERVER.HOST}:${CONFIG.SERVER.PORT}`);
        // FIX #8: log the correct WS address
        logger.info(`WebSocket Gateway: ws://${CONFIG.SERVER.HOST}:${CONFIG.SERVER.PORT}${CONFIG.GATEWAY.WS_PATH}`);
        logger.info(`Health check: http://${CONFIG.SERVER.HOST}:${CONFIG.SERVER.PORT}/health`);
        logger.info(`Gateway Token: ${CONFIG.GATEWAY.TOKEN.substring(0, 16)}...`);
    });
}

// Graceful shutdown
// FIX #10: database.saveLocalData() is synchronous — no need for await/?.
process.on('SIGTERM', () => {
    logger.info('SIGTERM received, shutting down gracefully');
    database.saveLocalData();
    process.exit(0);
});

process.on('SIGINT', () => {
    logger.info('SIGINT received, shutting down gracefully');
    database.saveLocalData();
    process.exit(0);
});

process.on('uncaughtException', (err) => {
    logger.error('Uncaught Exception:', err);
    process.exit(1);
});

startServer().catch(err => {
    logger.error('Failed to start server:', err);
    process.exit(1);
});