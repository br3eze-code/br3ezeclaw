// ==========================================
// ASK ENGINE - AI Coordinator with Fallbacks
// ==========================================

const { GoogleGenerativeAI } = require('@google/generative-ai');
const logger = require('./logger');

class AskEngine {
  constructor(apiKey) {
    this.genAI = new GoogleGenerativeAI(apiKey || process.env.GEMINI_API_KEY);
    this.model = this.genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
    
    // Enhanced fallback dictionary
    this.fallbackCommands = {
      // User management
      'who is active': '/users',
      'active users': '/users',
      'show users': '/users',
      'list users': '/users',
      'online users': '/users',
      'connected users': '/users',
      'kick user': '/kick',
      'remove user': '/remove',
      
      // System status
      'dashboard': '/dashboard',
      'system status': '/stats',
      'router status': '/stats',
      'show stats': '/stats',
      'cpu usage': '/stats',
      'memory usage': '/stats',
      
      // Network
      'ping': '/ping',
      'traceroute': '/traceroute',
      'network test': '/ping',
      'check connection': '/ping',
      
      // Vouchers
      'create voucher': '/voucher',
      'generate code': '/voucher',
      'new voucher': '/voucher',
      'wifi code': '/voucher',
      
      // System
      'reboot router': '/reboot',
      'restart router': '/reboot',
      'reboot': '/reboot',
      
      // Help
      'help': '/menu',
      'commands': '/menu',
      'what can you do': '/menu'
    };
    
    // Pattern matching for partial queries
    this.patterns = [
      { regex: /who.*active|active.*users|online.*users/i, command: '/users' },
      { regex: /kick\s+(\w+)|remove\s+(\w+)/i, command: '/kick', extractParam: true },
      { regex: /status|stats|cpu|memory|uptime/i, command: '/stats' },
      { regex: /reboot|restart.*router/i, command: '/reboot' },
      { regex: /voucher|code|wifi.*pass/i, command: '/voucher' },
      { regex: /ping|traceroute|trace.*route/i, command: '/ping' },
      { regex: /help|menu|commands/i, command: '/menu' }
    ];
  }

  async processQuery(query, context = {}) {
    const normalized = query.toLowerCase().trim();
    
    // 1. Check exact matches first (fastest)
    if (this.fallbackCommands[normalized]) {
      logger.debug(`Fallback match: "${normalized}" -> ${this.fallbackCommands[normalized]}`);
      return {
        command: this.fallbackCommands[normalized],
        params: {},
        source: 'fallback_exact',
        confidence: 1.0
      };
    }
    
    // 2. Check pattern matches
    for (const pattern of this.patterns) {
      const match = normalized.match(pattern.regex);
      if (match) {
        let params = {};
        if (pattern.extractParam && match[1]) {
          params.username = match[1];
        }
        logger.debug(`Pattern match: "${normalized}" -> ${pattern.command}`);
        return {
          command: pattern.command,
          params,
          source: 'fallback_pattern',
          confidence: 0.9
        };
      }
    }
    
    // 3. Try AI with timeout and error handling
    try {
      const aiResult = await Promise.race([
        this.geminiProcess(query, context),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('AI_TIMEOUT')), 8000)
        )
      ]);
      
      return {
        ...aiResult,
        source: 'ai',
        confidence: aiResult.confidence || 0.8
      };
      
    } catch (error) {
      logger.warn('AI processing failed:', error.message);
const failedLog = await fs.readFile('./knowledge/failed-commands.md', 'utf8');
const failures = (failedLog.match(new RegExp(call.name, 'g')) || []).length;

if (failures >= 2) {
  await telegramCtx.reply(`🤖 *Self-Improvement*: ${call.name} failed ${failures} times. Analyzing root cause...`);

  const diagnosis = await this.gemini.generate({
    prompt: `AgentOS skill '${call.name}' failed ${failures} times. 
Failed logs: ${failedLog}
Soul.md rules: ${memory['soul.md']}

Should I: 
A) Edit ${call.name}.js to fix it using 'self_edit'
B) Create new skill using 'skill_create' 
C) Ask user for help

Reply with A, B, or C and the fix.`
  });

  if (diagnosis.text.startsWith('A')) {
    await telegramCtx.reply(`📝 *Self-editing* ${call.name}.js to fix bug...`);
    // Gemini generates the fix and calls self_edit
  }
  if (diagnosis.text.startsWith('B')) {
    await telegramCtx.reply(`🧬 *Creating new skill* to handle this...`);
    // Gemini generates new skill and calls skill_create
  }
}
      
      // Return helpful error with suggestions
      return {
        error: true,
        message: 'I didn\'t understand that command.',
        suggestions: ['/users', '/stats', '/reboot', '/voucher', '/menu'],
        help: 'Try: "show users", "system status", "create voucher", or type /menu for options',
        originalQuery: query
      };
    }
  }

  async geminiProcess(query, context) {
    const prompt = `
You are AgentOS, a network management assistant. Convert the following user query into a structured command.
Available commands: /users, /stats, /reboot, /voucher, /ping, /kick, /menu, /dashboard

User query: "${query}"
Context: ${JSON.stringify(context)}

Respond ONLY with a JSON object in this format:
{
  "command": "/command",
  "params": {},
  "explanation": "What you're doing",
  "confidence": 0.95
}
`;

    const result = await this.model.generateContent(prompt);
    const response = result.response.text();
    
    // Extract JSON from response
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('Invalid AI response format');
    }
    
    return JSON.parse(jsonMatch[0]);
  }

  // Quick command execution helper
  async executeCommand(commandStr, mikrotikManager) {
    const [cmd, ...args] = commandStr.split(' ');
    
    switch(cmd) {
      case '/users':
        return await mikrotikManager.getActiveUsers();
      case '/stats':
        return await mikrotikManager.getSystemStats();
      case '/reboot':
        return await mikrotikManager.reboot();
      case '/kick':
        if (args[0]) {
          return await mikrotikManager.kickUser(args[0]);
        }
        throw new Error('Username required for kick');
      default:
        throw new Error(`Unknown command: ${cmd}`);
    }
  }
}

module.exports = AskEngine;
