'use strict';

const WebSocket = require('ws');
const QRCode = require('qrcode');
const { logger } = require('../logger');
const { getConfig } = require('../config');
const { getMikroTikClient } = require('../mikrotik');
const { getDatabase } = require('../database');
const { generate: voucherCode } = require('../voucher');

/**
 * WebSocketCLI — Interactive terminal emulator over WebSocket
 * Migrated from legacy monolith ss35b.js
 */
class WebSocketCLI {
    constructor(clientId, ws, channel) {
        this.clientId = clientId;
        this.ws = ws;
        this.channel = channel; // The WebSocketChannel instance
        this.config = getConfig();
        this.buffer = '';
        this.cursorPos = 0;
        this.history = [];
        this.historyIndex = -1;
        this.cols = 80;
        this.rows = 24;
        this.isProcessing = false;
        this.pendingConfirm = null;

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
            qr: { fn: b(this.cmdQR), desc: 'Print voucher QR code' },
            clear: { fn: b(this.cmdClear), desc: 'Clear screen' },
        };
    }

    sendPrompt() {
        this._out({ type: 'prompt', prompt: 'AgentOS> ', buffer: this.buffer, cursorPos: this.cursorPos });
    }

    handleInput(input) {
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
        } else if (input === '\u001b[A') {          // Arrow up
            if (this.historyIndex < this.history.length - 1) {
                this.historyIndex++;
                this.buffer = this.history[this.history.length - 1 - this.historyIndex] || '';
                this.cursorPos = this.buffer.length;
                this._updateLine();
            }
        } else if (input === '\u001b[B') {          // Arrow down
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
            this.channel.closeCliSession(this.clientId);
            return;
        }

        this.isProcessing = true;
        try {
            if (this._commands[key]) {
                await this._commands[key].fn(args);
            } else {
                this._out({ type: 'thinking', message: 'AgentOS: Consulting AI…' });
                const aiResult = await this.channel.agent.processInteraction(text, {
                    channel: 'websocket',
                    userId: this.clientId,
                    isCli: true
                });
                this._out({
                    type: 'ai_response',
                    result: aiResult.result?.text || JSON.stringify(aiResult),
                    data: aiResult.result?.data
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
            const mikrotik = getMikroTikClient();
            await mikrotik.connect();
            this._out({ type: 'success', message: `Connected to router` });
        } catch (err) {
            this._out({ type: 'error', message: `Connection failed: ${err.message}` });
        }
    }

    async cmdDisconnect() {
        const mikrotik = getMikroTikClient();
        mikrotik.disconnect();
        this._out({ type: 'success', message: 'Disconnected' });
    }

    async cmdStatus() {
        try {
            const mikrotik = getMikroTikClient();
            const s = await mikrotik.executeTool('system.stats');
            this._out({
                type: 'table', title: `Router Status`, data: {
                    'CPU Load': `${s['cpu-load']}%`,
                    'Free Memory': this.formatBytes(parseInt(s['free-memory']) || 0),
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
            const mikrotik = getMikroTikClient();
            const res = await mikrotik.executeCLI(cmd);
            this._out({ type: 'code', language: 'text', content: res });
        } catch (err) { this._out({ type: 'error', message: err.message }); }
    }

    async cmdRawApi(args) {
        const cmd = args.join(' ');
        if (!cmd) { this._out({ type: 'error', message: 'Usage: api </path/command>' }); return; }
        try {
            const mikrotik = getMikroTikClient();
            const res = await mikrotik.executeRawAPI(cmd);
            this._out({ type: 'code', language: 'json', content: JSON.stringify(res, null, 2) });
        } catch (err) { this._out({ type: 'error', message: err.message }); }
    }

    async cmdVoucher([plan, duration]) {
        if (!plan) { this._out({ type: 'error', message: 'Usage: voucher <plan> [duration]' }); return; }
        try {
            const code = voucherCode();
            const db = await getDatabase();
            const mikrotik = getMikroTikClient();
            const { DEFAULT_PLANS } = require('../database');
            const dateUtils = require('../../utils/date');
            
            const planObj = DEFAULT_PLANS[plan] || { name: 'Custom', deviceLimit: 1 };
            const expiresAt = planObj.durationValue && planObj.durationUnit ?
                dateUtils.add(new Date(), planObj.durationValue, planObj.durationUnit).toISOString() : null;
            const loginUrl = `http://${mikrotik?.state?.host || 'hotspot.local'}/login?username=${code}&password=${code}`;
            
            const vData = { 
                plan,
                planName: planObj.name || plan,
                durationUnit: planObj.durationUnit || null,
                durationValue: planObj.durationValue || null,
                deviceLimit: planObj.deviceLimit || 1,
                expiresAt,
                loginUrl,
                createdBy: 'ws-cli' 
            };

            await db.createVoucher(code, vData);
            
            if (mikrotik.state.isConnected) {
                const _durationToMikrotik = (p) => {
                    if (!p || !p.durationValue || !p.durationUnit) return null;
                    const v = p.durationValue;
                    switch (p.durationUnit) {
                        case 'weeks': return `${v}w`;
                        case 'days': return `${v}d`;
                        case 'hours': return `${String(v).padStart(2, '0')}:00:00`;
                        case 'minutes': return `${String(Math.floor(v / 60)).padStart(2, '0')}:${String(v % 60).padStart(2, '0')}:00`;
                        default: return null;
                    }
                };
                await mikrotik.addHotspotUser({
                    username: code, password: code, profile: plan,
                    sharedUsers: vData.deviceLimit,
                    ...(vData.expiresAt && { limitUptime: _durationToMikrotik(vData) })
                }).catch(() => { });
            }
            this._out({ type: 'success', message: `🎫 Code: ${code}  Plan: ${plan}${mikrotik.state.isConnected ? '\n✅ Auto-provisioned' : ''}` });
        } catch (err) { this._out({ type: 'error', message: err.message }); }
    }

    async cmdVouchers([limit = '20']) {
        try {
            const db = await getDatabase();
            const list = await db.listVouchers({ limit: parseInt(limit) });
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
            const db = await getDatabase();
            const mikrotik = getMikroTikClient();
            const v = await db.getVoucher(code);
            if (!v) return this._out({ type: 'error', message: 'Voucher not found' });
            if (v.used) return this._out({ type: 'error', message: 'Voucher already used' });
            await mikrotik.addHotspotUser(username, username, v.plan);
            await db.redeemVoucher(code, { username });
            this._out({ type: 'success', message: `Voucher ${code} redeemed for ${username}` });
        } catch (err) { this._out({ type: 'error', message: err.message }); }
    }

    async cmdRevoke([code]) {
        if (!code) { this._out({ type: 'error', message: 'Usage: revoke <code>' }); return; }
        try {
            const db = await getDatabase();
            await db.deleteVoucher(code);
            this._out({ type: 'success', message: `Voucher ${code} revoked` });
        } catch (err) { this._out({ type: 'error', message: err.message }); }
    }

    async cmdPing([host, count = '4']) {
        if (!host) { this._out({ type: 'error', message: 'Usage: ping <host> [count]' }); return; }
        try {
            const mikrotik = getMikroTikClient();
            this._out({ type: 'info', message: `Pinging ${host}…` });
            const res = await mikrotik.ping(host, parseInt(count));
            const arr = Array.isArray(res) ? res : (res ? [res] : []);
            const recv = arr.filter(r => parseInt(r.received) > 0).length;
            this._out({ type: 'result', text: `Sent: ${count}  Received: ${recv}  Lost: ${count - recv}` });
        } catch (err) { this._out({ type: 'error', message: err.message }); }
    }

    async cmdLogs([lines = '20']) {
        try {
            const mikrotik = getMikroTikClient();
            const logs = await mikrotik.getLogs(parseInt(lines));
            this._out({
                type: 'list', title: `Router Logs (${logs.length})`,
                items: logs.map(l => `${l.time || ''} [${(l.topics || '').padEnd(15)}] ${l.message || ''}`)
            });
        } catch (err) { this._out({ type: 'error', message: err.message }); }
    }

    async cmdDhcp() {
        try {
            const mikrotik = getMikroTikClient();
            const leases = await mikrotik.getDhcpLeases();
            this._out({
                type: 'table', title: `DHCP Leases (${leases.length})`,
                data: leases.slice(0, 20).reduce((acc, l) => { acc[l.address] = `${l.hostname || 'N/A'} (${l.status || 'bound'})`; return acc; }, {})
            });
        } catch (err) { this._out({ type: 'error', message: err.message }); }
    }

    async cmdArp() {
        try {
            const mikrotik = getMikroTikClient();
            const arp = await mikrotik.getArpTable();
            this._out({
                type: 'table', title: `ARP Table (${arp.length})`,
                data: arp.filter(e => e.address).slice(0, 20).reduce((acc, e) => { acc[e.address] = e['mac-address'] || 'N/A'; return acc; }, {})
            });
        } catch (err) { this._out({ type: 'error', message: err.message }); }
    }

    async cmdFirewall() {
        try {
            const mikrotik = getMikroTikClient();
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
            const mikrotik = getMikroTikClient();
            await mikrotik.addToBlockList(target);
            this._out({ type: 'success', message: `Blocked: ${target}` });
        } catch (err) { this._out({ type: 'error', message: err.message }); }
    }

    async cmdUnblock([target]) {
        if (!target) { this._out({ type: 'error', message: 'Usage: unblock <ip-or-mac>' }); return; }
        try {
            const mikrotik = getMikroTikClient();
            const res = await mikrotik.unblockAddress(target);
            this._out({ type: 'success', message: `Unblocked: ${target} (${res.count} entries removed)` });
        } catch (err) { this._out({ type: 'error', message: err.message }); }
    }

    async cmdReboot() {
        this._out({ type: 'confirm', id: 'reboot', message: 'Type yes to confirm router reboot.' });
        this.pendingConfirm = async () => {
            try {
                const mikrotik = getMikroTikClient();
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
            const aiResult = await this.channel.agent.processInteraction(query, {
                channel: 'websocket',
                userId: this.clientId,
                isCli: true
            });
            this._out({
                type: 'ai_response',
                result: aiResult.result?.text || JSON.stringify(aiResult),
                data: aiResult.result?.data
            });
        } catch (err) { this._out({ type: 'error', message: err.message }); }
    }

    async cmdUsers() {
        try {
            const mikrotik = getMikroTikClient();
            const list = await mikrotik.getAllHotspotUsers();
            this._out({
                type: 'table', title: `Hotspot Users (${list.length})`,
                data: list.slice(0, 50).reduce((acc, u) => { acc[u.name] = u.profile; return acc; }, {})
            });
        } catch (err) { this._out({ type: 'error', message: err.message }); }
    }

    async cmdActive() {
        try {
            const mikrotik = getMikroTikClient();
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
            const mikrotik = getMikroTikClient();
            const db = await getDatabase();
            const res = await mikrotik.kickUser(user);
            await db.logAuditTrail('ws-cli', 'user.kick', { user });
            this._out({ type: 'success', message: res.kicked ? `🚫 Kick successful: ${user}` : `⚠️ ${user} not active.` });
        } catch (err) { this._out({ type: 'error', message: err.message }); }
    }

    async cmdAddUser([user, pass, profile = 'default']) {
        if (!user || !pass) { this._out({ type: 'error', message: 'Usage: adduser <user> <pass> [profile]' }); return; }
        try {
            const mikrotik = getMikroTikClient();
            const db = await getDatabase();
            await mikrotik.addHotspotUser(user, pass, profile);
            await db.logAuditTrail('ws-cli', 'user.add', { user, profile });
            this._out({ type: 'success', message: `✅ User added: ${user} (profile: ${profile})` });
        } catch (err) { this._out({ type: 'error', message: err.message }); }
    }

    async cmdDelUser([user]) {
        if (!user) { this._out({ type: 'error', message: 'Usage: deluser <user>' }); return; }
        try {
            const mikrotik = getMikroTikClient();
            const db = await getDatabase();
            await mikrotik.removeHotspotUser(user);
            await db.logAuditTrail('ws-cli', 'user.remove', { user });
            this._out({ type: 'success', message: `🗑️ User deleted: ${user}` });
        } catch (err) { this._out({ type: 'error', message: err.message }); }
    }

    async cmdNodes() {
        const mikrotik = getMikroTikClient();
        this._out({
            type: 'text', text:
                `\n📡 Network Nodes\n${'━'.repeat(34)}\n` +
                `◆ Main-Router\n` +
                `  Status: ${mikrotik.state.isConnected ? '🟢 CONNECTED' : '🔴 OFFLINE'}\n` +
                `  Target: ${this.config.mikrotik?.host || 'default'}\n`
        });
    }

    async cmdQR([code]) {
        if (!code) { this._out({ type: 'error', message: 'Usage: qr <code>' }); return; }
        try {
            const db = await getDatabase();
            const v = await db.getVoucher(code);
            if (!v) return this._out({ type: 'error', message: 'Voucher not found' });
            const url = `http://${this.config.mikrotik?.host}/login.html?code=${code}`;
            const qrText = await QRCode.toString(
                JSON.stringify({ code, plan: v.plan, url }),
                { type: 'terminal', small: true }
            );
            this._out({ type: 'code', language: 'text', content: qrText });
        } catch (err) { this._out({ type: 'error', message: `QR generation failed: ${err.message}` }); }
    }

    async cmdClear() { this._out({ type: 'clear' }); }

    formatBytes(bytes) {
        if (!bytes || bytes === 0) return '0 B';
        const k = 1024, sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
    }

    resize(cols, rows) { this.cols = cols; this.rows = rows; }
    destroy() { this.buffer = ''; this.isProcessing = false; this.pendingConfirm = null; }
}

module.exports = WebSocketCLI;
