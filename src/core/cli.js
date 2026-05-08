'use strict';

const QRCode = require('qrcode');
const crypto = require('crypto');
const pc = require('picocolors');
const clack = require('@clack/prompts');
const { fmtBytes } = require('./utils');

/**
 * AgentOSCLI — Interactive REPL powered by @clack/prompts + picocolors
 */
class AgentOSCLI {
    constructor(deps) {
        this.config = deps.config;
        this.brand = deps.brand;
        this.mikrotik = deps.mikrotik;
        this.database = deps.database;
        this.askEngine = deps.askEngine;
        this._commands = this._buildCommands();
    }

    _buildCommands() {
        const b = (fn) => fn.bind(this);
        return {
            help:       { fn: b(this.cmdHelp),       desc: 'Show available commands' },
            connect:    { fn: b(this.cmdConnect),     desc: 'Connect to router' },
            disconnect: { fn: b(this.cmdDisconnect),  desc: 'Disconnect from router' },
            status:     { fn: b(this.cmdStatus),      desc: 'Router system stats' },
            cli:        { fn: b(this.cmdRawCli),      desc: 'Raw RouterOS CLI command' },
            api:        { fn: b(this.cmdRawApi),      desc: 'Raw RouterOS API call' },
            agent:      { fn: b(this.cmdAgent),       desc: 'Query AI coordinator' },
            nodes:      { fn: b(this.cmdNodes),       desc: 'Show network nodes' },
            users:      { fn: b(this.cmdUsers),       desc: 'All hotspot users' },
            active:     { fn: b(this.cmdActive),      desc: 'Active users' },
            adduser:    { fn: b(this.cmdAddUser),     desc: 'Add hotspot user' },
            deluser:    { fn: b(this.cmdDelUser),     desc: 'Delete hotspot user' },
            kick:       { fn: b(this.cmdKick),        desc: 'Kick active user' },
            voucher:    { fn: b(this.cmdVoucher),     desc: 'Create voucher' },
            vouchers:   { fn: b(this.cmdVouchers),    desc: 'List vouchers' },
            redeem:     { fn: b(this.cmdRedeem),      desc: 'Redeem voucher' },
            revoke:     { fn: b(this.cmdRevoke),      desc: 'Revoke voucher' },
            ping:       { fn: b(this.cmdPing),        desc: 'Ping a host' },
            logs:       { fn: b(this.cmdLogs),        desc: 'Router logs' },
            dhcp:       { fn: b(this.cmdDhcp),        desc: 'DHCP leases' },
            arp:        { fn: b(this.cmdArp),         desc: 'ARP table' },
            firewall:   { fn: b(this.cmdFirewall),    desc: 'Firewall rules' },
            block:      { fn: b(this.cmdBlock),       desc: 'Block IP/MAC' },
            unblock:    { fn: b(this.cmdUnblock),     desc: 'Unblock IP/MAC' },
            reboot:     { fn: b(this.cmdReboot),      desc: 'Reboot router' },
            qr:         { fn: b(this.cmdQR),          desc: 'Print voucher QR code' },
            stats:      { fn: b(this.cmdStats),       desc: 'Voucher statistics' },
        };
    }

    // ── Banner helpers ──────────────────────────────────────────────────────────

    _printBanner() {
        const v = this.brand?.version || '2026';
        console.log('');
        console.log(pc.cyan('  ╔══════════════════════════════════════════════════════════╗'));
        console.log(pc.cyan('  ║') + pc.bold(pc.white(`        AgentOS Platform  ${pc.yellow('v' + v)}`.padEnd(56))) + pc.cyan('║'));
        console.log(pc.cyan('  ║') + pc.dim('        Modular AI Agent OS · MikroTik Intelligence'.padEnd(58)) + pc.cyan('║'));
        console.log(pc.cyan('  ╚══════════════════════════════════════════════════════════╝'));
        console.log('');
    }

    _ok(msg)   { clack.log.success(msg); }
    _err(msg)  { clack.log.error(msg); }
    _warn(msg) { clack.log.warn(msg); }
    _info(msg) { clack.log.info(msg); }

