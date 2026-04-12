// src/channels/telegram.js
class TelegramChannel {
  constructor(token) {
    this.bot = new TelegramBot(token, {
      polling: {
        interval: 300,     
        autoStart: true,
        params: {
          timeout: 10      
        }
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
  }
  
  clearOldCache() {
    const now = Date.now();
    for (const [key, value] of this.messageCache.entries()) {
      if (now - value.timestamp > 300000) { // 5 min expiry
        this.messageCache.delete(key);
      }
    }
  }
  
  destroy() {
    clearInterval(this.cacheCleanup);
    this.bot.stopPolling();
    this.bot.removeAllListeners();
  }
}