'use strict';

const TelegramBot = require('node-telegram-bot-api');

class TelegramAdapter {
    constructor(token) {
        this.bot = new TelegramBot(token, { polling: true });
        this.handlers = new Map();
        
        // Setup command handlers
        this.bot.onText(/\/pair(?:\s+(.+))?/, (msg, match) => {
            this.handleCommand('pair', msg, match);
        });
        
        this.bot.onText(/\/pairing_status/, (msg) => {
            this.handleCommand('status', msg);
        });
    }

    onCommand(command, handler) {
        this.handlers.set(command, handler);
    }

    async handleCommand(cmd, msg, match) {
        const handler = this.handlers.get(cmd);
        if (handler) {
            await handler({
                channel: 'telegram',
                userId: msg.chat.id.toString(),
                username: msg.from.username || msg.from.first_name,
                args: match?.[1],
                raw: msg
            });
        }
    }

    async send(userId, message) {
        if (typeof message === 'string') {
            return this.bot.sendMessage(userId, message, { parse_mode: 'Markdown' });
        }
        
        // Structured message with optional file
        if (message.text) {
            await this.bot.sendMessage(userId, message.text, { 
                parse_mode: 'Markdown',
                reply_markup: message.buttons 
            });
        }
        
        if (message.file) {
            await this.bot.sendDocument(userId, Buffer.from(message.file.content), {
                filename: message.file.name,
                caption: message.file.caption
            });
        }
    }

    format(template, data) {
        switch (template) {
            case 'pairing_code':
                return {
                    text: `🔐 **Router Pairing Code**\n\n` +
                          `Code: \`${data.code}\`\n` +
                          `Location: ${data.location}\n` +
                          `Expires in: ${data.expiresIn} minutes\n\n` +
                          `Paste this script into your MikroTik terminal:\n` +
                          `\`\`\`routeros\n${data.script}\n\`\`\``,
                    file: {
                        name: `agentos-pair-${data.code}.rsc`,
                        content: data.script,
                        caption: 'Or download and import this script'
                    }
                };
                
            case 'pairing_success':
                return {
                    text: `✅ **Router Successfully Paired!**\n\n` +
                          `🖥️ Identity: \`${data.identity}\`\n` +
                          `🔢 Router ID: \`${data.routerId}\`\n` +
                          `📍 MAC: \`${data.macAddress}\`\n` +
                          `⚙️ Model: ${data.model}\n` +
                          `⏰ Paired: ${new Date(data.pairedAt).toLocaleString()}\n\n` +
                          `Use /fleet to see all your routers.`
                };
                
            default:
                return { text: JSON.stringify(data, null, 2) };
        }
    }

    stop() {
        this.bot.stopPolling();
    }
}

module.exports = TelegramAdapter;