    /**
     * _nav() — shared guard matching the onboard.js step-loop pattern.
     * Shows a select with Proceed / Cancel (optionally ← Back).
     * Returns true to continue, false to abort.
     */
    async _nav(message, { back = false } = {}) {
        const options = [
            { value: 'yes',    label: pc.green('▶  Proceed') },
            ...(back ? [{ value: 'back', label: pc.yellow('←  Back') }] : []),
            { value: 'no',     label: pc.red('✗  Cancel')  },
        ];
        const r = await clack.select({ message: pc.dim(message), options });
        if (clack.isCancel(r) || r === 'no') return false;
        if (r === 'back') return 'back';
        return true;
    }

    // ── Main REPL ───────────────────────────────────────────────────────────────

    async start() {
        console.clear();
        this._printBanner();
        clack.intro(pc.bgCyan(pc.black(' AgentOS REPL ')) + '  ' + pc.dim("Type 'help' or 'exit'"));

        await this.cmdConnect();

        // Main input loop
        while (true) {
            const input = await clack.text({
                message: pc.cyan('❯'),
                placeholder: pc.dim('command or natural language query…'),
                validate: () => undefined,
            });

            if (clack.isCancel(input)) {
                clack.outro(pc.yellow('Disconnecting…'));
                this.mikrotik?.disconnect();
                process.exit(0);
            }

            const text = String(input).trim();
            if (!text) continue;
            if (text === 'clear') { console.clear(); this._printBanner(); continue; }
            if (text === 'exit' || text === 'quit') {
                clack.outro(pc.yellow('Goodbye 👋'));
                this.mikrotik?.disconnect();
                process.exit(0);
            }

            const [cmd, ...args] = text.split(/\s+/);
            const key = cmd.toLowerCase();

            if (this._commands[key]) {
                try { await this._commands[key].fn(args); }
                catch (err) { this._err(pc.red(err.message)); }
            } else {
                // Natural language → AskEngine
                const s = clack.spinner();
                s.start(pc.cyan('Consulting AgentOS…'));
                try {
                    const resp = await this.askEngine.run(text);
                    s.stop(pc.green(`✔ Tier ${resp.tier} · ${pc.dim(resp.type)}`));
                    const formatted = this.askEngine.formatResponse(resp.result);
                    console.log('');
                    console.log(pc.bold(pc.cyan('  ◆ AgentOS Response')));
                    console.log(pc.dim('  ' + '─'.repeat(48)));
                    formatted.split('\n').forEach(l => console.log('  ' + pc.white(l)));
                    console.log('');
                } catch (e) {
                    s.stop(pc.red('✘ Error'));
                    this._err(e.message);
                }
            }
        }
    }

    // ── Commands ────────────────────────────────────────────────────────────────

    async cmdHelp() {
        console.log('');
        console.log(pc.bold(pc.cyan('  Available Commands')));
        console.log(pc.dim('  ' + '─'.repeat(48)));
        const entries = Object.entries(this._commands).sort(([a], [b]) => a.localeCompare(b));
        const half = Math.ceil(entries.length / 2);
        for (let i = 0; i < half; i++) {
            const [n1, c1] = entries[i];
            const [n2, c2] = entries[i + half] || ['', { desc: '' }];
            const left  = pc.cyan(n1.padEnd(12)) + pc.dim(c1.desc.padEnd(28));
            const right = n2 ? pc.cyan(n2.padEnd(12)) + pc.dim(c2.desc) : '';
            console.log('  ' + left + '  ' + right);
        }
        console.log('');
    }

    async cmdConnect() {
        const s = clack.spinner();
        s.start(pc.cyan(`Connecting to ${this.config?.MIKROTIK?.IP || 'router'}…`));
        try {
            await this.mikrotik.connect();
            s.stop(pc.green(`✔ Connected to ${pc.bold(this.config?.MIKROTIK?.IP)}`));
            return true;
        } catch {
            s.stop(pc.red('✘ Connection failed — check .env credentials'));
            return false;
        }
    }

    async cmdDisconnect() {
        this.mikrotik.disconnect();
        this._info(pc.yellow('🔌 Disconnected'));
    }

