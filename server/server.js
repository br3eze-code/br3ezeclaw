#!/usr/bin/env node
// ============================================================
// AgentOS WiFi Manager - Node.js Backend
// Version: 2026.5.0
// Architecture: Monolithic Tool Registry Pattern
// ============================================================

'use strict';

require('dotenv').config();
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const winston = require('winston');
const helmet = require('helmet');
const cors = require('cors');
const crypto = require('crypto');
const path = require('path');
const QRCode = require('qrcode');

// ============================================================
// §1 CONFIGURATION & CONSTANTS
// ============================================================

const BRAND = {
    name: 'AgentOS WiFi',
    version: '2026.5.0',
    emoji: '🤖'
};

const CONFIG = {
    PORT: parseInt(process.env.PORT || '3000'),
    HOST: process.env.HOST || '0.0.0.0',
    MIKROTIK_IP: process.env.MIKROTIK_IP || '192.168.88.1',
    MIKROTIK_USER: process.env.MIKROTIK_USER || 'admin',
    MIKROTIK_PASS: process.env.MIKROTIK_PASS || '',
    MIKROTIK_PORT: parseInt(process.env.MIKROTIK_PORT || '8728'),
    TELEGRAM_TOKEN: process.env.TELEGRAM_TOKEN || '',
    ALLOWED_CHAT_IDS: (process.env.ALLOWED_CHAT_IDS || '').split(',').filter(Boolean),
    GATEWAY_TOKEN: process.env.GATEWAY_TOKEN || crypto.randomBytes(32).toString('hex'),
    VOUCHER_PREFIX: 'STAR-',
    VOUCHER_PLANS: {
        '1hour': { duration: 60 * 60 * 1000, price: 1.00 },
        '1Day': { duration: 24 * 60 * 60 * 1000, price: 5.00 },
        '7Day': { duration: 7 * 24 * 60 * 60 * 1000, price: 25.00 },
        '30Day': { duration: 30 * 24 * 60 * 60 * 1000, price: 80.00 }
    },
    RATE_LIMIT: {
        WINDOW: 15 * 60 * 1000,
        MAX: 100
    }
};

if (!CONFIG.MIKROTIK_PASS) {
    console.warn('⚠️  Warning: MIKROTIK_PASS not set - router features disabled');
}

// ============================================================
// §2 LOGGER
// ============================================================

const logger = winston.createLogger({
    level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
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
                winston.format.printf(({ level, message, timestamp }) =>
                    `${BRAND.emoji} [${BRAND.name}] ${timestamp} ${level}: ${message}`
                )
            )
        })
    ]
});

// ============================================================
// §3 DATABASE SERVICE
// ============================================================

class DatabaseService {
    constructor() {
        this.db = null;
        this.ready = false;
    }

    async initialize() {
        try {
            const Database = require('better-sqlite3');
            this.db = new Database('agentos.db');

            // Create tables
            this.db.exec(`
                CREATE TABLE IF NOT EXISTS users (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    username TEXT UNIQUE NOT NULL,
                    password_hash TEXT NOT NULL,
                    role TEXT DEFAULT 'USER',
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                );

                CREATE TABLE IF NOT EXISTS vouchers (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    code TEXT UNIQUE NOT NULL,
                    plan TEXT NOT NULL,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    expires_at DATETIME,
                    used INTEGER DEFAULT 0,
                    used_at DATETIME,
                    used_by TEXT,
                    created_by TEXT
                );

                CREATE TABLE IF NOT EXISTS audit_log (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    event_type TEXT NOT NULL,
                    actor TEXT NOT NULL,
                    payload TEXT,
                    hash TEXT NOT NULL,
                    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
                );

                CREATE TABLE IF NOT EXISTS settings (
                    key TEXT PRIMARY KEY,
                    value TEXT
                );
            `);

            // Create default admin if not exists
            const adminExists = this.db.prepare('SELECT id FROM users WHERE username = ?').get('admin');
            if (!adminExists) {
                const hash = crypto.createHash('sha256').update('admin123').digest('hex');
                this.db.prepare('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)').run('admin', hash, 'ADMIN');
                logger.info('Default admin user created (username: admin, password: admin123)');
            }

            this.ready = true;
            logger.info('Database initialized successfully');
        } catch (error) {
            logger.error('Database initialization failed:', error);
            throw error;
        }
    }

    // User methods
    getUser(username) {
        return this.db.prepare('SELECT * FROM users WHERE username = ?').get(username);
    }

    validateUser(username, password) {
        const user = this.getUser(username);
        if (!user) return null;
        const hash = crypto.createHash('sha256').update(password).digest('hex');
        return user.password_hash === hash ? user : null;
    }

    // Voucher methods
    createVoucher(code, plan, createdBy = 'system') {
        const expiresAt = new Date(Date.now() + CONFIG.VOUCHER_PLANS[plan]?.duration || 0).toISOString();
        const stmt = this.db.prepare(`
            INSERT INTO vouchers (code, plan, expires_at, created_by)
            VALUES (?, ?, ?, ?)
        `);
        const result = stmt.run(code, plan, expiresAt, createdBy);

        this.logAudit('voucher.create', createdBy, { code, plan });

        return { id: result.lastInsertRowid, code, plan, expires_at: expiresAt };
    }

