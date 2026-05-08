
/**
 * WhatsApp Channel
 */

const { 
  default: makeWASocket, 
  DisconnectReason, 
  useMultiFileAuthState,
  Browsers
} = require('@whiskeysockets/baileys');
const { BaseChannel } = require('./base');
const { Logger } = require('../utils/logger');
const QRCode = require('qrcode-terminal');
const path = require('path');

class WhatsAppChannel extends BaseChannel {
  constructor(options = {}) {
    super(options);
    this.name = 'whatsapp';
    this.sessionName = options.sessionName || process.env.WHATSAPP_SESSION_NAME || 'agentos-session';
    this.enabled = options.enabled !== undefined ? options.enabled : process.env.WHATSAPP_ENABLED === 'true';
    this.logger = new Logger('WhatsAppChannel');
    this.sock = null;
    this.authState = null;
    this.qrCode = null;
  }
  
  async connect() {
    if (!this.enabled) {
      this.logger.info('WhatsApp disabled');
      return;
    }
    
    this.logger.info('Connecting to WhatsApp...');
    
    // Setup auth state
    const authPath = path.join(process.cwd(), 'data', 'whatsapp-auth', this.sessionName);
    this.authState = await useMultiFileAuthState(authPath);
    
    // Create socket
    this.sock = makeWASocket({
      auth: this.authState.state,
      printQRInTerminal: true,
      browser: Browsers.macOS('Desktop'),
      logger: { level: 'silent' }
    });
    
    // Setup event handlers
    this.sock.ev.on('connection.update', (update) => this.handleConnectionUpdate(update));
    this.sock.ev.on('messages.upsert', (m) => this.handleMessages(m));
    this.sock.ev.on('creds.update', this.authState.saveCreds);
  }
  
  handleConnectionUpdate(update) {
    const { connection, lastDisconnect, qr } = update;
    
    if (qr) {
      this.qrCode = qr;
      this.logger.info('QR Code received, scan with WhatsApp');
      QRCode.generate(qr, { small: true });
    }
    
    if (connection === 'close') {
      const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
      this.logger.info('WhatsApp disconnected, reconnecting:', shouldReconnect);
      
      if (shouldReconnect) {
        this.connect();
      }
    } else if (connection === 'open') {
      this.connected = true;
      this.qrCode = null;
      this.logger.info('WhatsApp connected');
    }
  }
  
  handleMessages({ messages, type }) {
    if (type !== 'notify') return;
    
    for (const msg of messages) {
      if (!msg.message) continue;
      
      const chatId = msg.key.remoteJid;
      const isDM = chatId.endsWith('@s.whatsapp.net');
      const sender = msg.key.participant || chatId;
      
      // Extract text
      let content = '';
      if (msg.message.conversation) {
        content = msg.message.conversation;
      } else if (msg.message.extendedTextMessage) {
        content = msg.message.extendedTextMessage.text;
      }
      
      if (!content) continue;
      
      const frame = this.createFrame({
        sender: chatId,
        senderName: msg.pushName || sender,
        content,
        isDM,
        metadata: {
          messageId: msg.key.id,
          timestamp: msg.messageTimestamp
        }
      });
      
      this.emit('message', frame);
    }
  }
  
  async disconnect() {
    if (this.sock) {
      await this.sock.logout();
    }
    this.connected = false;
  }
  
  async send(recipient, message) {
    if (!this.connected || !this.sock) {
      throw new Error('WhatsApp not connected');
    }
    
    const formatted = this.formatMessage(message);
    
    try {
      await this.sock.sendMessage(recipient, {
        text: formatted.text || formatted
      });
    } catch (error) {
      this.logger.error('Send error:', error);
      throw error;
    }
  }
}

module.exports = { WhatsAppChannel };


