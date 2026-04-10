// src/interfaces/telegram.js
const TelegramBot = require('node-telegram-bot-api');
const eventBus = require('../core/eventBus');

class Bot {
    constructor(token) {
        this.bot = new TelegramBot(token, { polling: true });
        this.init();
    }

    init() {
        eventBus.on('user.login', (data) => {
            this.bot.sendMessage(process.env.ADMIN_CHAT, `🟢 ${data.username} logged in`);
        });

        eventBus.on('user.logout', (data) => {
            this.bot.sendMessage(process.env.ADMIN_CHAT, `🔴 ${data.username} logged out`);
        });
    }
}

module.exports = Bot;
module.exports = (bot, agent) => {

    bot.onText(/\/kick (.+)/, async (msg, match) => {
        const username = match[1];

        await agent.handle({
            tool: 'user.kick',
            params: { username }
        });

        bot.sendMessage(msg.chat.id, `User ${username} kicked`);
    });

};