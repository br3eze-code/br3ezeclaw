// src/core/ask-engine.js
class AskEngine {
 async processQuery(query) {
  const fallbackCommands = {
    'who is active': '/users',
    'active users': '/users',
    'show users': '/users',
    'dashboard': '/stats',
    'system status': '/stats',
    'restart router': '/reboot'
  };
    
    // Try exact match first
    const normalized = query.toLowerCase().trim();
  if (fallbackCommands[normalized]) {
    return { command: fallbackCommands[normalized], source: 'fallback' };
  
    
  try {
    return await this.geminiProcess(query);
  } catch (e) {
    console.error('AI Error:', e.message);
    return { 
      error: 'AI unavailable', 
      message: 'Available commands: /users, /stats, /reboot, /voucher',
      fallback: '/menu' 
    };
  }
}
