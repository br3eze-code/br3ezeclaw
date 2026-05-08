// src/ai/universal-coordinator.js
/**
 * Universal AI Coordinator 
 */

const { GoogleGenerativeAI } = require('@google/generative-ai');
const { QNAPProcessor } = require('./qnap-integration');

class UniversalAICoordinator {
  constructor(config = {}) {
    this.genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    this.model = this.genAI.getGenerativeModel({ 
      model: config.model || "gemini-2.5-flash-preview-04-09"
    });
    
    this.qnap = new QNAPProcessor();
    this.registry = config.registry; 
    this.workspaceConfig = config.workspace || {};
    
    // Domain-specific configuration
    this.domain = config.domain || 'generic'; // 'network', 'cloud', 'iot', 'hybrid'
    this.toolSchemas = this.loadToolSchemas();
    this.intentMappings = this.loadIntentMappings();
  }

  loadToolSchemas() {
    // Load schemas based on domain
    const schemas = {
      generic: [
        { name: 'resource.list', description: 'List all managed resources' },
        { name: 'resource.status', description: 'Get resource status' },
        { name: 'resource.execute', description: 'Execute action on resource' }
      ],
      
      network: [
        { name: 'user.add', description: 'Add network user', params: ['username', 'password', 'profile'] },
        { name: 'user.kick', description: 'Disconnect user', params: ['username'] },
        { name: 'ping', description: 'Test connectivity', params: ['host'] },
        { name: 'bandwidth.check', description: 'Check bandwidth usage' },
        { name: 'voucher.create', description: 'Create access voucher', params: ['plan', 'duration'] }
      ],
      
      cloud: [
        { name: 'vm.start', description: 'Start virtual machine', params: ['instanceId'] },
        { name: 'vm.stop', description: 'Stop virtual machine', params: ['instanceId'] },
        { name: 'vm.scale', description: 'Scale VM resources', params: ['instanceId', 'cpu', 'memory'] },
        { name: 'snapshot.create', description: 'Create backup snapshot', params: ['resourceId'] },
        { name: 'cost.analyze', description: 'Analyze resource costs' }
      ],
      
      container: [
        { name: 'container.deploy', description: 'Deploy container', params: ['image', 'ports'] },
        { name: 'container.scale', description: 'Scale service', params: ['service', 'replicas'] },
        { name: 'container.logs', description: 'View logs', params: ['containerId'] },
        { name: 'container.rollback', description: 'Rollback deployment', params: ['service'] }
      ],
      
      iot: [
        { name: 'device.read', description: 'Read sensor data', params: ['deviceId', 'sensor'] },
        { name: 'device.write', description: 'Send command to device', params: ['deviceId', 'command'] },
        { name: 'firmware.update', description: 'Update device firmware', params: ['deviceId'] },
        { name: 'location.track', description: 'Track device location', params: ['deviceId'] }
      ]
    };

    return schemas[this.domain] || schemas.generic;
  }

  loadIntentMappings() {
    // Natural language to action mappings per domain
    const mappings = {
      network: {
        'kick {user}': 'user.kick',
        'disconnect {user}': 'user.kick',
        'create voucher {plan}': 'voucher.create',
        'generate code {plan}': 'voucher.create',
        'check stats': 'system.stats',
        'who is active': 'users.active',
        'reboot router': 'system.reboot',
        'block {ip}': 'firewall.block'
      },
      
      cloud: {
        'start {instance}': 'vm.start',
        'stop {instance}': 'vm.stop',
        'restart server {instance}': 'vm.reboot',
        'create backup {resource}': 'snapshot.create',
        'scale up {instance}': 'vm.scale',
        'how much are we spending': 'cost.analyze'
      },
      
      container: {
        'deploy {image}': 'container.deploy',
        'scale {service} to {count}': 'container.scale',
        'show logs {container}': 'container.logs',
        'rollback {service}': 'container.rollback',
        'restart container {container}': 'container.restart'
      }
    };

    return mappings[this.domain] || {};
  }

  async processQuery(text, context = {}) {
    // 1. Try pattern matching first (fast path)
    const patternMatch = this.matchPattern(text);
    if (patternMatch.confidence > 0.9) {
      return await this.executeAction(patternMatch.action, patternMatch.params, context);
    }

    // 2. Use Q-NAP for intent classification
    const intent = await this.qnap.classifyIntent(text);
    
    // 3. Use Gemini for complex reasoning
    const systemPrompt = this.buildSystemPrompt();
    const chat = this.model.startChat({
      systemInstruction: systemPrompt
    });

    const result = await chat.sendMessage(text);
    const response = result.response.text();

    // Parse tool calls
    const toolCall = this.parseToolCall(response);
    if (toolCall) {
      return await this.executeAction(toolCall.name, toolCall.params, context);
    }

    return { 
      response,
      suggestions: this.getSuggestions()
    };
  }

