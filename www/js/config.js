/**
 * AgentOS WiFi Manager - Configuration
 * Version: 2026.5.0
 */

const CONFIG = {
    APP_NAME: 'AgentOS WiFi Manager',
    VERSION: '2026.5.0',
    VOUCHER_PREFIX: 'STAR-',
    VOUCHER_PLANS: {
        '1hour': { name: '1 Hour', price: 1.00 },
        '1Day': { name: '1 Day', price: 5.00 },
        '7Day': { name: '7 Days', price: 25.00 },
        '30Day': { name: '30 Days', price: 80.00 }
    },
    WS_RECONNECT_INTERVAL: 5000,
    WS_MAX_RECONNECT: 10,
    API_TIMEOUT: 30000,
    CACHE_TTL: 5 * 60 * 1000, // 5 minutes
    MAX_LOG_SIZE: 100
};

// Storage keys
const STORAGE_KEYS = {
    SERVER_URL: 'agentos_server_url',
    API_TOKEN: 'agentos_api_token',
    VOUCHERS: 'agentos_vouchers_cache',
    ACTIVITY: 'agentos_activity',
    LEDGER: 'agentos_ledger',
    SETTINGS: 'agentos_settings'
};

// Export for use in other modules
if (typeof window !== 'undefined') {
    window.AGENTOS_CONFIG = CONFIG;
    window.STORAGE_KEYS = STORAGE_KEYS;
}