    async cmdStatus() {
        const s = clack.spinner();
        s.start('Fetching router stats…');
        try {
            const st = await this.mikrotik.getSystemStats();
            s.stop(pc.green('✔ Stats loaded'));
            console.log('');
            console.log(pc.bold(pc.cyan(`  Router: ${this.config?.MIKROTIK?.IP}`)));
            console.log(pc.dim('  ' + '─'.repeat(32)));
            console.log(`  ${pc.dim('CPU Load:')}  ${pc.yellow(st['cpu-load'] + '%')}`);
            console.log(`  ${pc.dim('Free RAM:')}  ${pc.green(fmtBytes(parseInt(st['free-memory']) || 0))}`);
            console.log(`  ${pc.dim('Uptime:  ')}  ${pc.white(st.uptime)}`);
            console.log(`  ${pc.dim('Version: ')}  ${pc.white(st.version)}`);
            console.log('');
        } catch (e) {
            s.stop(pc.red('✘ Failed'));
            this._err(e.message);
        }
    }

    async cmdRawCli(args) {
        const cmd = args.join(' ');
        if (!cmd) { this._warn('Usage: cli <command>'); return; }
        const ok = await this._nav(`Execute raw CLI command: ${pc.yellow(cmd)}?`);
        if (!ok) { this._info('Cancelled.'); return; }
        const s = clack.spinner();
        s.start('Executing CLI command…');
        const res = await this.mikrotik.executeCLI(cmd);
        s.stop(pc.green('✔ Done'));
        console.log('\n' + pc.dim('  Output:'));
        console.log(pc.white('  ' + String(res).split('\n').join('\n  ')));
        console.log('');
    }

    async cmdRawApi(args) {
        const cmd = args.join(' ');
        if (!cmd) { this._warn('Usage: api </path/command>'); return; }
        const ok = await this._nav(`Execute raw API call: ${pc.yellow(cmd)}?`);
        if (!ok) { this._info('Cancelled.'); return; }
        const s = clack.spinner();
        s.start('Executing API call…');
        const res = await this.mikrotik.executeRawAPI(cmd);
        s.stop(pc.green('✔ Done'));
        console.log('\n' + pc.dim('  Result:'));
        console.log(pc.cyan('  ' + JSON.stringify(res, null, 2).split('\n').join('\n  ')));
        console.log('');
    }

    async cmdAgent(args) {
        const query = args.join(' ');
        if (!query) { this._warn('Usage: agent <query>'); return; }
        const s = clack.spinner();
        s.start(pc.cyan('AI is thinking…'));
        try {
            const resp = await this.askEngine.run(query);
            s.stop(pc.green(`✔ AI Response [${pc.bold(resp.type)}]`));
            console.log('');
            resp.result.split('\n').forEach(l => console.log('  ' + pc.white(l)));
            if (resp.type === 'ai_act' && resp.data) {
                console.log('');
                console.log(pc.dim('  Tool trace: ' + JSON.stringify(resp.data, null, 2)));
            }
            console.log('');
        } catch (e) {
            s.stop(pc.red('✘ Error'));
            this._err(e.message);
        }
    }

    async cmdNodes() {
        console.log('');
        console.log(pc.bold(pc.cyan('  Network Nodes')));
        console.log(pc.dim('  ' + '─'.repeat(32)));
        const online = this.mikrotik?.isConnected;
        console.log(`  ${pc.cyan('◆')} ${pc.bold('AgentOS-Main-Gateway')}`);
        console.log(`    Status:   ${online ? pc.green('ONLINE') : pc.red('OFFLINE')}`);
        console.log(`    Endpoint: ${pc.white(this.config?.MIKROTIK?.IP || 'N/A')}`);
        console.log('');
    }

    async cmdUsers() {
        const s = clack.spinner();
        s.start('Loading hotspot users…');
        const users = await this.mikrotik.getAllHotspotUsers();
        s.stop(pc.green(`✔ ${users.length} users`));
        console.log('');
        users.slice(0, 20).forEach(u => {
            const dot = u.disabled === 'yes' ? pc.red('●') : pc.green('●');
            console.log(`  ${dot}  ${pc.bold(u.name.padEnd(16))} ${pc.dim(u.profile || 'default')}`);
        });
        console.log('');
    }

    async cmdActive() {
        const s = clack.spinner();
        s.start('Loading active sessions…');
        const users = await this.mikrotik.getActiveUsers();
        s.stop(pc.green(`✔ ${users.length} active`));
        console.log('');
        users.forEach(u =>
            console.log(`  ${pc.green('●')}  ${pc.bold(u.user.padEnd(16))} ${pc.dim(u.address.padEnd(16))} ${pc.yellow(u.uptime)}`));
        console.log('');
    }

