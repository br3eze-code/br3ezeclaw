const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const EventEmitter = require('events');
const SkillRegistry = require('./SkillRegistry');
const ChannelManager = require('./channels/ChannelManager');
const MemoryManager = require('./memory/MemoryManager');
const LLMCoordinator = require('./llm/LLMCoordinator');
const WorkflowEngine = require('./WorkflowEngine');
const TelemetryCollector = require('./TelemetryCollector');
const HealthMonitor = require('./HealthMonitor');
const AgentOSOrchestrator = require('./orchestrator');
const CircuitBreaker = require('../utils/CircuitBreaker');
const { logger } = require('./logger');
const MastercardA2AService = require('../../services/mastercardA2A');

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

    // Legacy manager aliases for compatibility with ss35b patterns
    this.mikrotik = config?.mikrotik || require('./mikrotik').getManager();
    this.database = require('./database').getDatabase();
    this.mastercard = new MastercardA2AService();
    this.financial = new (require('./financial'))({ database: this.database, mastercard: this.mastercard });
    this.billing = new (require('./universal-billing'))({ database: this.database });
    this.discovery = new (require('./discovery'))({ mikrotik: this.mikrotik });
    this.orchestrator = new AgentOSOrchestrator(this.mikrotik, this.database, this.channels, this);

    // Circuit breakers for external services
    this.breakers = {
      llm: new CircuitBreaker(5, 60000),
      database: new CircuitBreaker(3, 30000)
    };

    this.initialized = false;
    this.shutdownHandlers = [];
    this._alertState = new Map();
    this._signalHandlers = {}; // track for removal on destroy
  }

  // Logging aliases for legacy compatibility
  log(msg, meta) { logger.info(msg, meta); }
  info(msg, meta) { logger.info(msg, meta); }
  warn(msg, meta) { logger.warn(msg, meta); }
  error(msg, meta) { logger.error(msg, meta); }

  async initialize() {
    if (this.initialized) return;

    // ── Global Instance Lock ──────────────────────────────────────────────────
    const { STATE_PATH } = require('./config');
    const lockFile = path.join(STATE_PATH, '.agentos.lock');

    try {
        if (fs.existsSync(lockFile)) {
            const pid = parseInt(fs.readFileSync(lockFile, 'utf8').trim());
            if (pid === process.pid) {
                logger.debug('AgentOS: Already hold global lock, proceeding');
            } else {
                try {
                    process.kill(pid, 0); // Check if process alive
                    const msg = `FATAL: AgentOS already running in PID ${pid}. Use 'agentos gateway:stop' first.`;
                    logger.error(msg);
                    throw new Error(msg);
                } catch (e) {
                    if (e.code === 'EPERM') throw new Error(`Access denied to process ${pid}`);
                    // Stale lock
                    logger.info(`Cleaning up stale lock for PID ${pid}`);
                    fs.unlinkSync(lockFile);
                }
            }
        }
        fs.writeFileSync(lockFile, process.pid.toString());
        this.onShutdown(() => {
            try { if (fs.existsSync(lockFile)) fs.unlinkSync(lockFile); } catch (_) {}
        });
    } catch (err) {
        if (err.message.includes('FATAL')) throw err;
        logger.warn(`Lock check failed: ${err.message}`);
    }

    try {
      // Ensure database is ready first as other components depend on it
      logger.info('AgentOS: Initializing Database...');
      if (this.database && typeof this.database.initialize === 'function') {
        await this.database.initialize();
      }

      // Initialize memory (needed by other components)
      logger.info('AgentOS: Initializing Memory...');
      await this.memory.initialize();

      // Load skills from directory
      logger.info(`AgentOS: Loading skills from ${this.config.skillsPath}...`);
      await this.skills.loadFromDirectory(this.config.skillsPath);

      // Initialize LLM coordinator
      logger.info('AgentOS: Initializing LLM...');
      await this.llm.initialize();

      // Setup channels
      logger.info('AgentOS: Initializing Channels...');
      await this.channels.initialize();

      // Start health monitoring
      this.health.start();

      // Setup graceful shutdown
      this.setupShutdownHandlers();

      // Start system orchestrator for background tasks
      logger.info('AgentOS: Starting Orchestrator...');
      this.orchestrator.start();

      this.health.on('healthCheck', (status) => {
        if (status.status === 'degraded') {
          const errs = status.checks.filter(c => c.status !== 'healthy').map(c => c.name).join(', ');
          this.alertOnce(`health-degraded-${errs}`, `⚠️ *System Degraded:*\nFailing checks: ${errs}`);
        }
      });

      this.initialized = true;
      this.emit('initialized');

      logger.info(`AgentOS ${this.id} initialized with ${this.skills.count()} skills`);
    } catch (error) {
      logger.error(`AgentOS initialization failed: ${error.message}`);
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

  async executeSkill(skillName, params, context = {}) {
    // Support for dot-notation tool calls (e.g. 'skill.tool')
    if (skillName && skillName.includes('.')) {
      const output = await this.skills.executeTool(skillName, params, context);
      return {
        skill: skillName.split('.')[0],
        tool: skillName.split('.')[1],
        output,
        params,
        context: context.summary || {}
      };
    }

    const skill = this.skills.get(skillName);
    if (!skill) {
      throw new Error(`Skill '${skillName}' not found`);
    }

    // Check permissions
    if (skill.manifest && skill.manifest.permissions) {
      await this.checkPermissions(context.userId, skill.manifest.permissions);
    }

    // Execute with timeout and error handling
    const timeout = (skill.manifest && skill.manifest.timeout) || 30000;

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
      context: context.summary || {}
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

  async executeTool(toolName, params, context) {
  return this.skills.executeTool(toolName, params, context);
}

  // Channel management
  async sendMessage(channel, userId, message) {
  return this.channels.send(channel, userId, message);
}

  async broadcast(message, filter = null) {
  return this.channels.broadcast(message, filter);
}

  async sendToAll(message) {
  const tg = this.channels.channels.get('telegram');
  if (tg && typeof tg.sendToAll === 'function') {
    return tg.sendToAll(message);
  }
  return this.broadcast(message);
}

  async alertOnce(alertKey, message) {
  const lastSent = this._alertState.get(alertKey);
  const now = Date.now();
  if (!lastSent || now - lastSent > 2 * 60 * 60 * 1000) {
    this._alertState.set(alertKey, now);
    return this.sendToAll(message);
  }
  return { success: true, skipped: true };
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
    if (this.orchestrator) this.orchestrator.stop();

    console.log('Shutdown complete');
    process.exit(0);
  };

  // Store references so we can remove them in destroy()
  this._signalHandlers.SIGTERM = () => gracefulShutdown('SIGTERM');
  this._signalHandlers.SIGINT  = () => gracefulShutdown('SIGINT');
  process.on('SIGTERM', this._signalHandlers.SIGTERM);
  process.on('SIGINT',  this._signalHandlers.SIGINT);

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
    if (!this.initialized && !this.orchestrator) return;
    
    logger.info(`AgentOS ${this.id}: shutting down...`);

    // Remove process signal listeners to prevent open-handle leaks in tests
    if (this._signalHandlers.SIGTERM) {
      process.removeListener('SIGTERM', this._signalHandlers.SIGTERM);
      this._signalHandlers.SIGTERM = null;
    }
    if (this._signalHandlers.SIGINT) {
      process.removeListener('SIGINT', this._signalHandlers.SIGINT);
      this._signalHandlers.SIGINT = null;
    }

    // Stop background tasks first
    if (this.orchestrator) {
      try {
        this.orchestrator.stop();
      } catch (err) {
        logger.warn(`Orchestrator stop error: ${err.message}`);
      }
    }

    try {
      if (this.billing && typeof this.billing.stopReaper === 'function') {
        this.billing.stopReaper();
      }
      // Stop telemetry timer
      if (this.telemetry && typeof this.telemetry.stop === 'function') {
        this.telemetry.stop();
      }
      await this.health.stop();
      await this.channels.closeAll();
      await this.memory.close();

      // Cleanup MikroTik connection
      if (this.mikrotik && typeof this.mikrotik.destroy === 'function') {
        this.mikrotik.destroy();
      }

      // Close database last
      if (this.database && typeof this.database.close === 'function') {
        await this.database.close();
      }
    } catch (err) {
      logger.error(`Error during AgentOS destruction: ${err.message}`);
    }

    this.removeAllListeners();
    this.initialized = false;
    logger.info(`AgentOS ${this.id}: shutdown complete`);
  }
}

module.exports = AgentOS;

module.exports.AgentOSBot = AgentOS;
