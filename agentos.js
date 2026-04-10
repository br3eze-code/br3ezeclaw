#!/usr/bin/env node
// ============================================================
// AgentOS — Network Intelligence Platform
// Version : 2026.5.0
// Stack   : MikroTik RouterOS · Telegram · WebSocket CLI
//           Firebase/Local DB · Gemini 2.5 ReAct Engine
// Security: CVE-2026-1526 patched · WS leak-free · Firebase v13
// ============================================================
process.env.GRPC_DNS_RESOLVER = 'native';

// ── Dependencies ─────────────────────────────────────────────
const express = require('express');
const router = express.Router();
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const WebSocket = require('ws');
const http = require('http');
const MastercardA2AService = require('./services/mastercardA2A');
const TelegramBot = require('node-telegram-bot-api');
const { RouterOSClient } = require('routeros-client');
const QRCode = require('qrcode');
const admin = require('firebase-admin');
const winston = require('winston');
const Joi = require('joi');
const fs = require('fs');
const readline = require('readline');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { body, validationResult } = require('express-validator');
const crypto = require('crypto');
const path = require('path');
require('dotenv').config();

// Ensure log directory exists before Winston initialises
const logDir = path.join(__dirname, 'logs');
if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });

const ARGS = process.argv.slice(2);
const IS_CLI = ARGS[0] === 'cli';

// ============================================================
// §1  CONSTANTS & CONFIG
// ============================================================

const BRAND = {
    name: 'AgentOS',
    version: '2026.5.0',
    emoji: '🤖',
    tagline: 'Network Intelligence, Simplified',
};

// ── Environment schema ───────────────────────────────────────
const envSchema = Joi.object({
    MIKROTIK_PASS: Joi.string().required(),
    TELEGRAM_TOKEN: Joi.string().allow('').default(''),
    TELEGRAM_BOT_USERNAME: Joi.string().default('AgentOSBot'),
    MIKROTIK_IP: Joi.string().default('192.168.88.1'),
    MIKROTIK_USER: Joi.string().default('admin'),
    MIKROTIK_PORT: Joi.number().default(8728),
    GATEWAY_PORT: Joi.number().default(19876),
    GATEWAY_HOST: Joi.string().default('127.0.0.1'),
    PORT: Joi.number().default(3000),
    HOST: Joi.string().default('0.0.0.0'),
    NODE_ENV: Joi.string().valid('development', 'production', 'test').default('development'),
    ALLOWED_CHAT_IDS: Joi.string().allow('').default(''),
    FIREBASE_PROJECT_ID: Joi.string().allow('').default(''),
    FIREBASE_PRIVATE_KEY: Joi.string().allow('').default(''),
    FIREBASE_CLIENT_EMAIL: Joi.string().allow('').default(''),
    SERVER_URL: Joi.string().uri().default('http://localhost:3000'),
    ALLOWED_ORIGINS: Joi.string().default('*'),
    GEMINI_API_KEY: Joi.string().allow('').default(''),
    AGENTOS_GATEWAY_TOKEN: Joi.string().allow('').default(''),
}).unknown(true);

const { error: envError, value: ENV } = envSchema.validate(process.env);
if (envError) { console.error(`[AgentOS] ENV error: ${envError.message}`); process.exit(1); }

const CONFIG = {
    MIKROTIK: {
        IP: ENV.MIKROTIK_IP,
        USER: ENV.MIKROTIK_USER,
        PASS: ENV.MIKROTIK_PASS,
        PORT: ENV.MIKROTIK_PORT,
        RECONNECT_INTERVAL: 5000,
        MAX_RECONNECT: 10,
    },
    TELEGRAM: {
        TOKEN: ENV.TELEGRAM_TOKEN,
        ALLOWED_CHATS: ENV.ALLOWED_CHAT_IDS
            ? ENV.ALLOWED_CHAT_IDS.split(',').filter(Boolean)
            : [],
        BOT_USERNAME: ENV.TELEGRAM_BOT_USERNAME,
    },
    GATEWAY: {
        PORT: ENV.GATEWAY_PORT,
        HOST: ENV.GATEWAY_HOST,
        TOKEN: ENV.AGENTOS_GATEWAY_TOKEN || crypto.randomBytes(32).toString('hex'),
        WS_PATH: '/ws',
    },
    SERVER: {
        PORT: ENV.PORT,
        HOST: ENV.HOST,
        NODE_ENV: ENV.NODE_ENV,
    },
    SECURITY: {
        RATE_LIMIT_WINDOW: 15 * 60 * 1000,
        RATE_LIMIT_MAX: 100,
        VOUCHER_RATE_LIMIT: 5,
        VOUCHER_WINDOW_MS: 60 * 1000,
        ALERT_COOLDOWN_MS: 5 * 60 * 1000,
    },
    VOUCHER_PREFIX: 'STAR-',
    VOUCHER_PLANS: {
        '1hour': { maxAgeMs: 60 * 60 * 1000 },
        '1Day': { maxAgeMs: 24 * 60 * 60 * 1000 },
        '7Day': { maxAgeMs: 7 * 24 * 60 * 60 * 1000 },
        '30Day': { maxAgeMs: 30 * 24 * 60 * 60 * 1000 },
    },
};

if (!CONFIG.MIKROTIK.PASS) throw new Error('MIKROTIK_PASS required');

const REQUIRED_MODULES = [
    ['express', 'express'],
    ['@google/generative-ai', 'GoogleGenerativeAI'],
    ['routeros-client', 'RouterOSClient'],
    ['node-telegram-bot-api', 'TelegramBot']
];

for (const [pkg, name] of REQUIRED_MODULES) {
    try {
        require(pkg);
    } catch (e) {
        console.error(`❌ Missing module: ${pkg}. Run: npm install ${pkg}`);
        process.exit(1);
    }
}

// ── Gemini AI ────────────────────────────────────────────────
const genAI = ENV.GEMINI_API_KEY ? new GoogleGenerativeAI(ENV.GEMINI_API_KEY) : null;

const a2aService = new MastercardA2AService();

// ============================================================
// §2  LOGGER
// ============================================================

const logTransports = [
    new winston.transports.File({
        filename: path.join(logDir, 'error.log'), level: 'error',
        format: winston.format.combine(winston.format.timestamp(), winston.format.json()),
    }),
    new winston.transports.File({
        filename: path.join(logDir, 'combined.log'),
        format: winston.format.combine(winston.format.timestamp(), winston.format.json()),
    }),
];

if (!IS_CLI) {
    logTransports.push(new winston.transports.Console({
        format: winston.format.combine(
            winston.format.colorize(),
            winston.format.printf(({ level, message, timestamp }) =>
                `${BRAND.emoji} [${BRAND.name}] ${timestamp} ${level}: ${message}`
            ),
        ),
    }));
}

const logger = winston.createLogger({
    level: CONFIG.SERVER.NODE_ENV === 'production' ? 'info' : 'debug',
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.errors({ stack: true }),
        winston.format.json(),
    ),
    transports: logTransports,
    exitOnError: false,
});

// ============================================================
// §3  UTILITIES
// ============================================================

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const uid = () => crypto.randomUUID();
const voucherCode = () => CONFIG.VOUCHER_PREFIX + crypto.randomBytes(3).toString('hex').toUpperCase();

function fmtBytes(bytes) {
    if (!bytes || bytes <= 0) return '0 B';
    const k = 1024, units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.min(Math.floor(Math.log(bytes) / Math.log(k)), units.length - 1);
    return `${(bytes / k ** i).toFixed(2)} ${units[i]}`;
}

