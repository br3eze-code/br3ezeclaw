/**
 * AgentOS WiFi Manager - API Client
 * Version: 2026.5.0
 * Features: REST API communication with server
 */

class AgentOSClient {
    constructor() {
        this.serverUrl = '';
        this.token = '';
        this.timeout = CONFIG.API_TIMEOUT;
    }

    setConfig(serverUrl, token) {
        this.serverUrl = serverUrl.replace(/\/$/, ''); // Remove trailing slash
        this.token = token;
    }

    getServerUrl() {
        return this.serverUrl;
    }

    getToken() {
        return this.token;
    }

    async request(endpoint, options = {}) {
        const url = `${this.serverUrl}${endpoint}`;

        const defaultOptions = {
            headers: {
                'Content-Type': 'application/json'
            },
            timeout: this.timeout
        };

        if (this.token) {
            defaultOptions.headers['Authorization'] = `Bearer ${this.token}`;
        }

        const mergedOptions = {
            ...defaultOptions,
            ...options,
            headers: {
                ...defaultOptions.headers,
                ...(options.headers || {})
            }
        };

        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), this.timeout);

            const response = await fetch(url, {
                ...mergedOptions,
                signal: controller.signal
            });

            clearTimeout(timeoutId);

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.error || `HTTP ${response.status}`);
            }

            return data;
        } catch (error) {
            if (error.name === 'AbortError') {
                throw new Error('Request timeout');
            }
            throw error;
        }
    }

    // Authentication
    async login(username, password) {
        const data = await this.request('/api/auth/login', {
            method: 'POST',
            body: JSON.stringify({ username, password })
        });

        if (data.success && data.token) {
            this.token = data.token;
            await storage.saveSetting(STORAGE_KEYS.API_TOKEN, data.token);
        }

        return data;
    }

    // Health check
    async health() {
        return this.request('/health');
    }

    // System tools
    async executeTool(tool, params = []) {
        // Try WebSocket first for real-time
        if (wsClient.isConnected()) {
            try {
                return await wsClient.executeTool(tool, params);
            } catch (e) {
                console.warn('[Client] WS tool failed, falling back to HTTP:', e.message);
            }
        }

        // Fallback to HTTP
        return this.request('/api/tool/execute', {
            method: 'POST',
            body: JSON.stringify({ tool, params })
        });
    }

    // Router endpoints
    async getRouterStatus() {
        return this.executeTool('router.status');
    }

    async getRouterUsers() {
        return this.executeTool('router.users');
    }

    async getActiveUsers() {
        return this.executeTool('router.active');
    }

    async kickUser(username) {
        return this.executeTool('router.kick', [username]);
    }

    async rebootRouter() {
        return this.executeTool('router.reboot');
    }

    async backupRouter() {
        return this.executeTool('router.backup');
    }

    // Voucher endpoints
    async listVouchers(limit = 50, used = null) {
        let url = `/api/vouchers?limit=${limit}`;
        if (used !== null) {
            url += `&used=${used}`;
        }
        return this.request(url);
    }

    async createVoucher(plan, count = 1) {
        return this.request('/api/vouchers', {
            method: 'POST',
            body: JSON.stringify({ plan, count })
        });
    }

    async redeemVoucher(code, user) {
        return this.request('/api/vouchers/redeem', {
            method: 'POST',
            body: JSON.stringify({ code, user })
        });
    }

    async getVoucherStats() {
        return this.request('/api/vouchers/stats');
    }

    // Network tools
    async ping(host, count = 4) {
        return this.executeTool('network.ping', [host, count]);
    }

    async getInterfaces() {
        return this.executeTool('network.interfaces');
    }

    // System tools
    async getSystemStats() {
        return this.executeTool('system.stats');
    }

    async getSystemHealth() {
        return this.executeTool('system.health');
    }

    // Audit
    async getAuditLog(limit = 50) {
        return this.request(`/api/audit?limit=${limit}`);
    }

    // Available tools
    async listTools() {
        if (wsClient.isConnected()) {
            return wsClient.listTools();
        }
        return this.request('/api/tools');
    }

    // Check connection
    async isOnline() {
        try {
            await this.health();
            return true;
        } catch (e) {
            return false;
        }
    }
}

// Global client instance
const Client = new AgentOSClient();

// Export for use in other modules
if (typeof window !== 'undefined') {
    window.AgentOSClient = AgentOSClient;
    window.Client = Client;
}