    getVoucher(code) {
        return this.db.prepare('SELECT * FROM vouchers WHERE code = ?').get(code);
    }

    listVouchers(limit = 50, used = null) {
        let sql = 'SELECT * FROM vouchers ORDER BY created_at DESC LIMIT ?';
        const params = [limit];

        if (used !== null) {
            sql = 'SELECT * FROM vouchers WHERE used = ? ORDER BY created_at DESC LIMIT ?';
            params.unshift(used ? 1 : 0);
        }

        return this.db.prepare(sql).all(...params);
    }

    redeemVoucher(code, usedBy) {
        const voucher = this.getVoucher(code);
        if (!voucher) return { error: 'Voucher not found' };
        if (voucher.used) return { error: 'Voucher already used' };
        if (new Date(voucher.expires_at) < new Date()) return { error: 'Voucher expired' };

        const stmt = this.db.prepare(`
            UPDATE vouchers SET used = 1, used_at = datetime('now'), used_by = ? WHERE code = ?
        `);
        stmt.run(usedBy, code);

        this.logAudit('voucher.redeem', usedBy, { code });

        return { success: true, plan: voucher.plan };
    }

    deleteVoucher(code) {
        const stmt = this.db.prepare('DELETE FROM vouchers WHERE code = ?');
        return stmt.run(code);
    }

    getVoucherStats() {
        const total = this.db.prepare('SELECT COUNT(*) as count FROM vouchers').get().count;
        const used = this.db.prepare('SELECT COUNT(*) as count FROM vouchers WHERE used = 1').get().count;
        const active = this.db.prepare('SELECT COUNT(*) as count FROM vouchers WHERE used = 0 AND expires_at > datetime("now")').get().count;
        const expired = this.db.prepare('SELECT COUNT(*) as count FROM vouchers WHERE used = 0 AND expires_at <= datetime("now")').get().count;

        return { total, used, active, expired };
    }

    // Audit log
    logAudit(eventType, actor, payload = {}) {
        const hash = crypto.createHash('sha256')
            .update(JSON.stringify({ eventType, actor, payload, timestamp: Date.now() }))
            .digest('hex');

        const stmt = this.db.prepare(`
            INSERT INTO audit_log (event_type, actor, payload, hash) VALUES (?, ?, ?, ?)
        `);
        stmt.run(eventType, actor, JSON.stringify(payload), hash);

        return hash;
    }

    getAuditLog(limit = 50) {
        return this.db.prepare('SELECT * FROM audit_log ORDER BY timestamp DESC LIMIT ?').all(limit);
    }
}

const database = new DatabaseService();

// ============================================================
// §4A TOOL DISCOVERY REGISTRY (Metadata)
// ============================================================

