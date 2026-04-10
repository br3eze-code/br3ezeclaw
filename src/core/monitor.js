const eventBus = require('../core/eventBus');
const mikrotik = require('./mikrotik.agent');

class MonitorAgent {
    constructor() {
        this.active = new Set();
        this.start();
    }

    async start() {
        setInterval(async () => {
            const users = await mikrotik.getActiveUsers();

            const current = new Set(users.map(u => u.user));

            // LOGIN DETECT
            current.forEach(user => {
                if (!this.active.has(user)) {
                    eventBus.emit('user.login', { username: user });
                }
            });

            // LOGOUT DETECT
            this.active.forEach(user => {
                if (!current.has(user)) {
                    eventBus.emit('user.logout', { username: user });
                }
            });

            this.active = current;

        }, 5000);
    }
}

module.exports = new MonitorAgent();