  buildSystemPrompt() {
    const capabilities = this.toolSchemas.map(t => 
      `- ${t.name}: ${t.description} (${t.params ? 'Params: ' + t.params.join(', ') : 'No params'})`
    ).join('\n');

    return `You are AgentOS, an AI infrastructure coordinator operating in ${this.domain} mode.
You manage resources across multiple infrastructure providers.

Available capabilities:
${capabilities}

When a user makes a request:
1. Identify the target resource type and action
2. Ask for clarification if parameters are missing
3. For destructive actions (delete, reboot), always ask for confirmation
4. Respond with structured JSON when executing actions: {"tool": "name", "params": {...}}

Current domain: ${this.domain}
Available resources: ${this.registry ? this.registry.listAdapters().join(', ') : 'none connected'}`;
  }

  matchPattern(text) {
    // Simple pattern matching for common commands
    for (const [pattern, action] of Object.entries(this.intentMappings)) {
      const regex = new RegExp('^' + pattern.replace(/{(\w+)}/g, '(\\w+)') + '$', 'i');
      const match = text.match(regex);
      if (match) {
        const params = {};
        const keys = pattern.match(/{(\w+)}/g) || [];
        keys.forEach((key, index) => {
          const paramName = key.replace(/[{}]/g, '');
          params[paramName] = match[index + 1];
        });
        return { action, params, confidence: 0.95 };
      }
    }
    return { confidence: 0 };
  }

  async executeAction(action, params, context) {
    // Find resources that support this action
    const capableResources = this.registry.findByCapability(action.split('.')[0]);
    
    if (capableResources.length === 0) {
      return { error: `No resources available for action: ${action}` };
    }

    // If multiple resources, use context or ask
    let targetResource = capableResources[0];
    if (capableResources.length > 1 && params.resource) {
      targetResource = capableResources.find(r => r.name === params.resource) || targetResource;
    }

    // Execute via plugin registry
    try {
      const result = await this.registry.execute(targetResource.id, action, params);
      
      // Fraud/Policy check for sensitive operations
      if (this.isSensitiveAction(action)) {
        const riskCheck = await this.qnap.analyzeTransaction({
          userId: context.userId,
          action,
          target: targetResource.id,
          timestamp: Date.now()
        });
        
        if (riskCheck.riskScore > 0.8) {
          return { 
            error: 'Action blocked by security policy',
            reason: 'High risk score detected',
            riskScore: riskCheck.riskScore
          };
        }
      }

      return {
        success: true,
        action,
        resource: targetResource.name,
        result,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      return {
        error: true,
        message: error.message,
        action,
        resource: targetResource.name
      };
    }
  }

  isSensitiveAction(action) {
    const sensitive = ['delete', 'terminate', 'reboot', 'stop', 'block', 'kick'];
    return sensitive.some(s => action.includes(s));
  }

  parseToolCall(response) {
    try {
      const jsonMatch = response.match(/```json\s*(\{[\s\S]*?\})\s*```/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[1]);
      }
      // Try inline JSON
      const inline = response.match(/\{[\s\S]*?"tool"[\s\S]*?\}/);
      if (inline) return JSON.parse(inline[0]);
    } catch (e) {
      return null;
    }
  }

  getSuggestions() {
    const suggestions = {
      network: ['List active users', 'Create voucher', 'Check system stats', 'Reboot router'],
      cloud: ['List instances', 'Check costs', 'Create snapshot', 'Scale service'],
      container: ['List containers', 'View logs', 'Deploy service', 'Scale deployment'],
      iot: ['List devices', 'Read sensors', 'Update firmware', 'Track location']
    };
    return suggestions[this.domain] || ['List resources', 'Check status'];
  }

  // Switch domain dynamically
  setDomain(domain) {
    this.domain = domain;
    this.toolSchemas = this.loadToolSchemas();
    this.intentMappings = this.loadIntentMappings();
    console.log(`🔄 Switched to ${domain} domain`);
  }
}

module.exports = UniversalAICoordinator;