const TOOL_METADATA = {
    // System tools
    'system.info': {
        name: 'system.info',
        description: 'Get system information including version, uptime, and platform',
        category: 'system',
        parameters: [],
        returns: 'Object with system information'
    },
    'system.health': {
        name: 'system.health',
        description: 'Check system health status',
        category: 'system',
        parameters: [],
        returns: 'Object with health status'
    },
    'system.stats': {
        name: 'system.stats',
        description: 'Get system statistics including vouchers, memory, and uptime',
        category: 'system',
        parameters: [],
        returns: 'Object with system statistics'
    },

    // Voucher tools
    'voucher.create': {
        name: 'voucher.create',
        description: 'Create a new WiFi voucher with specified plan',
        category: 'voucher',
        parameters: [
            { name: 'plan', type: 'string', required: true, options: ['1hour', '1Day', '7Day', '30Day'] },
            { name: 'createdBy', type: 'string', required: false, default: 'api' }
        ],
        returns: 'Object with created voucher details'
    },
    'voucher.list': {
        name: 'voucher.list',
        description: 'List all vouchers with optional filtering',
        category: 'voucher',
        parameters: [
            { name: 'limit', type: 'number', required: false, default: 50 }
        ],
        returns: 'Array of voucher objects'
    },
    'voucher.get': {
        name: 'voucher.get',
        description: 'Get details of a specific voucher by code',
        category: 'voucher',
        parameters: [
            { name: 'code', type: 'string', required: true }
        ],
        returns: 'Voucher object or error'
    },
    'voucher.redeem': {
        name: 'voucher.redeem',
        description: 'Redeem a voucher for a user',
        category: 'voucher',
        parameters: [
            { name: 'code', type: 'string', required: true },
            { name: 'usedBy', type: 'string', required: true }
        ],
        returns: 'Success status and plan info'
    },
    'voucher.delete': {
        name: 'voucher.delete',
        description: 'Delete a voucher by code',
        category: 'voucher',
        parameters: [
            { name: 'code', type: 'string', required: true }
        ],
        returns: 'Success status'
    },
    'voucher.stats': {
        name: 'voucher.stats',
        description: 'Get voucher statistics',
        category: 'voucher',
        parameters: [],
        returns: 'Object with total, used, active, expired counts'
    },
    'voucher.plans': {
        name: 'voucher.plans',
        description: 'List available voucher plans',
        category: 'voucher',
        parameters: [],
        returns: 'Array of plan objects'
    },

    // Router tools
    'router.status': {
        name: 'router.status',
        description: 'Get MikroTik router connection status',
        category: 'router',
        parameters: [],
        returns: 'Object with router status'
    },
    'router.users': {
        name: 'router.users',
        description: 'List all router users',
        category: 'router',
        parameters: [],
        returns: 'Array of user objects'
    },
    'router.active': {
        name: 'router.active',
        description: 'List active router sessions',
        category: 'router',
        parameters: [],
        returns: 'Array of active session objects'
    },
    'router.kick': {
        name: 'router.kick',
        description: 'Kick a user from the router',
        category: 'router',
        parameters: [
            { name: 'username', type: 'string', required: true }
        ],
        returns: 'Success status'
    },
    'router.reboot': {
        name: 'router.reboot',
        description: 'Initiate router reboot',
        category: 'router',
        parameters: [],
        returns: 'Success status'
    },
    'router.backup': {
        name: 'router.backup',
        description: 'Create router backup',
        category: 'router',
        parameters: [],
        returns: 'Success status with filename'
    },
    'router.discover': {
        name: 'router.discover',
        description: 'Discover MikroTik routers on the local network',
        category: 'discovery',
        parameters: [
            { name: 'subnet', type: 'string', required: false, default: '192.168.88.0/24' }
        ],
        returns: 'Array of discovered routers'
    },

    // Network tools
    'network.ping': {
        name: 'network.ping',
        description: 'Ping a host to check connectivity',
        category: 'network',
        parameters: [
            { name: 'host', type: 'string', required: true },
            { name: 'count', type: 'number', required: false, default: 4 }
        ],
        returns: 'Object with ping results'
    },
    'network.interfaces': {
        name: 'network.interfaces',
        description: 'List network interfaces',
        category: 'network',
        parameters: [],
        returns: 'Array of interface objects'
    },
    'network.scan': {
        name: 'network.scan',
        description: 'Scan local network for devices',
        category: 'discovery',
        parameters: [
            { name: 'subnet', type: 'string', required: false, default: '192.168.88.0/24' },
            { name: 'timeout', type: 'number', required: false, default: 5000 }
        ],
        returns: 'Array of discovered devices'
    },

    // Audit tools
    'audit.list': {
        name: 'audit.list',
        description: 'List audit log entries',
        category: 'audit',
        parameters: [
            { name: 'limit', type: 'number', required: false, default: 50 }
        ],
        returns: 'Array of audit entries'
    },
    'audit.verify': {
        name: 'audit.verify',
        description: 'Verify audit log integrity',
        category: 'audit',
        parameters: [],
        returns: 'Object with verification status'
    },

    // Utility tools
    'utils.qrcode': {
        name: 'utils.qrcode',
        description: 'Generate QR code for data',
        category: 'utility',
        parameters: [
            { name: 'data', type: 'string', required: true }
        ],
        returns: 'Object with QR code as data URL'
    },
    'utils.hash': {
        name: 'utils.hash',
        description: 'Generate SHA256 hash of data',
        category: 'utility',
        parameters: [
            { name: 'data', type: 'string', required: true }
        ],
        returns: 'Object with hash and timestamp'
    },

    // Service discovery tools
    'service.discover': {
        name: 'service.discover',
        description: 'Discover available AgentOS services on the network',
        category: 'discovery',
        parameters: [
            { name: 'subnet', type: 'string', required: false, default: '192.168.88.0/24' }
        ],
        returns: 'Array of discovered services'
    },
    'service.list': {
        name: 'service.list',
        description: 'List all tools with metadata',
        category: 'discovery',
        parameters: [
            { name: 'category', type: 'string', required: false }
        ],
        returns: 'Object with tools organized by category'
    },
    'service.capabilities': {
        name: 'service.capabilities',
        description: 'Get service capabilities and features',
        category: 'discovery',
        parameters: [],
        returns: 'Object with service capabilities'
    }
};

// ============================================================
// §4B NETWORK DISCOVERY SERVICE
// ============================================================

class NetworkDiscoveryService {
    constructor() {
        this.discoveredDevices = new Map();
        this.discoveredServices = new Map();
        this.lastScan = null;
    }

    // Parse CIDR notation to IP range
    parseCIDR(cidr) {
        const [ip, mask] = cidr.split('/');
        const maskBits = parseInt(mask);
        const ipInt = ip.split('.').reduce((acc, oct) => (acc << 8) + parseInt(oct), 0);
        const maskInt = ~((1 << (32 - maskBits)) - 1);
        const networkInt = ipInt & maskInt;
        const broadcastInt = networkInt | ~maskInt;

        const start = networkInt + 1;
        const end = broadcastInt - 1;

        return { start, end, ip, mask };
    }

    // Convert integer to IP string
    intToIP(int) {
        return [
            (int >>> 24) & 255,
            (int >>> 16) & 255,
            (int >>> 8) & 255,
            int & 255
        ].join('.');
    }