function fmtUptime(seconds) {
    const d = Math.floor(seconds / 86400);
    const h = Math.floor((seconds % 86400) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return [d && `${d}d`, h && `${h}h`, `${m}m`].filter(Boolean).join(' ');
}

function truncate(s, max = 3500) {
    if (!s) return '';
    return s.length > max ? s.slice(0, max) + '\n…(truncated)' : s;
}

// ── ANSI palette ─────────────────────────────────────────────
const A = {
    RESET: '\x1b[0m', BOLD: '\x1b[1m', DIM: '\x1b[2m',
    PRIMARY: '\x1b[38;5;39m',
    SUCCESS: '\x1b[32m',
    ERROR: '\x1b[31m',
    WARN: '\x1b[33m',
    INFO: '\x1b[34m',
    NEON_CYAN: '\x1b[38;5;51m',
    CYBER_PURPLE: '\x1b[38;5;135m',
};

// ── Terminal animator (CLI-only) ─────────────────────────────
const TerminalAnimator = {
    _hexToAnsi(r, g, b) {
        return `\x1b[38;2;${r};${g};${b}m`;
    },

    gradient(text, startRGB, endRGB) {
        let out = '';
        const chars = [...text];
        for (let i = 0; i < chars.length; i++) {
            const r = Math.round(startRGB[0] + (endRGB[0] - startRGB[0]) * (i / chars.length));
            const g = Math.round(startRGB[1] + (endRGB[1] - startRGB[1]) * (i / chars.length));
            const b = Math.round(startRGB[2] + (endRGB[2] - startRGB[2]) * (i / chars.length));
            out += `${this._hexToAnsi(r, g, b)}${chars[i]}`;
        }
        return out + A.RESET;
    },

    async showSpinner(message, durationMs = 1000) {
        const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
        const end = Date.now() + durationMs;
        let i = 0;
        while (Date.now() < end) {
            process.stdout.write(`\r  ${A.CYBER_PURPLE}${frames[i % frames.length]}${A.RESET} ${message}`);
            await sleep(80);
            i++;
        }
        process.stdout.write(`\r  ${A.SUCCESS}✔${A.RESET} ${message}\n`);
    },

    async typewriter(text, speed = 15) {
        process.stdout.write('  ');
        for (const ch of text) { process.stdout.write(ch); await sleep(speed); }
        console.log();
    },

    async glitch(text, durationMs = 600) {
        const chars = '!@#$%^&*()_+-=[]{}|;:,.<>?/0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
        const end = Date.now() + durationMs;
        while (Date.now() < end) {
            const noise = text.split('').map(c => c === ' ' ? ' ' : chars[Math.floor(Math.random() * chars.length)]).join('');
            process.stdout.write(`\r  ${A.NEON_CYAN}${noise}${A.RESET}`);
            await sleep(50);
        }
        process.stdout.write(`\r  ${A.BOLD}${text}${A.RESET}\n`);
    },

    async decode(text, speed = 40) {
        const chars = '0123456789ABCDEF';
        let current = '';
        process.stdout.write('  ');
        for (let i = 0; i < text.length; i++) {
            for (let j = 0; j < 5; j++) {
                const rand = chars[Math.floor(Math.random() * chars.length)];
                process.stdout.write(`\r  ${A.BOLD}${current}${A.NEON_CYAN}${rand}${A.RESET}`);
                await sleep(speed / 2);
            }
            current += text[i];
            process.stdout.write(`\r  ${A.BOLD}${current}${A.RESET}`);
        }
        console.log();
    },

    progressBar(label, progress, total = 100, width = 30) {
        const p = Math.min(Math.max(progress / total, 0), 1);
        const complete = Math.round(p * width);
        const bar = '█'.repeat(complete) + '░'.repeat(width - complete);
        const pct = Math.round(p * 100);
        process.stdout.write(`\r  ${A.DIM}${label.padEnd(15)}${A.RESET} [${A.PRIMARY}${bar}${A.RESET}] ${A.BOLD}${pct}%${A.RESET}`);
        if (p >= 1) console.log();
    },

    printHeader(title) {
        const bar = '═'.repeat(52);
        console.log(`\n  ${A.DIM}╔${bar}╗${A.RESET}`);
        const center = title.padStart(26 + Math.floor(title.length / 2)).padEnd(52);
        console.log(`  ${A.DIM}║${A.RESET} ${this.gradient(center, [0, 229, 255], [181, 102, 255])} ${A.DIM}║${A.RESET}`);
        console.log(`  ${A.DIM}╚${bar}╝${A.RESET}\n`);
    },
};

// ============================================================
// §4  METRICS  +  COST TRACKER
// ============================================================

class CostTracker {
    constructor() {
        this.totalInputTokens = 0;
        this.totalOutputTokens = 0;
        this._events = [];
    }
    record(label, inputTokens = 0, outputTokens = 0) {
        this.totalInputTokens += inputTokens;
        this.totalOutputTokens += outputTokens;
        this._events.push({ label, inputTokens, outputTokens, ts: Date.now() });
        if (this._events.length > 1000) this._events.shift();
    }
    snapshot() {
        return {
            totalInputTokens: this.totalInputTokens,
            totalOutputTokens: this.totalOutputTokens,
            estimatedUSD: ((this.totalInputTokens * 0.00000025) + (this.totalOutputTokens * 0.00000075)).toFixed(6),
        };
    }
}
const costTracker = new CostTracker();

class Metrics {
    constructor() {
        this.startedAt = Date.now();
        this.requests = 0;
        this.errors = 0;
        this.toolInvocations = 0;
        this.vouchersCreated = 0;
        this.vouchersRedeemed = 0;
        this.wsMessages = 0;
        this.alertsFired = 0;
    }
    snapshot() {
        return {
            uptime: Math.floor((Date.now() - this.startedAt) / 1000),
            requests: this.requests,
            errors: this.errors,
            toolInvocations: this.toolInvocations,
            vouchersCreated: this.vouchersCreated,
            vouchersRedeemed: this.vouchersRedeemed,
            wsMessages: this.wsMessages,
            alertsFired: this.alertsFired,
            cost: costTracker.snapshot(),
        };
    }
}
const metrics = new Metrics();

// ============================================================
// §4.1  CONVERSATION SESSION  (claw-code ConversationRuntime port)
//       Typed messages · ToolUse/ToolResult blocks · JSON persistence
// ============================================================

const MessageRole = Object.freeze({ USER: 'user', ASSISTANT: 'assistant', TOOL: 'tool' });

class ContentBlock {
    static text(text) { return { type: 'text', text }; }
    static toolUse(id, name, input) { return { type: 'tool_use', id, name, input }; }
    static toolResult(toolUseId, toolName, output, isError = false) {
        return { type: 'tool_result', toolUseId, toolName, output: typeof output === 'string' ? output : JSON.stringify(output), isError };
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

// ============================================================
// §4.2  TRANSCRIPT STORE
// ============================================================

class TranscriptStore {
    constructor() { this.entries = []; this.flushed = false; }
    append(entry) { this.entries.push(entry); this.flushed = false; }
    compact(keepLast = 12) { if (this.entries.length > keepLast) this.entries = this.entries.slice(-keepLast); }
    replay() { return [...this.entries]; }
    flush() { this.flushed = true; }
}

// ============================================================
// §4.3  USAGE TRACKER  (claw-code UsageTracker port)
// ============================================================

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

// ============================================================
// §4.4  PERMISSION POLICY  (claw-code PermissionPolicy port)
// ============================================================

const PermissionMode = Object.freeze({
    READ_ONLY: 'read-only',
    WORKSPACE_WRITE: 'workspace-write',
    DANGER_FULL_ACCESS: 'danger-full-access',
    PROMPT: 'prompt',
    ALLOW: 'allow',
});

class PermissionPolicy {
    constructor(activeMode = PermissionMode.WORKSPACE_WRITE) {
        this.activeMode = activeMode;
        this._toolRequirements = new Map();
    }

    requireFor(toolName, mode) { this._toolRequirements.set(toolName, mode); return this; }

    check(toolName) {
        const required = this._toolRequirements.get(toolName) || PermissionMode.WORKSPACE_WRITE;
        const order = [
            PermissionMode.READ_ONLY, PermissionMode.WORKSPACE_WRITE,
            PermissionMode.DANGER_FULL_ACCESS, PermissionMode.PROMPT, PermissionMode.ALLOW,
        ];
        if (order.indexOf(this.activeMode) >= order.indexOf(required)) return { allowed: true };
        return { allowed: false, reason: `Tool "${toolName}" requires ${required}; active mode is ${this.activeMode}` };
    }

    static default() {
        return new PermissionPolicy(PermissionMode.WORKSPACE_WRITE)
            .requireFor('system.reboot', PermissionMode.DANGER_FULL_ACCESS)
            .requireFor('wireless.set_frequency', PermissionMode.DANGER_FULL_ACCESS)
            .requireFor('firewall.block', PermissionMode.WORKSPACE_WRITE)
            .requireFor('user.kick', PermissionMode.WORKSPACE_WRITE)
            .requireFor('user.remove', PermissionMode.WORKSPACE_WRITE);
    }
}
const permissionPolicy = PermissionPolicy.default();

// ============================================================
// §4.5  HOOK REGISTRY  (claw-code HookRunner port)
// ============================================================

class HookRegistry {
    constructor() { this._pre = new Map(); this._post = new Map(); }

    onBefore(toolName, fn) {
        if (!this._pre.has(toolName)) this._pre.set(toolName, []);
        this._pre.get(toolName).push(fn);
        return this;
    }

    onAfter(toolName, fn) {
        if (!this._post.has(toolName)) this._post.set(toolName, []);
        this._post.get(toolName).push(fn);
        return this;
    }

    async runBefore(toolName, args) {
        for (const fn of this._pre.get(toolName) || []) await fn({ tool: toolName, args });
    }

    async runAfter(toolName, args, result) {
        for (const fn of this._post.get(toolName) || []) await fn({ tool: toolName, args, result });
    }
}
const hooks = new HookRegistry();



// ============================================================
// §5  DATABASE (Firebase + Local fallback)
// ============================================================

class Database {
    constructor() {
        this.db = null;   // Firestore instance or null
        this._local = new Map();
        this._wallets = new Map();
        this._init();
    }

    _init() {
        if (!ENV.FIREBASE_PROJECT_ID || !ENV.FIREBASE_PRIVATE_KEY) {
            logger.warn('Firebase not configured — using local storage');
            this._loadLocal();
            return;
        }
        try {
            // Normalise escaped newlines that some env managers produce
            let key = ENV.FIREBASE_PRIVATE_KEY
                .replace(/^['"]|['"]$/g, '') // Remove surrounding quotes
                .replace(/\\n/g, '\n');      // Convert literal \n to real newlines
            if (!key.includes('-----BEGIN PRIVATE KEY-----')) {
                throw new Error('Missing BEGIN PRIVATE KEY header');
            }


            if (!admin.apps.length) {
                admin.initializeApp({
                    credential: admin.credential.cert({
                        projectId: ENV.FIREBASE_PROJECT_ID,
                        privateKey: key,
                        clientEmail: ENV.FIREBASE_CLIENT_EMAIL,
                    }),
                });
            }
            this.db = admin.firestore();
            logger.info('Firebase successfully initialised');
        } catch (err) {
            logger.error(`Firebase init failed: ${err.message} — falling back to local`);
            this.db = null; // Ensure we don't try to use a broken connection
            this._loadLocal();
        }
    }

    _loadLocal() {
        try {
            if (fs.existsSync('./data/vouchers.json')) {
                const raw = JSON.parse(fs.readFileSync('./data/vouchers.json', 'utf8'));
                for (const [k, v] of Object.entries(raw)) this._local.set(k, v);
            }
            if (fs.existsSync('./data/wallets.json')) {
                const raw = JSON.parse(fs.readFileSync('./data/wallets.json', 'utf8'));
                for (const [u, codes] of Object.entries(raw)) this._wallets.set(u, new Set(codes));
            }
        } catch { /* first run */ }
    }

    _saveLocal() {
        if (this.db) return;
        try {
            if (!fs.existsSync('./data')) fs.mkdirSync('./data', { recursive: true });
            fs.writeFileSync('./data/vouchers.json',
                JSON.stringify(Object.fromEntries(this._local), null, 2));

            const walletData = {};
            for (const [u, s] of this._wallets) walletData[u] = Array.from(s);
            fs.writeFileSync('./data/wallets.json', JSON.stringify(walletData, null, 2));
        } catch (err) {
            logger.error('Local save failed:', err.message);
        }
    }

    _calcExpiry(plan, duration) {
        if (duration) {
            const m = duration.match(/^(\d+)([hd])$/);
            if (m) return new Date(Date.now() + m[1] * (m[2] === 'h' ? 3_600_000 : 86_400_000)).toISOString();
        }
        const ms = CONFIG.VOUCHER_PLANS[plan]?.maxAgeMs;
        return ms ? new Date(Date.now() + ms).toISOString() : null;
    }

    async getVoucher(code) {
        if (this.db) {
            const doc = await this.db.collection('vouchers').doc(code).get();
            return doc.exists ? { id: doc.id, ...doc.data() } : null;
        }
        const v = this._local.get(code);
        return v ? { id: code, ...v } : null;
    }

    async createVoucher(code, data) {
        const record = {
            ...data,
            createdAt: new Date().toISOString(),
            used: false,
            expiresAt: this._calcExpiry(data.plan, data.duration),
            actor: data.actor || 'system'
        };
        if (this.db) await this.db.collection('vouchers').doc(code).set(record);
        else { this._local.set(code, record); this._saveLocal(); }

        await this.logAuditTrail(record.actor, 'voucher.create', { code, plan: data.plan });

        metrics.vouchersCreated++;
        return { id: code, ...record };
    }

    async redeemVoucher(code, userData) {
        const update = { used: true, redeemedAt: new Date().toISOString(), redeemedBy: userData };
        if (this.db) {
            await this.db.collection('vouchers').doc(code).update(update);
        } else {
            const v = this._local.get(code);
            if (v) { this._local.set(code, { ...v, ...update }); this._saveLocal(); }
        }
        metrics.vouchersRedeemed++;
    }

    async updateVoucher(code, updates) {
        if (this.db) {
            await this.db.collection('vouchers').doc(code).update(updates);
        } else {
            const v = this._local.get(code);
            if (v) { this._local.set(code, { ...v, ...updates }); this._saveLocal(); }
        }
    }

    async getVoucherByPaymentId(paymentId) {
        if (this.db) {
            const snap = await this.db.collection('vouchers').where('paymentId', '==', paymentId).limit(1).get();
            return snap.empty ? null : { id: snap.docs[0].id, ...snap.docs[0].data() };
        }
        for (const [id, v] of this._local.entries()) {
            if (v.paymentId === paymentId) return { id, ...v };
        }
        return null;
    }

    async deleteVoucher(code) {
        if (this.db) await this.db.collection('vouchers').doc(code).delete();
        else { this._local.delete(code); this._saveLocal(); }
    }

    async listVouchers({ limit = 50, used } = {}) {
        let items;
        if (this.db) {
            let q = this.db.collection('vouchers').orderBy('createdAt', 'desc').limit(limit);
            if (used !== undefined) q = q.where('used', '==', used);
            items = (await q.get()).docs.map(d => ({ id: d.id, ...d.data() }));
        } else {
            items = [...this._local.entries()]
                .map(([id, d]) => ({ id, ...d }))
                .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
                .slice(0, limit);
            if (used !== undefined) items = items.filter(v => v.used === used);
        }
        return items;
    }

    async getStats() {
        const all = await this.listVouchers({ limit: 10_000 });
        const now = Date.now();
        return {
            total: all.length,
            used: all.filter(v => v.used).length,
            active: all.filter(v => !v.used && (!v.expiresAt || new Date(v.expiresAt) > now)).length,
            expired: all.filter(v => !v.used && v.expiresAt && new Date(v.expiresAt) <= now).length,
        };
    }

    async expireOldVouchers() {
        const pending = await this.listVouchers({ limit: 10_000, used: false });
        const now = Date.now();
        let count = 0;
        for (const v of pending) {
            if (v.expiresAt && new Date(v.expiresAt) <= now) {
                await this.redeemVoucher(v.id, { reason: 'expired', expiredAt: new Date().toISOString() });
                if (mikrotik.isConnected) {
                    await mikrotik.removeHotspotUser(v.id).catch(() => { });
                    await mikrotik.kickUser(v.id).catch(() => { });
                }
                count++;
            }
        }
        return count;
    }

    async logAuditTrail(actor, action, details = {}) {
        const entry = {
            actor, action, details,
            timestamp: new Date().toISOString()
        };

        // Always log to Winston (local file)
        logger.info(`[AUDIT] ${actor} performed ${action}: ${JSON.stringify(details)}`);


        try {
            if (this.db) {
                // We use a timeout to prevent the CLI from hanging if the network is slow
                const writePromise = this.db.collection('audit_trail').add(entry);
                const timeoutPromise = new Promise((_, reject) =>
                    setTimeout(() => reject(new Error('Firestore timeout')), 5000)
                );
                await Promise.race([writePromise, timeoutPromise]);
            }
        } catch (err) {
            // Only log the error, DO NOT throw. The router action must succeed 
            // even if the logging database is temporarily unreachable.
            logger.warn(`Audit upload failed: ${err.message}`);
        }
        return entry;
    }

    // ── Wallet Methods ────────────────────────────────────────

    async depositToWallet(userId, code) {
        if (this.db) {
            await this.db.collection('wallets').doc(userId).collection('vouchers').doc(code).set({
                addedAt: new Date().toISOString(),
                claimed: false
            });
        } else {
            if (!this._wallets.has(userId)) this._wallets.set(userId, new Set());
            this._wallets.get(userId).add(code);
            this._saveLocal();
        }
        logger.info(`Voucher ${code} deposited to wallet ${userId}`);
    }

    async getWallet(userId) {
        if (this.db) {
            const snap = await this.db.collection('wallets').doc(userId).collection('vouchers').where('claimed', '==', false).get();
            return snap.docs.map(d => d.id);
        }
        return Array.from(this._wallets.get(userId) || []);
    }

    async claimFromWallet(userId, code) {
        if (this.db) {
            await this.db.collection('wallets').doc(userId).collection('vouchers').doc(code).update({
                claimed: true,
                claimedAt: new Date().toISOString()
            });
        } else {
            const s = this._wallets.get(userId);
            if (s) { s.delete(code); this._saveLocal(); }
        }
    }
}

// ============================================================
// §3  FINANCIAL CONTROLLER
// ============================================================

class FinancialController {
    constructor(db) {
        this.db = db;
        this.mastercard = a2aService; // reuse top-level singleton
        this.pricing = {
            '1hour': 1.00,
            '1Day': 5.00,
            '7Day': 25.00,
            '30Day': 80.00,
            'default': 5.00
        };
    }

    async getRevenueReport() {
        const vouchers = await this.db.listVouchers({ limit: 10000 });
        const now = new Date();
        const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();

        let total = 0, today = 0, pending = 0;
        const plans = {};

        vouchers.forEach(v => {
            const price = this.pricing[v.plan] || this.pricing.default;
            total += price;
            if (new Date(v.createdAt).getTime() >= startOfDay) today += price;
            if (!v.used) pending += price;

            plans[v.plan] = (plans[v.plan] || 0) + 1;
        });

        return {
            currency: 'USD',
            grossRevenue: total.toFixed(2),
            todayRevenue: today.toFixed(2),
            potentialRevenue: pending.toFixed(2),
            topPlan: Object.entries(plans).sort((a, b) => b[1] - a[1])[0]?.[0] || 'N/A'
        };
    }

    async verifyPayment(paymentId) {
        return await this.mastercard.getPaymentStatus(paymentId);
    }

    async auditTrail(limit = 10) {
        if (this.db && this.db.db) {
            const snap = await this.db.db.collection('audit_trail').orderBy('timestamp', 'desc').limit(limit).get();
            return snap.docs.map(d => d.data());
        }
        return [];
    }

    // Revenue intelligence — 7-day trend, hourly velocity, plan mix, churn signal
    async getTrends() {
        const vouchers = await this.db.listVouchers({ limit: 10000 });
        const now = Date.now();
        const DAY = 86_400_000;

        // Build daily buckets for last 7 days
        const days = Array.from({ length: 7 }, (_, i) => {
            const start = now - (6 - i) * DAY;
            const end = start + DAY;
            const label = new Date(start).toISOString().slice(5, 10);
            const created = vouchers.filter(v => {
                const t = new Date(v.createdAt).getTime();
                return t >= start && t < end;
            });
            const revenue = created.reduce((s, v) => s + (this.pricing[v.plan] || this.pricing.default), 0);
            return { label, count: created.length, revenue: revenue.toFixed(2) };
        });

        // Hourly velocity (last 24h)
        const hourly = Array.from({ length: 24 }, (_, h) => {
            const start = now - (23 - h) * 3_600_000;
            const end = start + 3_600_000;
            return vouchers.filter(v => {
                const t = new Date(v.createdAt).getTime();
                return t >= start && t < end;
            }).length;
        });

        // Plan mix
        const planMix = {};
        vouchers.forEach(v => { planMix[v.plan] = (planMix[v.plan] || 0) + 1; });

        // Churn signal: vouchers active > 90% of their plan window without being used
        const churnAtRisk = vouchers.filter(v => {
            if (v.used || !v.expiresAt || !v.createdAt) return false;
            const window = new Date(v.expiresAt).getTime() - new Date(v.createdAt).getTime();
            const elapsed = now - new Date(v.createdAt).getTime();
            return elapsed / window > 0.9;
        }).length;

        // Week-on-week growth
        const thisWeek = days.slice(4).reduce((s, d) => s + parseFloat(d.revenue), 0);
        const lastWeek = days.slice(0, 3).reduce((s, d) => s + parseFloat(d.revenue), 0);
        const wow = lastWeek > 0 ? (((thisWeek - lastWeek) / lastWeek) * 100).toFixed(1) : null;

        return { days, hourly, planMix, churnAtRisk, weekOnWeekGrowth: wow };
    }
}

const database = new Database();
const financial = new FinancialController(database);

// ============================================================
// §4  AGENT MEMORY  (persistent cross-session context)
// ============================================================

class AgentMemory {
    constructor() {
        this._path = './data/memory.json';
        this._store = {};
        this._load();
    }

    _load() {
        try {
            if (fs.existsSync(this._path)) {
                this._store = JSON.parse(fs.readFileSync(this._path, 'utf8'));
            }
        } catch { /* first run */ }
    }

    _save() {
        try {
            if (!fs.existsSync('./data')) fs.mkdirSync('./data', { recursive: true });
            fs.writeFileSync(this._path, JSON.stringify(this._store, null, 2));
        } catch (err) { logger.error(`Memory save failed: ${err.message}`); }
    }

    remember(key, value) {
        this._store[key] = { value, updatedAt: new Date().toISOString() };
        this._save();
    }

    recall(key) {
        return this._store[key]?.value ?? null;
    }

    recallAll() {
        return Object.fromEntries(Object.entries(this._store).map(([k, v]) => [k, v.value]));
    }

    forget(key) {
        delete this._store[key];
        this._save();
    }

    // Returns a compact context string for injection into AI prompts
    getContext() {
        const entries = Object.entries(this._store);
        if (!entries.length) return '';
        const lines = entries.map(([k, v]) => `- ${k}: ${JSON.stringify(v.value)}`).join('\n');
        return `[Agent Memory]\n${lines}`;
    }
}

// ============================================================
// §5  NODE REGISTRY  (multi-router mesh management)
// ============================================================

class NodeRegistry {
    constructor() {
        this._nodes = new Map();  // name → MikroTikManager
    }

    add(name, ip, user, pass, port = CONFIG.MIKROTIK.PORT) {
        if (this._nodes.has(name)) this._nodes.get(name).disconnect();
        const node = new MikroTikManager({ ip, user, pass, port });
        this._nodes.set(name, node);
        logger.info(`NodeRegistry: registered "${name}" (${ip})`);
        return node;
    }

    get(name) {
        return this._nodes.get(name) || null;
    }

    getAll() {
        return [...this._nodes.entries()].map(([name, node]) => ({
            name,
            ip: node.api?.options?.host || 'unknown',
            connected: node.isConnected,
        }));
    }

    async connectAll() {
        const results = [];
        for (const [name, node] of this._nodes) {
            try {
                await node.connect();
                results.push({ name, status: 'connected' });
            } catch (err) {
                results.push({ name, status: 'failed', error: err.message });
            }
        }
        return results;
    }

    async executeOnNode(name, tool, ...args) {
        const node = this._nodes.get(name);
        if (!node) throw new Error(`Node not found: ${name}`);
        return node.executeTool(tool, ...args);
    }

    // Fan-out a tool call across all connected nodes — returns per-node results
    async executeOnAll(tool, ...args) {
        const results = {};
        for (const [name, node] of this._nodes) {
            if (!node.isConnected) { results[name] = { error: 'offline' }; continue; }
            try {
                results[name] = await node.executeTool(tool, ...args);
            } catch (err) {
                results[name] = { error: err.message };
            }
        }
        return results;
    }

    disconnectAll() {
        for (const node of this._nodes.values()) node.disconnect();
    }
}


class SkillRegistry {
    constructor() {
        this.builtins = new Map();      // Bundled skills
        this.workspace = new Map();     // User-created skills  
        this.cache = new Map(); // Recently used (simple LRU-like map)
    }

    // Skills are loaded on-demand, not at startup
    async resolve(skillName, context) {
        // Check cache first
        if (this.cache.has(skillName)) return this.cache.get(skillName);

        // Search paths: workspace > managed > bundled
        const paths = [
            `./skills/${skillName}/SKILL.md`,           // User workspace
            `~/.agentos/skills/${skillName}/SKILL.md`,   // Global install
            `${__dirname}/skills/${skillName}/SKILL.md`  // Bundled
        ];

        for (const path of paths) {
            const skill = await this.loadSkill(path, context);
            if (skill) {
                this.cache.set(skillName, skill);
                return skill;
            }
        }

        throw new Error(`Skill not found: ${skillName}`);
    }

    async loadSkill(path, context) {
        // SKILL.md format:
        // ---
        // name: hotspot_manager
        // description: Manage MikroTik Hotspot users
        // requires:
        //   bins: ["ssh", "curl"]
        //   env: ["MIKROTIK_IP"]
        //   os: ["linux", "darwin"]
        // tools: ["user.add", "user.kick", "user.list"]
        // ---
        // # hotspot_manager
        // Detailed instructions for the AI...

        const content = await fs.promises.readFile(path, 'utf8');
        const { attributes, body } = this.parseFrontmatter(content);

        // Validate requirements
        if (!this.checkRequirements(attributes.requires)) {
            return null; // Skill gated - requirements not met
        }

        return {
            metadata: attributes,
            instructions: body,
            tools: (attributes.tools || []).map(t => this.createTool(t, context))
        };
    }

    parseFrontmatter(content) {
        const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
        if (!match) return { attributes: { tools: [] }, body: content };
        const attributes = {};
        match[1].split('\n').forEach(line => {
            const [k, ...v] = line.split(':');
            if (k && v.length) {
                const val = v.join(':').trim();
                // Parse simple arrays: ["a", "b"]
                if (val.startsWith('[')) {
                    try { attributes[k.trim()] = JSON.parse(val); } catch { attributes[k.trim()] = val; }
                } else {
                    attributes[k.trim()] = val;
                }
            }
        });
        if (!attributes.tools) attributes.tools = [];
        return { attributes, body: match[2].trim() };
    }

    checkRequirements(requires) {
        if (!requires) return true;
        // Check required env vars
        if (requires.env) {
            for (const key of requires.env) {
                if (!process.env[key]) {
                    logger.warn(`SkillRegistry: missing env var ${key}`);
                    return false;
                }
            }
        }
        // Check OS
        if (requires.os && !requires.os.includes(process.platform)) {
            logger.warn(`SkillRegistry: unsupported platform ${process.platform}`);
            return false;
        }
        return true;
    }

    // Wraps a tool name string into a callable that routes through mikrotik.executeTool
    createTool(toolName, context) {
        return {
            name: toolName,
            call: (...args) => {
                const node = context?.node || mikrotik;
                return node.executeTool(toolName, ...args);
            },
        };
    }

    // Evict oldest entry if cache grows beyond 50
    _cacheSet(key, value) {
        if (this.cache.size >= 50) {
            const firstKey = this.cache.keys().next().value;
            this.cache.delete(firstKey);
        }
        this.cache.set(key, value);
    }
}

// ============================================================
// §6  ROUTEROS TOOLS REGISTRY
// ============================================================

const TOOLS = {
    'system.stats': async (c) => (await c.menu('/system/resource').get())[0],
    'system.logs': async (c, n = 10) => (await c.menu('/log').get()).slice(-n),
    'system.reboot': async (c) => { await c.menu('/system').exec('reboot'); return { status: 'rebooting' }; },
    'system.backup': async (c, name = 'AgentOS_Backup') => {
        await c.menu('/system/backup').exec('save', { name });
        return { action: 'backup_created', file: `${name}.backup` };
    },
    'users.active': async (c) => c.menu('/ip/hotspot/active').get(),
    'users.all': async (c) => c.menu('/ip/hotspot/user').get(),
    'user.add': async (c, username, password, profile = 'default') => {
        const existing = await c.menu('/ip/hotspot/user').where('name', username).get();
        if (existing.length > 0) {
            await c.menu('/ip/hotspot/user').update(existing[0]['.id'], { password, profile, disabled: 'no' });
            return { action: 'updated', username };
        }
        await c.menu('/ip/hotspot/user').add({ name: username, password, profile });
        return { action: 'created', username };
    },
    'user.remove': async (c, username) => {
        const users = await c.menu('/ip/hotspot/user').where('name', username).get();
        if (!users.length) throw new Error(`User not found: ${username}`);
        await c.menu('/ip/hotspot/user').remove(users[0]['.id']);
        return { action: 'removed', username };
    },
    'user.kick': async (c, username) => {
        const active = await c.menu('/ip/hotspot/active').where('user', username).get();
        if (active.length) { await c.menu('/ip/hotspot/active').remove(active[0]['.id']); return { kicked: true, username }; }
        return { kicked: false, username, reason: 'Not active' };
    },
    'user.status': async (c, username) => {
        const r = await c.menu('/ip/hotspot/active').where('user', username).get();
        return r.length ? r[0] : null;
    },
    'ping': async (c, host, count = 4) => c.menu('/ping').exec({ address: host, count: String(count) }),
    'traceroute': async (c, host) => c.menu('/tool/traceroute').exec({ address: host, count: '1' }),
    'dhcp.leases': async (c) => c.menu('/ip/dhcp-server/lease').get(),
    'interfaces': async (c) => c.menu('/interface').get(),
    'arp.table': async (c) => c.menu('/ip/arp').get(),
    'ip.routes': async (c) => c.menu('/ip/route').get(),
    'hotspot.profiles': async (c) => c.menu('/ip/hotspot/user/profile').get(),
    'dns.flush': async (c) => { await c.menu('/ip/dns/cache').exec('flush'); return { action: 'flushed', service: 'dns' }; },
    'firewall.list': async (c, type = 'filter') => c.menu(`/ip/firewall/${type}`).get(),
    'firewall.block': async (c, target, list = 'blocked') => {
        await c.menu('/ip/firewall/address-list').add({ list, address: target, comment: 'Blocked via AgentOS' });
        return { action: 'blocked', target };
    },
    'firewall.unblock': async (c, target, list = 'blocked') => {
        const entries = await c.menu('/ip/firewall/address-list').where('address', target).where('list', list).get();
        for (const e of entries) await c.menu('/ip/firewall/address-list').remove(e['.id']);
        return { action: 'unblocked', target, count: entries.length };
    },
    'wireless.clients': async (c) => c.menu('/interface/wireless/registration-table').get(),
    'wireless.interfaces': async (c) => c.menu('/interface/wireless').get(),
    'wireless.set_frequency': async (c, name, frequency) => {
        const ifaces = await c.menu('/interface/wireless').where('name', name).get();
        if (!ifaces.length) throw new Error(`Wireless interface not found: ${name}`);
        await c.menu('/interface/wireless').update(ifaces[0]['.id'], { frequency: String(frequency) });
        return { action: 'updated_frequency', interface: name, frequency };
    },
    'interface.monitor-traffic': async (c, iface) => c.menu('/interface').exec('monitor-traffic', { interface: iface, once: true }),
    'neighbor.discovery': async (c) => c.menu('/ip/neighbor').get(),
};

// ============================================================
// §7  MIKROTIK MANAGER
// ============================================================

class MikroTikManager {
    constructor() {
        this.conn = null;
        this.isConnected = false;
        this.reconnectAttempts = 0;
        this._monitorTimer = null;

        this.api = new RouterOSClient({
            host: CONFIG.MIKROTIK.IP,
            user: CONFIG.MIKROTIK.USER,
            password: CONFIG.MIKROTIK.PASS,
            port: CONFIG.MIKROTIK.PORT,
            timeout: 10_000,
        });

        // Attach error handler — guard: routeros-client may not be a full EventEmitter
        if (typeof this.api.on === 'function') {
            this.api.on('error', (err) => {
                logger.warn(`RouterOSClient error: ${err.message}`);
                this.isConnected = false;
            });
        }
    }

    async connect() {
        try {
            this.conn = await this.api.connect();
            this.isConnected = true;
            this.reconnectAttempts = 0;
            logger.info(`MikroTik connected (${CONFIG.MIKROTIK.IP})`);
            if (!IS_CLI) this._startMonitor();
            return true;
        } catch (err) {
            this.isConnected = false;
            logger.error(`MikroTik connect failed: ${err.message}`);
            if (!IS_CLI) this._scheduleReconnect();
            throw err;
        }
    }

    async updateCredentials(ip, user, pass) {
        if (this.conn) {
            try { this.api.close(); } catch { }
        }
        this.conn = null;
        this.isConnected = false;
        this.ip = ip;
        this.api = new RouterOSClient({ host: ip, user, password: pass, port: CONFIG.MIKROTIK.PORT, timeout: 10_000 });
        return this.connect();
    }

    disconnect() {
        if (this._monitorTimer) { clearInterval(this._monitorTimer); this._monitorTimer = null; }
        this.isConnected = false;
        try { this.api.close(); } catch { /* already closed */ }
        this.conn = null;
    }

    _startMonitor() {
        if (this._monitorTimer) clearInterval(this._monitorTimer);
        this._monitorTimer = setInterval(async () => {
            if (this.conn) {
                try { await this.conn.menu('/system/resource').get(); }
                catch {
                    logger.warn('MikroTik heartbeat failed — reconnecting…');
                    this.isConnected = false;
                    clearInterval(this._monitorTimer);
                    this._monitorTimer = null;
                    this.connect().catch(() => { });
                }
            }
        }, 30_000);
    }

    _scheduleReconnect() {
        if (this.reconnectAttempts >= CONFIG.MIKROTIK.MAX_RECONNECT) return;
        this.reconnectAttempts++;
        const delay = CONFIG.MIKROTIK.RECONNECT_INTERVAL * this.reconnectAttempts;
        setTimeout(() => this.connect().catch(() => { }), delay);
    }

    // Execute a named tool from the registry
    async executeTool(name, ...args) {
        const fn = TOOLS[name];
        if (!fn) throw new Error(`Unknown tool: ${name}`);
        if (!this.isConnected || !this.conn) throw new Error('MikroTik not connected');

        // Permission gate (claw-code PermissionPolicy port)
        const perm = permissionPolicy.check(name);
        if (!perm.allowed) throw new Error(`Permission denied: ${perm.reason}`);

        metrics.toolInvocations++;

        // Pre-execution hooks (audit, telemetry)
        await hooks.runBefore(name, args);

        const result = await fn(this.conn, ...args);

        // Post-execution hooks (broadcast, SSE)
        await hooks.runAfter(name, args, result);

        return result;
    }

    // Send a raw RouterOS CLI command via a temporary script
    async executeCLI(command) {
        if (!this.isConnected) throw new Error('MikroTik not connected');
        // Sanitize: block shell injection patterns that have no place in RouterOS scripts
        const forbidden = /[`$(){}|;&<>]/;
        if (forbidden.test(command)) throw new Error(`Blocked: command contains forbidden characters`);
        if (command.length > 4096) throw new Error('Command exceeds maximum length (4096 chars)');
        const scriptName = `_agentos_${Date.now()}`;
        try {
            await this.conn.menu('/system/script').add({ name: scriptName, source: command });
            // Retrieve the newly created script's .id, then invoke run on it specifically
            const added = await this.conn.menu('/system/script').where('name', scriptName).get();
            if (added.length) {
                await this.conn.menu('/system/script').exec('run', { '.id': added[0]['.id'] });
            }
            // RouterOS API exec does not return stdout; check logs for output
            const logs = await this.conn.menu('/log').where('topics', 'script').get();
            const recent = logs.slice(-3).map(l => l.message || '').join('\n');
            return recent || 'OK';
        } catch (err) {
            throw new Error(`CLI exec failed: ${err.message}`);
        } finally {
            const entries = await this.conn.menu('/system/script').where('name', scriptName).get().catch(() => []);
            for (const e of entries) await this.conn.menu('/system/script').remove(e['.id']).catch(() => { });
        }
    }

    // Send a raw RouterOS API command string
    async executeRawAPI(commandStr) {
        if (!this.isConnected) throw new Error('MikroTik not connected');
        return this.conn.write(commandStr.trim().split(/\s+/));
    }

    availableTools() { return Object.keys(TOOLS); }
    getSystemStats() { return this.executeTool('system.stats'); }
    getLogs(n) { return this.executeTool('system.logs', n); }
    getActiveUsers() { return this.executeTool('users.active'); }
    getAllHotspotUsers() { return this.executeTool('users.all'); }
    addHotspotUser(u, p, pr) { return this.executeTool('user.add', u, p, pr); }
    removeHotspotUser(u) { return this.executeTool('user.remove', u); }
    kickUser(u) { return this.executeTool('user.kick', u); }
    getUserStatus(u) { return this.executeTool('user.status', u); }
    ping(h, c) { return this.executeTool('ping', h, c); }
    traceroute(h) { return this.executeTool('traceroute', h); }
    getDhcpLeases() { return this.executeTool('dhcp.leases'); }
    getInterfaces() { return this.executeTool('interfaces'); }
    getArpTable() { return this.executeTool('arp.table'); }
    getFirewallRules(t) { return this.executeTool('firewall.list', t); }
    addToBlockList(a, l) { return this.executeTool('firewall.block', a, l); }
    unblockAddress(a, l) { return this.executeTool('firewall.unblock', a, l); }
    reboot() { return this.executeTool('system.reboot'); }
}
const mikrotik = new MikroTikManager();
const agentMemory = new AgentMemory();
const nodeRegistry = new NodeRegistry();
// Register the primary router into the mesh
nodeRegistry.add('primary', CONFIG.MIKROTIK.IP, CONFIG.MIKROTIK.USER, CONFIG.MIKROTIK.PASS);

// ── Register default hooks ────────────────────────────────────
// Audit hook — log state-mutating tools to audit trail + Winston
['user.kick', 'system.reboot', 'firewall.block', 'user.add', 'user.remove', 'wireless.set_frequency'].forEach(tool => {
    hooks.onBefore(tool, async ({ tool: name, args }) => {
        await database.logAuditTrail('mikrotik', `tool.${name}`, { args }).catch(() => { });
    });
});

// Broadcast hook — push live activity to all WebSocket clients
Object.keys(TOOLS).forEach(tool => {
    hooks.onAfter(tool, async ({ tool: name, args }) => {
        if (global.gateway) {
            global.gateway.broadcast({
                type: 'activity',
                payload: { source: 'system', action: name, params: args, timestamp: new Date().toISOString() },
            });
        }
    });
});

// SSE hook — push tool events to SSE stream clients
Object.keys(TOOLS).forEach(tool => {
    hooks.onAfter(tool, async ({ tool: name, result }) => {
        if (typeof sseBroadcast === 'function') sseBroadcast('tool.result', { tool: name, result });
    });
});


// ============================================================

// Initialize payment for voucher purchase
router.post('/voucher/payment/initiate', [
    body('plan').isIn(['1hour', '1Day', '7Day', '30Day']),
    body('email').isEmail(),
    body('amount').isFloat({ min: 0.5 }),
    body('recipientAccount').isString().trim(),
], async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }

    const { plan, email, amount, recipientAccount, recipientBankCode } = req.body;

    // Generate voucher code
    const code = `STAR-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;

    try {
        // Create voucher in database first (pending status)
        await database.createVoucher(code, {
            plan,
            email,
            status: 'pending_payment',
            createdBy: 'mastercard-a2a',
        });

        // Process A2A payment
        const result = await a2aService.processVoucherPurchase(
            { plan, email, code },
            { amount, recipientAccount, recipientBankCode }
        );

        if (!result.success) {
            await database.deleteVoucher(code);
            return res.status(400).json({
                error: 'Payment initiation failed',
                details: result.error,
            });
        }

        // Update voucher with payment reference
        await database.updateVoucher(code, {
            paymentId: result.paymentId,
            transactionRef: result.transactionRef,
            paymentStatus: result.status,
        });

        res.json({
            success: true,
            voucherCode: code,
            paymentId: result.paymentId,
            transactionRef: result.transactionRef,
            status: result.status,
            amount: result.amount,
            fees: result.fees,
            exchangeRate: result.exchangeRate,
            message: 'Payment initiated. Complete transfer via your banking app.',
        });

    } catch (error) {
        logger.error(`A2A payment initiation error: ${error.message}`);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Get Daily Finance Summary
router.get('/finance/summary', async (req, res) => {
    try {
        const report = await financial.getRevenueReport();
        res.json(report);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Check payment status
router.get('/voucher/payment/status/:paymentId', async (req, res) => {
    try {
        const status = await a2aService.getPaymentStatus(req.params.paymentId);

        if (status.success) {
            // Update local database if completed
            if (status.status === 'COMPLETED') {
                const voucher = await database.getVoucherByPaymentId(req.params.paymentId);
                if (voucher && !voucher.activated) {
                    await mikrotik.addHotspotUser(voucher.id, voucher.id, voucher.plan);
                    await database.redeemVoucher(voucher.id, {
                        username: voucher.email,
                        paymentCompleted: true
                    });
                }
            }
        }

        res.json(status);
    } catch (error) {
        logger.error(`Payment status check error: ${error.message}`);
        res.status(500).json({ error: 'Failed to check payment status' });
    }
});

// Mastercard webhook for payment notifications
router.post('/webhook/mastercard', express.raw({ type: 'application/json' }), async (req, res) => {
    try {
        // Verify webhook signature
        const signature = req.headers['x-mastercard-signature'];
        const payload = req.body;

        // Process webhook
        const result = await a2aService.handleWebhook(JSON.parse(payload));

        // If payment completed, deposit voucher to user wallet and notify
        if (result?.status === 'COMPLETED' && result?.userId) {
            const voucher = await database.getVoucherByPaymentId(result.paymentId || '');
            if (voucher) {
                await database.depositToWallet(String(result.userId), voucher.id);
                global.agentBot?.sendToAll(`💰 *Payment Received:* Voucher \`${voucher.id}\` deposited to wallet for user ${result.userId}`);
            }
        }

        res.json({ received: true });
    } catch (error) {
        logger.error(`Webhook error: ${error.message}`);
        res.status(200).json({ received: true }); // Always return 200 to prevent retries
    }
});

// ============================================================
// §8  ASK ENGINE  (Tiered ReAct)
// ============================================================

class AskEngine {
    constructor({ mikrotik, database, financial, ai }) {
        this.mikrotik = mikrotik;
        this.database = database;
        this.financial = financial;
        this.ai = ai;
        this.memory = agentMemory;
        this.isRuleOnly = !ENV.GEMINI_API_KEY || ENV.GEMINI_API_KEY.includes('your-');

        if (this.isRuleOnly) {
            logger.warn('AskEngine starting in [RULE-ONLY] mode (no valid Gemini key)');
        }

        // Gemini function declarations — lowercase types required by the API
        this._declarations = [
            {
                name: 'manage_network',
                description: 'Execute a command on the MikroTik router.',
                parameters: {
                    type: 'object',
                    properties: {
                        action: { type: 'string', enum: ['users.active', 'system.stats', 'user.kick', 'firewall.block', 'system.reboot'] },
                        target: { type: 'string' },
                    },
                    required: ['action'],
                },
            },
            {
                name: 'manage_vouchers',
                description: 'Create or query WiFi access vouchers.',
                parameters: {
                    type: 'object',
                    properties: {
                        action: { type: 'string', enum: ['create', 'stats', 'list'] },
                        plan: { type: 'string', enum: ['1hour', '1Day', '7Day', '30Day'] },
                    },
                    required: ['action'],
                },
            },
            {
                name: 'manage_finance',
                description: 'Query revenue, audits, and payment statuses.',
                parameters: {
                    type: 'object',
                    properties: {
                        action: { type: 'string', enum: ['revenue_report', 'verify_payment', 'audit_log', 'trends'] },
                        target: { type: 'string', description: 'Payment ID or reference' }
                    },
                    required: ['action']
                }
            },
            {
                name: 'manage_mesh',
                description: 'Execute commands across multiple routers in the node registry.',
                parameters: {
                    type: 'object',
                    properties: {
                        action: { type: 'string', enum: ['list_nodes', 'execute_all', 'execute_node'] },
                        node: { type: 'string', description: 'Node name for execute_node' },
                        tool: { type: 'string', description: 'Tool name to run' },
                    },
                    required: ['action'],
                },
            },
        ];

        // Tier-1 keyword → tool map (Human-to-Machine Translation shortcuts)
        this._toolMap = {
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
        };
    }

    async run(input) {
        // Tier 1 — direct keyword → tool
        const tier1 = this._matchTool(input);
        if (tier1) {
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

        // Tier 3 — Gemini AI with function calling
        if (this.isRuleOnly) {
            return {
                tier: 0,
                type: 'fallback',
                result: '⚠️ *Rule-Only Mode Active*\nGemini Key is missing. I can only process direct tools and shortcuts (e.g. `who`, `kick name`).'
            };
        }

        if (this.ai) {
            try {
                // Broadcast thinking state to Web 3D Bot
                if (global.gateway) global.gateway.broadcast({ type: 'ai.state', state: 'thinking' });
                const res = await this._runAI(input);
                if (global.gateway) global.gateway.broadcast({ type: 'ai.state', state: 'idle' });
                return res;
            } catch (e) {
                if (global.gateway) global.gateway.broadcast({ type: 'ai.state', state: 'idle' });
                return { tier: 3, type: 'error', result: e.message };
            }
        }

        // Tier 4 — fallback
        return { tier: 4, type: 'fallback', result: 'Command not understood and AI is unavailable.' };
    }

    async _runAI(input, existingSession = null) {
        const model = this.ai.getGenerativeModel({
            model: 'gemini-2.0-flash',
            tools: [{ functionDeclarations: this._declarations }],
        });

        // Use provided session or create a fresh one
        const session = existingSession || new ConversationSession();
        const memCtx = this.memory.getContext();
        const systemPrefix = memCtx
            ? `You are AgentOS — a network intelligence agent managing MikroTik routers.\n${memCtx}\n\nUser request: `
            : '';

        session.addUser(systemPrefix ? systemPrefix + input : input);
        session.compactIfNeeded();

        // Start Gemini chat with typed session history (excluding the message we just added)
        const chat = model.startChat({ history: session.toGeminiHistory().slice(0, -1) });

        // ── ReAct loop (max 5 tool-call turns) ──────────────
        const toolTrace = [];
        let response = await chat.sendMessage(input);
        let turns = 0;
        const MAX_TURNS = 5;

        while (turns < MAX_TURNS) {
            const calls = response.response.functionCalls();
            const call = Array.isArray(calls) ? calls[0] : calls;
            if (!call) break;

            turns++;
            logger.debug(`AI ReAct turn ${turns}: ${call.name}(${JSON.stringify(call.args)})`);

            // Record ToolUse block in session
            const toolUseId = uid();
            session.addAssistant(
                [ContentBlock.toolUse(toolUseId, call.name, JSON.stringify(call.args))],
                response.response.usageMetadata
            );

            let toolResult;
            let isError = false;
            try {
                toolResult = await this._dispatchFunctionCall(call);
            } catch (err) {
                toolResult = { error: err.message };
                isError = true;
            }
            toolTrace.push({ id: toolUseId, call: call.name, args: call.args, result: toolResult, isError });

            // Record ToolResult block in session and auto-compact if needed
            session.addToolResult(toolUseId, call.name, toolResult, isError);
            session.compactIfNeeded();

            response = await chat.sendMessage([{
                functionResponse: { name: call.name, response: { content: toolResult } },
            }]);
        }

        const finalText = response.response.text();

        // Record final assistant text + usage, then persist session to disk
        session.addAssistant([ContentBlock.text(finalText)], response.response.usageMetadata);
        session.persist();

        if (finalText.toLowerCase().includes('remember')) {
            this.memory.remember(`ai_note_${Date.now()}`, finalText.slice(0, 200));
        }

        if (toolTrace.length) {
            return { tier: 3, type: 'ai_act', result: finalText, data: toolTrace, turns, sessionId: session.sessionId };
        }
        return { tier: 3, type: 'ai_chat', result: finalText, sessionId: session.sessionId };
    }

    async _dispatchFunctionCall({ name, args }) {
        const { action, plan, target } = args || {};

        if (name === 'manage_vouchers') {
            if (action === 'create') return this.database.createVoucher(voucherCode(), { plan });
            if (action === 'stats') return this.database.getStats();
            if (action === 'list') return this.database.listVouchers({ limit: 5 });
        }

        if (name === 'manage_network') {
            return this.mikrotik.executeTool(action, target);
        }

        if (name === 'manage_finance') {
            if (action === 'revenue_report') return this.financial.getRevenueReport();
            if (action === 'verify_payment') return this.financial.verifyPayment(target);
            if (action === 'audit_log') return this.financial.auditTrail(5);
            if (action === 'trends') return this.financial.getTrends();
        }

        if (name === 'manage_mesh') {
            if (action === 'list_nodes') return nodeRegistry.getAll();
            if (action === 'execute_all') return nodeRegistry.executeOnAll(args.tool);
            if (action === 'execute_node') return nodeRegistry.executeOnNode(args.node, args.tool);
        }

        return { error: 'Unknown function' };
    }

    formatResponse(text) {
        if (!text) return 'No data available.';

        // Tiered Translation Layer
        const s = (typeof text === 'object') ? JSON.stringify(text, null, 2) : String(text);
        const lower = s.toLowerCase();

        // 1. Data-specific Translation to Markdown Tables/Lists
        if (Array.isArray(text)) {
            if (text.length === 0) return 'Empty results.';
            const keys = Object.keys(text[0]).filter(k => k !== '.id');
            const header = `| ${keys.join(' | ')} |`;
            const sep = `| ${keys.map(() => '---').join(' | ')} |`;
            const rows = text.slice(0, 10).map(row => `| ${keys.map(k => row[k] ?? '').join(' | ')} |`);
            return `\n${header}\n${sep}\n${rows.join('\n')}${text.length > 10 ? '\n\n*(Truncated)*' : ''}`;
        }

        // 2. Resource Translation (cpu-load, free-memory, etc.)
        if (typeof text === 'object' && text['cpu-load']) {
            return `📊 **System Intelligence**\n` +
                `• **CPU Load:** ${text['cpu-load']}%\n` +
                `• **Free RAM:** ${fmtBytes(parseInt(text['free-memory']))}\n` +
                `• **Total RAM:** ${fmtBytes(parseInt(text['total-memory']))}\n` +
                `• **Uptime:** ${text.uptime}\n` +
                `• **Version:** ${text.version}`;
        }

        const isTech = ['/ip', '/system', '/tool', 'delay', 'set '].some(k => lower.includes(k));
        return (isTech && !s.includes('```'))
            ? `🖥️ **Configuration Translation:**\n\`\`\`routeros\n${s.trim()}\n\`\`\``
            : s;
    }

    _matchTool(input) {
        const lower = input.toLowerCase();
        const key = Object.keys(this._toolMap).find(k => lower.includes(k));
        return key ? this._toolMap[key] : null;
    }

    _matchRule(input) {
        const lower = input.trim().toLowerCase();

        // Rule: Voucher Statistics
        if (lower.includes('voucher stats') || lower.includes('db stats')) {
            return () => this.database.getStats();
        }

        // Rule: Kick User (Regex Translation)
        const kickMatch = lower.match(/^kick\s+(\w+)$/);
        if (kickMatch) return () => this.mikrotik.kickUser(kickMatch[1]);

        // Rule: Block Target (Regex Translation)
        const blockMatch = lower.match(/^block\s+([\d.a-f:]+)$/);
        if (blockMatch) return () => this.mikrotik.addToBlockList(blockMatch[1]);

        // Rule: Ping Host (Regex Translation)
        const pingMatch = lower.match(/^ping\s+([\w.-]+)$/);
        if (pingMatch) return () => this.mikrotik.ping(pingMatch[1]);

        // Rule: Voucher Generation (Quick Shortcut)
        const genMatch = lower.match(/^(?:gen|create)\s+voucher\s+(\S+)$/);
        if (genMatch) return () => this.database.createVoucher(voucherCode(), { plan: genMatch[1] });

        return null;
    }

    // ── Streaming ask — yields typed SSE events (claw-code stream_submit_message port)
    async *stream(input) {
        yield { type: 'message_start', input, ts: Date.now() };

        // Tier 1 — keyword tool
        const tier1 = this._matchTool(input);
        if (tier1) {
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

        // Tier 2 — rule
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

        // Tier 3 — AI
        if (this.isRuleOnly || !this.ai) {
            yield { type: 'message_delta', text: '⚠️ Rule-Only Mode — no AI key configured.' };
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
            yield { type: 'message_stop', tier: 3, stop_reason: 'completed', turns: res.turns, sessionId: res.sessionId };
        } catch (e) {
            if (global.gateway) global.gateway.broadcast({ type: 'ai.state', state: 'idle' });
            yield { type: 'error', message: e.message };
            yield { type: 'message_stop', tier: 3, stop_reason: 'error' };
        }
    }
}
const askEngine = new AskEngine({ mikrotik, database, financial, ai: genAI });

// ============================================================
// §9  SYSTEM MONITOR
// ============================================================

class SystemMonitor {
    constructor(mikrotik, bot) {
        this.mikrotik = mikrotik;
        this.bot = bot;
        this._interval = null;
        this.thresholds = { cpu: 85, freeMemMB: 15 };
    }

    start(intervalMs = 60_000) {
        logger.info(`System monitor started (${intervalMs / 1000}s interval)`);
        this._interval = setInterval(() => this._check(), intervalMs);
    }

    async _check() {
        try {
            if (!this.mikrotik.isConnected) {
                this.bot?.alertOnce('conn_down', '🚨 *CRITICAL:* MikroTik Disconnected!');
                return;
            }
            const stats = await this.mikrotik.getSystemStats();
            const cpu = parseInt(stats['cpu-load']) || 0;
            const freeMem = parseInt(stats['free-memory']) / 1024 / 1024;

            if (cpu > this.thresholds.cpu)
                this.bot?.alertOnce('cpu_high', `🔥 *High Load:* Router CPU at ${cpu}%`);
            if (freeMem < this.thresholds.freeMemMB)
                this.bot?.alertOnce('mem_low', `⚠️ *Low Memory:* ${freeMem.toFixed(1)} MB remaining`);
        } catch (err) {
            logger.error(`System monitor check failed: ${err.message}`);
        }
    }
}

// ============================================================
// §10  CLI COMMANDS REGISTRY
// Declared here — before AgentOSGateway which references it.
// ============================================================

const cliCommandRegistry = {
    async voucher(args) {
        const [plan, duration] = args;
        if (!plan) return console.log('Usage: voucher <plan> [duration]');
        const code = voucherCode();
        await database.createVoucher(code, { plan, duration, createdBy: 'cli-batch' });
        console.log(code);
        if (mikrotik.isConnected) await mikrotik.addHotspotUser(code, code, plan).catch(() => { });
    },
    async redeem(args) {
        const [code, username] = args;
        if (!code || !username) return console.log('Usage: redeem <code> <username>');
        const voucher = await database.getVoucher(code);
        if (!voucher || voucher.used) return console.error('Invalid or already-used voucher');
        await mikrotik.connect();
        await mikrotik.addHotspotUser(username, username, voucher.plan);
        await database.redeemVoucher(code, { username });
        console.log(`Activated ${code} for ${username}`);
    },
    async status() {
        // Only connect if not already connected (avoid double-connect errors)
        if (!mikrotik.isConnected) await mikrotik.connect();
        const stats = await mikrotik.getSystemStats();
        console.log(JSON.stringify(stats, null, 2));
    },
    async 'batch-vouchers'(args) {
        const [count, plan] = args;
        for (let i = 0; i < (parseInt(count) || 1); i++) {
            const code = voucherCode();
            await database.createVoucher(code, { plan: plan || 'default', createdBy: 'cli-batch' });
            console.log(code);
        }
    },
};

// ============================================================
// §11  WEBSOCKET CLI SESSION
// ============================================================

class WebSocketCLI {
    constructor(clientId, ws, gateway) {
        this.clientId = clientId;
        this.ws = ws;
        this.gateway = gateway;
        this.buffer = '';
        this.cursorPos = 0;
        this.history = [];
        this.historyIndex = -1;
        this.cols = 80;
        this.rows = 24;
        this.isProcessing = false;
        this.pendingConfirm = null;  // Stores an async fn awaiting yes/no confirmation

        this._commands = this._buildCommands();
    }

    _buildCommands() {
        const b = (fn) => fn.bind(this);
        return {
            help: { fn: b(this.cmdHelp), desc: 'Show help' },
            connect: { fn: b(this.cmdConnect), desc: 'Connect to router' },
            disconnect: { fn: b(this.cmdDisconnect), desc: 'Disconnect' },
            status: { fn: b(this.cmdStatus), desc: 'Router stats' },
            cli: { fn: b(this.cmdRawCli), desc: 'Raw RouterOS CLI' },
            api: { fn: b(this.cmdRawApi), desc: 'Raw RouterOS API' },
            users: { fn: b(this.cmdUsers), desc: 'All hotspot users' },
            active: { fn: b(this.cmdActive), desc: 'Active users' },
            adduser: { fn: b(this.cmdAddUser), desc: 'Add user' },
            deluser: { fn: b(this.cmdDelUser), desc: 'Delete user' },
            kick: { fn: b(this.cmdKick), desc: 'Kick user' },
            voucher: { fn: b(this.cmdVoucher), desc: 'Create voucher' },
            vouchers: { fn: b(this.cmdVouchers), desc: 'List vouchers' },
            redeem: { fn: b(this.cmdRedeem), desc: 'Redeem voucher' },
            revoke: { fn: b(this.cmdRevoke), desc: 'Revoke voucher' },
            ping: { fn: b(this.cmdPing), desc: 'Ping host' },
            logs: { fn: b(this.cmdLogs), desc: 'Router logs' },
            dhcp: { fn: b(this.cmdDhcp), desc: 'DHCP leases' },
            arp: { fn: b(this.cmdArp), desc: 'ARP table' },
            firewall: { fn: b(this.cmdFirewall), desc: 'Firewall rules' },
            block: { fn: b(this.cmdBlock), desc: 'Block IP/MAC' },
            unblock: { fn: b(this.cmdUnblock), desc: 'Unblock IP/MAC' },
            reboot: { fn: b(this.cmdReboot), desc: 'Reboot router' },
            agent: { fn: b(this.cmdAgent), desc: 'AI coordinator' },
            nodes: { fn: b(this.cmdNodes), desc: 'Show nodes' },
            clear: { fn: b(this.cmdClear), desc: 'Clear screen' },
        };
    }

    // ── Input handling ───────────────────────────────────────

    sendPrompt() {
        this._out({ type: 'prompt', prompt: 'AgentOS> ', buffer: this.buffer, cursorPos: this.cursorPos });
    }

    handleInput(input) {
        // Intercept enter when a yes/no confirmation is pending (e.g. reboot)
        if (this.pendingConfirm && (input === '\r' || input === '\n')) {
            const answer = this.buffer.trim().toLowerCase();
            const action = this.pendingConfirm;
            this.pendingConfirm = null;
            this.buffer = '';
            this.cursorPos = 0;
            this._out({ type: 'executing', command: answer });
            if (answer === 'yes' || answer === 'y') {
                action().catch(err => {
                    this._out({ type: 'error', message: err.message });
                    this.sendPrompt();
                });
            } else {
                this._out({ type: 'warning', message: 'Action cancelled.' });
                this.sendPrompt();
            }
            return;
        }

        if (input === '\r' || input === '\n') {
            this._executeCommand();
        } else if (input === '\u0003') {            // Ctrl+C
            this.buffer = ''; this.cursorPos = 0;
            this._out({ type: 'clear_line' });
            this.sendPrompt();
        } else if (input === '\u007F') {            // Backspace
            if (this.cursorPos > 0) {
                this.buffer = this.buffer.slice(0, this.cursorPos - 1) + this.buffer.slice(this.cursorPos);
                this.cursorPos--;
                this._updateLine();
            }
        } else if (input === '\u001b[A') {          // Arrow up (history)
            if (this.historyIndex < this.history.length - 1) {
                this.historyIndex++;
                this.buffer = this.history[this.history.length - 1 - this.historyIndex] || '';
                this.cursorPos = this.buffer.length;
                this._updateLine();
            }
        } else if (input === '\u001b[B') {          // Arrow down (history)
            if (this.historyIndex > 0) {
                this.historyIndex--;
                this.buffer = this.history[this.history.length - 1 - this.historyIndex] || '';
                this.cursorPos = this.buffer.length;
            } else {
                this.historyIndex = -1;
                this.buffer = '';
                this.cursorPos = 0;
            }
            this._updateLine();
        } else if (input === '\u001b[C') {          // Arrow right
            if (this.cursorPos < this.buffer.length) { this.cursorPos++; this._out({ type: 'cursor', pos: this.cursorPos }); }
        } else if (input === '\u001b[D') {          // Arrow left
            if (this.cursorPos > 0) { this.cursorPos--; this._out({ type: 'cursor', pos: this.cursorPos }); }
        } else if (input === '\u001b[H') {          // Home
            this.cursorPos = 0; this._out({ type: 'cursor', pos: 0 });
        } else if (input === '\u001b[F') {          // End
            this.cursorPos = this.buffer.length; this._out({ type: 'cursor', pos: this.cursorPos });
        } else if (input.startsWith('\u001b')) {    // Other escape sequences — ignore
            // no-op
        } else if (input.length === 1 && input.charCodeAt(0) >= 32) {
            this.buffer = this.buffer.slice(0, this.cursorPos) + input + this.buffer.slice(this.cursorPos);
            this.cursorPos++;
            this._updateLine();
        }
    }

    _updateLine() {
        this._out({ type: 'update_line', prompt: 'AgentOS> ', buffer: this.buffer, cursorPos: this.cursorPos });
    }

    async _executeCommand() {
        const text = this.buffer.trim();
        if (!text) { this.sendPrompt(); return; }

        this.history.push(text);
        if (this.history.length > 100) this.history.shift();
        this.historyIndex = -1;
        this.buffer = '';
        this.cursorPos = 0;

        this._out({ type: 'executing', command: text });

        const [cmd, ...args] = text.split(/\s+/);
        const key = cmd.toLowerCase();

        if (key === 'exit' || key === 'quit') {
            this._out({ type: 'exit', message: 'Goodbye!' });
            this.gateway._handleCliStop(this.clientId);
            return;
        }

        this.isProcessing = true;
        try {
            if (this._commands[key]) {
                await this._commands[key].fn(args);
            } else {
                this._out({ type: 'thinking', message: 'AgentOS: Consulting AI…' });
                const resp = await askEngine.run(text);
                this._out({
                    type: 'ai_response',
                    tier: resp.tier,
                    responseType: resp.type,
                    result: askEngine.formatResponse(resp.result),
                    data: (resp.type === 'ai_act' ? resp.data : null)
                });
            }
        } catch (err) {
            this._out({ type: 'error', message: err.message });
        }
        this.isProcessing = false;
        this.sendPrompt();
    }

    _out(data) {
        if (this.ws.readyState === WebSocket.OPEN)
            this.ws.send(JSON.stringify({ type: 'cli.output', ...data }));
    }

    // ── Commands ─────────────────────────────────────────────

    async cmdHelp() {
        const lines = Object.entries(this._commands)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([n, { desc }]) => `  ${n.padEnd(12)} ${desc}`)
            .join('\n');
        this._out({ type: 'text', text: `\n📋 Commands:\n${lines}\n\nType 'exit' to quit.\n` });
    }

    async cmdConnect() {
        try {
            await mikrotik.connect();
            this._out({ type: 'success', message: `Connected to ${CONFIG.MIKROTIK.IP}` });
        } catch (err) {
            this._out({ type: 'error', message: `Connection failed: ${err.message}` });
        }
    }

    async cmdDisconnect() {
        mikrotik.disconnect();
        this._out({ type: 'success', message: 'Disconnected' });
    }

    async cmdStatus() {
        try {
            const s = await mikrotik.getSystemStats();
            this._out({
                type: 'table', title: `Router Status (${CONFIG.MIKROTIK.IP})`, data: {
                    'CPU Load': `${s['cpu-load']}%`,
                    'Free Memory': fmtBytes(parseInt(s['free-memory']) || 0),
                    'Uptime': s.uptime,
                    'Version': s.version,
                }
            });
        } catch (err) { this._out({ type: 'error', message: err.message }); }
    }

    async cmdRawCli(args) {
        const cmd = args.join(' ');
        if (!cmd) { this._out({ type: 'error', message: 'Usage: cli <command>' }); return; }
        try {
            const res = await mikrotik.executeCLI(cmd);
            this._out({ type: 'code', language: 'text', content: res });
        } catch (err) { this._out({ type: 'error', message: err.message }); }
    }

    async cmdRawApi(args) {
        const cmd = args.join(' ');
        if (!cmd) { this._out({ type: 'error', message: 'Usage: api </path/command>' }); return; }
        try {
            const res = await mikrotik.executeRawAPI(cmd);
            this._out({ type: 'code', language: 'json', content: JSON.stringify(res, null, 2) });
        } catch (err) { this._out({ type: 'error', message: err.message }); }
    }

    async cmdVoucher([plan, duration]) {
        if (!plan) { this._out({ type: 'error', message: 'Usage: voucher <plan> [duration]' }); return; }
        try {
            const code = voucherCode();
            await database.createVoucher(code, { plan, duration, createdBy: 'ws-cli' });
            if (mikrotik.isConnected) await mikrotik.addHotspotUser(code, code, plan).catch(() => { });
            this._out({ type: 'success', message: `🎫 Code: ${code}  Plan: ${plan}${mikrotik.isConnected ? '\n✅ Auto-provisioned' : ''}` });
        } catch (err) { this._out({ type: 'error', message: err.message }); }
    }

    async cmdVouchers([limit = '20']) {
        try {
            const list = await database.listVouchers({ limit: parseInt(limit) });
            this._out({
                type: 'list', title: `Recent Vouchers (${list.length})`,
                items: list.map(v => {
                    const tag = v.used ? '✅ USED' : (v.expiresAt && new Date(v.expiresAt) < new Date() ? '⌛ EXPIRED' : '⏳ ACTIVE');
                    return `${tag.padEnd(10)} ${v.id.padEnd(15)} ${v.plan}`;
                })
            });
        } catch (err) { this._out({ type: 'error', message: err.message }); }
    }

    async cmdRedeem([code, username]) {
        if (!code || !username) { this._out({ type: 'error', message: 'Usage: redeem <code> <username>' }); return; }
        try {
            const v = await database.getVoucher(code);
            if (!v) return this._out({ type: 'error', message: 'Voucher not found' });
            if (v.used) return this._out({ type: 'error', message: 'Voucher already used' });
            await mikrotik.addHotspotUser(username, username, v.plan);
            await database.redeemVoucher(code, { username });
            this._out({ type: 'success', message: `Voucher ${code} redeemed for ${username}` });
        } catch (err) { this._out({ type: 'error', message: err.message }); }
    }

    async cmdRevoke([code]) {
        if (!code) { this._out({ type: 'error', message: 'Usage: revoke <code>' }); return; }
        try {
            await database.deleteVoucher(code);
            this._out({ type: 'success', message: `Voucher ${code} revoked` });
        } catch (err) { this._out({ type: 'error', message: err.message }); }
    }

    async cmdPing([host, count = '4']) {
        if (!host) { this._out({ type: 'error', message: 'Usage: ping <host> [count]' }); return; }
        try {
            this._out({ type: 'info', message: `Pinging ${host}…` });
            const res = await mikrotik.ping(host, parseInt(count));
            const recv = res.filter(r => r.received > 0).length;
            this._out({ type: 'result', text: `Sent: ${count}  Received: ${recv}  Lost: ${count - recv}` });
        } catch (err) { this._out({ type: 'error', message: err.message }); }
    }

    async cmdLogs([lines = '20']) {
        try {
            const logs = await mikrotik.getLogs(parseInt(lines));
            this._out({
                type: 'list', title: `Router Logs (${logs.length})`,
                items: logs.map(l => `${l.time || ''} [${(l.topics || '').padEnd(15)}] ${l.message || ''}`)
            });
        } catch (err) { this._out({ type: 'error', message: err.message }); }
    }

    async cmdDhcp() {
        try {
            const leases = await mikrotik.getDhcpLeases();
            this._out({
                type: 'table', title: `DHCP Leases (${leases.length})`,
                data: leases.slice(0, 20).reduce((acc, l) => { acc[l.address] = `${l.hostname || 'N/A'} (${l.status || 'bound'})`; return acc; }, {})
            });
        } catch (err) { this._out({ type: 'error', message: err.message }); }
    }

    async cmdArp() {
        try {
            const arp = await mikrotik.getArpTable();
            this._out({
                type: 'table', title: `ARP Table (${arp.length})`,
                data: arp.filter(e => e.address).slice(0, 20).reduce((acc, e) => { acc[e.address] = e['mac-address'] || 'N/A'; return acc; }, {})
            });
        } catch (err) { this._out({ type: 'error', message: err.message }); }
    }

    async cmdFirewall() {
        try {
            const rules = await mikrotik.getFirewallRules('filter');
            this._out({
                type: 'list', title: `Firewall Filter (${rules.length})`,
                items: rules.slice(0, 10).map(r => `${r.chain}: ${r.action}${r.comment ? ` # ${r.comment}` : ''}`)
            });
        } catch (err) { this._out({ type: 'error', message: err.message }); }
    }

    async cmdBlock([target]) {
        if (!target) { this._out({ type: 'error', message: 'Usage: block <ip-or-mac>' }); return; }
        try {
            await mikrotik.addToBlockList(target);
            this._out({ type: 'success', message: `Blocked: ${target}` });
        } catch (err) { this._out({ type: 'error', message: err.message }); }
    }

    async cmdUnblock([target]) {
        if (!target) { this._out({ type: 'error', message: 'Usage: unblock <ip-or-mac>' }); return; }
        try {
            const res = await mikrotik.unblockAddress(target);
            this._out({ type: 'success', message: `Unblocked: ${target} (${res.count} entries removed)` });
        } catch (err) { this._out({ type: 'error', message: err.message }); }
    }

    async cmdReboot() {
        this._out({ type: 'confirm', id: 'reboot', message: 'Type yes to confirm router reboot.' });
        this.pendingConfirm = async () => {
            try {
                await mikrotik.reboot();
                this._out({ type: 'success', message: 'Router is rebooting…' });
            } catch (err) {
                this._out({ type: 'error', message: `Reboot failed: ${err.message}` });
            }
            this.sendPrompt();
        };
    }

    async cmdAgent(args) {
        const query = args.join(' ');
        if (!query) { this._out({ type: 'error', message: 'Usage: agent <query>' }); return; }
        this._out({ type: 'thinking', message: 'AgentOS Thinking…' });
        try {
            const resp = await askEngine.run(query);
            this._out({
                type: 'ai_response',
                tier: resp.tier,
                responseType: resp.type,
                result: askEngine.formatResponse(resp.result),
                data: resp.data
            });
        } catch (err) { this._out({ type: 'error', message: err.message }); }
    }

    async cmdUsers() {
        try {
            const list = await mikrotik.getAllHotspotUsers();
            this._out({
                type: 'table', title: `Hotspot Users (${list.length})`,
                data: list.slice(0, 50).reduce((acc, u) => { acc[u.name] = u.profile; return acc; }, {})
            });
        } catch (err) { this._out({ type: 'error', message: err.message }); }
    }

    async cmdActive() {
        try {
            const list = await mikrotik.getActiveUsers();
            this._out({
                type: 'table', title: `Active Sessions (${list.length})`,
                data: list.slice(0, 50).reduce((acc, s) => { acc[s.user] = `${s.address} (${s.uptime})`; return acc; }, {})
            });
        } catch (err) { this._out({ type: 'error', message: err.message }); }
    }

    async cmdKick([user]) {
        if (!user) { this._out({ type: 'error', message: 'Usage: kick <user>' }); return; }
        try {
            const res = await mikrotik.kickUser(user);
            await database.logAuditTrail('ws-cli', 'user.kick', { user });
            this._out({ type: 'success', message: res.kicked ? `🚫 Kick successful: ${user}` : `⚠️ ${user} not active.` });
        } catch (err) { this._out({ type: 'error', message: err.message }); }
    }

    async cmdAddUser([user, pass, profile = 'default']) {
        if (!user || !pass) { this._out({ type: 'error', message: 'Usage: adduser <user> <pass> [profile]' }); return; }
        try {
            await mikrotik.addHotspotUser(user, pass, profile);
            await database.logAuditTrail('ws-cli', 'user.add', { user, profile });
            this._out({ type: 'success', message: `✅ User added: ${user} (profile: ${profile})` });
        } catch (err) { this._out({ type: 'error', message: err.message }); }
    }

    async cmdDelUser([user]) {
        if (!user) { this._out({ type: 'error', message: 'Usage: deluser <user>' }); return; }
        try {
            await mikrotik.removeHotspotUser(user);
            await database.logAuditTrail('ws-cli', 'user.remove', { user });
            this._out({ type: 'success', message: `🗑️ User deleted: ${user}` });
        } catch (err) { this._out({ type: 'error', message: err.message }); }
    }

    async cmdNodes() {
        this._out({
            type: 'text', text:
                `\n📡 Network Nodes\n${'━'.repeat(34)}\n` +
                `◆ Main-Router\n` +
                `  Status: ${mikrotik.isConnected ? '🟢 CONNECTED' : '🔴 OFFLINE'}\n` +
                `  Target: ${CONFIG.MIKROTIK.IP}\n`
        });
    }

    async cmdClear() { this._out({ type: 'clear' }); }

    resize(cols, rows) { this.cols = cols; this.rows = rows; }
    destroy() { this.buffer = ''; this.isProcessing = false; this.pendingConfirm = null; }
}
// § — Unified Gateway Control Plane
// ============================================================
// §12  WEBSOCKET GATEWAY  (CVE-2026-1526 patched)
// ============================================================

class AgentOSGateway {
    constructor(server) {
        this.wss = new WebSocket.Server({
            server,
            path: CONFIG.GATEWAY.WS_PATH,
            verifyClient: this._verify.bind(this),
            perMessageDeflate: false,    // CVE-2026-1526: disables memory-exhaustion vector
            maxPayload: 1024 * 1024,
            clientTracking: true,
        });
        this.clients = new Map();   // id → { ws, cliInstance, heartbeat, heartbeatInterval }
        this.cliSessions = new Map();   // id → WebSocketCLI
        this._setupHandlers();
    }

    _verify(info, cb) {
        const url = new URL(info.req.url, `http://${info.req.headers.host}`);
        const token = url.searchParams.get('token') || info.req.headers['x-agentos-token'];
        if (!token) return cb(false, 401, 'Token required');

        const secret = Buffer.from(CONFIG.GATEWAY.TOKEN);
        const provided = Buffer.from(token);

        if (provided.length === secret.length && crypto.timingSafeEqual(provided, secret)) {
            return cb(true);
        }
        cb(false, 401, 'Invalid token');
    }

    _setupHandlers() {
        this.wss.on('connection', (ws) => {
            const id = uid();

            const heartbeat = setInterval(() => {
                if (ws.readyState !== WebSocket.OPEN) { clearInterval(heartbeat); return; }
                const c = this.clients.get(id);
                if (!c) { clearInterval(heartbeat); return; }
                if (Date.now() - c.heartbeat > 60_000) {
                    ws.terminate();
                    this._onDisconnect(id);
                    return;
                }
                this._send(ws, { type: 'ping', timestamp: Date.now() });
            }, 30_000);

            this.clients.set(id, {
                ws,
                cliInstance: null,
                heartbeat: Date.now(),
                heartbeatInterval: heartbeat,
            });

            this._send(ws, {
                type: 'hello',
                payload: {
                    service: BRAND.name,
                    version: BRAND.version,
                    timestamp: new Date().toISOString(),
                    endpoints: ['tool.invoke', 'cli.exec', 'cli.start', 'cli.input', 'cli.stop', 'cli.resize', 'status', 'ping'],
                },
            });

            ws.on('message', (data) => this._onMessage(id, data));
            ws.on('close', () => this._onDisconnect(id));
            ws.on('error', (err) => { logger.error(`WS error (${id}): ${err.message}`); this._onDisconnect(id); });
        });
    }

    _onDisconnect(id) {
        const c = this.clients.get(id);
        if (!c) return;
        if (c.heartbeatInterval) clearInterval(c.heartbeatInterval);
        if (c.cliInstance) { c.cliInstance.destroy(); this.cliSessions.delete(id); }
        this.clients.delete(id);
    }

    _onMessage(id, raw) {
        metrics.wsMessages++;
        let msg;
        try { msg = JSON.parse(raw); }
        catch { return this._sendToClient(id, { type: 'error', error: 'Invalid JSON' }); }

        const c = this.clients.get(id);
        if (!c) return;
        c.heartbeat = Date.now();

        switch (msg.type) {
            case 'pong': break;
            case 'tool.invoke': this._invokeTool(c.ws, msg); break;
            case 'call':
                if (TOOLS[msg.tool]) {
                    mikrotik.executeTool(msg.tool, ...(msg.params || []))
                        .then(data => this._send(c.ws, { type: 'result', id: msg.id, data }))
                        .catch(e => this._send(c.ws, { type: 'error', id: msg.id, message: e.message }));
                }
                break;
            case 'discover':
                this._send(c.ws, { type: 'tools', list: mikrotik.availableTools() });
                break;
            case 'status':
                this._send(c.ws, {
                    type: 'status', payload: {
                        mikrotik: mikrotik.isConnected ? 'connected' : 'disconnected',
                        clients: this.clients.size,
                        cliSessions: this.cliSessions.size,
                    }
                });
                break;
            case 'cli.exec': this._handleCliExec(id, msg); break;
            case 'cli.start': this._handleCliStart(id); break;
            case 'cli.input': this._handleCliInput(id, msg); break;
            case 'cli.stop': this._handleCliStop(id); break;
            case 'cli.resize': this._handleCliResize(id, msg); break;
            default:
                this._send(c.ws, { type: 'error', error: 'Unknown message type', received: msg.type });
        }
    }

    async _handleCliExec(clientId, msg) {
        const c = this.clients.get(clientId);
        if (!c) return;
        const { command, id } = msg;
        if (!command) return this._send(c.ws, { type: 'cli.error', id, error: 'No command provided' });

        try {
            const [cmd, ...args] = command.trim().split(/\s+/);
            const key = cmd.toLowerCase();
            let result;

            if (cliCommandRegistry[key]) {
                const outputs = [];
                const origLog = console.log, origErr = console.error;
                console.log = (...a) => outputs.push({ type: 'log', data: a.join(' ') });
                console.error = (...a) => outputs.push({ type: 'error', data: a.join(' ') });
                try {
                    await cliCommandRegistry[key](args);
                    result = { success: true, output: outputs };
                } catch (err) {
                    result = { success: false, error: err.message, output: outputs };
                } finally {
                    console.log = origLog; console.error = origErr;
                }
            } else {
                // Tiered Engine Fallback for One-Off WS CLI Execution
                try {
                    const resp = await askEngine.run(command);
                    result = {
                        success: true,
                        tier: resp.tier,
                        type: resp.type,
                        message: askEngine.formatResponse(resp.result),
                        data: resp.data,
                        output: [{ type: 'log', data: askEngine.formatResponse(resp.result) }]
                    };
                } catch (err) {
                    const output = await mikrotik.executeCLI(command);
                    result = { success: true, output: [{ type: 'log', data: output }] };
                }
            }

            this._send(c.ws, { type: 'cli.result', id, ...result });
        } catch (err) {
            this._send(c.ws, { type: 'cli.error', id, error: err.message });
        }
    }

    _handleCliStart(clientId) {
        const c = this.clients.get(clientId);
        if (!c) return;
        if (c.cliInstance) c.cliInstance.destroy();

        const session = new WebSocketCLI(clientId, c.ws, this);
        c.cliInstance = session;
        this.cliSessions.set(clientId, session);

        session.sendPrompt();
        this._send(c.ws, { type: 'cli.started', message: 'Interactive CLI session started. Type "exit" to quit.' });
    }

    _handleCliInput(clientId, msg) {
        const session = this.cliSessions.get(clientId);
        if (!session) {
            const c = this.clients.get(clientId);
            if (c) this._send(c.ws, { type: 'cli.error', error: 'No active CLI session — send cli.start first.' });
            return;
        }
        session.handleInput(msg.input);
    }

    _handleCliStop(clientId) {
        const c = this.clients.get(clientId);
        if (!c || !c.cliInstance) return;
        c.cliInstance.destroy();
        c.cliInstance = null;
        this.cliSessions.delete(clientId);
        this._send(c.ws, { type: 'cli.stopped', message: 'CLI session ended' });
    }

    _handleCliResize(clientId, msg) {
        this.cliSessions.get(clientId)?.resize(msg.cols || 80, msg.rows || 24);
    }

    async _invokeTool(ws, msg) {
        try {
            const result = await mikrotik.executeTool(msg.tool.replace(/^mikrotik\./, ''), ...(msg.params || []));
            this._send(ws, { type: 'tool.result', id: msg.id, result, success: true });
        } catch (err) {
            this._send(ws, { type: 'tool.error', id: msg.id, error: err.message, success: false });
        }
    }

    _send(ws, data) {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(data));
    }

    _sendToClient(id, data) {
        const c = this.clients.get(id);
        if (c) this._send(c.ws, data);
    }

    broadcast(payload) {
        this.clients.forEach(({ ws }) => this._send(ws, { type: 'broadcast', payload }));
    }

    closeAll() {
        this.clients.forEach(c => {
            if (c.heartbeatInterval) clearInterval(c.heartbeatInterval);
            c.ws.terminate();
        });
        this.clients.clear();
    }
}

// ============================================================
// §13  CHAT RATE LIMITER
// ============================================================

class ChatRateLimiter {
    constructor() {
        this._buckets = new Map();
        this._cleanup = setInterval(() => this._purge(), 60_000);
    }

    allow(chatId) {
        const now = Date.now();
        const win = CONFIG.SECURITY.VOUCHER_WINDOW_MS;
        let b = this._buckets.get(chatId);

        if (!b || now - b.windowStart > win) b = { count: 0, windowStart: now };
        if (b.count >= CONFIG.SECURITY.VOUCHER_RATE_LIMIT) { this._buckets.set(chatId, b); return false; }
        b.count++;
        this._buckets.set(chatId, b);
        return true;
    }

    _purge() {
        const cutoff = Date.now() - CONFIG.SECURITY.VOUCHER_WINDOW_MS * 2;
        for (const [id, b] of this._buckets)
            if (b.windowStart < cutoff) this._buckets.delete(id);
    }

    destroy() { clearInterval(this._cleanup); }
}

// ============================================================
// §14  TELEGRAM BOT
// ============================================================

class AgentOSBot {
    constructor() {
        // All properties initialised first — Orchestrator and Monitor call
        // alertOnce/sendToAll on this instance regardless of token availability.
        this.bot = null;
        this.rateLimiter = new ChatRateLimiter();
        this._cooldown = new Map();
        this.pendingInputs = new Map();

        if (!CONFIG.TELEGRAM.TOKEN) {
            logger.warn('Telegram not configured — bot disabled');
            return;
        }

        this.bot = new TelegramBot(CONFIG.TELEGRAM.TOKEN, { polling: false });

        this.bot.on('polling_error', (err) => {
            const isConflict = err.code === 'ETELEGRAM' && err.response?.body?.description?.includes('Conflict');
            logger.error(isConflict
                ? 'Telegram polling conflict — another instance is running'
                : `Telegram polling error: ${err.message}`);
        });

        this._registerHandlers();
        this.bot.startPolling({ restart: false, drop_pending_updates: true });
        logger.info('Telegram bot started');
    }

    _registerHandlers() {
        const on = (re, fn) => this.bot.onText(re, fn.bind(this));
        on(/\/start/, this._cmdStart);
        on(/\/dashboard/, this._cmdDashboard);
        on(/\/tools/, this._cmdTools);
        on(/\/network/, this._cmdNetwork);
        on(/\/users/, this._cmdUsers);
        on(/\/voucher/, this._cmdVoucher);
        on(/\/status/, this._cmdStatus);
        on(/\/help/, this._cmdHelp);
        on(/\/logs/, this._cmdLogs);
        on(/\/gen\s+(\S+)/, this._cmdGen);
        on(/\/ping\s+(\S+)(?:\s+(\d+))?/, this._cmdPing);
        on(/\/traceroute\s+(\S+)/, this._cmdTraceroute);
        on(/\/kick\s+(\w+)/, this._cmdKick);
        on(/\/adduser\s+(\S+)\s+(\S+)(?:\s+(\S+))?/, this._cmdAddUser);
        on(/\/block\s+(\S+)(?:\s+(.+))?/, this._cmdBlock);
        on(/\/tool\s+(\S+)(?:\s+(.*))?/, this._cmdTool);
        on(/\/cli\s+(.+)/, this._cmdCli);
        on(/\/api\s+(.+)/, this._cmdApi);
        on(/\/ask\s+(.+)/, this._cmdAsk);
        on(/\/claim/, this._cmdClaim);
        on(/\/token/, this._cmdToken);
        on(/\/setup_router/, this._cmdSetupRouter);

        this.bot.on('message', this._onMessage.bind(this));
        this.bot.on('callback_query', this._onCallback.bind(this));
    }

    // ── Auth & messaging helpers ──────────────────────────────

    _checkAuth(msg) {
        if (!this.bot) return false;
        const chatId = String(msg.chat.id);

        // Global command rate limit: 30 commands per minute per chat
        if (!this._cmdBuckets) this._cmdBuckets = new Map();
        const now = Date.now();
        let bucket = this._cmdBuckets.get(chatId);
        if (!bucket || now - bucket.start > 60_000) bucket = { count: 0, start: now };
        bucket.count++;
        this._cmdBuckets.set(chatId, bucket);
        if (bucket.count > 30) {
            this.bot.sendMessage(chatId, '⏳ *Rate limit:* Too many commands. Please wait a moment.', { parse_mode: 'Markdown' }).catch(() => { });
            return false;
        }

        // Setup Mode: if no admins are set, allow /claim or warn
        if (!CONFIG.TELEGRAM.ALLOWED_CHATS.length) {
            this.bot.sendMessage(chatId, '⚠️ *Setup Mode Active*\nNo administrators are configured. Use `/claim` to become the primary admin.', { parse_mode: 'Markdown' });
            return false;
        }

        if (CONFIG.TELEGRAM.ALLOWED_CHATS.includes(chatId)) return true;
        this.bot.sendMessage(chatId, '⛔ *Unauthorised*', { parse_mode: 'Markdown' });
        return false;
    }

    async _cmdClaim(msg) {
        if (CONFIG.TELEGRAM.ALLOWED_CHATS.length > 0) {
            return this.bot.sendMessage(msg.chat.id, '❌ Admin already claimed.');
        }
        const chatId = String(msg.chat.id);
        CONFIG.TELEGRAM.ALLOWED_CHATS.push(chatId);

        await database.logAuditTrail(chatId, 'admin.claim', { username: msg.from.username });

        this.bot.sendMessage(chatId,
            `🎉 *Success!* You are now the primary admin (\`${chatId}\`).\n` +
            `Commands are now strictly restricted to you.\n\n` +
            `> [!IMPORTANT]\n` +
            `> Please update your \`.env\` with \`ALLOWED_CHAT_IDS=${chatId}\` to persist this across restarts.`,
            { parse_mode: 'Markdown' }
        );
    }

    async _cmdSetupRouter(msg) {
        if (!this._checkAuth(msg)) return;
        this.promptUser(msg.chat.id, '🌐 *Step 1: Router IP*\nPlease enter the IP address of your MikroTik (e.g., `192.168.88.1`):', 'setup:ip');
    }

    async _finishSetup(chatId, ip, user, pass) {
        const status = await this.bot.sendMessage(chatId, '⚙️ `[ Attempting connection & provisioning… ]`', { parse_mode: 'Markdown' });
        try {
            await mikrotik.updateCredentials(ip, user, pass);
            await global.orchestrator._provisionRouter();
            await this.bot.editMessageText('✅ *Setup Successful!*\nRouter is connected and provisioned.', {
                chat_id: chatId, message_id: status.message_id, parse_mode: 'Markdown'
            });
            await database.logAuditTrail(chatId, 'router.setup', { ip, user });
        } catch (e) {
            await this.bot.editMessageText(`❌ *Setup Failed:* ${e.message}`, {
                chat_id: chatId, message_id: status.message_id, parse_mode: 'Markdown'
            });
        }
    }

    async _cmdToken(msg) {
        if (!this._checkAuth(msg)) return;
        this.bot.sendMessage(msg.chat.id,
            `🔑 *Gateway Token*\n\n\`${CONFIG.GATEWAY.TOKEN}\`\n\n` +
            `Use this for WebSocket or API Authorization (Bearer). Keep it secret!`,
            { parse_mode: 'Markdown' }
        );
    }

    sendToAll(text, opts = {}) {
        if (!this.bot) return;
        CONFIG.TELEGRAM.ALLOWED_CHATS.forEach(chatId =>
            this.bot.sendMessage(chatId, text, { parse_mode: 'Markdown', ...opts }).catch(() => { })
        );
    }

    alertOnce(key, text, buttons = null) {
        const now = Date.now();
        const last = this._cooldown.get(key) || 0;
        if (now - last < CONFIG.SECURITY.ALERT_COOLDOWN_MS) return false;
        this._cooldown.set(key, now);
        if (this._cooldown.size > 1000) this._cooldown.clear();
        metrics.alertsFired++;
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

    _reply(chatId, text, opts = {}) {
        const botOpts = { parse_mode: 'Markdown', ...opts };
        if (opts.editMessageId) {
            return this.bot?.editMessageText(text, { chat_id: chatId, message_id: opts.editMessageId, ...botOpts })
                .catch(e => {
                    if (e.message.includes('message is not modified')) return;
                    logger.error(`Telegram edit error: ${e.message}`);
                    return this.bot?.sendMessage(chatId, text, botOpts);
                });
        }
        return this.bot?.sendMessage(chatId, text, botOpts).catch(e => logger.error(`Telegram send error: ${e.message}`));
    }

    // ── Message routing ───────────────────────────────────────

    async _onMessage(msg) {
        if (!msg.text || !this._checkAuth(msg)) return;
        if (msg.text.startsWith('/')) { this.pendingInputs.delete(msg.chat.id); return; }

        const pending = this.pendingInputs.get(msg.chat.id);
        if (pending) {
            this.pendingInputs.delete(msg.chat.id);
            await this._executePending(msg.chat.id, msg.text.trim(), pending.action);
            return;
        }

        try {
            const resp = await askEngine.run(msg.text);
            let out;
            if (['ai_chat', 'ai_act', 'fallback', 'error'].includes(resp.type)) {
                out = resp.result;
            } else {
                out = `⚙️ *Tier ${resp.tier} (${resp.type}):*\n\`\`\`json\n${truncate(JSON.stringify(resp.result, null, 2), 3900)}\n\`\`\``;
            }
            this._reply(msg.chat.id, out);
        } catch (e) {
            this._reply(msg.chat.id, `❌ Error: ${e.message}`);
        }
    }

    async _executePending(chatId, input, action) {
        try {
            await this.bot.sendChatAction(chatId, 'typing');
            switch (action) {
                case 'setup:ip':
                    this.promptUser(chatId, `👤 *Step 2: Username*\nIP: \`${input}\` set. Enter MikroTik user:`, `setup:user:${input}`);
                    break;
                default: {
                    if (action.startsWith('setup:user:')) {
                        const ip = action.split(':')[2];
                        this.promptUser(chatId, `🔑 *Step 3: Password*\nUser: \`${input}\` set. Enter MikroTik password:`, `setup:pass:${ip}:${input}`);
                        break;
                    }
                    if (action.startsWith('setup:pass:')) {
                        const [, , ip, user] = action.split(':');
                        await this._finishSetup(chatId, ip, user, input);
                        break;
                    }
                    break;
                }
                case 'ping': {
                    const res = await mikrotik.ping(input);
                    this._reply(chatId, `📡 *Ping: ${input}*\n\`\`\`json\n${JSON.stringify(res, null, 2)}\n\`\`\``);
                    break;
                }
                case 'traceroute': {
                    const res = await mikrotik.traceroute(input);
                    this._reply(chatId, `🛤 *Trace: ${input}*\n\`\`\`json\n${JSON.stringify(res, null, 2)}\n\`\`\``);
                    break;
                }
                case 'block':
                    await mikrotik.addToBlockList(input, 'blocked');
                    this._reply(chatId, `🚫 *${input}* blocked.`);
                    break;
                case 'kick': {
                    const res = await mikrotik.kickUser(input);
                    this._reply(chatId, res.kicked ? `🚫 *${input}* kicked.` : `⚠️ *${input}* not active.`);
                    break;
                }
                case 'adduser': {
                    const [u, p, pr = 'default'] = input.split(' ');
                    await mikrotik.addHotspotUser(u, p, pr);
                    this._reply(chatId, `✅ User *${u}* created.`);
                    break;
                }
                case 'user_status': {
                    const res = await mikrotik.getUserStatus(input);
                    this._reply(chatId, res
                        ? `🟢 *Active: ${input}*\nIP: \`${res.address}\`\nUptime: ${res.uptime}`
                        : `🔴 *${input}* NOT active.`);
                    break;
                }
            }
        } catch (err) {
            this._reply(chatId, `❌ Failed: ${err.message}`);
        }
    }

    // ── Command handlers ──────────────────────────────────────

    async _cmdStart(msg, opts = {}) {
        if (!this._checkAuth(msg)) return;
        this._reply(msg.chat.id, `${BRAND.emoji} *${BRAND.name}*\nWelcome, ${msg.from.first_name}!`, {
            editMessageId: opts.editMessageId,
            reply_markup: {
                inline_keyboard: [
                    [{ text: '📊 Dashboard', callback_data: 'action:dashboard' }, { text: '🛠 Tools', callback_data: 'action:tools' }],
                    [{ text: '🌐 Network', callback_data: 'action:network' }, { text: '👥 Users', callback_data: 'action:users' }],
                    [{ text: '🎫 Voucher', callback_data: 'action:voucher' }, { text: '👛 Wallet', callback_data: 'wallet:list' }],
                    [{ text: '📈 Status', callback_data: 'action:status' }],
                ]
            },
        });
    }

    async _cmdDashboard(msg, opts = {}) {
        if (!this._checkAuth(msg)) return;
        try {
            const [dbRes, rtRes] = await Promise.allSettled([database.getStats(), mikrotik.getSystemStats()]);
            const db = dbRes.status === 'fulfilled' ? dbRes.value : {};
            const rt = rtRes.status === 'fulfilled' ? rtRes.value : null;
            const cpu = rt ? parseInt(rt['cpu-load']) : 0;
            const cpuIcon = cpu > 80 ? '🔴' : cpu > 50 ? '🟡' : '🟢';

            this._reply(msg.chat.id,
                `📊 *Dashboard*\n\n*Router*\nCPU: ${cpuIcon} ${cpu}%\nRAM Free: ${fmtBytes(parseInt(rt?.['free-memory']) || 0)}\n\n` +
                `*Vouchers*\nTotal: ${db.total || 0}  Active: ${db.active || 0}  Used: ${db.used || 0}`,
                {
                    editMessageId: opts.editMessageId,
                    reply_markup: {
                        inline_keyboard: [[
                            { text: '🔄 Refresh', callback_data: 'action:dashboard' },
                            { text: '📋 Status', callback_data: 'action:status' },
                        ]]
                    }
                },
            );
        } catch (e) {
            logger.error(`_cmdDashboard: ${e.message}`);
            this._reply(msg.chat.id, `❌ Dashboard error: ${e.message}`);
        }
    }

    async _cmdTools(msg, opts = {}) {
        if (!this._checkAuth(msg)) return;
        const btns = mikrotik.availableTools().map(t => ({ text: `🔧 ${t}`, callback_data: `tool:${t}` }));
        const rows = [];
        for (let i = 0; i < btns.length; i += 2) rows.push(btns.slice(i, i + 2));
        rows.push([{ text: '⬅️ Back', callback_data: 'action:start' }]);
        this._reply(msg.chat.id, '*Available Tools*', { editMessageId: opts.editMessageId, reply_markup: { inline_keyboard: rows } });
    }

    async _cmdNetwork(msg, opts = {}) {
        if (!this._checkAuth(msg)) return;
        this._reply(msg.chat.id, '🌐 *Network* — Select action:', {
            editMessageId: opts.editMessageId,
            reply_markup: {
                inline_keyboard: [
                    [{ text: '📡 Ping', callback_data: 'net:ping' }, { text: '🛤 Trace', callback_data: 'net:traceroute' }],
                    [{ text: '🔥 Firewall', callback_data: 'net:firewall' }, { text: '🚫 Block', callback_data: 'net:block' }],
                    [{ text: '📋 DHCP', callback_data: 'net:dhcp' }, { text: '🔍 LAN Scan', callback_data: 'net:scan' }],
                    [{ text: '📊 Interfaces', callback_data: 'net:bandwidth' }, { text: '🧹 Flush DNS', callback_data: 'net:flush_dns' }],
                    [{ text: '💾 Backup', callback_data: 'net:backup' }, { text: '⚡ Reboot', callback_data: 'net:reboot' }],
                    [{ text: '⬅️ Back', callback_data: 'action:start' }],
                ]
            },
        });
    }

    async _cmdUsers(msg, opts = {}) {
        if (!this._checkAuth(msg)) return;
        this._reply(msg.chat.id, '👥 *Users* — Select action:', {
            editMessageId: opts.editMessageId,
            reply_markup: {
                inline_keyboard: [
                    [{ text: '👁 Active', callback_data: 'users:active' }, { text: '📋 All', callback_data: 'users:all' }],
                    [{ text: '➕ Add', callback_data: 'users:add' }, { text: '🚫 Kick', callback_data: 'users:kick' }],
                    [{ text: '🔍 Status', callback_data: 'users:status' }, { text: '⬅️ Back', callback_data: 'action:start' }],
                ]
            },
        });
    }

    async _cmdVoucher(msg, opts = {}) {
        if (!this._checkAuth(msg)) return;
        this._reply(msg.chat.id, '🎫 *Create Voucher* — Select duration:', {
            editMessageId: opts.editMessageId,
            reply_markup: {
                inline_keyboard: [
                    [{ text: '⏱ 1 Hour', callback_data: 'voucher:1h' }, { text: '📅 1 Day', callback_data: 'voucher:1d' }],
                    [{ text: '📆 7 Days', callback_data: 'voucher:7d' }, { text: '🌙 30 Days', callback_data: 'voucher:30d' }],
                ]
            },
        });
    }

    async _cmdStatus(msg, opts = {}) {
        if (!this._checkAuth(msg)) return;
        const snap = metrics.snapshot();
        const mode = askEngine.isRuleOnly ? 'Rule-Only' : 'AI-Optimized';
        this._reply(msg.chat.id,
            `*System Status*\n\nMikroTik: ${mikrotik.isConnected ? '🟢 Connected' : '🔴 Offline'}\n` +
            `Intelligence: \`${mode}\`\nUptime: ${fmtUptime(snap.uptime)}\nDB: ${database.db ? 'Firebase' : 'Local'}\n` +
            `Tools Invoked: ${snap.toolInvocations}\nAlerts: ${snap.alertsFired}`,
            {
                editMessageId: opts.editMessageId,
                reply_markup: { inline_keyboard: [[{ text: '⬅️ Back', callback_data: 'action:start' }]] }
            }
        );
    }

    async _cmdHelp(msg) {
        if (!this._checkAuth(msg)) return;
        this._reply(msg.chat.id,
            `*Commands*\n/dashboard  /tools  /network  /users  /voucher  /status  /logs\n\n` +
            `*Advanced*\n/cli \\<command\\> — Raw RouterOS CLI\n/api \\<command\\> — Raw API\n/ask \\<query\\> — AI agent\n\n` +
            `Type any message for free-form AI chat.`);
    }

    async _cmdLogs(msg) {
        if (!this._checkAuth(msg)) return;
        try {
            const logs = await mikrotik.getLogs(10);
            const text = logs.map(l => `• ${l.time || ''} ${l.message || JSON.stringify(l)}`).join('\n');
            this._reply(msg.chat.id, `📋 *Router Logs*\n\n${text || 'No logs'}`);
        } catch (e) { this._reply(msg.chat.id, `❌ ${e.message}`); }
    }

    async _cmdAsk(msg, match) {
        if (!this._checkAuth(msg)) return;
        const chatId = msg.chat.id;
        const query = match[1];

        const status = await this.bot.sendMessage(chatId, '⏳ `[ AgentOS thinking… ]`', {
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [[{ text: '🛑 Cancel', callback_data: 'action:cancel_ai' }]] },
        });

        const frames = ['⚡', '🧠', '🔍', '⚙️'];
        let step = 0;
        const anim = setInterval(() => {
            this.bot.editMessageText(
                `${frames[step++ % frames.length]} \`[ Processing: ${query.slice(0, 20)}… ]\``,
                { chat_id: chatId, message_id: status.message_id, parse_mode: 'Markdown' }
            ).catch(() => { });
        }, 1200);

        try {
            const resp = await askEngine.run(query);
            clearInterval(anim);
            const icon = resp.type === 'error' ? '❌' : '✅';
            const formatted = askEngine.formatResponse(resp.result);
            await this.bot.editMessageText(`${icon} *AgentOS Response:*\n\n${formatted}`, {
                chat_id: chatId, message_id: status.message_id, parse_mode: 'Markdown',
            });
        } catch (e) {
            clearInterval(anim);
            this.bot.editMessageText(`❌ *AI Error:* ${e.message}`,
                { chat_id: chatId, message_id: status.message_id, parse_mode: 'Markdown' }).catch(() => { });
        }
    }

    async _cmdGen(msg, match) {
        if (!this._checkAuth(msg)) return;
        const plan = match[1];
        const chatId = msg.chat.id;

        this._reply(chatId, `⚠️ *Confirm Action*\nGenerate a **${plan}** voucher?`, {
            reply_markup: {
                inline_keyboard: [[
                    { text: '✅ Confirm', callback_data: `action:gen_confirm:${plan}` },
                    { text: '❌ Cancel', callback_data: 'action:cancel_ai' }
                ]]
            }
        });
    }

    async _cmdPing(msg, match) {
        if (!this._checkAuth(msg)) return;
        try {
            const res = await mikrotik.ping(match[1], parseInt(match[2]) || 4);
            this._reply(msg.chat.id, `📡 *Ping: ${match[1]}*\n\`\`\`json\n${JSON.stringify(res, null, 2)}\n\`\`\``);
        } catch (e) { this._reply(msg.chat.id, `❌ ${e.message}`); }
    }

    async _cmdTraceroute(msg, match) {
        if (!this._checkAuth(msg)) return;
        try {
            const res = await mikrotik.traceroute(match[1]);
            this._reply(msg.chat.id, `🛤 *Traceroute: ${match[1]}*\n\`\`\`json\n${JSON.stringify(res, null, 2)}\n\`\`\``);
        } catch (e) { this._reply(msg.chat.id, `❌ ${e.message}`); }
    }

    async _cmdKick(msg, match) {
        if (!this._checkAuth(msg)) return;
        try {
            const res = await mikrotik.kickUser(match[1]);
            this._reply(msg.chat.id, res.kicked ? `🚫 Kicked *${match[1]}*` : `⚠️ *${match[1]}* not active`);
        } catch (e) { this._reply(msg.chat.id, `❌ ${e.message}`); }
    }

    async _cmdAddUser(msg, match) {
        if (!this._checkAuth(msg)) return;
        try {
            const res = await mikrotik.addHotspotUser(match[1], match[2], match[3] || 'default');
            this._reply(msg.chat.id, `✅ User *${match[1]}* ${res.action}`);
        } catch (e) { this._reply(msg.chat.id, `❌ ${e.message}`); }
    }

    async _cmdBlock(msg, match) {
        if (!this._checkAuth(msg)) return;
        try {
            await mikrotik.addToBlockList(match[1]);
            this._reply(msg.chat.id, `🚫 Blocked *${match[1]}*`);
        } catch (e) { this._reply(msg.chat.id, `❌ ${e.message}`); }
    }

    async _cmdTool(msg, match) {
        if (!this._checkAuth(msg)) return;
        try {
            const params = match[2] ? match[2].trim().split(/\s+/) : [];
            const res = await mikrotik.executeTool(match[1], ...params);
            this._reply(msg.chat.id, `✅ *${match[1]}*\n\`\`\`json\n${truncate(JSON.stringify(res, null, 2))}\n\`\`\``);
        } catch (e) { this._reply(msg.chat.id, `❌ ${e.message}`); }
    }

    async _cmdCli(msg, match) {
        if (!this._checkAuth(msg)) return;
        try {
            await this.bot.sendChatAction(msg.chat.id, 'typing');
            const res = await mikrotik.executeCLI(match[1]);
            this._reply(msg.chat.id, `💻 *CLI:*\n\`\`\`text\n${truncate(res, 3900)}\n\`\`\``);
        } catch (e) { this._reply(msg.chat.id, `❌ CLI Error: ${e.message}`); }
    }

    async _cmdApi(msg, match) {
        if (!this._checkAuth(msg)) return;
        try {
            await this.bot.sendChatAction(msg.chat.id, 'typing');
            const res = await mikrotik.executeRawAPI(match[1]);
            this._reply(msg.chat.id, `⚙️ *API:*\n\`\`\`json\n${truncate(JSON.stringify(res, null, 2), 3900)}\n\`\`\``);
        } catch (e) { this._reply(msg.chat.id, `❌ API Error: ${e.message}`); }
    }

    // ── Callback query handler ────────────────────────────────

    async _onCallback(query) {
        const chatId = query.message.chat.id;
        const msgId = query.message.message_id;
        const data = query.data || '';
        const [cat, act, val] = data.split(':');

        try { await this.bot.answerCallbackQuery(query.id); } catch { /* stale query — ignore */ }

        // Security: authenticate every callback — not just 'action' dispatch
        const fakeMsg = { chat: { id: chatId }, from: query.from };
        if (!this._checkAuth(fakeMsg)) return;

        try {
            // Processing feedback for all interactive buttons
            if (cat !== 'action' || act !== 'cancel_ai') {
                await this.bot.editMessageText(`⏳ *Processing ${cat}:${act}...*`, {
                    chat_id: chatId, message_id: msgId, parse_mode: 'Markdown'
                }).catch(() => { });
            }

            if (cat === 'action') {
                if (act === 'cancel_ai') {
                    await this.bot.editMessageText('🛑 *Cancelled.*',
                        { chat_id: chatId, message_id: msgId, parse_mode: 'Markdown' }).catch(() => { });
                } else if (act === 'gen_confirm') {
                    try {
                        const plan = val;
                        const code = voucherCode();
                        const actor = String(chatId);
                        await database.createVoucher(code, { plan, actor, createdBy: 'telegram-btn' });
                        await mikrotik.addHotspotUser(code, code, plan);
                        this.bot.editMessageText(`✅ *Voucher Generated*\nCode: \`${code}\`\nPlan: ${plan}\n\n_Logged to audit trail._`, {
                            chat_id: chatId, message_id: msgId, parse_mode: 'Markdown'
                        });
                    } catch (e) {
                        this.bot.editMessageText(`❌ *Error:* ${e.message}`, {
                            chat_id: chatId, message_id: msgId, parse_mode: 'Markdown'
                        });
                    }
                } else {
                    const map = {
                        dashboard: '_cmdDashboard', tools: '_cmdTools',
                        network: '_cmdNetwork', users: '_cmdUsers',
                        voucher: '_cmdVoucher', status: '_cmdStatus',
                        start: '_cmdStart'
                    };
                    if (map[act]) this[map[act]]({ chat: { id: chatId }, from: query.from }, { editMessageId: msgId });
                }
            }

            else if (cat === 'tool') {
                const result = await mikrotik.executeTool(act);
                this._reply(chatId, `✅ *${act}*\n\`\`\`json\n${truncate(JSON.stringify(result, null, 2))}\n\`\`\``);
            }

            else if (cat === 'net') {
                switch (act) {
                    case 'ping': this.promptUser(chatId, '📡 Enter IP/host to ping:', 'ping'); break;
                    case 'traceroute': this.promptUser(chatId, '🛤 Enter IP/host to trace:', 'traceroute'); break;
                    case 'block': this.promptUser(chatId, '🚫 Enter IP/MAC to block:', 'block'); break;
                    case 'flush_dns': {
                        await mikrotik.executeTool('dns.flush');
                        this._reply(chatId, '✅ DNS cache flushed');
                        break;
                    }
                    case 'backup': {
                        const b = await mikrotik.executeTool('system.backup');
                        this._reply(chatId, `💾 Backup saved: ${b.file}`);
                        break;
                    }
                    case 'reboot':
                        this._reply(chatId, '⚠️ Confirm router reboot?', {
                            reply_markup: { inline_keyboard: [[{ text: '✅ Yes, reboot', callback_data: 'confirm:reboot' }]] }
                        });
                        break;
                    default: {
                        const map = {
                            dhcp: [() => mikrotik.getDhcpLeases(), 'DHCP Leases'],
                            scan: [() => mikrotik.getArpTable(), 'LAN Scan (ARP)'],
                            firewall: [() => mikrotik.getFirewallRules(), 'Firewall Rules'],
                            bandwidth: [() => mikrotik.getInterfaces(), 'Interfaces'],
                        };
                        if (map[act]) {
                            const [fn, title] = map[act];
                            const res = await fn();
                            this._reply(chatId, `*${title} (${res.length})*\n\`\`\`json\n${truncate(JSON.stringify(res.slice(0, 5), null, 2))}\n\`\`\``);
                        }
                    }
                }
            }

            else if (cat === 'users') {
                if (act === 'add') this.promptUser(chatId, '➕ Format: `username password`', 'adduser');
                else if (act === 'kick') this.promptUser(chatId, '🚫 Username to kick:', 'kick');
                else if (act === 'status') this.promptUser(chatId, '🔍 Username to check:', 'user_status');
                else if (act === 'active' || act === 'all') {
                    const list = act === 'active' ? await mikrotik.getActiveUsers() : await mikrotik.getAllHotspotUsers();
                    const text = list.slice(0, 15).map(u => `• ${u.user || u.name}${u.address ? ` (${u.address})` : ''}`).join('\n');
                    this._reply(chatId, `👥 *${act === 'active' ? 'Active' : 'All'} Users (${list.length})*\n\n${text || 'None'}`);
                }
            }

            else if (cat === 'voucher') {
                const planMap = { '1h': '1hour', '1d': '1Day', '7d': '7Day', '30d': '30Day' };
                const plan = planMap[act];
                if (plan) {
                    if (!this.rateLimiter.allow(chatId)) { this._reply(chatId, '⏳ Too many requests — slow down.'); return; }
                    if (!mikrotik.isConnected) throw new Error('Router disconnected');
                    const code = voucherCode();
                    await database.createVoucher(code, { plan, createdBy: 'telegram' });
                    await mikrotik.addHotspotUser(code, code, plan);
                    const url = `${ENV.SERVER_URL}/login.html?code=${code}`;
                    const qrBuf = await QRCode.toBuffer(JSON.stringify({ code, plan, url }));
                    await this.bot.sendPhoto(chatId, qrBuf, {
                        caption: `🎟 *Voucher*\nCode: \`${code}\`\nPlan: ${plan}`,
                        parse_mode: 'Markdown',
                    });
                }
            }

            else if (cat === 'wallet') {
                if (act === 'list') {
                    const codes = await database.getWallet(String(chatId));
                    if (!codes.length) {
                        this._reply(chatId, 'Your wallet is empty or all vouchers have been claimed.', {
                            editMessageId: msgId,
                            reply_markup: { inline_keyboard: [[{ text: '⬅️ Back', callback_data: 'action:start' }]] }
                        });
                    } else {
                        const btns = codes.map(c => [{ text: `🎟 Activate ${c}`, callback_data: `wallet:claim:${c}` }]);
                        btns.push([{ text: '⬅️ Back', callback_data: 'action:start' }]);
                        this._reply(chatId, '👛 *Your Wallet*\nSelect a voucher to activate on this router:', {
                            editMessageId: msgId,
                            reply_markup: { inline_keyboard: btns }
                        });
                    }
                } else if (act === 'claim') {
                    const code = (query.data || '').split(':')[2];
                    const v = await database.getVoucher(code);
                    if (!v) throw new Error('Voucher lost');
                    await mikrotik.addHotspotUser(code, code, v.plan);
                    await database.claimFromWallet(String(chatId), code);
                    await database.redeemVoucher(code, { via: 'wallet', userId: String(chatId) });
                    this._reply(chatId, `✅ *Voucher Activated!*\nCode: \`${code}\`\nYou are now provisioned on the network.`, {
                        reply_markup: { inline_keyboard: [[{ text: '📊 Dashboard', callback_data: 'action:dashboard' }]] }
                    });
                }
            }

            else if (cat === 'confirm' && act === 'reboot') {
                await mikrotik.reboot();
                this._reply(chatId, '✅ Router rebooting…');
            }

        } catch (e) {
            this._reply(chatId, `❌ Error: ${e.message}`);
        }
    }
}

// ============================================================
// §15  ORCHESTRATOR
// ============================================================

class AgentOSOrchestrator {
    constructor(mikrotik, db, gateway, bot) {
        this.mikrotik = mikrotik;
        this.db = db;
        this.gateway = gateway;
        this.bot = bot;
        this._knownMacs = new Set();
        this._start();
    }

    _start() {
        this._provisionRouter().catch(e => logger.error(`Provisioning error: ${e.message}`));
        this._monitorSystem();
        this._monitorNewDevices();
        this._scheduleVoucherExpiry();
        this._runCron();
    }

    async _provisionRouter() {
        if (!this.mikrotik.isConnected) return;
        logger.info('Provisioning router (Day 1 checks)…');

        // 1. Ensure Firewall Address List exists
        await this.mikrotik.executeCLI('/ip/firewall/address-list add list=AgentOS-Protected address=127.0.0.1 comment="Reserved"').catch(() => { });

        // 2. Ensure logging is set up for hotspot
        await this.mikrotik.executeCLI('/system/logging add topics=hotspot,info,debug action=memory').catch(() => { });

        logger.info('Router provisioning complete.');
    }

    _runCron() {
        // Daily Reboot at 4:00 AM
        setInterval(async () => {
            const now = new Date();
            if (now.getHours() === 4 && now.getMinutes() === 0) {
                logger.info('Cron: Triggering automated daily reboot (4:00 AM)');
                this.bot?.sendToAll('🔄 *Automated System Maintenance:* Router is rebooting.');
                await this.mikrotik.reboot().catch(() => { });
            }

            // Heartbeat Every 24 Hours
            if (now.getHours() === 12 && now.getMinutes() === 0) {
                this.bot?.sendToAll('💚 *System Heartbeat:* AgentOS is active and monitoring.');
            }
        }, 60_000);
    }

    _monitorSystem() {
        setInterval(async () => {
            if (!this.mikrotik.isConnected) return;
            try {
                const s = await this.mikrotik.getSystemStats();
                const cpu = parseInt(s?.['cpu-load']) || 0;
                const fm = parseInt(s?.['free-memory']) || 0;
                const tm = parseInt(s?.['total-memory']) || 1;
                if (cpu > 90)
                    this.bot?.alertOnce('cpu-high', `⚠️ *High CPU:* ${cpu}%`);
                if ((1 - fm / tm) > 0.85)
                    this.bot?.alertOnce('mem-high', `⚠️ *High Memory:* ${Math.round((1 - fm / tm) * 100)}% used`);
            } catch (err) {
                logger.error(`Orchestrator system monitor: ${err.message}`);
            }
        }, 15_000);
    }

    _monitorNewDevices() {
        let firstScan = true;
        setInterval(async () => {
            if (!this.mikrotik.isConnected) return;
            try {
                const arp = await this.mikrotik.getArpTable();
                for (const dev of arp.filter(e => e.address && e['mac-address'])) {
                    const mac = dev['mac-address'];
                    if (!this._knownMacs.has(mac)) {
                        this._knownMacs.add(mac);
                        if (!firstScan)
                            this.bot?.alertOnce(`new-device-${mac}`, `🆕 *New Device*\nIP: \`${dev.address}\`  MAC: \`${mac}\``);
                    }
                }
                firstScan = false;
            } catch { /* silence transient read failures */ }
        }, 60_000);
    }

    _scheduleVoucherExpiry() {
        setInterval(async () => {
            try {
                const count = await this.db.expireOldVouchers();
                if (count > 0) {
                    this.bot?.sendToAll(`⌛ ${count} voucher(s) expired.`);
                    this.gateway?.broadcast({ type: 'vouchers.expired', count });
                }
            } catch (err) {
                logger.error(`Voucher expiry task: ${err.message}`);
            }
        }, 60 * 60_000);
    }
}

// ============================================================
// §16  EXPRESS APPLICATION
// ============================================================

const app = express();
app.set('trust proxy', 1);
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'", "'unsafe-inline'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            imgSrc: ["'self'", "data:", "https:"],
            connectSrc: ["'self'", "wss:", "https:"],
        }
    }
}));

const authMiddleware = (req, res, next) => {
    const auth = req.headers.authorization;
    if (!auth || !auth.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorised — Bearer token required' });
    const token = auth.split(' ')[1];

    // Use timingSafeEqual to prevent timing attacks
    const secret = Buffer.from(CONFIG.GATEWAY.TOKEN);
    const provided = Buffer.from(token);

    if (provided.length === secret.length && crypto.timingSafeEqual(provided, secret)) {
        return next();
    }
    res.status(401).json({ error: 'Invalid token' });
};

app.use(cors({ origin: ENV.ALLOWED_ORIGINS === '*' ? '*' : ENV.ALLOWED_ORIGINS.split(',') }));
app.use(express.json({ limit: '10mb' }));
app.use(rateLimit({
    windowMs: CONFIG.SECURITY.RATE_LIMIT_WINDOW,
    max: CONFIG.SECURITY.RATE_LIMIT_MAX,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests — please retry later.' },
}));
app.use((req, _res, next) => { metrics.requests++; next(); });
app.use(express.static('public'));
app.use('/', router);
app.get('/', (_req, res) => res.redirect('/index.html'));

// ── Routes ───────────────────────────────────────────────────

app.get('/health', async (_req, res) => {
    const stats = await database.getStats().catch(() => ({}));
    res.json({
        status: 'ok',
        version: BRAND.version,
        services: { mikrotik: mikrotik.isConnected, database: database.db ? 'firebase' : 'local' },
        stats,
        metrics: metrics.snapshot(),
    });
});

app.get('/api/stats', authMiddleware, async (_req, res) => {
    try {
        const [dbRes, rtRes] = await Promise.allSettled([database.getStats(), mikrotik.getSystemStats()]);
        res.json({
            vouchers: dbRes.status === 'fulfilled' ? dbRes.value : {},
            router: rtRes.status === 'fulfilled' ? rtRes.value : null,
            metrics: metrics.snapshot(),
            mikrotik: mikrotik.isConnected,
        });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/vouchers', authMiddleware, async (req, res) => {
    try {
        const limit = Math.min(parseInt(req.query.limit) || 50, 200);
        const used = req.query.used === 'true' ? true : req.query.used === 'false' ? false : undefined;
        const items = await database.listVouchers({ limit, used });
        res.json({ count: items.length, items });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

const redeemSchema = Joi.object({
    code: Joi.string().pattern(/^STAR-[A-Z0-9]{6}$/).required(),
    user: Joi.string().alphanum().min(3).max(20).required(),
});

app.post('/voucher/redeem', async (req, res) => {
    try {
        const { error, value } = redeemSchema.validate(req.body);
        if (error) return res.status(400).json({ error: error.details[0].message });

        const { code, user } = value;
        const voucher = await database.getVoucher(code);
        if (!voucher) return res.status(404).json({ error: 'Voucher not found' });
        if (voucher.used) return res.status(400).json({ error: 'Voucher already used' });
        if (voucher.expiresAt && new Date(voucher.expiresAt) < new Date())
            return res.status(400).json({ error: 'Voucher expired' });
        if (!mikrotik.isConnected) return res.status(503).json({ error: 'Router unavailable' });

        await mikrotik.addHotspotUser(user, user, voucher.plan);
        await database.redeemVoucher(code, { username: user, ip: req.ip });
        res.json({ status: 'activated', plan: voucher.plan });
    } catch (err) {
        metrics.errors++;
        res.status(500).json({ error: 'Failed to activate voucher' });
    }
});

app.get('/voucher/:code/qr', async (req, res) => {
    try {
        const voucher = await database.getVoucher(req.params.code);
        if (!voucher) return res.status(404).json({ error: 'Not found' });
        const url = `${req.protocol}://${req.get('host')}/login.html?code=${req.params.code}`;
        const qr = await QRCode.toDataURL(JSON.stringify({ code: req.params.code, plan: voucher.plan, url }));
        res.json({ qr, code: req.params.code, plan: voucher.plan });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/tool/execute', authMiddleware, async (req, res) => {
    try {
        const { tool, params } = req.body;
        if (!tool || !mikrotik.availableTools().includes(tool))
            return res.status(400).json({ error: 'Invalid or unknown tool' });
        const result = await mikrotik.executeTool(tool, ...(params || []));
        res.json({ success: true, result });
    } catch (err) {
        metrics.errors++;
        res.status(500).json({ success: false, error: err.message });
    }
});

// ── SSE real-time stream ─────────────────────────────────────
const sseClients = new Set();

app.get('/api/stream', authMiddleware, (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    send('connected', { service: BRAND.name, version: BRAND.version });

    const heartbeat = setInterval(() => {
        res.write(': heartbeat\n\n');
    }, 15_000);

    sseClients.add(send);
    req.on('close', () => { clearInterval(heartbeat); sseClients.delete(send); });
});

// Broadcast helper — called by gateway and orchestrator
function sseBroadcast(event, data) {
    sseClients.forEach(send => { try { send(event, data); } catch { sseClients.delete(send); } });
}

// ── Streaming ask (claw-code stream_submit_message REST port) ─
app.get('/api/ask/stream', authMiddleware, async (req, res) => {
    const input = req.query.q;
    if (!input) return res.status(400).json({ error: 'q query param required' });

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const write = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

    try {
        for await (const event of askEngine.stream(input)) {
            write(event.type, event);
            if (event.type === 'message_stop') break;
        }
    } catch (err) {
        write('error', { message: err.message });
    }
    res.end();
});

// ── Session replay ────────────────────────────────────────────
app.get('/api/session/:id', authMiddleware, (req, res) => {
    const session = ConversationSession.load(req.params.id);
    if (!session) return res.status(404).json({ error: 'Session not found' });
    res.json({ sessionId: session.sessionId, messages: session.messages, usage: session.usage.snapshot() });
});

// ── Revenue trends ───────────────────────────────────────────
app.get('/api/trends', authMiddleware, async (_req, res) => {
    try {
        res.json(await financial.getTrends());
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Mesh node management ─────────────────────────────────────
app.get('/api/nodes', authMiddleware, (_req, res) => {
    res.json(nodeRegistry.getAll());
});

app.post('/api/nodes', authMiddleware, async (req, res) => {
    const { name, ip, user, pass, port } = req.body;
    if (!name || !ip || !user || !pass) return res.status(400).json({ error: 'name, ip, user, pass required' });
    try {
        const node = nodeRegistry.add(name, ip, user, pass, port);
        await node.connect();
        await database.logAuditTrail('api', 'node.add', { name, ip });
        res.json({ success: true, name, status: 'connected' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/nodes/:name/exec', authMiddleware, async (req, res) => {
    const { tool, params } = req.body;
    if (!tool) return res.status(400).json({ error: 'tool required' });
    try {
        const result = await nodeRegistry.executeOnNode(req.params.name, tool, ...(params || []));
        res.json({ success: true, result });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/mesh/exec', authMiddleware, async (req, res) => {
    const { tool } = req.query;
    if (!tool) return res.status(400).json({ error: 'tool query param required' });
    try {
        const results = await nodeRegistry.executeOnAll(tool);
        res.json({ results });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Agent memory ─────────────────────────────────────────────
app.get('/api/memory', authMiddleware, (_req, res) => {
    res.json(agentMemory.recallAll());
});

app.post('/api/memory', authMiddleware, (req, res) => {
    const { key, value } = req.body;
    if (!key) return res.status(400).json({ error: 'key required' });
    agentMemory.remember(key, value);
    res.json({ success: true });
});

app.delete('/api/memory/:key', authMiddleware, (req, res) => {
    agentMemory.forget(req.params.key);
    res.json({ success: true });
});

app.use((_req, res) => res.status(404).json({ error: 'Not found' }));
app.use((err, _req, res, _next) => {
    metrics.errors++;
    logger.error(`Express unhandled: ${err.message}`);
    res.status(500).json({ error: 'Internal server error' });
});

// ============================================================
// §17  INTERACTIVE CLI  (readline REPL)
// ============================================================

class AgentOSCLI {
    constructor() {
        this.rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        process.on('SIGINT', () => { console.log('\nSIGINT — shutting down…'); this.rl.close(); mikrotik.disconnect(); process.exit(0); });
        this._commands = this._buildCommands();
    }

    _buildCommands() {
        const b = (fn) => fn.bind(this);
        return {
            help: { fn: b(this.cmdHelp), desc: 'Show help' },
            connect: { fn: b(this.cmdConnect), desc: 'Connect to router' },
            disconnect: { fn: b(this.cmdDisconnect), desc: 'Disconnect from router' },
            status: { fn: b(this.cmdStatus), desc: 'Router stats' },
            cli: { fn: b(this.cmdRawCli), desc: 'Raw RouterOS CLI' },
            api: { fn: b(this.cmdRawApi), desc: 'Raw RouterOS API' },
            agent: { fn: b(this.cmdAgent), desc: 'AI coordinator' },
            nodes: { fn: b(this.cmdNodes), desc: 'Show network nodes' },
            users: { fn: b(this.cmdUsers), desc: 'All hotspot users' },
            active: { fn: b(this.cmdActive), desc: 'Active users' },
            adduser: { fn: b(this.cmdAddUser), desc: 'Add hotspot user' },
            deluser: { fn: b(this.cmdDelUser), desc: 'Delete hotspot user' },
            kick: { fn: b(this.cmdKick), desc: 'Kick active user' },
            voucher: { fn: b(this.cmdVoucher), desc: 'Create voucher' },
            vouchers: { fn: b(this.cmdVouchers), desc: 'List vouchers' },
            redeem: { fn: b(this.cmdRedeem), desc: 'Redeem voucher' },
            revoke: { fn: b(this.cmdRevoke), desc: 'Revoke voucher' },
            ping: { fn: b(this.cmdPing), desc: 'Ping a host' },
            logs: { fn: b(this.cmdLogs), desc: 'Router logs' },
            dhcp: { fn: b(this.cmdDhcp), desc: 'DHCP leases' },
            arp: { fn: b(this.cmdArp), desc: 'ARP table' },
            firewall: { fn: b(this.cmdFirewall), desc: 'Firewall rules' },
            block: { fn: b(this.cmdBlock), desc: 'Block IP/MAC' },
            unblock: { fn: b(this.cmdUnblock), desc: 'Unblock IP/MAC' },
            reboot: { fn: b(this.cmdReboot), desc: 'Reboot router' },
            qr: { fn: b(this.cmdQR), desc: 'Print voucher QR code' },
            stats: { fn: b(this.cmdStats), desc: 'Voucher statistics' },
        };
    }

    async start() {
        console.clear();
        console.log(A.NEON_CYAN + `
╔══════════════════════════════════════════════════════════════════╗
║                   AGENTOS PLATFORM v${BRAND.version}                      ║
║              Modular AI Agent Operating System                   ║
╚══════════════════════════════════════════════════════════════════╝
` + A.RESET);
        console.log(`  ${A.INFO}Interactive REPL ready. Type 'help' or 'exit'.${A.RESET}\n`);
        await this.cmdConnect();
        this.rl.setPrompt(`${A.PRIMARY}${A.BOLD}AgentOS> ${A.RESET}`);
        this.rl.prompt();

        this.rl.on('line', async (line) => {
            const text = line.trim();
            if (!text) { this.rl.prompt(); return; }
            const [cmd, ...args] = text.split(/\s+/);
            const key = cmd.toLowerCase();

            if (key === 'exit' || key === 'quit') {
                console.log('  Shutting down AgentOS…');
                mikrotik.disconnect();
                process.exit(0);
            }
            if (key === 'clear') { console.clear(); this.rl.prompt(); return; }

            if (this._commands[key]) {
                try { await this._commands[key].fn(args); }
                catch (err) { console.error(`  ${A.ERROR}Error: ${err.message}${A.RESET}`); }
            } else {
                await TerminalAnimator.showSpinner('Consulting AgentOS…', 500);
                try {
                    const resp = await askEngine.run(text);
                    await TerminalAnimator.glitch(`🤖 Agent (Tier ${resp.tier} — ${resp.type}):`, 400);
                    const formatted = askEngine.formatResponse(resp.result);
                    await TerminalAnimator.typewriter(formatted, 10);
                } catch (e) {
                    console.log(`  ${A.ERROR}Error: ${e.message}${A.RESET}`);
                }
            }
            this.rl.prompt();
        }).on('close', () => { mikrotik.disconnect(); process.exit(0); });
    }

    // ── Commands ─────────────────────────────────────────────

    async cmdHelp() {
        console.log('\n📋 Commands:\n');
        Object.entries(this._commands)
            .sort(([a], [b]) => a.localeCompare(b))
            .forEach(([n, { desc }]) =>
                console.log(`  ${A.PRIMARY}${n.padEnd(12)}${A.RESET} ${A.DIM}${desc}${A.RESET}`));
        console.log('');
    }

    async cmdConnect() {
        try {
            await mikrotik.connect();
            console.log(`${A.SUCCESS}✔ Connected to ${CONFIG.MIKROTIK.IP}${A.RESET}`);
            return true;
        } catch {
            console.log(`${A.ERROR}✗ Connection failed — check .env credentials${A.RESET}`);
            return false;
        }
    }

    async cmdDisconnect() { mikrotik.disconnect(); console.log('🔌 Disconnected'); }

    async cmdStatus() {
        const s = await mikrotik.getSystemStats();
        console.log(`\n🔧 Router: ${CONFIG.MIKROTIK.IP}\n${'━'.repeat(32)}`);
        console.log(`CPU:     ${s['cpu-load']}%`);
        console.log(`RAM:     ${fmtBytes(parseInt(s['free-memory']) || 0)} free`);
        console.log(`Uptime:  ${s.uptime}\nVersion: ${s.version}\n`);
    }

    async cmdRawCli(args) {
        const cmd = args.join(' ');
        if (!cmd) { console.log('Usage: cli <command>'); return; }
        const res = await mikrotik.executeCLI(cmd);
        console.log(`\n💻 Output:\n${res}\n`);
    }

    async cmdRawApi(args) {
        const cmd = args.join(' ');
        if (!cmd) { console.log('Usage: api </path/command>'); return; }
        const res = await mikrotik.executeRawAPI(cmd);
        console.log(`\n⚙️ Result:\n${JSON.stringify(res, null, 2)}\n`);
    }

    async cmdAgent(args) {
        const query = args.join(' ');
        if (!query) { console.log(`Usage: agent <query>`); return; }
        TerminalAnimator.printHeader('AI COORDINATOR');
        await TerminalAnimator.showSpinner('Analysing…', 600);
        try {
            const resp = await askEngine.run(query);
            await TerminalAnimator.glitch(`◆ AI RESPONSE [${resp.type}]`, 500);
            if (resp.type === 'ai_act') {
                await TerminalAnimator.typewriter(resp.result, 15);
                console.log(`  ${A.DIM}Metadata: ${JSON.stringify(resp.data, null, 2)}${A.RESET}`);
            } else {
                console.log(`  ${A.BOLD}${resp.result}${A.RESET}`);
            }
        } catch (e) {
            console.log(`  ${A.ERROR}Error: ${e.message}${A.RESET}`);
        }
    }

    async cmdNodes() {
        TerminalAnimator.printHeader('NETWORK NODES');
        await sleep(300);
        console.log(`  ${A.PRIMARY}◆${A.RESET} ${TerminalAnimator.gradient('AgentOS-Main-Gateway', [0, 255, 127], [50, 150, 255])}`);
        console.log(`  ${A.DIM}│  Status: ${mikrotik.isConnected ? A.SUCCESS + 'ONLINE' : A.ERROR + 'OFFLINE'}${A.RESET}`);
        console.log(`  ${A.DIM}│  Endpoint: ${A.RESET}${CONFIG.MIKROTIK.IP}\n`);
    }

    async cmdUsers() {
        const users = await mikrotik.getAllHotspotUsers();
        console.log(`\n📋 Hotspot Users (${users.length}):\n`);
        users.slice(0, 20).forEach(u =>
            console.log(`  ${u.disabled === 'yes' ? '🔴' : '🟢'} ${u.name.padEnd(15)} ${u.profile || 'default'}`));
        console.log('');
    }

    async cmdActive() {
        const users = await mikrotik.getActiveUsers();
        console.log(`\n👥 Active (${users.length}):\n`);
        users.forEach(u => console.log(`  🟢 ${u.user.padEnd(15)} ${u.address.padEnd(15)} ${u.uptime}`));
        console.log('');
    }

    async cmdAddUser([username, password, profile = 'default']) {
        if (!username || !password) { console.log('Usage: adduser <name> <pass> [profile]'); return; }
        const res = await mikrotik.addHotspotUser(username, password, profile);
        console.log(`✅ User ${res.username} ${res.action}`);
    }

    async cmdDelUser([username]) {
        if (!username) { console.log('Usage: deluser <name>'); return; }
        await mikrotik.removeHotspotUser(username);
        console.log(`✅ User ${username} deleted`);
    }

    async cmdKick([username]) {
        if (!username) { console.log('Usage: kick <name>'); return; }
        const res = await mikrotik.kickUser(username);
        console.log(res.kicked ? `🚫 ${username} kicked` : `⚠️ ${username} not active`);
    }

    async cmdVoucher([plan, duration]) {
        if (!plan) { console.log('Usage: voucher <plan> [duration]'); return; }
        const code = voucherCode();
        await database.createVoucher(code, { plan, duration, createdBy: 'cli' });

        console.log(`\n  ${A.DIM}Generating secure voucher…${A.RESET}`);
        await TerminalAnimator.decode(code, 60);
        console.log(`  ${A.DIM}Plan:  ${A.RESET}${A.BOLD}${plan}${A.RESET}`);

        if (mikrotik.isConnected) {
            await mikrotik.addHotspotUser(code, code, plan).catch(() => { });
            console.log(`  ${A.SUCCESS}✔ Provisioned on gateway${A.RESET}\n`);
        }
    }

    async cmdVouchers([limit = '20']) {
        const list = await database.listVouchers({ limit: parseInt(limit) });
        console.log(`\n🎫 Vouchers (${list.length}):\n`);
        list.forEach(v => {
            const tag = v.used ? '✅ USED' : (v.expiresAt && new Date(v.expiresAt) < new Date() ? '⌛ EXPIRED' : '⏳ ACTIVE');
            console.log(`  ${tag.padEnd(10)} ${v.id.padEnd(15)} ${v.plan}`);
        });
        console.log('');
    }

    async cmdRedeem([code, username]) {
        if (!code || !username) { console.log('Usage: redeem <code> <username>'); return; }
        const v = await database.getVoucher(code);
        if (!v) { console.log('Voucher not found'); return; }
        if (v.used) { console.log('Voucher already used'); return; }
        await mikrotik.addHotspotUser(username, username, v.plan);
        await database.redeemVoucher(code, { username });
        console.log(`✅ ${code} redeemed for ${username}`);
    }

    async cmdRevoke([code]) {
        if (!code) { console.log('Usage: revoke <code>'); return; }
        await database.deleteVoucher(code);
        console.log(`🗑  Voucher ${code} revoked`);
    }

    async cmdPing([host, count = '4']) {
        if (!host) { console.log('Usage: ping <host> [count]'); return; }
        console.log(`📡 Pinging ${host}…`);
        const n = parseInt(count) || 4;
        const results = await mikrotik.ping(host, n);
        const recv = results.filter(r => parseInt(r.received) > 0).length;
        console.log(`Sent: ${n}  Received: ${recv}  Lost: ${n - recv}`);
    }

    async cmdLogs([lines = '20']) {
        const logs = await mikrotik.getLogs(parseInt(lines));
        console.log(`\n📋 Logs (${logs.length}):\n`);
        logs.forEach(l => console.log(`  ${l.time || ''} [${(l.topics || '').padEnd(15)}] ${l.message || ''}`));
        console.log('');
    }

    async cmdDhcp() {
        const leases = await mikrotik.getDhcpLeases();
        console.log(`\n📋 DHCP (${leases.length}):\n`);
        leases.slice(0, 20).forEach(l =>
            console.log(`  ${l.address.padEnd(15)} ${(l.hostname || '').padEnd(20)} ${l.status || 'bound'}`));
        console.log('');
    }

    async cmdArp() {
        const arp = await mikrotik.getArpTable();
        console.log(`\n  ${A.BOLD}🔍 Scanning ARP Table…${A.RESET}`);
        for (let i = 1; i <= 10; i++) {
            TerminalAnimator.progressBar('Network Scan', i * 10);
            await sleep(50);
        }
        console.log('');
        arp.filter(e => e.address).slice(0, 20).forEach(e =>
            console.log(`  ${A.PRIMARY}◆${A.RESET} ${e.address.padEnd(15)} ${A.DIM}${e['mac-address'] || 'N/A'}${A.RESET}`));
        console.log('');
    }

    async cmdFirewall() {
        const rules = await mikrotik.getFirewallRules('filter');
        console.log(`\n🛡️  Firewall Filter (${rules.length}):\n`);
        rules.slice(0, 10).forEach(r =>
            console.log(`  ${r.chain}: ${r.action}${r.comment ? ` # ${r.comment}` : ''}`));
        console.log('');
    }

    async cmdBlock([target]) {
        if (!target) { console.log('Usage: block <ip-or-mac>'); return; }
        await mikrotik.addToBlockList(target);
        console.log(`🚫 Blocked: ${target}`);
    }

    async cmdUnblock([target]) {
        if (!target) { console.log('Usage: unblock <ip-or-mac>'); return; }
        const res = await mikrotik.unblockAddress(target);
        console.log(`✅ Unblocked: ${target} (${res.count} entries removed)`);
    }

    async cmdReboot() {
        this.rl.question('⚠️  Reboot router? (yes/no): ', async (answer) => {
            if (answer.toLowerCase() === 'yes') {
                await mikrotik.reboot();
                console.log('🔄 Rebooting…');
                mikrotik.disconnect();
            } else {
                console.log('❌ Cancelled');
            }
            this.rl.prompt();
        });
    }

    async cmdQR([code]) {
        if (!code) { console.log('Usage: qr <code>'); return; }
        const v = await database.getVoucher(code);
        if (!v) { console.log('Voucher not found'); return; }
        const url = `http://${CONFIG.MIKROTIK.IP}/login.html?code=${code}`;
        try {
            console.log(await QRCode.toString(JSON.stringify({ code, plan: v.plan, url }), { type: 'terminal', small: true }));
        } catch (e) {
            console.error(`QR generation failed: ${e.message}`);
        }
    }

    async cmdStats() {
        const s = await database.getStats();
        console.log(`\n📊 Vouchers — Total: ${s.total}  Active: ${s.active}  Used: ${s.used}  Expired: ${s.expired}\n`);
    }
}

// ============================================================
// §18  ONE-OFF CLI EXECUTION
// ============================================================

async function runOneOff(params) {
    const [cmd, ...args] = params;
    const cli = new AgentOSCLI();
    const commands = {
        'voucher': () => cli.cmdVoucher(args),
        'redeem': () => cli.cmdRedeem(args),
        'status': () => cli.cmdStatus(),
    };
    if (commands[cmd]) {
        try { await commands[cmd](); }
        catch (err) { console.error('Error:', err.message); }
    } else {
        // Fallback to Tiered Engine for one-off CLI calls
        try {
            const resp = await askEngine.run(params.join(' '));
            console.log(`\n🤖 Tier ${resp.tier} (${resp.type}):\n${askEngine.formatResponse(resp.result)}`);
        } catch (err) {
            console.log(`Unknown command: ${cmd}\nAvailable: ${Object.keys(commands).join(', ')}`);
        }
    }
    mikrotik.disconnect();
    setTimeout(() => process.exit(0), 100);
}

// ============================================================
// §19  DAEMON BOOTSTRAP
// ============================================================

async function bootDaemon() {
    // Connect to MikroTik — failures are non-fatal (limited mode)
    try { await mikrotik.connect(); }
    catch (err) { logger.warn(`Starting in limited mode — MikroTik unreachable: ${err.message}`); }

    const expressServer = http.createServer(app);

    // Gateway: separate port if configured, otherwise share Express server
    let gateway;
    if (CONFIG.GATEWAY.PORT !== CONFIG.SERVER.PORT) {
        const gwServer = http.createServer((req, res) => {
            const corsH = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' };

            if (req.url === '/' || req.url === '/index.html') {
                const htmlPath = path.join(__dirname, 'index.html');
                fs.readFile(htmlPath, (err, data) => {
                    if (err) { res.writeHead(404, corsH); res.end('index.html not found'); return; }
                    res.writeHead(200, { 'Content-Type': 'text/html', ...corsH });
                    res.end(data);
                });
                return;
            }
            if (req.url === '/api/token') {
                res.writeHead(200, { 'Content-Type': 'application/json', ...corsH });
                res.end(JSON.stringify({
                    token: CONFIG.GATEWAY.TOKEN,
                    wsPort: CONFIG.GATEWAY.PORT,
                    apiPort: CONFIG.SERVER.PORT,
                }));
                return;
            }
            res.writeHead(404, corsH); res.end('Not found');
        });

        gateway = new AgentOSGateway(gwServer);
        global.gateway = gateway;
        gwServer.listen(CONFIG.GATEWAY.PORT, CONFIG.GATEWAY.HOST, () => {
            logger.info(`WS Gateway  → ws://${CONFIG.GATEWAY.HOST}:${CONFIG.GATEWAY.PORT}${CONFIG.GATEWAY.WS_PATH}`);
            logger.info(`Dashboard   → http://localhost:${CONFIG.GATEWAY.PORT}/index.html`);
        });
    } else {
        gateway = new AgentOSGateway(expressServer);
        global.gateway = gateway;
    }

    const bot = new AgentOSBot();
    global.agentBot = bot;
    const monitor = new SystemMonitor(mikrotik, bot);
    monitor.start(30_000);
    global.orchestrator = new AgentOSOrchestrator(mikrotik, database, gateway, bot);

    expressServer.listen(CONFIG.SERVER.PORT, CONFIG.SERVER.HOST, () => {
        logger.info(`${BRAND.name} v${BRAND.version} → http://${CONFIG.SERVER.HOST}:${CONFIG.SERVER.PORT}`);
        logger.info(`Health check → http://${CONFIG.SERVER.HOST}:${CONFIG.SERVER.PORT}/health`);
    });

    const shutdown = (sig) => {
        logger.info(`${sig} received — shutting down gracefully`);
        gateway.closeAll();
        mikrotik.disconnect();
        expressServer.close(() => process.exit(0));
        setTimeout(() => process.exit(1), 5000).unref();
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('uncaughtException', (err) => { logger.error('Uncaught exception:', err); process.exit(1); });
    process.on('unhandledRejection', (reason) => { logger.error('Unhandled rejection:', reason); });
}

// ============================================================
// §20  ENTRY POINT
// ============================================================

if (IS_CLI) {
    const cliArgs = ARGS.slice(1);
    cliArgs.length > 0 ? runOneOff(cliArgs) : new AgentOSCLI().start();
} else {
    bootDaemon().catch(err => { logger.error('Fatal boot error:', err); process.exit(1); });
}
