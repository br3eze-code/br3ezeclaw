// src/core/AgentOS.js
const EventEmitter = require('events');
const SkillRegistry = require('./SkillRegistry');
const ChannelManager = require('./ChannelManager');
const MemoryManager = require('./MemoryManager');
const LLMCoordinator = require('./LLMCoordinator');
const WorkflowEngine = require('./WorkflowEngine');
const TelemetryCollector = require('./TelemetryCollector');
const HealthMonitor = require('./HealthMonitor');
const CircuitBreaker = require('../utils/CircuitBreaker');

class AgentOS extends EventEmitter {
  constructor(config = {}) {
    super();
    this.id = config.id || crypto.randomUUID();
    this.config = {
      skillsPath: config.skillsPath || './skills',
      memoryAdapter: config.memoryAdapter || 'memory',
      llmProvider: config.llmProvider || 'gemini',
      maxConcurrentSkills: config.maxConcurrentSkills || 10,
      ...config
    };

    // Core components
    this.skills = new SkillRegistry(this.config);
    this.channels = new ChannelManager(this);
    this.memory = new MemoryManager(this.config.memoryAdapter);
    this.llm = new LLMCoordinator(this.config.llmProvider);
    this.workflows = new WorkflowEngine(this);
    this.telemetry = new TelemetryCollector();
    this.health = new HealthMonitor(this);

    // Circuit breakers for external services
    this.breakers = {
      llm: new CircuitBreaker(5, 60000),
      database: new CircuitBreaker(3, 30000)
    };

    this.initialized = false;
    this.shutdownHandlers = [];
  }

  async initialize() {
    if (this.initialized) return;

    try {
      // Initialize memory first (needed by other components)
      await this.memory.initialize();
      
      // Load skills from directory
      await this.skills.loadFromDirectory(this.config.skillsPath);
      
      // Initialize LLM coordinator
      await this.llm.initialize();
      
      // Setup channels
      await this.channels.initialize();
      
      // Start health monitoring
      this.health.start();
      
      // Setup graceful shutdown
      this.setupShutdownHandlers();
      
      this.initialized = true;
      this.emit('initialized');
      
      console.log(`AgentOS ${this.id} initialized with ${this.skills.count()} skills`);
    } catch (error) {
      this.emit('error', error);
      throw error;
    }
  }

  // Main entry point for all interactions
  async processInteraction(input, context = {}) {
    const startTime = Date.now();
    const interactionId = crypto.randomUUID();
    
    try {
      // Validate input
      if (!input || (!input.text && !input.action)) {
        throw new Error('Invalid input: requires text or action');
      }

      // Build execution context
      const execContext = await this.buildContext(input, context, interactionId);
      
      // Determine intent using LLM or direct skill invocation
      let result;
      if (input.action) {
        // Direct skill execution
        result = await this.executeSkill(input.action, input.params, execContext);
      } else {
        // LLM-based intent classification
        const intent = await this.classifyIntent(input.text, execContext);
        result = await this.executeSkill(intent.skill, intent.params, execContext);
      }

      // Store interaction in memory
      await this.memory.storeInteraction(interactionId, {
        input,
        context: execContext,
        result,
        duration: Date.now() - startTime
      });

      // Emit telemetry
      this.telemetry.record('interaction', {
        id: interactionId,
        skill: result.skill,
        duration: Date.now() - startTime,
        success: true
      });

      return {
        id: interactionId,
        success: true,
        result: result.output,
        metadata: {
          skill: result.skill,
          duration: Date.now() - startTime,
          context: execContext.summary
        }
      };

    } catch (error) {
      this.telemetry.record('interaction_error', {
        id: interactionId,
        error: error.message,
        duration: Date.now() - startTime
      });
      
      return {
        id: interactionId,
        success: false,
        error: error.message,
        help: await this.suggestHelp(input, error)
      };
    }
  }