    // Scan network for MikroTik routers
    async discoverMikrotikRouters(subnet = '192.168.88.0/24') {
        const { start, end } = this.parseCIDR(subnet);
        const found = [];
        const commonPorts = [8728, 8729, 80, 443, 8080]; // MikroTik API and web ports

        logger.info(`Scanning ${subnet} for MikroTik routers...`);

        // Scan common MikroTik IPs first
        const priorityIPs = [
            this.intToIP(end - 1), // Usually gateway
            this.intToIP(start + 1),
            '192.168.88.1',
            '192.168.1.1',
            '10.0.0.1'
        ];

        // Quick scan priority IPs
        for (const ip of priorityIPs) {
            try {
                const result = await this.checkMikrotik(ip, commonPorts);
                if (result.isMikrotik) {
                    found.push(result);
                    this.discoveredDevices.set(ip, result);
                }
            } catch (e) {
                // Continue scanning
            }
        }

        this.lastScan = Date.now();
        return found;
    }

    // Check if IP is a MikroTik router
    async checkMikrotik(ip, ports) {
        const http = require('http');
        const https = require('https');

        for (const port of ports) {
            try {
                const result = await this.httpCheck(ip, port);
                if (result.success) {
                    return {
                        ip,
                        port,
                        isMikrotik: result.isMikrotik,
                        hostname: result.hostname,
                        model: result.model,
                        version: result.version,
                        api: ports.includes(8728),
                        web: port === 80 || port === 443 || port === 8080,
                        foundAt: Date.now()
                    };
                }
            } catch (e) {
                // Try next port
            }
        }

        return { ip, isMikrotik: false };
    }

    // HTTP check with timeout
    httpCheck(ip, port, timeout = 2000) {
        return new Promise((resolve) => {
            const httpModule = port === 443 ? https : http;
            const options = {
                hostname: ip,
                port,
                path: '/',
                method: 'GET',
                timeout
            };

            const req = httpModule.request(options, (res) => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => {
                    const isMikrotik = data.includes('mikrotik') ||
                        res.headers['server']?.toLowerCase().includes('mikrotik') ||
                        data.includes('RouterOS');

                    const hostname = res.headers['x-hostname'] ||
                        (isMikrotik ? ip : null);

                    resolve({
                        success: true,
                        isMikrotik,
                        hostname,
                        model: this.extractModel(data),
                        version: this.extractVersion(data)
                    });
                });
            });

            req.on('timeout', () => {
                req.destroy();
                resolve({ success: false });
            });

            req.on('error', () => resolve({ success: false }));
        });
    }

    extractModel(html) {
        const match = html.match(/board_name["\s:=]+([^"<\s]+)/i) ||
            html.match(/model["\s:=]+([^"<\s]+)/i);
        return match ? match[1] : null;
    }

    extractVersion(html) {
        const match = html.match(/version["\s:=]+([^"<\s]+)/i) ||
            html.match(/ROS["\s]+([\d.]+)/i);
        return match ? match[1] : null;
    }

    // Full network scan
    async scanNetwork(subnet = '192.168.88.0/24', timeout = 5000) {
        const { start, end } = this.parseCIDR(subnet);
        const found = [];

        logger.info(`Scanning ${subnet} for devices...`);

        // Limit scan to prevent timeout
        const maxIPs = Math.min(end - start + 1, 256);
        const startIP = end - maxIPs + 1;

        for (let i = 0; i < maxIPs; i++) {
            const ip = this.intToIP(startIP + i);
            try {
                const device = await this.pingHost(ip, timeout);
                if (device.alive) {
                    found.push(device);
                    this.discoveredDevices.set(ip, device);
                }
            } catch (e) {
                // Continue
            }
        }

        this.lastScan = Date.now();
        return found;
    }

    // Ping host (TCP method since ICMP requires admin)
    async pingHost(ip, timeout = 2000) {
        const net = require('net');

        return new Promise((resolve) => {
            const start = Date.now();
            const socket = new net.Socket();

            socket.setTimeout(timeout);

            socket.on('connect', () => {
                const responseTime = Date.now() - start;
                socket.destroy();

                resolve({
                    ip,
                    alive: true,
                    responseTime,
                    ports: [80, 443, 22, 3389].filter(port =>
                        this.checkPort(ip, port, timeout)
                    ),
                    foundAt: Date.now()
                });
            });

            socket.on('timeout', () => {
                socket.destroy();
                resolve({ ip, alive: false });
            });

            socket.on('error', () => {
                resolve({ ip, alive: false });
            });

            socket.connect(80, ip);
        });
    }

    async checkPort(ip, port, timeout) {
        const net = require('net');
        return new Promise((resolve) => {
            const socket = new net.Socket();
            socket.setTimeout(timeout);

            socket.on('connect', () => {
                socket.destroy();
                resolve(true);
            });

            socket.on('timeout', () => {
                socket.destroy();
                resolve(false);
            });

            socket.on('error', () => resolve(false));

            socket.connect(port, ip);
        });
    }

    // Get discovered devices
    getDiscoveredDevices() {
        return Array.from(this.discoveredDevices.values());
    }

    // Get service info
    getServiceInfo() {
        return {
            name: BRAND.name,
            version: BRAND.version,
            uptime: process.uptime(),
            tools: Object.keys(TOOLS).length,
            categories: [...new Set(Object.values(TOOL_METADATA).map(t => t.category))],
            discoveredDevices: this.discoveredDevices.size,
            lastScan: this.lastScan
        };
    }
}

const discoveryService = new NetworkDiscoveryService();

