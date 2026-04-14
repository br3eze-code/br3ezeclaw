/**
 * Slave Node - Cross-Platform WebSocket Client
 * AgentOS Omni-Agent Component
 * Version: 2026.5.0
 * Purpose: Lightweight listener that executes commands from AgentOS master
 * Platforms: Windows (PowerShell), Linux (bash), macOS (zsh), Pi (bash)
 */

class SlaveNode {
    constructor(config = {}) {
        this.version = '1.0.0';
        this.nodeId = config.nodeId || this.generateNodeId();
        this.masterUrl = config.masterUrl || 'ws://localhost:3000/ws';
        this.platform = config.platform || this.detectPlatform();
        this.capabilities = config.capabilities || this.getDefaultCapabilities();
        this.connected = false;
        this.ws = null;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 10;
        this.reconnectDelay = 1000;
        this.commandHistory = [];
        this.subscriptions = new Set();
        this.pendingCommands = new Map();
    }

    // §1 Platform Detection
    detectPlatform() {
        const platform = navigator.platform?.toLowerCase() || '';
        if (platform.includes('win')) return 'windows';
        if (platform.includes('linux')) return 'linux';
        if (platform.includes('mac') || platform.includes('darwin')) return 'macos';
        if (platform.includes('android')) return 'android';
        if (platform.includes('ios') || platform.includes('iphone')) return 'ios';
        return 'web';
    }

    generateNodeId() {
        const prefix = 'node';
        const timestamp = Date.now().toString(36);
        const random = Math.random().toString(36).substr(2, 9);
        return `${prefix}_${timestamp}_${random}`;
    }

    getDefaultCapabilities() {
        const base = {
            websocket: true,
            shell: true,
            file: true,
            notification: true
        };

        switch (this.platform) {
            case 'windows':
                return {
                    ...base,
                    powershell: true,
                    cmd: true,
                    registry: false,
                    wmi: true,
                    netsh: true
                };
            case 'linux':
            case 'macos':
                return {
                    ...base,
                    bash: true,
                    ssh: true,
                    docker: true,
                    systemctl: true,
                    nmcli: true
                };
            case 'android':
                return {
                    ...base,
                    wifi: true,
                    intent: true,
                    notification: true,
                    storage: true
                };
            case 'ios':
                return {
                    ...base,
                    wifi: false,
                    notification: true,
                    storage: true
                };
            default:
                return base;
        }
    }

    // §2 Connection Management
    async connect() {
        if (this.connected) {
            console.log('[SlaveNode] Already connected');
            return;
        }

        console.log(`[SlaveNode] Connecting to ${this.masterUrl}...`);

        return new Promise((resolve, reject) => {
            try {
                this.ws = new WebSocket(this.masterUrl);

                this.ws.onopen = () => this.handleOpen(resolve);
                this.ws.onclose = (e) => this.handleClose(e);
                this.ws.onerror = (e) => this.handleError(e, reject);
                this.ws.onmessage = (e) => this.handleMessage(e);

                // Connection timeout
                setTimeout(() => {
                    if (!this.connected) {
                        this.ws.close();
                        reject(new Error('Connection timeout'));
                    }
                }, 10000);
            } catch (error) {
                reject(error);
            }
        });
    }

    handleOpen(resolve) {
        this.connected = true;
        this.reconnectAttempts = 0;
        console.log('[SlaveNode] Connected to master');

        // Send registration
        this.send({
            type: 'node.register',
            payload: {
                nodeId: this.nodeId,
                platform: this.platform,
                capabilities: this.capabilities,
                version: this.version,
                registeredAt: Date.now()
            }
        });

        resolve();
    }

    handleClose(e) {
        this.connected = false;
        console.log(`[SlaveNode] Disconnected (code: ${e.code})`);

        // Attempt reconnection
        this.attemptReconnect();
    }

    handleError(e, reject) {
        console.error('[SlaveNode] WebSocket error:', e);
        this.connected = false;
        reject(e);
    }

    async attemptReconnect() {
        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
            console.log('[SlaveNode] Max reconnection attempts reached');
            return;
        }