    async cmdAddUser([username, password, profile = 'default']) {
        if (!username || !password) { this._warn('Usage: adduser <name> <pass> [profile]'); return; }
        const ok = await this._nav(`Add user ${pc.bold(username)} with profile ${pc.cyan(profile)}?`);
        if (!ok) { this._info('Cancelled.'); return; }
        const s = clack.spinner();
        s.start('Adding user…');
        const res = await this.mikrotik.addHotspotUser(username, password, profile);
        s.stop(pc.green(`✔ User ${pc.bold(res.username)} ${res.action}`));
    }

    async cmdDelUser([username]) {
        if (!username) { this._warn('Usage: deluser <name>'); return; }
        const ok = await this._nav(`Delete hotspot user  ${pc.bold(username)}?`);
        if (!ok) { this._info('Cancelled.'); return; }
        const s = clack.spinner();
        s.start(`Deleting ${pc.bold(username)}…`);
        await this.mikrotik.removeHotspotUser(username);
        s.stop(pc.green(`✔ User ${pc.bold(username)} deleted`));
    }

    async cmdKick([username]) {
        if (!username) { this._warn('Usage: kick <name>'); return; }
        const ok = await this._nav(`Kick active session for  ${pc.bold(username)}?`);
        if (!ok) { this._info('Cancelled.'); return; }
        const s = clack.spinner();
        s.start(`Kicking ${pc.bold(username)}…`);
        const res = await this.mikrotik.kickUser(username);
        s.stop(res.kicked
            ? pc.green(`✔ ${pc.bold(username)} kicked`)
            : pc.yellow(`⚠ ${username} not active`));
    }

    async cmdVoucher([plan]) {
        if (!plan) { this._warn('Usage: voucher <plan>'); return; }
        const { DEFAULT_PLANS } = require('./database');
        const dateUtils = require('../utils/date');

        const code = (this.config?.VOUCHER_PREFIX || 'STAR-') + crypto.randomBytes(3).toString('hex').toUpperCase();
        const planObj = DEFAULT_PLANS[plan] || { name: 'Custom', deviceLimit: 1 };
        
        const ok = await this._nav(`Generate voucher for plan: ${pc.cyan(planObj.name || plan)}?`);
        if (!ok) { this._info('Cancelled.'); return; }

        const expiresAt = planObj.durationValue && planObj.durationUnit
            ? dateUtils.add(new Date(), planObj.durationValue, planObj.durationUnit).toISOString() : null;
        const loginUrl = `http://${this.mikrotik?.state?.host || 'hotspot.local'}/login?username=${code}&password=${code}`;

        const vData = { plan, planName: planObj.name || plan, durationUnit: planObj.durationUnit || null,
            durationValue: planObj.durationValue || null, deviceLimit: planObj.deviceLimit || 1,
            expiresAt, loginUrl, createdBy: 'cli' };

        const s = clack.spinner();
        s.start(pc.cyan('Generating secure voucher…'));
        await this.database.createVoucher(code, vData);

        if (this.mikrotik?.isConnected) {
            await this.mikrotik.addHotspotUser({
                username: code, password: code, profile: plan,
                sharedUsers: vData.deviceLimit,
            }).catch(() => {});
        }
        s.stop(pc.green('✔ Voucher created'));

        // ── Print receipt ─────────────────────────────────────────────────────
        const { printVoucher } = require('./printer');
        await printVoucher({ username: code, password: code, profile: plan, loginUrl })
            .then(r => {
                if (r.success) console.log(pc.dim(`  🖨  Printed via ${r.interface}`));
                else console.log(pc.yellow(`  ⚠  Print skipped: ${r.error}`));
            })
            .catch(e => console.log(pc.yellow(`  ⚠  Print error: ${e.message}`)));

        console.log('');
        console.log(pc.cyan('  ┌─────────────────────────────────────┐'));
        console.log(pc.cyan('  │') + pc.bold(pc.white(`  ${code.padEnd(35)}`)) + pc.cyan('│'));
        console.log(pc.cyan('  │') + pc.dim(`  Plan: ${plan.padEnd(31)  }`) + pc.cyan('│'));
        if (expiresAt) console.log(pc.cyan('  │') + pc.dim(`  Expires: ${new Date(expiresAt).toLocaleDateString().padEnd(28)}`) + pc.cyan('│'));
        console.log(pc.cyan('  └─────────────────────────────────────┘'));
        console.log('');
    }

