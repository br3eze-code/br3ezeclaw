/**
 * AgentOS WiFi Manager - Tool Registry (Client-side)
 * Version: 2026.5.0
 * Pattern: Maps commands to executable functions
 */

class ToolRegistry {
    constructor() {
        this.tools = new Map();
        this._registerLocalTools();
    }

    _registerLocalTools() {
        // Local tools run directly on the client

        // Device info tool
        this.register('device.info', async () => {
            return {
                platform: navigator.platform || 'unknown',
                userAgent: navigator.userAgent,
                language: navigator.language,
                online: navigator.onLine,
                screenWidth: screen.width,
                screenHeight: screen.height,
                timestamp: new Date().toISOString()
            };
        });

        // Storage tools
        this.register('storage.get', async (key) => {
            if (!key) throw new Error('Key required');
            return storage.getCache(key);
        });

        this.register('storage.set', async (key, value) => {
            if (!key) throw new Error('Key required');
            return storage.setCache(key, value);
        });

        // Ledger tools
        this.register('ledger.status', async () => {
            return ledger.verify();
        });

        this.register('ledger.history', async (limit = 50) => {
            return ledger.getEventHistory(limit);
        });

        // Math tool (secure evaluation)
        this.register('math.evaluate', async (expression) => {
            return this.safeMathEval(expression);
        });

        // Hash tool
        this.register('utils.hash', async (data) => {
            return quantumSecurity.hash(data);
        });

        // UUID generator
        this.register('utils.uuid', async () => {
            return SecurityValidator.generateSecureId('uuid');
        });

        // Time tool
        this.register('time.now', async () => {
            return {
                timestamp: Date.now(),
                iso: new Date().toISOString(),
                utc: new Date().toUTCString()
            };
        });

        // Connection status
        this.register('connection.status', async () => {
            return {
                online: navigator.onLine,
                wsConnected: wsClient.isConnected(),
                serverUrl: Client.getServerUrl()
            };
        });
    }

    register(name, fn) {
        this.tools.set(name, {
            fn,
            name,
            type: 'local',
            registeredAt: Date.now()
        });
    }

    registerRemote(name) {
        // Mark tool as requiring server
        this.tools.set(name, {
            fn: (...args) => wsClient.executeTool(name, args),
            name,
            type: 'remote',
            registeredAt: Date.now()
        });
    }

    async execute(name, ...args) {
        const tool = this.tools.get(name);

        if (!tool) {
            throw new Error(`Unknown tool: ${name}. Available: ${[...this.tools.keys()].join(', ')}`);
        }

        try {
            const result = await tool.fn(...args);

            // Log to ledger
            await ledger.log('tool.execute', name, {
                tool: name,
                args: args.length <= 2 ? args : '[args]'
            });

            return result;
        } catch (error) {
            console.error(`[ToolRegistry] Tool ${name} failed:`, error);
            throw error;
        }
    }

    getTools(type = null) {
        if (type) {
            return [...this.tools.entries()]
                .filter(([_, t]) => t.type === type)
                .map(([name, t]) => ({
                    name,
                    type: t.type,
                    registeredAt: t.registeredAt
                }));
        }

        return [...this.tools.keys()];
    }

    getRemoteTools() {
        return this.getTools('remote');
    }

    getLocalTools() {
        return this.getTools('local');
    }

    safeMathEval(expression) {
        if (!expression || typeof expression !== 'string') {
            throw new Error('Invalid expression');
        }

        // Remove anything that isn't a number, operator, or whitespace
        const sanitized = expression.replace(/[^0-9+\-*/().%\s]/g, '');

        if (!sanitized.trim()) {
            throw new Error('No valid math expression');
        }

        try {
            // Use Function constructor for safer evaluation
            const fn = new Function(`return ${sanitized}`);
            const result = fn();

            if (typeof result !== 'number' || !isFinite(result)) {
                throw new Error('Invalid result');
            }

            return {
                expression: sanitized,
                result: Math.round(result * 1000000) / 1000000, // 6 decimal places
                type: typeof result
            };
        } catch (error) {
            throw new Error(`Math evaluation failed: ${error.message}`);
        }
    }
}

// Global tool registry
const toolRegistry = new ToolRegistry();

// Register remote tools (proxied to server)
const remoteTools = [
    // Router tools
    'router.status',
    'router.users',
    'router.active',
    'router.kick',
    'router.reboot',
    'router.backup',

    // Network tools
    'network.ping',
    'network.interfaces',

    // Voucher tools
    'voucher.create',
    'voucher.list',
    'voucher.get',
    'voucher.redeem',
    'voucher.delete',
    'voucher.stats',
    'voucher.plans',

    // System tools
    'system.info',
    'system.health',
    'system.stats',

    // Audit tools
    'audit.list',
    'audit.verify',

    // Utility tools
    'utils.qrcode'
];

// Register all remote tools
remoteTools.forEach(tool => toolRegistry.registerRemote(tool));

// Export for use in other modules
if (typeof window !== 'undefined') {
    window.ToolRegistry = ToolRegistry;
    window.toolRegistry = toolRegistry;
}
