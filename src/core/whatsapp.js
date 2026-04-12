/**
 * WhatsApp Service - Baileys Integration
 * @module core/whatsapp
 */

const { default: makeWASocket, DisconnectReason, useMultiFileAuthState } = require('@whiskeysockets/baileys');
const { logger } = require('./logger');
const { getConfig } = require('./config');
const path = require('path');
const fs = require('fs');

class WhatsAppService {
  constructor() {
    this.sock = null;
    this.qrCode = null;
    this.isConnected = false;
    this.authStateFolder = path.join(process.cwd(), '.whatsapp-auth');
  }

  async initialize() {
    const config = getConfig();
    
    if (!config.whatsapp?.enabled) {
      logger.info('WhatsApp integration disabled');
      return;
    }

    // Ensure auth folder exists
    if (!fs.existsSync(this.authStateFolder)) {
      fs.mkdirSync(this.authStateFolder, { recursive: true });
    }

    const { state, saveCreds } = await useMultiFileAuthState(this.authStateFolder);

    this.sock = makeWASocket({
      auth: state,
      printQRInTerminal: true,
      logger: logger.child({ service: 'whatsapp' })
    });

    this.sock.ev.on('connection.update', (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        this.qrCode = qr;
        logger.info('WhatsApp QR code generated. Scan with your phone.');
      }

      if (connection === 'close') {
        const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
        logger.info('WhatsApp connection closed. Reconnecting:', shouldReconnect);
        this.isConnected = false;
        
        if (shouldReconnect) {
          setTimeout(() => this.initialize(), 5000);
        }
      } else if (connection === 'open') {
        this.isConnected = true;
        this.qrCode = null;
        logger.info('WhatsApp connected successfully');
      }
    });

    this.sock.ev.on('creds.update', saveCreds);

    this.sock.ev.on('messages.upsert', async (m) => {
      const message = m.messages[0];
      if (!message.key.fromMe && m.type === 'notify') {
        await this.handleIncomingMessage(message);
      }
    });
  }

  async handleIncomingMessage(message) {
    const text = message.message?.conversation || 
                 message.message?.extendedTextMessage?.text || '';
    const from = message.key.remoteJid;

    logger.info(`WhatsApp message from ${from}: ${text}`);

    // Simple command handling
    if (text.startsWith('/')) {
      const command = text.slice(1).split(' ')[0].toLowerCase();
      
      switch (command) {
        case 'status':
          await this.sendMessage(from, '🤖 AgentOS is running!');
          break;
        case 'help':
          await this.sendMessage(from, 
            '*AgentOS Commands:*\\n' +
            '/status - Check system status\\n' +
            '/help - Show this message'
          );
          break;
        default:
          await this.sendMessage(from, 'Unknown command. Type /help');
      }
    }
  }

  async sendMessage(to, text) {
    if (!this.sock || !this.isConnected) {
      throw new Error('WhatsApp not connected');
    }
    await this.sock.sendMessage(to, { text });
  }

  async destroy() {
    if (this.sock) {
      await this.sock.logout();
      this.sock = null;
    }
  }

  getState() {
    return {
      isConnected: this.isConnected,
      hasQR: !!this.qrCode
    };
  }
}

module.exports = { WhatsAppService };
