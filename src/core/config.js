const fs = require('fs');
const path = require('path');
const os = require('os');
require('dotenv').config();

const BRAND = {
    name: 'AgentOS',
    version: '2026.3.27',
    emoji: '🤖',
    tagline: 'Network Intelligence, Simplified'
};

function getProfileDir() {
    const profile = process.env.AGENTOS_PROFILE ||
        (process.argv.includes('--dev') ? 'dev' : 'default');

    if (profile === 'default') {
        return path.join(os.homedir(), '.agentos');
    }
    return path.join(os.homedir(), `.agentos-${profile}`);
}

function ensureProfile() {
    const dir = getProfileDir();
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    return dir;
}

const PROFILE_DIR = ensureProfile();
const CONFIG_PATH = path.join(PROFILE_DIR, 'config.json');
const STATE_PATH = path.join(PROFILE_DIR, 'state');

// Ensure state dir
if (!fs.existsSync(STATE_PATH)) {
    fs.mkdirSync(STATE_PATH, { recursive: true });
}

// Default config
const DEFAULT_CONFIG = {
    name: BRAND.name,
    version: BRAND.version,
    mikrotik: {
        ip: '192.168.88.1',
        user: 'admin',
        pass: '',
        port: 8728,
        reconnectInterval: 5000,
        maxReconnectAttempts: 10
    },
    telegram: {
        token: '',
        allowedChats: [],
        botUsername: 'AgentOSBot'
    },
    gateway: {
        port: 19876,
        host: '127.0.0.1',
        token: require('crypto').randomBytes(32).toString('hex')
    },
    server: {
        port: 3000,
        host: '0.0.0.0'
    },
    security: {
        rateLimitWindow: 15 * 60 * 1000,
        rateLimitMax: 100,
        voucherRateLimit: 5
    },
    features: {
        vouchers: true,
        telegramBot: true,
        webDashboard: true,
        websocketApi: true
    }
};

function loadConfig() {
    if (!fs.existsSync(CONFIG_PATH)) {
        return null;
    }

    try {
        const saved = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
        return { ...DEFAULT_CONFIG, ...saved };
    } catch (e) {
        console.error('Failed to load config:', e.message);
        return null;
    }
}

function saveConfig(config) {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
}

function getConfig() {
    const loaded = loadConfig();
    if (!loaded) {
        // Return defaults but don't save yet (wait for onboard)
        return { ...DEFAULT_CONFIG, createdAt: new Date().toISOString() };
    }
    return loaded;
}

module.exports = {
    BRAND,
    PROFILE_DIR,
    CONFIG_PATH,
    STATE_PATH,
    DEFAULT_CONFIG,
    loadConfig,
    saveConfig,
    getConfig,
    mikrotik: {
        host: process.env.MIKROTIK_IP,
        user: process.env.MIKROTIK_USER,
        pass: process.env.MIKROTIK_PASS
    },
    security: {
        apiKey: process.env.API_KEY
    }
};