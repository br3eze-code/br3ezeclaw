const TelegramBot = require('node-telegram-bot-api');
const https = require('https');
const logger = require('../logger'); // Corrected path if logger is in src/core/logger
const { BaseChannel } = require('./BaseChannel');

class TelegramChannel extends BaseChannel {
  constructor(config, agent) {
    super(config, agent);
    this.token = config.token;
    // this.mikrotik = agent.mikrotik; // Assuming agent has mikrotik or it's in config
    
    this.bot = new TelegramBot(token, {
      polling: {
        interval: 300,
        autoStart: true,
        params: { timeout: 10 }
      },
      request: {
        url: 'https://api.telegram.org',
        timeout: 30000,
        agent: new https.Agent({
          keepAlive: true,
          maxSockets: 5
        })
      }
    });

    this.messageCache = new Map();
    this.cacheCleanup = setInterval(() => this.clearOldCache(), 60000);
    this.bot.setMaxListeners(20);
    
    // Initialize command handlers
    this._registerHandlers();
    
    logger.info('Telegram channel initialized');
  }

  _registerHandlers() {
    // Start command
    this.bot.onText(/\/start/, async (msg) => {
      const chatId = msg.chat.id;
      const username = msg.from.username || msg.from.first_name;
      
      await this.bot.sendMessage(chatId, 
        `🤖 *AgentOS v2026.4.11*\n` +
        `"Network Intelligence, Simplified"\n\n` +
        `Welcome, ${username}! I'm your network intelligence assistant.\n\n` +
        `🔧 *Quick Actions:*`,
        {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [{ text: '📊 Dashboard', callback_data: '/dashboard' }, { text: '🛠️ Tools', callback_data: '/menu' }],
              [{ text: '👥 Users', callback_data: '/users' }, { text: '🌐 Network', callback_data: '/ping' }],
              [{ text: '🎫 Create Voucher', callback_data: '/voucher' }, { text: '📈 Status', callback_data: '/stats' }]
            ]
          }
        }
      );
    });

    // Explicit command handlers
    this.bot.onText(/\/users/, async (msg) => await this._handleUsers(msg));
    this.bot.onText(/\/stats/, async (msg) => await this._handleStats(msg));
    this.bot.onText(/\/dashboard/, async (msg) => await this._handleDashboard(msg));
    this.bot.onText(/\/reboot/, async (msg) => await this._handleReboot(msg));
    this.bot.onText(/\/voucher(?:\s+(\w+))?/, async (msg, match) => {
      await this._handleVoucher(msg, match);
    });
    this.bot.onText(/\/kick\s+(\w+)/, async (msg, match) => {
      await this._handleKick(msg, match);
    });
    this.bot.onText(/\/ping(?:\s+(.+))?/, async (msg, match) => {
      await this._handlePing(msg, match);
    });
    this.bot.onText(/\/menu/, async (msg) => await this._handleMenu(msg));

    // Handle inline keyboard callbacks
    this.bot.on('callback_query', async (query) => {
      const chatId = query.message.chat.id;
      const data = query.data;
      
      // Answer the callback to remove loading state
      await this.bot.answerCallbackQuery(query.id);
      
      // Route to appropriate handler
      switch(data) {
        case '/users':
          await this._sendUsers(chatId);
          break;
        case '/stats':
          await this._sendStats(chatId);
          break;
        case '/dashboard':
          await this._sendDashboard(chatId);
          break;
        case '/voucher':
          await this._sendVoucher(chatId);
          break;
        case '/menu':
          await this._sendMenu(chatId);
          break;
        default:
          await this.bot.sendMessage(chatId, 'Unknown command');
      }
    });

    // Natural language handler (catches all non-command text)
    this.bot.on('message', async (msg) => {
      // Skip if it's a command or callback
      if (msg.text?.startsWith('/')) return;
      if (msg.via_bot) return;
      
      await this._handleNaturalLanguage(msg);
    });

    // Error handling
    this.bot.on('polling_error', (error) => {
      logger.error('Telegram polling error:', error.message);
    });
  }

  async _handleNaturalLanguage(msg) {
    const chatId = msg.chat.id;
    const text = msg.text;
    
    // Show typing indicator
    this.bot.sendChatAction(chatId, 'typing');
    
    try {
      const result = await this.agent.processInteraction(text, {
        userId: msg.from.id,
        username: msg.from.username,
        channel: 'telegram',
        channelId: chatId
      });
      
      if (!result.success) {
        await this.bot.sendMessage(chatId, 
          `⚠️ ${result.error || 'Interaction failed'}\n\n` +
          `*Try using manual commands:*`,
          { parse_mode: 'Markdown' }
        );
        return;
      }
      
      // Execute the command
      await this._executeCommand(chatId, result.command, result.params);
      
    } catch (error) {
      logger.error('Natural language processing error:', error);
      await this.bot.sendMessage(chatId, 
        '⚠️ AI error. Please use manual commands.\nTry: /users, /stats, /reboot, /voucher'
      );
    }
  }

  async _executeCommand(chatId, command, params = {}) {
    try {
      switch(command) {
        case '/users':
          await this._sendUsers(chatId);
          break;
        case '/stats':
          await this._sendStats(chatId);
          break;
        case '/dashboard':
          await this._sendDashboard(chatId);
          break;
        case '/reboot':
          await this._handleRebootConfirm(chatId);
          break;
        case '/voucher':
          await this._sendVoucher(chatId);
          break;
        case '/kick':
          if (params.username) {
            await this._doKick(chatId, params.username);
          }
          break;
        default:
          await this.bot.sendMessage(chatId, `Executing: ${command}`);
      }
    } catch (error) {
      logger.error('Command execution error:', error);
      await this.bot.sendMessage(chatId, `❌ Error: ${error.message}`);
    }
  }

  async _sendUsers(chatId) {
    try {
      const users = await this.mikrotik.getActiveUsers();
      
      if (users.length === 0) {
        await this.bot.sendMessage(chatId, '👥 No active users');
        return;
      }
      
      let message = `👥 *Active Sessions: ${users.length}*\n\n`;
      users.forEach((user, i) => {
        const dataIn = this._formatBytes(user['bytes-in'] || 0);
        const dataOut = this._formatBytes(user['bytes-out'] || 0);
        message += `${i + 1}. *${user.user}*\n`;
        message += `   IP: ${user.address}\n`;
        message += `   Data: ↓${dataIn} ↑${dataOut}\n\n`;
      });
      
      await this.bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
    } catch (error) {
      await this.bot.sendMessage(chatId, `❌ Failed to get users: ${error.message}`);
    }
  }

  async _sendStats(chatId) {
    try {
      const stats = await this.mikrotik.getSystemStats();
      
      const message = 
        `📊 *System Stats*\n` +
        `CPU: ${stats['cpu-load'] || 'N/A'}%\n` +
        `Uptime: ${stats.uptime || 'N/A'}\n` +
        `Version: ${stats.version || 'N/A'}\n` +
        `Memory: ${stats['memory-usage-percent'] || 'N/A'}%\n` +
        `Board: ${stats['board-name'] || 'N/A'}`;
      
      await this.bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
    } catch (error) {
      await this.bot.sendMessage(chatId, `❌ Failed to get stats: ${error.message}`);
    }
  }

  async _sendDashboard(chatId) {
    try {
      const [stats, users] = await Promise.all([
        this.mikrotik.getSystemStats(),
        this.mikrotik.getActiveUsers()
      ]);
      
      const message = 
        `📊 *AgentOS Dashboard*\n\n` +
        `🖥️ *System*\n` +
        `CPU: ${stats['cpu-load'] || 'N/A'}%\n` +
        `Memory: ${stats['memory-usage-percent'] || 'N/A'}%\n` +
        `Uptime: ${stats.uptime || 'N/A'}\n\n` +
        `👥 *Users*\n` +
        `Active: ${users.length}\n\n` +
        `🟢 System operational`;
      
      await this.bot.sendMessage(chatId, message, { 
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: 'Refresh', callback_data: '/dashboard' }]
          ]
        }
      });
    } catch (error) {
      await this.bot.sendMessage(chatId, `❌ Dashboard error: ${error.message}`);
    }
  }

  async _handleReboot(msg) {
    const chatId = msg.chat.id;
    await this._handleRebootConfirm(chatId);
  }

  async _handleRebootConfirm(chatId) {
    await this.bot.sendMessage(chatId,
      '⚠️ *Confirm System Reboot?*\nReply with YES to proceed.',
      { 
        parse_mode: 'Markdown',
        reply_markup: {
          force_reply: true,
          selective: true
        }
      }
    );
    
    // Store state for confirmation
    this.pendingReboots = this.pendingReboots || new Set();
    this.pendingReboots.add(chatId);
  }

  async _sendVoucher(chatId) {
    // Placeholder - integrate with your voucher system
    await this.bot.sendMessage(chatId, 
      '🎫 Voucher generation\nUse: /voucher 1Day or /voucher 1Hour'
    );
  }

  async _sendMenu(chatId) {
    await this.bot.sendMessage(chatId,
      '🤖 *AgentOS Control Panel*\n\n' +
      '/stats - Network Performance\n' +
      '/voucher [1Day|1Hour] - Generate\n' +
      '/users - List Active\n' +
      '/reboot - Restart Router\n' +
      '/dashboard - Full Dashboard\n' +
      '/menu - Show this menu',
      { parse_mode: 'Markdown' }
    );
  }

  async _doKick(chatId, username) {
    try {
      const result = await this.mikrotik.kickUser(username);
      if (result.kicked) {
        await this.bot.sendMessage(chatId, `✅ User ${username} kicked`);
      } else {
        await this.bot.sendMessage(chatId, `⚠️ User ${username} not active`);
      }
    } catch (error) {
      await this.bot.sendMessage(chatId, `❌ Failed to kick: ${error.message}`);
    }
  }

  _formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  clearOldCache() {
    const now = Date.now();
    for (const [key, value] of this.messageCache.entries()) {
      if (now - value.timestamp > 300000) {
        this.messageCache.delete(key);
      }
    }
  }

  destroy() {
    clearInterval(this.cacheCleanup);
    this.bot.stopPolling();
    this.bot.removeAllListeners();
    logger.info('Telegram channel destroyed');
  }
}

module.exports = TelegramChannel;