        this.reconnectAttempts++;
        const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);

        console.log(`[SlaveNode] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);

        await new Promise(resolve => setTimeout(resolve, delay));

        try {
            await this.connect();
        } catch (e) {
            console.error('[SlaveNode] Reconnection failed:', e.message);
        }
    }

    // §3 Message Handling
    handleMessage(e) {
        let msg;
        try {
            msg = JSON.parse(e.data);
        } catch {
            console.warn('[SlaveNode] Invalid JSON message');
            return;
        }

        console.log(`[SlaveNode] Received: ${msg.type}`);

        switch (msg.type) {
            case 'ping':
                this.send({ type: 'pong', timestamp: Date.now() });
                break;

            case 'node.registered':
                this.handleRegistered(msg.payload);
                break;

            case 'command.invoke':
                this.handleCommand(msg);
                break;

            case 'command.result':
                this.handleCommandResult(msg);
                break;

            case 'broadcast':
                this.handleBroadcast(msg);
                break;

            case 'subscribe':
                this.subscriptions.add(msg.channel);
                this.send({ type: 'subscribed', channel: msg.channel });
                break;

            case 'unsubscribe':
                this.subscriptions.delete(msg.channel);
                this.send({ type: 'unsubscribed', channel: msg.channel });
                break;

            default:
                console.log(`[SlaveNode] Unknown message type: ${msg.type}`);
        }
    }

    handleRegistered(payload) {
        console.log(`[SlaveNode] Registered with master: ${payload.masterId}`);
    }

    // §4 Command Execution
    async handleCommand(msg) {
        const { id, command, params, target } = msg.payload;

        // Verify this command is for us
        if (target && target !== this.nodeId && target !== 'all') {
            console.log(`[SlaveNode] Command not for us (target: ${target})`);
            return;
        }

        console.log(`[SlaveNode] Executing command: ${command}`);

        try {
            const result = await this.executeCommand(command, params);

            this.send({
                type: 'command.result',
                id,
                success: true,
                result,
                nodeId: this.nodeId,
                timestamp: Date.now()
            });

            // Log to history
            this.commandHistory.push({
                id,
                command,
                params,
                result,
                success: true,
                executedAt: Date.now()
            });

        } catch (error) {
            this.send({
                type: 'command.result',
                id,
                success: false,
                error: error.message,
                nodeId: this.nodeId,
                timestamp: Date.now()
            });

            this.commandHistory.push({
                id,
                command,
                params,
                error: error.message,
                success: false,
                executedAt: Date.now()
            });
        }
    }

    async executeCommand(command, params = {}) {
        const [category, action] = command.split('.');

        switch (category) {
            case 'shell':
                return await this.execShell(action, params);
            case 'file':
                return await this.execFile(action, params);
            case 'system':
                return await this.execSystem(action, params);
            case 'network':
                return await this.execNetwork(action, params);
            case 'github':
                return await this.execGitHub(action, params);
            default:
                throw new Error(`Unknown command category: ${category}`);
        }
    }

    // §5 Shell Execution
    async execShell(action, params) {
        switch (action) {
            case 'run':
                return await this.runShellCommand(params.cmd, params.timeout);
            case 'powershell':
                return await this.runPowerShell(params.script, params.timeout);
            case 'bash':
                return await this.runBash(params.script, params.timeout);
            default:
                throw new Error(`Unknown shell action: ${action}`);
        }
    }

    async runShellCommand(cmd, timeout = 30000) {
        // This will be implemented per-platform
        console.log(`[SlaveNode] Running shell: ${cmd}`);

        // For browser/web platform, we can't execute shell commands
        // But this demonstrates the interface
        return {
            executed: true,
            command: cmd,
            output: '[Browser mode - shell execution simulated]',
            exitCode: 0,
            platform: this.platform
        };
    }

    async runPowerShell(script, timeout = 30000) {
        console.log(`[SlaveNode] Running PowerShell: ${script}`);
        return {
            executed: true,
            script,
            output: '[PowerShell execution simulated in browser]',
            exitCode: 0
        };
    }

    async runBash(script, timeout = 30000) {
        console.log(`[SlaveNode] Running bash: ${script}`);
        return {
            executed: true,
            script,
            output: '[Bash execution simulated in browser]',
            exitCode: 0
        };
    }

    // §6 File Operations
    async execFile(action, params) {
        switch (action) {
            case 'read':
                return await this.readFile(params.path);
            case 'write':
                return await this.writeFile(params.path, params.content);
            case 'list':
                return await this.listDirectory(params.path);
            case 'exists':
                return await this.fileExists(params.path);
            case 'delete':
                return await this.deleteFile(params.path);
            default:
                throw new Error(`Unknown file action: ${action}`);
        }
    }

    async readFile(path) {
        // Simulated for browser
        return { path, content: '[File read simulated]', size: 0 };
    }

    async writeFile(path, content) {
        return { path, written: true, size: content?.length || 0 };
    }

    async listDirectory(path) {
        return { path, files: [], directories: [] };
    }

    async fileExists(path) {
        return false;
    }

    async deleteFile(path) {
        return { path, deleted: true };
    }

    // §7 System Operations
    async execSystem(action, params) {
        switch (action) {
            case 'info':
                return this.getSystemInfo();
            case 'processes':
                return await this.listProcesses();
            case 'kill':
                return await this.killProcess(params.pid);
            case 'reboot':
                return this.initiateReboot();
            case 'sleep':
                return this.initiateSleep();
            default:
                throw new Error(`Unknown system action: ${action}`);
        }
    }

    getSystemInfo() {
        return {
            nodeId: this.nodeId,
            platform: this.platform,
            capabilities: this.capabilities,
            userAgent: navigator.userAgent,
            language: navigator.language,
            memory: performance?.memory?.usedJSHeapSize || 0,
            online: navigator.onLine,
            timestamp: Date.now()
        };
    }

    async listProcesses() {
        return { processes: [], count: 0 };
    }

    async killProcess(pid) {
        return { pid, killed: true };
    }

    initiateReboot() {
        return { message: 'Reboot initiated', platform: this.platform };
    }

    initiateSleep() {
        return { message: 'Sleep mode initiated', platform: this.platform };
    }

    // §8 Network Operations
    async execNetwork(action, params) {
        switch (action) {
            case 'wifi.connect':
                return await this.wifiConnect(params.ssid, params.password);
            case 'wifi.disconnect':
                return await this.wifiDisconnect();
            case 'wifi.scan':
                return await this.wifiScan();
            case 'ping':
                return await this.pingHost(params.host, params.count);
            case 'dns':
                return await this.dnsLookup(params.host);
            default:
                throw new Error(`Unknown network action: ${action}`);
        }
    }

    async wifiConnect(ssid, password) {
        if (!this.capabilities.wifi) {
            throw new Error('WiFi control not available on this platform');
        }
        return { ssid, connected: true, message: 'WiFi connection simulated' };
    }

    async wifiDisconnect() {
        return { disconnected: true };
    }

    async wifiScan() {
        return { networks: [], count: 0 };
    }

    async pingHost(host, count = 4) {
        return {
            host,
            count,
            results: Array(count).fill({ time: Math.random() * 100 }),
            packetLoss: '0%'
        };
    }

    async dnsLookup(host) {
        return { host, ip: '127.0.0.1', resolved: true };
    }

    // §9 GitHub Operations
    async execGitHub(action, params) {
        switch (action) {
            case 'repos':
                return await this.githubRepos();
            case 'branches':
                return await this.githubBranches(params.owner, params.repo);
            case 'push':
                return await this.githubPush(params.owner, params.repo, params.branch);
            case 'pull':
                return await this.githubPull(params.owner, params.repo, params.branch);
            case 'pr':
                return await this.githubPR(params.owner, params.repo);
            default:
                throw new Error(`Unknown GitHub action: ${action}`);
        }
    }

    async githubRepos() {
        // This would use OAuth vault to get token
        return { repos: [], message: 'GitHub API requires OAuth token' };
    }

    async githubBranches(owner, repo) {
        return { owner, repo, branches: [] };
    }

    async githubPush(owner, repo, branch) {
        return { owner, repo, branch, pushed: false, message: 'GitHub push requires OAuth' };
    }

    async githubPull(owner, repo, branch) {
        return { owner, repo, branch, pulled: false, message: 'GitHub pull requires OAuth' };
    }

    async githubPR(owner, repo) {
        return { owner, repo, pullRequests: [] };
    }

    // §10 Message Handling Helpers
    handleCommandResult(msg) {
        const pending = this.pendingCommands.get(msg.id);
        if (pending) {
            pending.resolve(msg);
            this.pendingCommands.delete(msg.id);
        }
    }

    handleBroadcast(msg) {
        const channel = msg.channel;
        if (this.subscriptions.has(channel)) {
            this.emit(channel, msg.payload);
        }
    }

    // §11 Event System
    on(event, handler) {
        if (!this.eventHandlers) this.eventHandlers = new Map();
        if (!this.eventHandlers.has(event)) {
            this.eventHandlers.set(event, []);
        }
        this.eventHandlers.get(event).push(handler);
    }

    off(event, handler) {
        if (!this.eventHandlers) return;
        const handlers = this.eventHandlers.get(event);
        if (handlers) {
            const index = handlers.indexOf(handler);
            if (index > -1) handlers.splice(index, 1);
        }
    }

    emit(event, data) {
        if (!this.eventHandlers) return;
        const handlers = this.eventHandlers.get(event);
        if (handlers) {
            handlers.forEach(h => h(data));
        }
    }

    // §12 Utility Methods
    send(data) {
        if (!this.connected || !this.ws) {
            console.warn('[SlaveNode] Cannot send - not connected');
            return false;
        }

        this.ws.send(JSON.stringify(data));
        return true;
    }

    async sendCommand(command, params = {}, timeout = 30000) {
        const id = crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36);

        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this.pendingCommands.delete(id);
                reject(new Error('Command timeout'));
            }, timeout);

            this.pendingCommands.set(id, {
                resolve: (result) => {
                    clearTimeout(timer);
                    resolve(result);
                },
                reject
            });

            this.send({
                type: 'command.invoke',
                id,
                payload: {
                    command,
                    params,
                    target: this.nodeId,
                    timestamp: Date.now()
                }
            });
        });
    }

    disconnect() {
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
        this.connected = false;
    }

    getStatus() {
        return {
            nodeId: this.nodeId,
            platform: this.platform,
            connected: this.connected,
            masterUrl: this.masterUrl,
            reconnectAttempts: this.reconnectAttempts,
            subscriptions: Array.from(this.subscriptions),
            commandHistory: this.commandHistory.length,
            lastCommand: this.commandHistory[this.commandHistory.length - 1]?.command
        };
    }
}

// Node.js desktop listener executable
const DESKTOP_LISTENER_TEMPLATE = `#!/usr/bin/env node
/**
 * AgentOS Desktop Slave Node Listener
 * Run on Windows/Linux/Pi to receive commands from AgentOS master
 * Usage: node slave-listener.js --master ws://your-server:3000/ws --node-id my-pc
 */

const WebSocket = require('ws');
const { spawn, exec } = require('child_process');
const crypto = require('crypto');
const os = require('os');

const config = {
    masterUrl: process.argv.includes('--master')
        ? process.argv[process.argv.indexOf('--master') + 1]
        : 'ws://localhost:3000/ws',
    nodeId: process.argv.includes('--node-id')
        ? process.argv[process.argv.indexOf('--node-id') + 1]
        : \`node_\${os.hostname()}_\${Date.now().toString(36)}\`,
    platform: os.platform().startsWith('win') ? 'windows' : 'linux',
    capabilities: {
        shell: true,
        powershell: os.platform().startsWith('win'),
        bash: !os.platform().startsWith('win'),
        ssh: true,
        file: true,
        system: true,
        network: true,
        docker: false,
        systemctl: !os.platform().startsWith('win')
    }
};

class DesktopSlave {
    constructor(config) {
        this.config = config;
        this.connected = false;
        this.ws = null;
        this.commands = new Map();
    }

    async connect() {
        return new Promise((resolve, reject) => {
            this.ws = new WebSocket(this.config.masterUrl);

            this.ws.on('open', () => {
                this.connected = true;
                console.log('[DesktopSlave] Connected to master');
                this.register();
                resolve();
            });

            this.ws.on('close', () => {
                this.connected = false;
                console.log('[DesktopSlave] Disconnected, reconnecting...');
                setTimeout(() => this.connect(), 5000);
            });

            this.ws.on('error', (e) => {
                console.error('[DesktopSlave] Error:', e.message);
                reject(e);
            });

            this.ws.on('message', (data) => this.handleMessage(data));
        });
    }

    register() {
        this.send({
            type: 'node.register',
            payload: {
                nodeId: this.config.nodeId,
                platform: this.config.platform,
                capabilities: this.config.capabilities,
                hostname: os.hostname(),
                ips: Object.values(os.networkInterfaces())
                    .flat()
                    .filter(i => !i.internal)
                    .map(i => i.address)
            }
        });
    }

    handleMessage(data) {
        const msg = JSON.parse(data);

        if (msg.type === 'command.invoke') {
            this.handleCommand(msg);
        } else if (msg.type === 'ping') {
            this.send({ type: 'pong' });
        }
    }

    async handleCommand(msg) {
        const { id, payload } = msg;
        const { command, params } = payload;

        try {
            let result;

            if (command.startsWith('shell.')) {
                result = await this.execShell(command, params);
            } else if (command.startsWith('file.')) {
                result = await this.execFile(command, params);
            } else if (command.startsWith('system.')) {
                result = await this.execSystem(command, params);
            } else if (command.startsWith('github.')) {
                result = await this.execGitHub(command, params);
            } else {
                throw new Error(\`Unknown command: \${command}\`);
            }

            this.send({ type: 'command.result', id, success: true, result });
        } catch (error) {
            this.send({ type: 'command.result', id, success: false, error: error.message });
        }
    }

    async execShell(command, params) {
        return new Promise((resolve, reject) => {
            const isWindows = this.config.platform === 'windows';
            const shell = isWindows ? 'powershell' : 'bash';
            const args = isWindows ? ['-Command', params.cmd] : ['-c', params.cmd];

            const proc = spawn(shell, args, { timeout: params.timeout || 30000 });

            let stdout = '';
            let stderr = '';

            proc.stdout.on('data', d => stdout += d);
            proc.stderr.on('data', d => stderr += d);

            proc.on('close', code => {
                resolve({ stdout, stderr, exitCode: code });
            });

            proc.on('error', reject);
        });
    }

    async execFile(command, params) {
        const fs = require('fs');

        switch (command) {
            case 'file.read':
                return { content: fs.readFileSync(params.path, 'utf8') };
            case 'file.write':
                fs.writeFileSync(params.path, params.content);
                return { written: true };
            case 'file.exists':
                return { exists: fs.existsSync(params.path) };
            default:
                throw new Error(\`Unknown file command: \${command}\`);
        }
    }

    async execSystem(command, params) {
        return { hostname: os.hostname(), uptime: os.uptime(), platform: os.platform() };
    }

    async execGitHub(command, params) {
        throw new Error('GitHub operations require OAuth configuration');
    }

    send(data) {
        if (this.connected) {
            this.ws.send(JSON.stringify(data));
        }
    }

    start() {
        console.log(\`[DesktopSlave] Starting node: \${this.config.nodeId}\`);
        console.log(\`[DesktopSlave] Master: \${this.config.masterUrl}\`);
        this.connect().catch(console.error);
    }
}

// Start
const slave = new DesktopSlave(config);
slave.start();
`;

// Export for browser
const slaveNode = new SlaveNode();

// Make available globally
if (typeof window !== 'undefined') {
    window.SlaveNode = SlaveNode;
    window.slaveNode = slaveNode;
}

export { SlaveNode, slaveNode, DESKTOP_LISTENER_TEMPLATE };
