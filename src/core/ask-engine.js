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
  // Quick regex patterns for common queries
  if (/who is active|active users|online users/.test(normalized)) {
    return { command: '/users', confidence: 1.0 };
  }
  if (/restart|reboot router/.test(normalized)) {
    return { command: '/reboot', confidence: 1.0 };
  }
  
  // Fallback to AI only for complex queries
  try {
    const aiResult = await Promise.race([
      this.geminiProcess(query),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('AI Timeout')), 5000)
      )
    ]);
    return aiResult;
  } catch (e) {
    return {
      error: true,
      message: 'I didn\'t understand. Try: /users, /stats, /reboot, /voucher',
      suggestions: ['/users', '/stats', '/menu']
    };
  }
}