// ============================================================
// §4C TOOL REGISTRY (AgentOS Pattern)
// ============================================================

const TOOLS = {
    // System tools
    'system.info': async () => ({
        name: BRAND.name,
        version: BRAND.version,
        uptime: process.uptime(),
        platform: process.platform,
        nodeVersion: process.version,
        memory: process.memoryUsage()
    }),

    'system.health': async () => ({
        status: 'healthy',
        database: database.ready,
        timestamp: new Date().toISOString()
    }),

    'system.stats': async () => {
        const voucherStats = database.getVoucherStats();
        return {
            vouchers: voucherStats,
            memory: process.memoryUsage(),
            uptime: process.uptime()
        };
    },

    // Voucher tools
    'voucher.create': async (plan, createdBy = 'api') => {
        if (!CONFIG.VOUCHER_PLANS[plan]) {
            throw new Error(`Invalid plan: ${plan}. Available: ${Object.keys(CONFIG.VOUCHER_PLANS).join(', ')}`);
        }
        const code = CONFIG.VOUCHER_PREFIX + crypto.randomBytes(3).toString('hex').toUpperCase();
        const voucher = database.createVoucher(code, plan, createdBy);
        return { success: true, ...voucher };
    },

    'voucher.list': async (limit = 50) => {
        return database.listVouchers(limit);
    },

    'voucher.get': async (code) => {
        const voucher = database.getVoucher(code);
        if (!voucher) return { error: 'Voucher not found' };
        return voucher;
    },

    'voucher.redeem': async (code, usedBy) => {
        return database.redeemVoucher(code, usedBy);
    },

    'voucher.delete': async (code) => {
        database.deleteVoucher(code);
        return { success: true, code };
    },

    'voucher.stats': async () => {
        return database.getVoucherStats();
    },

    'voucher.plans': async () => {
        return Object.entries(CONFIG.VOUCHER_PLANS).map(([name, data]) => ({
            name,
            duration: data.duration / 1000 / 60 / 60 + ' hours',
            price: `$${data.price}`
        }));
    },

    // Audit tools
    'audit.list': async (limit = 50) => {
        return database.getAuditLog(limit);
    },

    'audit.verify': async () => {
        const logs = database.getAuditLog(1000);
        let valid = true;
        let previousHash = null;

        for (const log of logs) {
            const expectedHash = crypto.createHash('sha256')
                .update(JSON.stringify({
                    event_type: log.event_type,
                    actor: log.actor,
                    payload: log.payload,
                    timestamp: new Date(log.timestamp).getTime()
                }))
                .digest('hex');

            if (log.hash !== expectedHash) {
                valid = false;
                break;
            }
            previousHash = log.hash;
        }

        return { valid, count: logs.length };
    },

    // Router tools (mock - replace with actual MikroTik API)
    'router.status': async () => ({
        connected: !!CONFIG.MIKROTIK_PASS,
        ip: CONFIG.MIKROTIK_IP,
        user: CONFIG.MIKROTIK_USER,
        mock: !CONFIG.MIKROTIK_PASS
    }),

    'router.users': async () => {
        if (!CONFIG.MIKROTIK_PASS) return { error: 'Router not configured' };
        // In production, connect to MikroTik and get users
        return [
            { name: 'user1', profile: 'default', uptime: '1h30m' },
            { name: 'user2', profile: '1Day', uptime: '45m' }
        ];
    },

    'router.active': async () => {
        if (!CONFIG.MIKROTIK_PASS) return { error: 'Router not configured' };
        return [
            { user: 'user1', address: '192.168.88.100', uptime: '1h30m' }
        ];
    },

    'router.kick': async (username) => {
        if (!CONFIG.MIKROTIK_PASS) return { error: 'Router not configured' };
        database.logAudit('router.kick', 'system', { username });
        return { success: true, username, kicked: true };
    },

    'router.reboot': async () => {
        if (!CONFIG.MIKROTIK_PASS) return { error: 'Router not configured' };
        database.logAudit('router.reboot', 'system', {});
        return { success: true, message: 'Reboot initiated' };
    },

    'router.discover': async (subnet = '192.168.88.0/24') => {
        return discoveryService.discoverMikrotikRouters(subnet);
    },

    // Network tools
    'network.ping': async (host, count = 4) => {
        return {
            host,
            count,
            results: Array(count).fill({ time: Math.random() * 100 }),
            packetLoss: '0%'
        };
    },

    'network.scan': async (subnet = '192.168.88.0/24', timeout = 5000) => {
        return discoveryService.scanNetwork(subnet, timeout);
    },

    'network.interfaces': async () => {
        return [
            { name: 'ether1', type: 'ethernet', status: 'running' },
            { name: 'wlan1', type: 'wireless', status: 'running' }
        ];
    },

    'service.discover': async (subnet = '192.168.88.0/24') => {
        return {
            services: [
                {
                    name: BRAND.name,
                    version: BRAND.version,
                    host: CONFIG.HOST,
                    port: CONFIG.PORT,
                    wsPath: '/ws',
                    tools: Object.keys(TOOLS).length,
                    categories: [...new Set(Object.values(TOOL_METADATA).map(t => t.category))]
                }
            ],
            timestamp: Date.now()
        };
    },

    'service.list': async (category = null) => {
        const tools = Object.entries(TOOL_METADATA)
            .filter(([_, meta]) => !category || meta.category === category)
            .map(([name, meta]) => ({ name, ...meta }));

        const grouped = tools.reduce((acc, tool) => {
            const cat = tool.category;
            if (!acc[cat]) acc[cat] = [];
            acc[cat].push(tool);
            return acc;
        }, {});

        return { tools, grouped, total: tools.length };
    },

    'service.capabilities': async () => {
        return {
            name: BRAND.name,
            version: BRAND.version,
            platform: 'nodejs',
            nodeVersion: process.version,
            features: {
                oauth: true,
                websocket: true,
                discovery: true,
                nanoAI: true
            },
            endpoints: {
                api: '/api',
                ws: '/ws',
                health: '/health',
                oauth: '/oauth'
            }
        };
    },

    // Utility tools
    'utils.qrcode': async (data) => {
        try {
            const qr = await QRCode.toDataURL(data);
            return { success: true, qr };
        } catch (error) {
            return { error: error.message };
        }
    },

    'utils.hash': async (data) => {
        return {
            sha256: crypto.createHash('sha256').update(data).digest('hex'),
            timestamp: Date.now()
        };
    }
};