    async cmdVouchers([limit = '20']) {
        const s = clack.spinner();
        s.start('Loading vouchers…');
        const list = await this.database.listVouchers({ limit: parseInt(limit) });
        s.stop(pc.green(`✔ ${list.length} vouchers`));
        console.log('');
        list.forEach(v => {
            const now = new Date();
            const expired = v.expiresAt && new Date(v.expiresAt) < now;
            const tag = v.used ? pc.green('USED') : expired ? pc.dim('EXPIRED') : pc.yellow('ACTIVE');
            console.log(`  ${tag.padEnd(14)}  ${pc.bold(v.id.padEnd(18))}  ${pc.dim(v.plan)}`);
        });
        console.log('');
    }

    async cmdRedeem([code, username]) {
        if (!code || !username) { this._warn('Usage: redeem <code> <username>'); return; }
        const v = await this.database.getVoucher(code);
        if (!v) { this._err('Voucher not found'); return; }
        if (v.used) { this._warn('Voucher already used'); return; }
        const ok = await this._nav(`Redeem ${pc.bold(code)} for user ${pc.bold(username)}  (plan: ${pc.cyan(v.plan)})?`);
        if (!ok) { this._info('Cancelled.'); return; }
        const s = clack.spinner();
        s.start('Redeeming…');
        await this.mikrotik.addHotspotUser(username, username, v.plan);
        await this.database.redeemVoucher(code, { username });
        s.stop(pc.green(`✔ ${code} redeemed for ${pc.bold(username)}`));
    }

    async cmdRevoke([code]) {
        if (!code) { this._warn('Usage: revoke <code>'); return; }
        const ok = await this._nav(`Permanently revoke voucher  ${pc.bold(code)}?`);
        if (!ok) { this._info('Cancelled.'); return; }
        const s = clack.spinner();
        s.start('Revoking…');
        await this.database.deleteVoucher(code);
        s.stop(pc.green(`✔ Voucher ${pc.bold(code)} revoked`));
    }

    async cmdPing([host, count = '4']) {
        if (!host) { this._warn('Usage: ping <host> [count]'); return; }
        const s = clack.spinner();
        s.start(`Pinging ${pc.bold(host)}…`);
        const n = parseInt(count) || 4;
        const results = await this.mikrotik.ping(host, n);
        const recv = results.filter(r => parseInt(r.received) > 0).length;
        s.stop(pc.green(`✔ Sent: ${n}  Received: ${pc.bold(recv)}  Lost: ${pc.yellow(n - recv)}`));
    }

    async cmdLogs([lines = '20']) {
        const s = clack.spinner();
        s.start('Fetching router logs…');
        const logs = await this.mikrotik.getLogs(parseInt(lines));
        s.stop(pc.green(`✔ ${logs.length} entries`));
        console.log('');
        logs.forEach(l =>
            console.log(`  ${pc.dim(l.time || '')}  ${pc.cyan((l.topics || '').padEnd(16))}  ${pc.white(l.message || '')}`));
        console.log('');
    }

    async cmdDhcp() {
        const s = clack.spinner();
        s.start('Loading DHCP leases…');
        const leases = await this.mikrotik.getDhcpLeases();
        s.stop(pc.green(`✔ ${leases.length} leases`));
        console.log('');
        leases.slice(0, 20).forEach(l =>
            console.log(`  ${pc.cyan(l.address.padEnd(16))}  ${pc.white((l.hostname || '').padEnd(20))}  ${pc.dim(l.status || 'bound')}`));
        console.log('');
    }

    async cmdArp() {
        const s = clack.spinner();
        s.start('Scanning ARP table…');
        const arp = await this.mikrotik.getArpTable();
        s.stop(pc.green(`✔ ${arp.length} entries`));
        console.log('');
        arp.filter(e => e.address).slice(0, 20).forEach(e =>
            console.log(`  ${pc.cyan('◆')}  ${pc.white(e.address.padEnd(16))}  ${pc.dim(e['mac-address'] || 'N/A')}`));
        console.log('');
    }

