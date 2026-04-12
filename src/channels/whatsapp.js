// src/channels/whatsapp.js 
const makeWASocket = require('@whiskeysockets/baileys').default;
const { DisconnectReason, useMultiFileAuthState } = require('@whiskeysockets/baileys');

class WhatsAppChannel {
  constructor() {
    this.sock = null;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 10;
    this.messageQueue = []; // Queue messages during disconnect
    this.isConnected = false;
    this.connectionState = 'disconnected';
  }

  async connect() {
    const { state, saveCreds } = await useMultiFileAuthState('./auth_info');
    
    this.sock = makeWASocket({
      auth: state,
      printQRInTerminal: false,
      syncFullHistory: false,    
      markOnlineOnConnect: false,    
      keepAliveIntervalMs: 15000,     
      connectTimeoutMs: 60000,
      defaultQueryTimeoutMs: 60000,
      retryRequestDelayMs: 250,
      browser: ['AgentOS', 'Chrome', '120.0.0'],
      logger: require('pino')({ 
        level: 'warn',
        redact: ['creds.noiseKey', 'creds.signedPreKey']
      })
    });

    this.sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;
      
      if (qr) {
        this.emit('qr', qr);
      }
      
      if (connection === 'close') {
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        this.isConnected = false;
        this.connectionState = 'disconnected';
        
        console.log('WhatsApp disconnected:', statusCode);
        
        if (statusCode === DisconnectReason.loggedOut) {
          console.error('WhatsApp session logged out - needs re-authentication');
          this.emit('auth_required');
          return; 
        }
        
        if (statusCode === DisconnectReason.connectionReplaced) {
          console.error('Connection replaced - another session active');
          this.emit('connection_replaced');
          return;
        }
        

        if (this.reconnectAttempts < this.maxReconnectAttempts) {
          this.reconnectAttempts++;
          const delay = Math.min(1000 * this.reconnectAttempts, 30000);
          console.log(`Reconnecting in ${delay}ms... (attempt ${this.reconnectAttempts})`);
          setTimeout(() => this.connect(), delay);
        }
      } else if (connection === 'open') {
        this.isConnected = true;
        this.connectionState = 'connected';
        this.reconnectAttempts = 0;
        this.emit('connected');
        
        await this.flushMessageQueue();
      }
    });

    this.sock.ev.on('creds.update', saveCreds);
    
    this.sock.ws.on('CB:ib,,downgrade_webclient', () => {
      console.error('Multi-device not enabled on phone');
      this.emit('multidevice_required');
    });
  }

  async sendMessage(jid, message) {
    if (!this.isConnected) {

      this.messageQueue.push({ jid, message, timestamp: Date.now() });
      return { queued: true };
    }
    
    try {
      const result = await this.sock.sendMessage(jid, message);
      return { success: true, id: result.key.id };
    } catch (error) {
  
      this.messageQueue.push({ jid, message, timestamp: Date.now() });
      return { queued: true, error: error.message };
    }
  }

  async flushMessageQueue() {
    while (this.messageQueue.length > 0) {
      const item = this.messageQueue.shift();
      
      if (Date.now() - item.timestamp > 300000) continue;
      
      try {
        await this.sock.sendMessage(item.jid, item.message);
      } catch (error) {
        console.error('Failed to send queued message:', error);
  
        if (this.messageQueue.length < 100) {
          this.messageQueue.unshift(item);
        }
        break;
      }
    }
  }
}