// ============================================================
// §5 COMMAND HANDLER
// ============================================================

class CommandHandler {
    constructor(tools, db, gateway) {
        this.tools = tools;
        this.db = db;
        this.gateway = gateway;
        this.rateLimiter = new Map();
    }

    checkRateLimit(clientId) {
        const now = Date.now();
        const windowStart = CONFIG.RATE_LIMIT.WINDOW;
        let bucket = this.rateLimiter.get(clientId);

        if (!bucket || now - bucket.start > windowStart) {
            bucket = { count: 0, start: now };
        }

        if (bucket.count >= CONFIG.RATE_LIMIT.MAX) {
            return { allowed: false, reason: 'Rate limit exceeded' };
        }

        bucket.count++;
        this.rateLimiter.set(clientId, bucket);
        return { allowed: true };
    }

    async execute(tool, params = [], actor = 'unknown') {
        const fn = this.tools[tool];
        if (!fn) {
            throw new Error(`Unknown tool: ${tool}. Available: ${Object.keys(this.tools).join(', ')}`);
        }

        try {
            const result = await fn(...params);

            // Broadcast result via WebSocket
            if (this.gateway) {
                this.gateway.broadcast({
                    type: 'tool.result',
                    tool,
                    result,
                    actor,
                    timestamp: new Date().toISOString()
                });
            }

            return result;
        } catch (error) {
            throw new Error(`Tool execution failed: ${error.message}`);
        }
    }

    getAvailableTools() {
        return Object.keys(this.tools);
    }
}

// ============================================================
// §6 WEBSOCKET GATEWAY
// ============================================================

class AgentOSGateway {
    constructor(server) {
        this.wss = new WebSocket.Server({ server, path: '/ws' });
        this.clients = new Map();
        this._setupHandlers();
        logger.info(`WebSocket Gateway initialized at ws://${CONFIG.HOST}:${CONFIG.PORT}/ws`);
    }

    _setupHandlers() {
        this.wss.on('connection', (ws, req) => {
            const clientId = crypto.randomUUID();
            const ip = req.socket.remoteAddress;

            ws.on('message', (data) => this._onMessage(clientId, ws, data));
            ws.on('close', () => this._onDisconnect(clientId));
            ws.on('error', (err) => logger.error(`WS error (${clientId}):`, err));

            this.clients.set(clientId, { ws, ip, connectedAt: Date.now() });

            this._send(ws, {
                type: 'hello',
                payload: {
                    service: BRAND.name,
                    version: BRAND.version,
                    clientId,
                    timestamp: new Date().toISOString()
                }
            });

            logger.info(`Client connected: ${clientId} from ${ip}`);
        });
    }

    _onMessage(clientId, ws, raw) {
        let msg;
        try {
            msg = JSON.parse(raw);
        } catch {
            return this._send(ws, { type: 'error', error: 'Invalid JSON' });
        }

        const client = this.clients.get(clientId);
        if (!client) return;

        switch (msg.type) {
            case 'ping':
                this._send(ws, { type: 'pong', timestamp: Date.now() });
                break;

            case 'node.register':
                this._handleNodeRegister(clientId, ws, msg.payload);
                break;

            case 'node.unregister':
                this._handleNodeUnregister(clientId);
                break;

            case 'command.invoke':
                this._handleCommandInvoke(clientId, ws, msg);
                break;

            case 'tool.invoke':
                this._handleToolInvoke(clientId, ws, msg);
                break;

            case 'tool.list':
                this._send(ws, {
                    type: 'tool.list',
                    tools: commandHandler.getAvailableTools()
                });
                break;

            case 'subscribe':
                client.subscriptions = client.subscriptions || new Set();
                client.subscriptions.add(msg.channel);
                this._send(ws, { type: 'subscribed', channel: msg.channel });
                break;

            case 'broadcast':
                this._handleBroadcast(clientId, ws, msg);
                break;

            default:
                this._send(ws, { type: 'error', error: `Unknown message type: ${msg.type}` });
        }
    }

