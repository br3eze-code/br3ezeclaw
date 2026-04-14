// src/ai/coordinator.js
const { GoogleGenerativeAI } = require('@google/generative-ai');
const EventEmitter = require('events');
const { logger } = require('../core/logger');


const { QNAPProcessor } = require('./qnap-integration');

class AICoordinator extends EventEmitter {
  constructor(config = {}) {
    super();
    this.genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    this.model = this.genAI.getGenerativeModel({ 
      model: "gemini-2.5-flash-preview-04-09",
      systemInstruction: this.getSystemPrompt()
    });
    
    this.qnap = new QNAPProcessor();
    this.conversationContext = new Map(); // Context per user
    this.toolRegistry = new Map();
    
    this._registerTools();
  }

  getSystemPrompt() {
    return `You are AgentOS, an AI network administrator for MikroTik routers.
You control hotspot users, generate vouchers, monitor system stats, and manage network security.

Available tools:
- user.add(username, password, profile) - Create hotspot user
- user.kick(username) - Disconnect active user
- users.active() - List active sessions
- system.stats() - Get router stats
- system.reboot() - Restart router
- voucher.create(plan) - Generate WiFi voucher (plans: 1hour, 1day, 1week)
- ping(host) - Network test
- firewall.block(ip) - Block address

Respond naturally but include structured data when tools are needed.
If a user asks for a voucher, create it immediately without asking confirmation.
If rebooting, always ask for confirmation first.`;
  }

  _registerTools() {
    const { getManager } = require('../core/mikrotik');
    const { getDatabase } = require('../core/database');

    // Register all MikroTik tools
    const mt = getManager();
    const tools = [
      'user.add', 'user.kick', 'users.active', 'user.status',
      'system.stats', 'system.reboot', 'ping', 'firewall.block'
    ];

    tools.forEach(name => {
      this.toolRegistry.set(name, async (params) => {
        try {
          return await mt.executeTool(name, params);
        } catch (error) {
          throw new Error(`Tool ${name} failed: ${error.message}`);
        }
      });
    });

    // Register voucher tool with neural fraud detection
    this.toolRegistry.set('voucher.create', async (params) => {
      // Q-NAP Fraud Detection
      const fraudCheck = await this.qnap.analyzeTransaction({
        userId: params.chatId,
        amount: this._getPlanPrice(params.plan),
        timestamp: Date.now(),
        deviceFingerprint: params.fingerprint
      });

      if (fraudCheck.riskScore > 0.8) {
        logger.audit('fraud_detected', { plan: params.plan, risk: fraudCheck.riskScore });
        throw new Error('Transaction flagged for review');
      }

      const db = await getDatabase();
      const code = this._generateVoucherCode();
      
      await db.createVoucher(code, {
        plan: params.plan,
        createdBy: 'telegram_bot',
        fraudScore: fraudCheck.riskScore
      });

      // Generate QR code
      const QRCode = require('qrcode');
      const qrData = await QRCode.toDataURL(`WIFI:T:WPA;S:AgentOS;P:${code};;`);
      
      return {
        success: true,
        code,
        plan: params.plan,
        expiresAt: this._getExpiryDate(params.plan),
        qrCode: qrData.split(',')[1], // Remove data:image prefix
        fraudCheck: fraudCheck.riskScore < 0.3 ? 'passed' : 'review'
      };
    });
  }

