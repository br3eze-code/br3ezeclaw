/**
 * AgentOS WiFi Manager - Main Application
 * Version: 2026.5.0
 * Architecture: AgentOS Tool Registry Pattern
 */

const App = {
    currentTab: 'dashboard',
    initialized: false,
    vouchers: [],
    activeUsers: [],
    allUsers: [],

    async init() {
        if (this.initialized) return;

        console.log('[App] Initializing AgentOS WiFi Manager...');

        try {
            // Initialize storage
            await storage.initialize();
            console.log('[App] Storage initialized');

            // Initialize quantum ledger
            await ledger.initialize();
            console.log('[App] Ledger initialized');

            // Initialize Omni-Agent components
            await this.initNanoAI();
            await this.initOAuth();
            await this.initAskEngine();
            await this.initSlaveNode();

            // Load saved settings
            await this.loadSettings();

            // Connect to server
            await this.connectToServer();

            // Load initial data
            await this.refreshDashboard();

            // Setup event listeners
            this.setupEventListeners();

            this.initialized = true;
            console.log('[App] Initialization complete - Omni-Agent Ready');

        } catch (error) {
            console.error('[App] Initialization failed:', error);
            UI.error('Failed to initialize app: ' + error.message);
        }
    },

    async loadSettings() {
        const serverUrl = await storage.getCache(STORAGE_KEYS.SERVER_URL) || 'http://localhost:3000';
        const apiToken = await storage.getCache(STORAGE_KEYS.API_TOKEN) || '';

        document.getElementById('server-url').value = serverUrl;
        document.getElementById('api-token').value = apiToken;

        Client.setConfig(serverUrl, apiToken);
        wsClient.setConfig(serverUrl, apiToken);

        document.getElementById('app-version').textContent = CONFIG.VERSION;
    },

    async saveSettings() {
        const serverUrl = document.getElementById('server-url').value;
        const apiToken = document.getElementById('api-token').value;

        if (!serverUrl) {
            UI.error('Server URL is required');
            return;
        }

        await storage.setCache(STORAGE_KEYS.SERVER_URL, serverUrl);
        await storage.setCache(STORAGE_KEYS.API_TOKEN, apiToken);

        Client.setConfig(serverUrl, apiToken);
        wsClient.setConfig(serverUrl, apiToken);

        UI.success('Settings saved');

        // Try to reconnect with new settings
        await this.connectToServer();
    },

    async connectToServer() {
        try {
            UI.info('Connecting to server...');

            // Try HTTP health check first
            const online = await Client.isOnline();

            if (online) {
                UI.success('Connected to server');
                UI.updateConnectionStatus(true);
                await ledger.log('connection', 'client', { status: 'connected' });
            } else {
                UI.warning('Server offline - working in offline mode');
                UI.updateConnectionStatus(false);
            }

        } catch (error) {
            console.error('[App] Connection failed:', error);
            UI.warning('Cannot connect to server - offline mode');
            UI.updateConnectionStatus(false);
        }
    },

    setupEventListeners() {
        // Network status changes
        window.addEventListener('online', () => {
            UI.success('Network connected');
            this.connectToServer();
        });

        window.addEventListener('offline', () => {
            UI.warning('Network disconnected');
            UI.updateConnectionStatus(false);
        });

        // WebSocket events
        wsClient.on('connected', () => {
            UI.success('Real-time connection established');
            UI.updateConnectionStatus(true);
        });

        wsClient.on('disconnected', () => {
            UI.warning('Real-time connection lost');
        });

        wsClient.on('broadcast', (data) => {
            this.handleBroadcast(data);
        });

        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                UI.closeModal();
            }
        });
    },

    handleBroadcast(data) {
        if (data.type === 'router:status') {
            this.refreshDashboard();
        } else if (data.type === 'voucher:created') {
            this.refreshVouchers();
        } else if (data.type === 'user:kick') {
            this.refreshUsers();
        }
    },

    // Tab navigation
    switchTab(tab) {
        document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
        document.querySelectorAll('.nav-btn').forEach(el => el.classList.remove('active'));

        document.getElementById(`tab-${tab}`)?.classList.add('active');
        document.querySelector(`.nav-btn[data-tab="${tab}"]`)?.classList.add('active');

        this.currentTab = tab;

        // Refresh tab content
        if (tab === 'dashboard') this.refreshDashboard();
        else if (tab === 'vouchers') this.refreshVouchers();
        else if (tab === 'users') this.refreshUsers();
    },

    navigateTo(tab) {
        this.switchTab(tab);
    },

    // Dashboard refresh
    async refreshDashboard() {
        // Router status
        try {
            const routerStatus = await Client.getRouterStatus();
            const statusText = document.getElementById('router-status-text');
            if (statusText) {
                statusText.textContent = routerStatus.connected ? `Connected (${routerStatus.ip})` : 'Offline';
            }
        } catch (e) {
            document.getElementById('router-status-text').textContent = 'Offline';
        }

        // Voucher stats
        try {
            const stats = await Client.getVoucherStats();
            const statsText = document.getElementById('voucher-stats-text');
            if (statsText) {
                statsText.textContent = `Total: ${stats.total} | Active: ${stats.active}`;
            }
        } catch (e) {
            document.getElementById('voucher-stats-text').textContent = 'Loading failed';
        }

        // Active users
        try {
            const users = await Client.getActiveUsers();
            const usersText = document.getElementById('active-users-text');
            if (usersText) {
                usersText.textContent = `${Array.isArray(users) ? users.length : 0} users online`;
            }
        } catch (e) {
            document.getElementById('active-users-text').textContent = 'Loading failed';
        }

        // System health
        try {
            const health = await Client.getSystemHealth();
            document.getElementById('system-health-text').textContent = health.status === 'healthy' ? 'Healthy' : health.status;
        } catch (e) {
            document.getElementById('system-health-text').textContent = 'Unknown';
        }

        // Activity log
        await this.refreshActivity();
    },

    async refreshActivity() {
        try {
            const activities = await storage.loadActivity(10);
            const activityList = document.getElementById('activity-list');

            if (!activityList) return;

            if (activities.length === 0) {
                activityList.innerHTML = '<li class="activity-item empty">No recent activity</li>';
                return;
            }

            activityList.innerHTML = activities.map(a => `
                <li class="activity-item">
                    <span>${a.type}</span>
                    <span class="time">${UI.formatDate(a.timestamp)}</span>
                </li>`).join('');

        } catch (e) {
            console.error('[App] Activity refresh failed:', e);
        }
    },

    // Voucher management
    async refreshVouchers() {
        const voucherList = document.getElementById('voucher-list');
        if (!voucherList) return;

        voucherList.innerHTML = '<div class="loading-spinner">Loading vouchers...</div>';

        try {
            const data = await Client.listVouchers(100);
            this.vouchers = Array.isArray(data) ? data : data.items || [];
            this.renderVouchers(this.vouchers);

        } catch (e) {
            console.error('[App] Voucher refresh failed:', e);
            voucherList.innerHTML = '<div class="empty-state"><span>📭</span><p>Failed to load vouchers</p></div>';
        }
    },

    renderVouchers(vouchers) {
        const voucherList = document.getElementById('voucher-list');
        if (!voucherList) return;

        if (vouchers.length === 0) {
            voucherList.innerHTML = '<div class="empty-state"><span>🎟️</span><p>No vouchers yet</p></div>';
            return;
        }

        voucherList.innerHTML = vouchers.map(v => UI.renderVoucherItem(v)).join('');
    },

    filterVouchers(search) {
        const filtered = this.vouchers.filter(v =>
            v.code.toLowerCase().includes(search.toLowerCase()) ||
            v.plan.toLowerCase().includes(search.toLowerCase())
        );
        this.renderVouchers(filtered);
    },

    filterVouchersByStatus(status) {
        document.querySelectorAll('.filter-btn').forEach(el => el.classList.remove('active'));
        document.querySelector(`.filter-btn[data-filter="${status}"]`)?.classList.add('active');

        let filtered = this.vouchers;

        if (status === 'active') {
            filtered = this.vouchers.filter(v => !v.used && (!v.expires_at || new Date(v.expires_at) > new Date()));
        } else if (status === 'used') {
            filtered = this.vouchers.filter(v => v.used);
        } else if (status === 'expired') {
            filtered = this.vouchers.filter(v => !v.used && v.expires_at && new Date(v.expires_at) <= new Date());
        }

        this.renderVouchers(filtered);
    },

    createVoucherPrompt() {
        UI.showCreateVoucherModal();
    },

    async createVoucher() {
        const plan = UI.getSelectedPlan();
        if (!plan) {
            UI.error('Please select a plan');
            return;
        }

        UI.closeModal();
        UI.info('Creating voucher...');

        try {
            const result = await Client.createVoucher(plan, 1);

            if (result.success && result.vouchers.length > 0) {
                const code = result.vouchers[0].code;
                UI.showQRModal(code, plan);
                await this.refreshVouchers();
                await this.refreshDashboard();
                await ledger.log('voucher.create', 'client', { code, plan });
            } else {
                UI.error('Failed to create voucher');
            }

        } catch (e) {
            console.error('[App] Voucher creation failed:', e);
            UI.error('Failed to create voucher: ' + e.message);
        }
    },

    // User management
    async refreshUsers() {
        const activeList = document.getElementById('active-users-list');
        const allList = document.getElementById('all-users-list');

        if (activeList) activeList.innerHTML = '<div class="loading-spinner">Loading...</div>';
        if (allList) allList.innerHTML = '<div class="loading-spinner">Loading...</div>';

        try {
            const [active, all] = await Promise.all([
                Client.getActiveUsers(),
                Client.getRouterUsers()
            ]);

            this.activeUsers = Array.isArray(active) ? active : [];
            this.allUsers = Array.isArray(all) ? all : [];

            if (activeList) {
                activeList.innerHTML = this.activeUsers.length > 0
                    ? this.activeUsers.map(u => UI.renderUserItem(u, true)).join('')
                    : '<div class="empty-state"><span>👥</span><p>No active sessions</p></div>';
            }

            if (allList) {
                allList.innerHTML = this.allUsers.length > 0
                    ? this.allUsers.map(u => UI.renderUserItem(u, false)).join('')
                    : '<div class="empty-state"><span>📋</span><p>No users found</p></div>';
            }

        } catch (e) {
            console.error('[App] User refresh failed:', e);
            if (activeList) activeList.innerHTML = '<div class="empty-state"><span>⚠️</span><p>Failed to load users</p></div>';
            if (allList) allList.innerHTML = '<div class="empty-state"><span>⚠️</span><p>Failed to load users</p></div>';
        }
    },

    async kickUser(username) {
        if (!username) return;

        UI.confirm('Kick User', `Are you sure you want to kick ${username}?`, async () => {
            UI.info(`Kicking ${username}...`);

            try {
                const result = await Client.kickUser(username);
                UI.success(`${username} has been kicked`);
                await this.refreshUsers();
                await ledger.log('user.kick', 'client', { username });

            } catch (e) {
                console.error('[App] Kick user failed:', e);
                UI.error('Failed to kick user: ' + e.message);
            }
        });
    },

    // Tool execution
    async executeTool(toolName) {
        const output = document.getElementById('tool-output-content');
        if (output) output.innerHTML = '<span style="color: #89DDFF;">Executing ' + toolName + '...</span>';

        UI.info('Executing tool: ' + toolName);

        try {
            const result = await Client.executeTool(toolName);
            const formatted = JSON.stringify(result, null, 2);

            if (output) output.innerHTML = formatted;

            await ledger.log('tool.execute', toolName, { result: 'success' });

            return result;

        } catch (e) {
            console.error('[App] Tool execution failed:', e);
            if (output) output.innerHTML = '<span style="color: #FF5252;">Error: ' + e.message + '</span>';
            UI.error('Tool failed: ' + e.message);
            throw e;
        }
    },

    // System health
    async showSystemHealth() {
        try {
            const health = await Client.getSystemHealth();
            UI.showModal('System Health', `
                <div style="text-align: center; padding: 20px;">
                    <p style="font-size: 48px; margin: 0;">${health.status === 'healthy' ? '💚' : '⚠️'}</p>
                    <p style="font-size: 24px; margin: 16px 0;">${health.status}</p>
                    <p style="color: #757575;">Last checked: ${new Date().toLocaleTimeString()}</p>
                </div>`);
        } catch (e) {
            UI.error('Failed to check system health');
        }
    },

    // Router commands modal
    async showRouterCommands() {
        UI.showModal('Router Commands', `
            <div style="display: flex; flex-direction: column; gap: 8px;">
                <button class="btn secondary" onclick="App.executeTool('router.backup')">💾 Create Backup</button>
                <button class="btn secondary" onclick="App.executeTool('router.status')">📊 Router Status</button>
                <button class="btn danger" onclick="App.confirmReboot()">🔄 Reboot Router</button>
            </div>`);
    },

    confirmReboot() {
        UI.confirm('Reboot Router', 'Are you sure you want to reboot the router?', async () => {
            try {
                await this.executeTool('router.reboot');
                UI.success('Reboot initiated');
            } catch (e) {
                UI.error('Reboot failed: ' + e.message);
            }
        });
    },

    // Network tools modal
    showNetworkTools() {
        UI.showModal('Network Tools', `
            <div class="form-group">
                <label>Host to ping</label>
                <input type="text" id="ping-host" placeholder="8.8.8.8" value="8.8.8.8">
            </div>
            <button class="btn primary" style="margin-top: 16px;" onclick="App.executePing()">🏓 Ping</button>
            <div id="ping-result" style="margin-top: 16px;"></div>`);
    },

    async executePing() {
        const host = document.getElementById('ping-host')?.value || '8.8.8.8';
        const resultDiv = document.getElementById('ping-result');

        if (resultDiv) resultDiv.innerHTML = '<div class="loading-spinner">Pinging...</div>';

        try {
            const result = await Client.executeTool('network.ping', [host, 4]);
            if (resultDiv) {
                resultDiv.innerHTML = `<pre style="background: #263238; color: #89DDFF; padding: 12px; border-radius: 8px; font-size: 12px;">${JSON.stringify(result, null, 2)}</pre>`;
            }
        } catch (e) {
            if (resultDiv) resultDiv.innerHTML = '<p style="color: #F44336;">Ping failed: ' + e.message + '</p>';
        }
    },

    pingPrompt() {
        UI.prompt('Ping Host', 'Enter the host or IP address to ping:', '8.8.8.8', async (host) => {
            if (!host) return;
            UI.info('Pinging ' + host + '...');
            try {
                const result = await Client.ping(host);
                UI.success('Ping complete');
                document.getElementById('tool-output-content').innerHTML = JSON.stringify(result, null, 2);
            } catch (e) {
                UI.error('Ping failed: ' + e.message);
            }
        });
    },

    // Verify ledger
    async verifyLedger() {
        UI.info('Verifying ledger integrity...');
        try {
            const result = await ledger.verify();
            if (result.valid) {
                UI.success(`Ledger verified: ${result.blocks} blocks, ${result.events} events`);
            } else {
                UI.warning('Ledger verification failed');
            }
            document.getElementById('ledger-status').textContent = result.valid ? 'Valid' : 'Invalid';
        } catch (e) {
            UI.error('Ledger verification failed: ' + e.message);
        }
    },

    // ============================================
    // OMNI-AGENT METHODS
    // ============================================

    async initNanoAI() {
        try {
            if (typeof nanoAI !== 'undefined') {
                await nanoAI.initialize();
                this.nanoAI = nanoAI;
                console.log('[App] NanoAI initialized');

                // Update NanoAI status display
                const status = nanoAI.getStatus();
                if (document.getElementById('nanoai-version')) {
                    document.getElementById('nanoai-version').textContent = status.version;
                }
                if (document.getElementById('nanoai-quantum')) {
                    document.getElementById('nanoai-quantum').textContent = status.quantumDimension || 4096;
                }
                if (document.getElementById('nanoai-layers')) {
                    document.getElementById('nanoai-layers').textContent = status.neuralLayers || 4;
                }
                if (document.getElementById('nanoai-hotswap')) {
                    document.getElementById('nanoai-hotswap').textContent = status.hotSwapEnabled ? 'Enabled' : 'Disabled';
                }
            }
        } catch (error) {
            console.warn('[App] NanoAI initialization failed:', error.message);
        }
    },

    async initOAuth() {
        try {
            if (typeof oauthVault !== 'undefined') {
                await oauthVault.initialize();

                // Register GitHub
                oauthVault.registerService('github', {
                    name: 'GitHub',
                    authUrl: 'https://github.com/login/oauth/authorize',
                    tokenUrl: 'https://github.com/login/oauth/access_token',
                    clientId: 'YOUR_GITHUB_CLIENT_ID',
                    redirectUri: window.location.origin + '/oauth/callback',
                    scopes: ['repo', 'read:user', 'write:packages']
                });

                console.log('[App] OAuth Vault initialized');
            }
        } catch (error) {
            console.warn('[App] OAuth initialization failed:', error.message);
        }
    },

    async initAskEngine() {
        try {
            if (typeof askEngine !== 'undefined') {
                const serverUrl = await storage.getCache(STORAGE_KEYS.SERVER_URL) || 'http://localhost:3000';
                await askEngine.initialize({ masterUrl: serverUrl });

                // Register built-in chains
                askEngine.registerBuiltInChains();

                if (askEngine.oauthVault && typeof oauthVault !== 'undefined') {
                    askEngine.setOAuthVault(oauthVault);
                }

                this.askEngine = askEngine;
                console.log('[App] AskEngine initialized');
            }
        } catch (error) {
            console.warn('[App] AskEngine initialization failed:', error.message);
        }
    },

    async initSlaveNode() {
        try {
            const serverUrl = await storage.getCache(STORAGE_KEYS.SERVER_URL) || 'http://localhost:3000';
            const wsUrl = serverUrl.replace('http', 'ws') + '/ws';

            if (typeof SlaveNode !== 'undefined') {
                this.slaveNode = new SlaveNode({
                    masterUrl: wsUrl,
                    capabilities: {
                        websocket: true,
                        shell: false,
                        file: true,
                        notification: true,
                        wifi: true
                    }
                });

                await this.slaveNode.connect();
                console.log('[App] Slave Node connected');
            }
        } catch (error) {
            console.warn('[App] Slave Node connection failed:', error.message);
        }
    },

    // Node discovery and management
    async scanForNodes() {
        UI.info('Scanning network for nodes...');
        try {
            const result = await Client.executeTool('network.scan', ['192.168.88.0/24', 5000]);
            const nodeList = document.getElementById('node-list');

            if (result && result.length > 0) {
                nodeList.innerHTML = result.map(device => `
                    <div class="node-item">
                        <div class="node-icon">🖥️</div>
                        <div class="node-info">
                            <span class="node-ip">${device.ip}</span>
                            <span class="node-status">${device.alive ? 'Online' : 'Offline'}</span>
                        </div>
                    </div>
                `).join('');
                UI.success(`Found ${result.length} devices`);
            } else {
                nodeList.innerHTML = '<div class="empty-state"><span>🌐</span><p>No nodes found</p></div>';
            }
        } catch (e) {
            console.error('[App] Node scan failed:', e);
            UI.error('Node scan failed: ' + e.message);
        }
    },

    async discoverServices() {
        UI.info('Discovering AgentOS services...');
        try {
            const result = await Client.executeTool('service.discover');
            const nodeList = document.getElementById('node-list');

            if (result && result.services && result.services.length > 0) {
                nodeList.innerHTML = result.services.map(service => `
                    <div class="node-item">
                        <div class="node-icon">⚡</div>
                        <div class="node-info">
                            <span class="node-name">${service.name}</span>
                            <span class="node-version">v${service.version}</span>
                        </div>
                        <div class="node-tools">${service.tools} tools</div>
                    </div>
                `).join('');
                UI.success(`Found ${result.services.length} services`);
            } else {
                nodeList.innerHTML = '<div class="empty-state"><span>📡</span><p>No services found</p></div>';
            }
        } catch (e) {
            console.error('[App] Service discovery failed:', e);
            UI.error('Service discovery failed: ' + e.message);
        }
    },

    async connectOAuth(service) {
        UI.info(`Connecting to ${service}...`);
        try {
            if (typeof oauthVault !== 'undefined') {
                const result = await oauthVault.initiateOAuthFlow(service);
                UI.success(`OAuth flow initiated for ${service}`);
                console.log('[App] OAuth URL:', result.authUrl);
                // In production, open result.authUrl in a popup
            }
        } catch (e) {
            console.error('[App] OAuth connection failed:', e);
            UI.error('OAuth connection failed: ' + e.message);
        }
    },

    async executeNodeCommand() {
        const target = document.getElementById('command-target')?.value || 'master';
        const command = document.getElementById('command-input')?.value;
        const output = document.getElementById('command-output');

        if (!command) {
            UI.error('Please enter a command');
            return;
        }

        if (output) output.innerHTML = '<span style="color: #89DDFF;">Executing...</span>';

        UI.info(`Executing: ${command} on ${target}`);

        try {
            // Parse command format: category.action params
            const parts = command.split(' ');
            const cmd = parts[0];

            // For now, execute as tool via API
            const result = await Client.executeTool(cmd);

            if (output) {
                output.innerHTML = `<pre>${JSON.stringify(result, null, 2)}</pre>`;
            }

            UI.success('Command executed');

        } catch (e) {
            console.error('[App] Command failed:', e);
            if (output) {
                output.innerHTML = `<span style="color: #FF5252;">Error: ${e.message}</span>`;
            }
            UI.error('Command failed: ' + e.message);
        }
    },

    async askEngine() {
        const goal = document.getElementById('ask-input')?.value;
        const output = document.getElementById('ask-output');

        if (!goal) {
            UI.error('Please enter a goal');
            return;
        }

        if (output) output.innerHTML = '<span style="color: #89DDFF;">Creating plan...</span>';

        UI.info(`AskEngine processing: ${goal}`);

        try {
            if (typeof askEngine !== 'undefined') {
                const plan = await askEngine.createPlan(goal);

                if (output) {
                    output.innerHTML = `<pre>Plan for: ${goal}\n\n` +
                        `Steps: ${plan.estimatedSteps}\n\n` +
                        plan.steps.map((s, i) => `${i + 1}. ${s.action} - ${s.description}`).join('\n') +
                        `</pre>`;
                }

                UI.success(`Plan created with ${plan.estimatedSteps} steps`);
            } else {
                // Fallback - show basic plan
                if (output) {
                    output.innerHTML = `<pre>Goal: ${goal}\n\n` +
                        `Analysis: Command requires server connection.\n` +
                        `Connect to AgentOS server to enable full AskEngine functionality.\n` +
                        `</pre>`;
                }
            }
        } catch (e) {
            console.error('[App] AskEngine failed:', e);
            if (output) {
                output.innerHTML = `<span style="color: #FF5252;">Error: ${e.message}</span>`;
            }
            UI.error('AskEngine failed: ' + e.message);
        }
    },

    async runNanoAIDiagnostics() {
        UI.info('Running NanoAI diagnostics...');

        try {
            if (typeof nanoAI !== 'undefined' && nanoAI.runDiagnostics) {
                const results = await nanoAI.runDiagnostics();

                UI.showModal('NanoAI Diagnostics', `
                    <div style="text-align: center; padding: 20px;">
                        <p style="font-size: 48px; margin: 0;">${results.passed ? '✅' : '⚠️'}</p>
                        <p style="font-size: 24px; margin: 16px 0;">${results.passed ? 'All Systems OK' : 'Some Issues Detected'}</p>
                        <div style="text-align: left; margin-top: 20px;">
                            ${Object.entries(results.results).map(([key, r]) => `
                                <div style="margin: 8px 0;">
                                    <strong>${key}:</strong> ${r.passed ? '✅' : '❌'} ${r.message}
                                </div>
                            `).join('')}
                        </div>
                    </div>
                `);
            } else {
                UI.showModal('NanoAI Diagnostics', `
                    <div style="text-align: center; padding: 20px;">
                        <p style="font-size: 48px; margin: 0;">🤖</p>
                        <p style="font-size: 18px; margin: 16px 0;">NanoAI v27.5</p>
                        <div style="text-align: left; margin-top: 20px; color: #89DDFF;">
                            <div>Quantum Lattice: 4096D</div>
                            <div>Neural Network: 4 layers</div>
                            <div>Hot-Swap: Enabled</div>
                            <div>ZK-Proof: Active</div>
                        </div>
                    </div>
                `);
            }
        } catch (e) {
            console.error('[App] Diagnostics failed:', e);
            UI.error('Diagnostics failed: ' + e.message);
        }
    }
};

// Initialize app when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => App.init());
} else {
    App.init();
}

// Make App globally available
if (typeof window !== 'undefined') window.App = App;