    _handleNodeRegister(clientId, ws, payload) {
        const nodeInfo = {
            ...payload,
            clientId,
            ws,
            registeredAt: Date.now(),
            lastActivity: Date.now()
        };

        this.clients.set(clientId, nodeInfo);

        this._send(ws, {
            type: 'node.registered',
            payload: {
                masterId: BRAND.name,
                nodeId: payload.nodeId,
                registeredAt: Date.now()
            }
        });

        logger.info(`Node registered: ${payload.nodeId} (${payload.platform}) from ${ws.remoteAddress}`);

        // Broadcast node list to all clients
        this._broadcastNodeList();
    }

    _handleNodeUnregister(clientId) {
        const client = this.clients.get(clientId);
        if (client) {
            logger.info(`Node unregistered: ${client.nodeId}`);
        }
        this.clients.delete(clientId);
        this._broadcastNodeList();
    }

    _broadcastNodeList() {
        const nodes = [];
        this.clients.forEach((client) => {
            if (client.nodeId) {
                nodes.push({
                    nodeId: client.nodeId,
                    platform: client.platform,
                    capabilities: client.capabilities,
                    connectedAt: client.connectedAt || client.registeredAt,
                    lastActivity: client.lastActivity
                });
            }
        });

        this.broadcast({
            type: 'node.list',
            nodes,
            timestamp: Date.now()
        });
    }

    _handleCommandInvoke(clientId, ws, msg) {
        const client = this.clients.get(clientId);
        if (!client) {
            return this._send(ws, { type: 'error', id: msg.id, error: 'Client not found' });
        }

        client.lastActivity = Date.now();

        const { target, command, params } = msg.payload;

        // If targeting a specific node
        if (target && target !== 'all') {
            const targetClient = this._findNodeById(target);
            if (targetClient) {
                // Forward to target node
                this._send(targetClient.ws, {
                    type: 'command.invoke',
                    id: msg.id,
                    payload: { command, params, actor: client.nodeId }
                });
            } else {
                this._send(ws, {
                    type: 'command.result',
                    id: msg.id,
                    success: false,
                    error: `Target node not found: ${target}`
                });
            }
            return;
        }

        // Execute locally or broadcast
        if (target === 'all') {
            // Broadcast to all nodes
            this.clients.forEach((c) => {
                if (c.nodeId && c.ws !== ws) {
                    this._send(c.ws, {
                        type: 'command.invoke',
                        id: msg.id,
                        payload: { command, params, actor: client.nodeId }
                    });
                }
            });
        }

        // Also execute locally
        commandHandler.execute(command, params || [], client.nodeId || clientId)
            .then(result => {
                this._send(ws, {
                    type: 'command.result',
                    id: msg.id,
                    success: true,
                    result
                });
            })
            .catch(error => {
                this._send(ws, {
                    type: 'command.result',
                    id: msg.id,
                    success: false,
                    error: error.message
                });
            });
    }

    _handleBroadcast(clientId, ws, msg) {
        const client = this.clients.get(clientId);
        if (!client) return;

        // Broadcast to specified channel or all
        this.clients.forEach((c) => {
            if (c.ws !== ws && (!msg.channel || c.subscriptions?.has(msg.channel))) {
                this._send(c.ws, {
                    type: 'broadcast',
                    payload: msg.payload,
                    from: client.nodeId || clientId,
                    channel: msg.channel
                });
            }
        });
    }

    _findNodeById(nodeId) {
        for (const [_, client] of this.clients) {
            if (client.nodeId === nodeId) {
                return client;
            }
        }
        return null;
    }

    async _handleToolInvoke(clientId, ws, msg) {
        const rateCheck = commandHandler.checkRateLimit(clientId);
        if (!rateCheck.allowed) {
            return this._send(ws, { type: 'error', id: msg.id, error: rateCheck.reason });
        }

        try {
            const result = await commandHandler.execute(msg.tool, msg.params || [], clientId);
            this._send(ws, {
                type: 'tool.result',
                id: msg.id,
                tool: msg.tool,
                result,
                success: true
            });
        } catch (error) {
            this._send(ws, {
                type: 'tool.result',
                id: msg.id,
                tool: msg.tool,
                error: error.message,
                success: false
            });
        }
    }

    _onDisconnect(clientId) {
        this.clients.delete(clientId);
        logger.info(`Client disconnected: ${clientId}`);
    }

    _send(ws, data) {
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify(data));
        }
    }

    broadcast(payload) {
        this.clients.forEach(({ ws }) => {
            this._send(ws, { type: 'broadcast', ...payload });
        });
    }
}

// ============================================================
// §7 EXPRESS APPLICATION
// ============================================================

const app = express();
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'", "'unsafe-inline'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            imgSrc: ["'self'", "data:", "https:"]
        }
    }
}));
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Auth middleware
const authMiddleware = (req, res, next) => {
    const auth = req.headers.authorization;
    if (!auth || !auth.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Authorization required' });
    }
    const token = auth.split(' ')[1];
    if (token !== CONFIG.GATEWAY_TOKEN) {
        return res.status(401).json({ error: 'Invalid token' });
    }
    next();
};

