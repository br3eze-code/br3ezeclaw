'use strict';
/**
 * AgentOSOrchestrator — migrated from ss35.js §15
 * Manages provisioning, system monitoring, device detection, and CRON tasks.
 */
const { logger } = require('./logger');

class AgentOSOrchestrator {
    constructor(mikrotik, db, gateway, bot) {
        this.mikrotik = mikrotik;
        this.db = db;
        this.gateway = gateway;
        this.bot = bot;
        this._knownMacs = new Set();
        this._intervals = [];
    }

    start() {
        logger.info('AgentOSOrchestrator: Starting services...');
        this._provisionRouter().catch(e => logger.error(`Provisioning error: ${e.message}`));
        this._monitorSystem();
        this._monitorNewDevices();
        this._scheduleVoucherExpiry();
        this._runCron();
    }

    stop() {
        this._intervals.forEach(clearInterval);
        this._intervals = [];
    }

    async _provisionRouter() {
        if (!this.mikrotik.isConnected) return;
        logger.info('Provisioning router (Day 1 checks)…');

        // 3. Ensure hotspot profiles exist
        const profiles = [
            { name: '1Hour', sessionTimeout: '01:00:00' },
            { name: '1Day', sessionTimeout: '24:00:00' },
            { name: '7Day', sessionTimeout: '168:00:00' },
            { name: '30Days', sessionTimeout: '720:00:00' }
        ];

        for (const p of profiles) {
            try {
                // Try to find it first
                const existing = await this.mikrotik.executeRawAPI(['/ip/hotspot/user/profile/print', `?name=${p.name}`]);
                if (!existing || existing.length === 0) {
                    logger.info(`Orchestrator: Creating profile ${p.name}...`);
                    await this.mikrotik.executeRawAPI([
                        '/ip/hotspot/user/profile/add',
                        `name=${p.name}`,
                        `session-timeout=${p.sessionTimeout}`,
                        'shared-users=1',
                        'status-autorefresh=00:01:00'
                    ]);
                }
            } catch (err) {
                logger.warn(`Orchestrator: Failed to ensure profile ${p.name}: ${err.message}`);
            }
        }

        logger.info('Router provisioning complete.');
    }

    _runCron() {
        // Daily Reboot at 4:00 AM & Heartbeat at 12:00 PM
        const cronInterval = setInterval(async () => {
            const now = new Date();
            if (now.getHours() === 4 && now.getMinutes() === 0) {
                logger.info('Cron: Triggering automated daily reboot (4:00 AM)');
                this.bot?.sendToAll?.('🔄 *Automated System Maintenance:* Router is rebooting.');
                await this.mikrotik.reboot().catch(() => { });
            }

            // Heartbeat Every 24 Hours
            if (now.getHours() === 12 && now.getMinutes() === 0) {
                this.bot?.sendToAll?.('💚 *System Heartbeat:* AgentOS is active and monitoring.');
            }
        }, 60_000);
        this._intervals.push(cronInterval);
    }

    _monitorSystem() {
        const sysInterval = setInterval(async () => {
            if (!this.mikrotik.isConnected) return;
            try {
                const s = await this.mikrotik.getSystemStats();
                const cpu = parseInt(s?.['cpu-load']) || 0;
                const fm = parseInt(s?.['free-memory']) || 0;
                const tm = parseInt(s?.['total-memory']) || 1;

                if (cpu > 90) {
                    this.bot?.alertOnce?.('cpu-high', `⚠️ *High CPU:* ${cpu}%`);
                }
                if ((1 - fm / tm) > 0.85) {
                    this.bot?.alertOnce?.('mem-high', `⚠️ *High Memory:* ${Math.round((1 - fm / tm) * 100)}% used`);
                }

                // Hardware health checks
                const health = this.mikrotik.state?.lastKnownHealth;
                if (health) {
                    const voltage = parseFloat(health.voltage);
                    const temp = parseFloat(health.temperature);
                    
                    if (!isNaN(voltage) && voltage < 11.5) { // Low voltage alert (assuming 12V supply)
                        this.bot?.alertOnce?.('low-voltage', `🔌 *Low Voltage Warning:* ${voltage}V\nSystem may be unstable.`);
                    }
                    if (!isNaN(temp) && temp > 65) { // High temperature alert
                        this.bot?.alertOnce?.('high-temp', `🔥 *High Temperature:* ${temp}°C\nThermal throttling possible.`);
                    }
                }
            } catch (err) {
                logger.error(`Orchestrator system monitor: ${err.message}`);
            }
        }, 15_000);
        this._intervals.push(sysInterval);
    }

    _monitorNewDevices() {
        let firstScan = true;
        const devInterval = setInterval(async () => {
            if (!this.mikrotik.isConnected) return;
            try {
                const arp = await this.mikrotik.getArpTable();
                for (const dev of arp.filter(e => e.address && e['mac-address'])) {
                    const mac = dev['mac-address'];
                    if (!this._knownMacs.has(mac)) {
                        this._knownMacs.add(mac);
                        if (!firstScan) {
                            this.bot?.alertOnce?.(`new-device-${mac}`, `🆕 *New Device*\nIP: \`${dev.address}\`  MAC: \`${mac}\``);
                        }
                    }
                }
                firstScan = false;
            } catch { /* silence transient read failures */ }
        }, 60_000);
        this._intervals.push(devInterval);
    }

    _scheduleVoucherExpiry() {
        const expInterval = setInterval(async () => {
            try {
                if (typeof this.db.expireOldVouchers === 'function') {
                    const count = await this.db.expireOldVouchers();
                    if (count > 0) {
                        this.bot?.sendToAll?.(`⌛ ${count} voucher(s) expired.`);
                        this.gateway?.broadcast?.({ type: 'vouchers.expired', count });
                    }
                }
            } catch (err) {
                logger.error(`Voucher expiry task: ${err.message}`);
            }
        }, 60 * 60_000); // Hourly check
        this._intervals.push(expInterval);
    }
}

module.exports = AgentOSOrchestrator;
