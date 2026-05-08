const fs = require('fs');
const path = require('path');
const os = require('os');
require('dotenv').config();

const BRAND = {
    name: 'AgentOS',
    version: '2026.5.4',
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
        ip: process.env.MIKROTIK_IP || '192.168.88.1',
        user: process.env.MIKROTIK_USER || 'admin',
        pass: process.env.MIKROTIK_PASS || '',
        port: parseInt(process.env.MIKROTIK_PORT) || 8728,
        reconnectInterval: 5000,
        maxReconnectAttempts: 10
    },
    telegram: {
        token: '',
        allowedChats: [],
        botUsername: 'AgentOSBot'
    },
    gateway: {
        port: parseInt(process.env.GATEWAY_PORT || process.env.PORT) || 19876,
        host: process.env.GATEWAY_HOST || process.env.HOST || '127.0.0.1',
        token: process.env.AGENTOS_GATEWAY_TOKEN
            || require('crypto').randomBytes(32).toString('hex')
    },
    server: {
        port: 3000,
        host: '0.0.0.0'
    },
    security: {
        rateLimitWindow: 15 * 60 * 1000,
        rateLimitMax: 100,
        voucherRateLimit: 5,
        alertCooldownMs: 60000
    },
    features: {
        vouchers: true,
        telegramBot: true,
        webDashboard: true,
        websocketApi: true
    },
    vouchers: {
        prefix: 'STAR',
        format: 'XXXX-XXXX',
        alphabet: 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
    },
    whatsapp: {
        enabled: false,
        authStateFolder: './data/whatsapp_auth',
        allowedJids: []
    },
    plans: [
        { name: '1 Hour', description: 'Perfect for a quick browsing session.', deviceLimit: 1, durationUnit: 'hours', durationValue: 1, imageUrl: '', mikrotikProfile: '1Hour', price: 0.50, currency: 'USD', active: true },
        { name: '1 Day', description: 'Full-day access for work or entertainment.', deviceLimit: 1, durationUnit: 'days', durationValue: 1, imageUrl: '', mikrotikProfile: '1Day', price: 1.00, currency: 'USD', active: true },
        { name: '7 Days', description: 'A full week of high-speed connectivity.', deviceLimit: 2, durationUnit: 'days', durationValue: 7, imageUrl: '', mikrotikProfile: '7Day', price: 3.00, currency: 'USD', active: true },
        { name: '30 Days', description: 'Monthly plan — best value for regular users.', deviceLimit: 3, durationUnit: 'days', durationValue: 30, imageUrl: '', mikrotikProfile: '30Day', price: 5.00, currency: 'USD', active: true },
    ],
    printer: {
        type: process.env.PRINTER_TYPE || 'EPSON',
        interface: process.env.PRINTER_INTERFACE || 'tcp://192.168.88.254',
        timeout: parseInt(process.env.PRINTER_TIMEOUT) || 5000,
        enabled: process.env.PRINTER_ENABLED !== 'false'
    },
    slack: {
        enabled: false,
        token: process.env.SLACK_BOT_TOKEN || '',
        channel: process.env.SLACK_CHANNEL || ''
    },
    discord: {
        enabled: false,
        token: process.env.DISCORD_BOT_TOKEN || '',
        channelId: process.env.DISCORD_CHANNEL_ID || ''
    },
    sms: {
        enabled: false,
        provider: process.env.SMS_PROVIDER || 'twilio',
        // Twilio credentials
        accountSid: process.env.TWILIO_ACCOUNT_SID || process.env.SMS_ACCOUNT_SID || '',
        authToken: process.env.TWILIO_AUTH_TOKEN || process.env.SMS_AUTH_TOKEN || '',
        phoneNumber: process.env.TWILIO_FROM_NUMBER || process.env.SMS_PHONE_NUMBER || '',
        // Econet A2A credentials
        econetBaseUrl: process.env.ECONET_BASE_URL || 'https://api.econet.co.zw',
        econetClientId: process.env.ECONET_CLIENT_ID || '',
        econetClientSecret: process.env.ECONET_CLIENT_SECRET || '',
        econetFromName: process.env.ECONET_FROM_NAME || 'AgentOS'
    },
    ussd: {
        enabled: false,
        provider: process.env.USSD_PROVIDER || 'africastalking',
        apiKey: process.env.USSD_API_KEY || '',
        username: process.env.USSD_USERNAME || '',
        serviceCode: process.env.USSD_SERVICE_CODE || ''
    },
    email: {
        enabled: false,
        host: process.env.EMAIL_HOST || '',
        port: parseInt(process.env.EMAIL_PORT) || 587,
        user: process.env.EMAIL_USER || '',
        pass: process.env.EMAIL_PASS || '',
        from: process.env.EMAIL_FROM || ''
    }
};

/**
 * Deep-merge `src` into `dst`, skipping null/undefined src values so that
 * DEFAULT_CONFIG sub-objects are never clobbered by a null in the saved file.
 */
function deepMerge(dst, src) {
    if (!src || typeof src !== 'object' || Array.isArray(src)) return dst;
    const out = { ...dst };
    for (const key of Object.keys(src)) {
        const sv = src[key];
        if (sv === null || sv === undefined) continue; // keep default
        if (typeof sv === 'object' && !Array.isArray(sv) && typeof dst[key] === 'object' && dst[key] !== null) {
            out[key] = deepMerge(dst[key], sv);
        } else {
            out[key] = sv;
        }
    }
    return out;
}

