// src/services/sessions.js

'use strict';

class SessionService {
    constructor(mikrotik, events) {
        this.mikrotik = mikrotik;
        this.events = events;
        this.active = new Map();
        this.intervalId = null;
        this.running = false;
    }

    async monitor(intervalMs = 5000) {
        if (this.running) return;
        this.running = true;

        const check = async () => {
            try {
                const users = await this.mikrotik.getActiveUsers();
                const current = new Set(users.map(u => u.user));

                // LOGIN DETECT
                users.forEach(u => {
                    if (!this.active.has(u.user)) {
                        this.active.set(u.user, {
                            ...u,
                            loginTime: Date.now()
                        });
                        this.events.emit('user.login', u);
                    }
                });

                // LOGOUT DETECT
                this.active.forEach((val, key) => {
                    if (!current.has(key)) {
                        this.active.delete(key);
                        this.events.emit('user.logout', {
                            ...val,
                            logoutTime: Date.now(),
                            durationMs: Date.now() - val.loginTime
                        });
                    }
                });

            } catch (error) {
                this.events.emit('monitor.error', { 
                    error: error.message, 
                    time: new Date().toISOString(),
                    source: 'SessionService.monitor'
                });
            }
        };

        // Immediate first check, then interval
        await check();
        this.intervalId = setInterval(check, intervalMs);
    }

    getActiveSessions() {
        return Array.from(this.active.entries()).map(([username, data]) => ({
            username,
            ip: data.address,
            mac: data['mac-address'],
            uptime: Date.now() - data.loginTime
        }));
    }

    stop() {
        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
            this.running = false;
        }
    }
}

module.exports = SessionService;