    async cmdFirewall() {
        const s = clack.spinner();
        s.start('Loading firewall rules…');
        const rules = await this.mikrotik.getFirewallRules('filter');
        s.stop(pc.green(`✔ ${rules.length} rules`));
        console.log('');
        rules.slice(0, 10).forEach(r =>
            console.log(`  ${pc.yellow(r.chain.padEnd(10))}  ${pc.cyan(r.action.padEnd(10))}  ${pc.dim(r.comment || '')}`));
        console.log('');
    }

    async cmdBlock([target]) {
        if (!target) { this._warn('Usage: block <ip-or-mac>'); return; }
        const ok = await this._nav(`Add ${pc.bold(target)} to firewall block list?`);
        if (!ok) { this._info('Cancelled.'); return; }
        const s = clack.spinner();
        s.start(`Blocking ${pc.bold(target)}…`);
        await this.mikrotik.addToBlockList(target);
        s.stop(pc.red(`✘ Blocked: ${pc.bold(target)}`));
    }

    async cmdUnblock([target]) {
        if (!target) { this._warn('Usage: unblock <ip-or-mac>'); return; }
        const ok = await this._nav(`Remove ${pc.bold(target)} from firewall block list?`);
        if (!ok) { this._info('Cancelled.'); return; }
        const s = clack.spinner();
        s.start(`Unblocking ${target}…`);
        const res = await this.mikrotik.unblockAddress(target);
        s.stop(pc.green(`✔ Unblocked: ${pc.bold(target)} (${res.count} entries removed)`));
    }

    async cmdReboot() {
        const ok = await this._nav(pc.yellow('⚠  Reboot the router? This will drop all connections.'));
        if (!ok) { this._info('Cancelled.'); return; }
        const s = clack.spinner();
        s.start('Sending reboot command…');
        await this.mikrotik.reboot();
        s.stop(pc.yellow('🔄 Rebooting…'));
        this.mikrotik.disconnect();
    }

    async cmdQR([code]) {
        if (!code) { this._warn('Usage: qr <code>'); return; }
        const v = await this.database.getVoucher(code);
        if (!v) { this._err('Voucher not found'); return; }
        const url = `http://${this.config?.MIKROTIK?.IP || 'hotspot.local'}/login.html?code=${code}`;
        try {
            const qr = await QRCode.toString(JSON.stringify({ code, plan: v.plan, url }), { type: 'terminal', small: true });
            console.log(pc.cyan(qr));
        } catch (e) {
            this._err(`QR generation failed: ${e.message}`);
        }
    }

    async cmdStats() {
        const s = clack.spinner();
        s.start('Loading stats…');
        const st = await this.database.getStats();
        s.stop(pc.green('✔ Stats loaded'));
        console.log('');
        console.log(pc.bold(pc.cyan('  Voucher Statistics')));
        console.log(pc.dim('  ' + '─'.repeat(32)));
        console.log(`  ${pc.dim('Total:  ')}  ${pc.white(st.total)}`);
        console.log(`  ${pc.dim('Active: ')}  ${pc.green(st.active)}`);
        console.log(`  ${pc.dim('Used:   ')}  ${pc.yellow(st.used)}`);
        console.log(`  ${pc.dim('Expired:')}  ${pc.red(st.expired)}`);
        console.log('');
    }
}

/**
 * One-off execution helper
 */
async function runOneOff(params, deps) {
    const [cmd, ...args] = params;
    const cli = new AgentOSCLI(deps);
    const commands = {
        'voucher': () => cli.cmdVoucher(args),
        'redeem':  () => cli.cmdRedeem(args),
        'status':  () => cli.cmdStatus(),
    };
    if (commands[cmd]) {
        try { await commands[cmd](); }
        catch (err) { console.error(pc.red('Error: ' + err.message)); }
    } else {
        const s = clack.spinner();
        s.start(pc.cyan('Querying AgentOS…'));
        try {
            const resp = await deps.askEngine.run(params.join(' '));
            s.stop(pc.green(`✔ Tier ${resp.tier} · ${resp.type}`));
            console.log('\n' + deps.askEngine.formatResponse(resp.result));
        } catch (err) {
            s.stop(pc.red('✘ Error'));
            console.log(pc.red(`Unknown command: ${cmd}`));
        }
    }
    deps.mikrotik?.disconnect();
    setTimeout(() => process.exit(0), 100);
}

module.exports = { AgentOSCLI, runOneOff };
