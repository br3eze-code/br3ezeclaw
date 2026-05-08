// src/interfaces/telegram.js
const TelegramBot = require('node-telegram-bot-api');
const eventBus = require('../core/eventBus');

class Bot {
    constructor(token, agent) {
        this.bot = new TelegramBot(token, { polling: false }); 
        this.agent = agent;
        this.init();
    }

    init() {
        eventBus.on('user.login', (data) => {
            this.bot.sendMessage(process.env.ADMIN_CHAT, `🟢 ${data.username} logged in`).catch(() => {});
        });

        eventBus.on('user.logout', (data) => {
            this.bot.sendMessage(process.env.ADMIN_CHAT, `🔴 ${data.username} logged out`).catch(() => {});
        });

        // Register commands
        this.bot.onText(/\/kick (.+)/, async (msg, match) => {
            const username = match[1];
            try {
                await this.agent.handle({
                    tool: 'user.kick',
                    params: { username }
                });
                this.bot.sendMessage(msg.chat.id, `✅ User ${username} kicked`);
            } catch (err) {
                this.bot.sendMessage(msg.chat.id, `❌ Kick failed: ${err.message}`);
            }
        });
    }
}

module.exports = Bot;