  async processQuery(text, context = {}) {
    try {
      // Neural intent classification
      const intent = await this.qnap.classifyIntent(text);
      
      // If high confidence direct command, execute immediately
      if (intent.confidence > 0.9 && intent.action !== 'unknown') {
        return await this.executeDirectCommand(intent, context);
      }

      // Otherwise use Gemini for complex reasoning
      const chat = this.model.startChat({
        history: this.getConversationHistory(context.userId),
        generationConfig: {
          temperature: 0.2,
          topP: 0.8,
          topK: 40
        }
      });

      const result = await chat.sendMessage(text);
      const response = result.response.text();
      
      // Parse tool calls from response if present
      const toolCall = this.parseToolCall(response);
      if (toolCall) {
        const toolResult = await this.executeTool(toolCall.name, toolCall.params);
        return {
          response: this.formatToolResponse(toolCall.name, toolResult),
          data: toolResult,
          suggestions: this.getSuggestions(toolCall.name)
        };
      }

      return { response, suggestions: ['Show users', 'Create voucher', 'System stats'] };
      
    } catch (error) {
      logger.error('AI Coordinator error:', error);
      return { 
        error: true, 
        message: 'AI processing failed. Please use manual commands like /users or /voucher 1day' 
      };
    }
  }

  async processCommand(command, params) {
    if (this.toolRegistry.has(command)) {
      return await this.toolRegistry.get(command)(params);
    }
    
    // Fallback to parsing
    return await this.processQuery(command, params);
  }

  parseToolCall(response) {
    // Look for JSON tool calls in response
    const jsonMatch = response.match(/```json\s*(\{[\s\S]*?\})\s*```/);
    if (jsonMatch) {
      try {
        return JSON.parse(jsonMatch[1]);
      } catch (e) {
        return null;
      }
    }
    return null;
  }

  async executeTool(name, params) {
    const tool = this.toolRegistry.get(name);
    if (!tool) throw new Error(`Unknown tool: ${name}`);
    return await tool(params);
  }

  getConversationHistory(userId) {
    if (!userId) return [];
    return this.conversationContext.get(userId) || [];
  }

  _generateVoucherCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // No ambiguous chars
    let code = '';
    for (let i = 0; i < 8; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
  }

  _getPlanPrice(plan) {
    const prices = { '1hour': 0.5, '1day': 2, '1week': 10 };
    return prices[plan] || 2;
  }

  _getExpiryDate(plan) {
    const now = new Date();
    const durations = { '1hour': 1, '1day': 24, '1week': 168 };
    now.setHours(now.getHours() + (durations[plan] || 24));
    return now.toISOString();
  }

  formatToolResponse(toolName, result) {
    const formatters = {
      'users.active': (r) => `Found ${r.length} active users`,
      'voucher.create': (r) => `Created voucher ${r.code} (${r.plan})`,
      'system.stats': (r) => `CPU: ${r['cpu-load']}%, Uptime: ${r.uptime}`
    };
    
    return formatters[toolName] ? formatters[toolName](result) : JSON.stringify(result);
  }

  getSuggestions(lastAction) {
    const suggestions = {
      'users.active': ['Kick user', 'View stats', 'Create voucher'],
      'voucher.create': ['Create another', 'View active users', 'Check stats'],
      'default': ['Show users', 'Create voucher', 'System stats']
    };
    return suggestions[lastAction] || suggestions.default;
  }

  async executeDirectCommand(intent, context) {
    // Direct execution for known intents without Gemini
    const mappings = {
      'list_users': { tool: 'users.active', response: 'Here are the active users:' },
      'get_stats': { tool: 'system.stats', response: 'System status:' },
      'kick_user': { tool: 'user.kick', params: { username: intent.target } }
    };

    const mapping = mappings[intent.action];
    if (!mapping) return { response: "I didn't understand. Try: list users, kick [name], create voucher" };

    const result = await this.executeTool(mapping.tool, mapping.params || {});
    return {
      response: `${mapping.response}\n${this.formatToolResponse(mapping.tool, result)}`,
      data: result
    };
  }
  async processInteraction(msg, context = {}) {
    logger.debug(`Processing interaction from ${context.channel || 'unknown'}: ${msg.text}`);
    
    const result = await this.processQuery(msg.text, { 
      userId: msg.userId,
      channel: context.channel,
      ...context
    });
    
    return {
      success: !result.error,
      result: {
        text: result.response,
        data: result.data,
        suggestions: result.suggestions
      },
      error: result.message
    };
  }
}

module.exports = AICoordinator;