function loadConfig() {
    let config = JSON.parse(JSON.stringify(DEFAULT_CONFIG)); // deep clone defaults

    // Load JSON config from profile
    if (fs.existsSync(CONFIG_PATH)) {
        try {
            const saved = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
            config = deepMerge(config, saved);
        } catch (e) {
            console.error('Failed to load JSON config:', e.message);
        }
    }

    // Load YAML config from project root or config folder
    const yamlPaths = [
        path.join(process.cwd(), 'br3eze.yaml'),
        path.join(process.cwd(), 'config', 'br3eze.yaml')
    ];

    for (const yamlPath of yamlPaths) {
        if (fs.existsSync(yamlPath)) {
            try {
                const yaml = require('js-yaml');
                const content = fs.readFileSync(yamlPath, 'utf8');
                const loaded = yaml.load(content);

                // Merge common sections
                if (loaded.integration && loaded.integration.printer) {
                    config.printer = { ...config.printer, ...loaded.integration.printer };
                }

                // Also merge other sections if needed
                if (loaded.mikrotik) {
                    config.mikrotik = { ...config.mikrotik, ...loaded.mikrotik };
                }

                break; // Use the first one found
            } catch (e) {
                console.error(`Failed to load YAML config from ${yamlPath}:`, e.message);
            }
        }
    }

    return config;
}

function saveConfig(config) {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
}

function getConfig() {
    const loaded = loadConfig() || { ...DEFAULT_CONFIG, createdAt: new Date().toISOString() };

    // Environment variables ALWAYS override config file for critical infrastructure
    if (process.env.GATEWAY_PORT || process.env.PORT) {
        loaded.gateway.port = parseInt(process.env.GATEWAY_PORT || process.env.PORT);
    }
    if (process.env.GATEWAY_HOST || process.env.HOST) {
        loaded.gateway.host = process.env.GATEWAY_HOST || process.env.HOST;
    }
    if (process.env.MIKROTIK_IP) {
        loaded.mikrotik.ip = process.env.MIKROTIK_IP;
    }
    if (process.env.AGENTOS_GATEWAY_TOKEN) {
        loaded.gateway.token = process.env.AGENTOS_GATEWAY_TOKEN;
    }

    // Ensure structures exist before setting properties
    loaded.whatsapp = loaded.whatsapp || {};
    loaded.telegram = loaded.telegram || {};

    // Channel Overrides
    if (process.env.WHATSAPP_ENABLED) {
        loaded.whatsapp.enabled = process.env.WHATSAPP_ENABLED === 'true';
    }
    if (process.env.TELEGRAM_TOKEN || process.env.TELEGRAM_BOT_TOKEN) {
        loaded.telegram.enabled = true;
        loaded.telegram.token = process.env.TELEGRAM_TOKEN || process.env.TELEGRAM_BOT_TOKEN;
    }
    if (process.env.ALLOWED_CHAT_IDS) {
        const ids = process.env.ALLOWED_CHAT_IDS.split(',').map(id => id.trim()).filter(Boolean);
        loaded.telegram.allowed_ids = ids;
        loaded.whatsapp.allowed_ids = ids;
    }

    // Slack & Discord Overrides
    if (process.env.SLACK_ENABLED !== undefined) {
        loaded.slack.enabled = process.env.SLACK_ENABLED === 'true';
    } else if (process.env.SLACK_BOT_TOKEN) {
        loaded.slack.enabled = true;
    }
    if (process.env.SLACK_BOT_TOKEN) {
        loaded.slack.token = process.env.SLACK_BOT_TOKEN;
    }
    if (process.env.SLACK_CHANNEL) {
        loaded.slack.channel = process.env.SLACK_CHANNEL;
    }

    if (process.env.DISCORD_ENABLED !== undefined) {
        loaded.discord.enabled = process.env.DISCORD_ENABLED === 'true';
    } else if (process.env.DISCORD_BOT_TOKEN) {
        loaded.discord.enabled = true;
    }
    if (process.env.DISCORD_BOT_TOKEN) {
        loaded.discord.token = process.env.DISCORD_BOT_TOKEN;
    }
    if (process.env.DISCORD_CHANNEL_ID) {
        loaded.discord.channelId = process.env.DISCORD_CHANNEL_ID;
    }

    // SMS Overrides
    loaded.sms = loaded.sms || {};
    if (process.env.SMS_ENABLED !== undefined) {
        loaded.sms.enabled = process.env.SMS_ENABLED === 'true';
    }

    // USSD Overrides
    loaded.ussd = loaded.ussd || {};
    if (process.env.USSD_ENABLED !== undefined) {
        loaded.ussd.enabled = process.env.USSD_ENABLED === 'true';
    }

    // Email Overrides
    loaded.email = loaded.email || {};
    if (process.env.EMAIL_ENABLED !== undefined) {
        loaded.email.enabled = process.env.EMAIL_ENABLED === 'true';
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
        apiKey: process.env.API_KEY,
        ALERT_COOLDOWN_MS: 60000
    }
};
