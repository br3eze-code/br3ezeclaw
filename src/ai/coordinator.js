// src/ai/coordinator.js
const { GoogleGenerativeAI } = require('@google/generative-ai');
const EventEmitter = require('events');
const { logger } = require('../core/logger');


const { QNAPProcessor } = require('./qnap-integration');

class AICoordinator extends EventEmitter {
  constructor(config = {}) {
    super();
    this.config = config;
    this.genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    this.skillRegistry = new (require('../core/skills/SkillRegistry'))();
    this.qnap = new QNAPProcessor();
    this.conversationContext = new Map(); // Context per user
    this.toolRegistry = new Map();
    this.toolToSkillMap = new Map(); // toolName -> skillName

    // Inject MikroTik Manager
    const { getManager } = require('../core/mikrotik');
    this.mikrotik = getManager();

    this.model = this.genAI.getGenerativeModel({
      model: "gemini-2.0-flash-exp",
      systemInstruction: this.getSystemPrompt()
    });

    this._registerStaticTools();
    this._initSkills();
  }

  async _initSkills() {
    const path = require('path');
    const skillsPath = path.join(__dirname, '../skills');
    await this.skillRegistry.loadFromDirectory(skillsPath);
    
    // Build tool-to-skill map
    for (const manifest of this.skillRegistry.list()) {
      if (manifest.tools) {
        if (Array.isArray(manifest.tools)) {
          manifest.tools.forEach(t => this.toolToSkillMap.set(t.name, manifest.name));
        } else {
          Object.keys(manifest.tools).forEach(tn => this.toolToSkillMap.set(tn, manifest.name));
        }
      }
    }

    logger.info(`AICoordinator: Loaded ${this.skillRegistry.skills.size} skills and ${this.toolToSkillMap.size} tools`);

    // Refresh model with new system prompt containing all loaded tools
    this.model = this.genAI.getGenerativeModel({
      model: "gemini-2.0-flash-exp",
      systemInstruction: this.getSystemPrompt()
    });
  }

  getSystemPrompt() {
    let prompt = `You manage network infrastructure, CCTV systems, and IoT devices via unified skills.
Available tools:
${this._getToolsDescription()}
`;

    if (this.skillRegistry) {
      for (const manifest of this.skillRegistry.list()) {
        if (manifest.tools) {
          for (const [toolName, tool] of Object.entries(manifest.tools)) {
            prompt += `- ${toolName}: ${tool.description}\n`;
          }
        }
      }
    }

    prompt += `\nRespond naturally but include structured data when tools are needed.
If a user asks for a voucher, create it immediately without asking confirmation.
If rebooting or performing high-risk actions, always ask for confirmation first.
When managing CCTV, you can target specific devices by their deviceId.`;

    return prompt;
  }

  _getToolsDescription() {
    let desc = '';
    // Add static tools
    this.toolRegistry.forEach((tool, name) => {
      desc += `- ${name}: ${tool.description || 'System tool'}\n`;
    });

    // Add dynamic skills
    if (this.skillRegistry) {
      for (const manifest of this.skillRegistry.list()) {
        if (manifest.tools) {
          // If tools is array (YAML format)
          if (Array.isArray(manifest.tools)) {
            manifest.tools.forEach(t => {
              desc += `- ${t.name}: ${t.description}\n`;
            });
          } else {
            // If tools is object (JSON format)
            for (const [toolName, tool] of Object.entries(manifest.tools)) {
              desc += `- ${toolName}: ${tool.description}\n`;
            }
          }
        } else if (manifest.description) {
          desc += `- ${manifest.name}: ${manifest.description}\n`;
        }
      }
    }
    return desc;
  }

  _registerStaticTools() {
    // Voucher tool remains static for now as it involves complex logic/QR generation
    this.toolRegistry.set('voucher.create', {
      description: 'Generate WiFi voucher (plans: 1hour, 1day, 1week)',
      execute: async (params) => {
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

        const { getDatabase } = require('../core/database');
        const db = await getDatabase();
        const voucherAgent = require('../core/voucher');
        const code = voucherAgent.generate(params.plan || '1hour');

        const { DEFAULT_PLANS } = require('../core/database');
        const dateUtils = require('../utils/date');
        
        const planObj = DEFAULT_PLANS[params.plan] || { name: 'Custom', deviceLimit: 1 };
        const expiresAt = planObj.durationValue && planObj.durationUnit ?
            dateUtils.add(new Date(), planObj.durationValue, planObj.durationUnit).toISOString() : null;
        
        const loginUrl = `http://${this.mikrotik?.state?.host || 'hotspot.local'}/login?username=${code}&password=${code}`;
        
        const vData = { 
            plan: params.plan,
            planName: planObj.name || params.plan,
            durationUnit: planObj.durationUnit || null,
            durationValue: planObj.durationValue || null,
            deviceLimit: planObj.deviceLimit || 1,
            expiresAt,
            loginUrl,
            createdBy: 'telegram_bot',
            fraudScore: fraudCheck.riskScore
        };
        
        await db.createVoucher(code, vData);
        
        if (this.mikrotik && this.mikrotik.state?.isConnected) {
            const _durationToMikrotik = (p) => {
                if (!p || !p.durationValue || !p.durationUnit) return null;
                const v = p.durationValue;
                switch (p.durationUnit) {
                    case 'weeks': return `${v}w`;
                    case 'days': return `${v}d`;
                    case 'hours': return `${String(v).padStart(2, '0')}:00:00`;
                    case 'minutes': return `${String(Math.floor(v / 60)).padStart(2, '0')}:${String(v % 60).padStart(2, '0')}:00`;
                    default: return null;
                }
            };
            await this.mikrotik.addHotspotUser({
                username: code, password: code, profile: params.plan,
                sharedUsers: vData.deviceLimit,
                ...(vData.expiresAt && { limitUptime: _durationToMikrotik(vData) })
            }).catch(() => { });
        }

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
      }         // close execute fn
    });           // close {description, execute} object + toolRegistry.set call
  }               // close _registerStaticTools


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
    const tool = this.toolRegistry.get(command);
    if (tool?.execute) {
      return await tool.execute(params);
    }
    // Fallback to NLU parsing
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

  async executeTool(name, params, context = {}) {
    // 1. Check static toolRegistry
    const tool = this.toolRegistry.get(name);
    if (tool) return await tool.execute(params, context);

    // 2. Check toolToSkillMap (Individual tools like 'user.kick')
    const skillName = this.toolToSkillMap.get(name);
    if (skillName) {
      return await this.skillRegistry.execute(skillName, name, params, {
        ...context,
        logger,
        mikrotik: this.mikrotik
      });
    }

    // 3. Check SkillRegistry (Direct skill names like 'mikrotik')
    if (this.skillRegistry.skills.has(name)) {
      return await this.skillRegistry.execute(name, params, {
        ...context,
        logger,
        mikrotik: this.mikrotik
      });
    }

    throw new Error(`Unknown tool: ${name}`);
  }

  getConversationHistory(userId) {
    if (!userId) return [];
    return this.conversationContext.get(userId) || [];
  }

  _getPlanPrice(plan) {
    const prices = { '1hour': 0.5, '1day': 2, '1week': 10, '1month': 30 };
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