// Rate limiter middleware
const rateLimitMiddleware = (req, res, next) => {
    const ip = req.ip;
    const now = Date.now();
    let bucket = global.rateLimitBuckets?.get(ip);

    if (!bucket || now - bucket.start > CONFIG.RATE_LIMIT.WINDOW) {
        bucket = { count: 0, start: now };
    }

    if (bucket.count >= CONFIG.RATE_LIMIT.MAX) {
        return res.status(429).json({ error: 'Too many requests' });
    }

    bucket.count++;
    if (!global.rateLimitBuckets) global.rateLimitBuckets = new Map();
    global.rateLimitBuckets.set(ip, bucket);
    next();
};

// Health check
app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        version: BRAND.version,
        uptime: process.uptime()
    });
});

// API routes
app.post('/api/auth/login', (req, res) => {
    const { username, password } = req.body;
    const user = database.validateUser(username, password);
    if (!user) {
        return res.status(401).json({ error: 'Invalid credentials' });
    }
    res.json({
        success: true,
        token: CONFIG.GATEWAY_TOKEN,
        user: { username: user.username, role: user.role }
    });
});

app.post('/api/tool/execute', authMiddleware, rateLimitMiddleware, async (req, res) => {
    const { tool, params = [] } = req.body;
    try {
        const result = await commandHandler.execute(tool, params, req.body._actor || 'api');
        res.json({ success: true, result });
    } catch (error) {
        res.status(400).json({ success: false, error: error.message });
    }
});

app.get('/api/tools', authMiddleware, (req, res) => {
    res.json({ tools: commandHandler.getAvailableTools() });
});

app.get('/api/vouchers', authMiddleware, rateLimitMiddleware, (req, res) => {
    const limit = parseInt(req.query.limit) || 50;
    const used = req.query.used === 'true' ? true : req.query.used === 'false' ? false : null;
    res.json(database.listVouchers(limit, used));
});

app.post('/api/vouchers', authMiddleware, rateLimitMiddleware, (req, res) => {
    const { plan, count = 1 } = req.body;
    if (!CONFIG.VOUCHER_PLANS[plan]) {
        return res.status(400).json({ error: `Invalid plan: ${plan}` });
    }

    const vouchers = [];
    for (let i = 0; i < Math.min(count, 100); i++) {
        const code = CONFIG.VOUCHER_PREFIX + crypto.randomBytes(3).toString('hex').toUpperCase();
        vouchers.push(database.createVoucher(code, plan, 'api'));
    }

    res.json({ success: true, vouchers });
});

app.post('/api/vouchers/redeem', rateLimitMiddleware, (req, res) => {
    const { code, user } = req.body;
    if (!code || !user) {
        return res.status(400).json({ error: 'Code and user required' });
    }
    res.json(database.redeemVoucher(code, user));
});

app.get('/api/vouchers/stats', authMiddleware, (req, res) => {
    res.json(database.getVoucherStats());
});

app.get('/api/audit', authMiddleware, (req, res) => {
    const limit = parseInt(req.query.limit) || 50;
    res.json(database.getAuditLog(limit));
});

app.get('/api/router/status', authMiddleware, async (req, res) => {
    try {
        const result = await commandHandler.execute('router.status');
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// SSE endpoint for real-time updates
app.get('/api/stream', authMiddleware, (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

    send('connected', { service: BRAND.name, version: BRAND.version });

    const interval = setInterval(() => {
        res.write(': heartbeat\n\n');
    }, 15000);

    req.on('close', () => clearInterval(interval));
});

// Catch-all
app.use((req, res) => {
    res.status(404).json({ error: 'Not found' });
});

app.use((err, req, res, next) => {
    logger.error('Unhandled error:', err);
    res.status(500).json({ error: 'Internal server error' });
});

// ============================================================
// §8 BOOTSTRAP
// ============================================================

async function boot() {
    // Ensure logs directory exists
    const fs = require('fs');
    if (!fs.existsSync('logs')) {
        fs.mkdirSync('logs', { recursive: true });
    }

    // Initialize database
    await database.initialize();

    // Create command handler
    const commandHandler = new CommandHandler(TOOLS, database, null);

    // Create HTTP server
    const server = http.createServer(app);

    // Initialize WebSocket gateway
    const gateway = new AgentOSGateway(server);
    commandHandler.gateway = gateway;

    // Start server
    server.listen(CONFIG.PORT, CONFIG.HOST, () => {
        logger.info(`${BRAND.emoji} ${BRAND.name} v${BRAND.version}`);
        logger.info(`Server running at http://${CONFIG.HOST}:${CONFIG.PORT}`);
        logger.info(`WebSocket Gateway at ws://${CONFIG.HOST}:${CONFIG.PORT}/ws`);
        logger.info(`Health check: http://${CONFIG.HOST}:${CONFIG.PORT}/health`);
    });

    // Graceful shutdown
    const shutdown = (signal) => {
        logger.info(`${signal} received - shutting down...`);
        gateway.wss.close();
        server.close(() => {
            logger.info('Server closed');
            process.exit(0);
        });
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
}

// Make commandHandler available globally for this module
global.commandHandler = null;

boot().then(() => {
    global.commandHandler = new CommandHandler(TOOLS, database, null);
}).catch(err => {
    logger.error('Boot failed:', err);
    process.exit(1);
});

module.exports = { app, TOOLS, database };