  async classifyIntent(text, context) {
    return this.breakers.llm.execute(async () => {
      const availableSkills = this.skills.getDescriptions();
      
      const prompt = `
Available skills:
${availableSkills.map(s => `- ${s.name}: ${s.description}`).join('\n')}

User context: ${JSON.stringify(context.summary)}
User message: "${text}"

Determine the most appropriate skill and extract parameters.
Respond with JSON: {"skill": "skillName", "params": {}, "confidence": 0.9}
`;

      const response = await this.llm.generate(prompt, {
        temperature: 0.1,
        responseFormat: 'json'
      });

      if (!this.skills.has(response.skill)) {
        throw new Error(`Unknown skill: ${response.skill}`);
      }

      return response;
    });
  }

  async executeSkill(skillName, params, context) {
    const skill = this.skills.get(skillName);
    if (!skill) {
      throw new Error(`Skill '${skillName}' not found`);
    }

    // Check permissions
    if (skill.manifest.permissions) {
      await this.checkPermissions(context.userId, skill.manifest.permissions);
    }

    // Execute with timeout and error handling
    const timeout = skill.manifest.timeout || 30000;
    
    const execution = Promise.race([
      skill.execute(params, context),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Skill execution timeout')), timeout)
      )
    ]);

    const output = await execution;
    
    return {
      skill: skillName,
      output,
      params,
      context: context.summary
    };
  }

  async buildContext(input, context, interactionId) {
    const userMemory = await this.memory.getUserContext(input.userId);
    const session = await this.memory.getSession(input.sessionId);
    
    return {
      id: interactionId,
      agentId: this.id,
      userId: input.userId,
      sessionId: input.sessionId,
      channel: input.channel,
      timestamp: new Date().toISOString(),
      memory: userMemory,
      session: session,
      summary: {
        userId: input.userId,
        previousIntent: userMemory?.lastIntent,
        skillHistory: userMemory?.recentSkills || []
      },
      // Skill execution context
      skills: this.skills,
      memory: this.memory,
      llm: this.llm,
      channels: this.channels
    };
  }

  async checkPermissions(userId, requiredPermissions) {
    const userPerms = await this.memory.getPermissions(userId);
    const missing = requiredPermissions.filter(p => !userPerms.includes(p));
    
    if (missing.length > 0) {
      throw new Error(`Missing permissions: ${missing.join(', ')}`);
    }
  }

  async suggestHelp(input, error) {
    // Use LLM to suggest alternative approaches
    const skills = this.skills.getDescriptions();
    const prompt = `
User tried: "${input.text || input.action}"
Error: ${error.message}

Available skills: ${skills.map(s => s.name).join(', ')}

Suggest what the user might have meant or how to fix the error.
Be concise and helpful.
`;
    
    try {
      return await this.llm.generate(prompt, { maxTokens: 150 });
    } catch {
      return 'Try using /help to see available commands.';
    }
  }

  // Workflow execution
  async executeWorkflow(workflowId, params, context) {
    return this.workflows.execute(workflowId, params, context);
  }

  // Channel management
  async sendMessage(channel, userId, message) {
    return this.channels.send(channel, userId, message);
  }

  async broadcast(message, filter = null) {
    return this.channels.broadcast(message, filter);
  }

  // Lifecycle management
  setupShutdownHandlers() {
    const gracefulShutdown = async (signal) => {
      console.log(`Received ${signal}, shutting down gracefully...`);
      
      for (const handler of this.shutdownHandlers) {
        try {
          await handler();
        } catch (err) {
          console.error('Shutdown handler error:', err);
        }
      }
      
      await this.channels.closeAll();
      await this.memory.close();
      await this.health.stop();
      
      console.log('Shutdown complete');
      process.exit(0);
    };

    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));
    
    this.shutdownHandlers.push(async () => {
      this.emit('shutdown');
    });
  }

  onShutdown(handler) {
    this.shutdownHandlers.push(handler);
  }

  // Health and status
  getStatus() {
    return {
      id: this.id,
      initialized: this.initialized,
      skills: this.skills.count(),
      channels: this.channels.getStatus(),
      memory: this.memory.getStatus(),
      health: this.health.getStatus(),
      uptime: process.uptime()
    };
  }

  async destroy() {
    await this.channels.closeAll();
    await this.memory.close();
    this.removeAllListeners();
  }
}

module.exports = AgentOS;
