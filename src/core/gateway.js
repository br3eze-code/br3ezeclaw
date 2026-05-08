/**
 * @deprecated This file is STALE — use `gateway-engine.js` instead.
 *
 * The active gateway is `src/core/gateway-engine.js` which is what
 * `agentos gateway` (CLI) and all tests reference.
 *
 * This file is kept to avoid breaking any legacy imports, but it is NOT
 * started by the CLI and receives no updates.
 *
 * @see src/core/gateway-engine.js
 */

const EventEmitter = require('events');
const express = require('express');
const { WebSocketServer } = require('ws');
const helmet = require('helmet');
const path = require('path');
const fs = require('fs').promises;

const { AgentRuntime } = require('./agent-runtime');
const { ToolRegistry } = require('./tool-registry');
const { SessionManager } = require('./session-manager');
const { MemoryStore } = require('./memory-store');
const { ProviderManager } = require('./provider-manager');
const { SafetyEnvelope } = require('./safety-envelope');
const { Heartbeat } = require('./heartbeat');
const { Logger } = require('../utils/logger');

class Gateway extends EventEmitter {
  constructor(options = {}) {
    super();

    this.options = {
      port: options.port || process.env.GATEWAY_PORT || 3000,
      host: options.host || process.env.GATEWAY_HOST || '0.0.0.0',
      heartbeatInterval: options.heartbeatInterval || parseInt(process.env.HEARTBEAT_INTERVAL) || 1800000,
      skillsPath: options.skillsPath || process.env.SKILLS_PATH || path.join(process.cwd(), 'src/skills'),
      memoryPath: options.memoryPath || process.env.MEMORY_BASE_PATH || path.join(process.cwd(), 'data/sessions'),
      sessionMode: options.sessionMode || process.env.SESSION_MODE || 'isolated',
      ...options
    };

    this.logger = new Logger('Gateway');
    this.app = null;
    this.wss = null;
    this.server = null;

    // Core components
    this.toolRegistry = new ToolRegistry({ skillsPath: this.options.skillsPath });
    this.sessionManager = new SessionManager({
      basePath: this.options.memoryPath,
      mode: this.options.sessionMode
    });
    this.memoryStore = new MemoryStore({ basePath: this.options.memoryPath });
    this.providerManager = new ProviderManager();
    this.safetyEnvelope = new SafetyEnvelope();

    // Agent runtime orchestrates everything
    this.agentRuntime = new AgentRuntime({
      toolRegistry: this.toolRegistry,
      sessionManager: this.sessionManager,
      memoryStore: this.memoryStore,
      providerManager: this.providerManager,
      safetyEnvelope: this.safetyEnvelope
    });

    // Heartbeat for autonomous operation
    this.heartbeat = new Heartbeat({
      interval: this.options.heartbeatInterval,
      agentRuntime: this.agentRuntime
    });

    // Channel adapters
    this.channels = new Map();
    this.clients = new Map();
  }

  async initialize() {
    this.logger.info('Initializing OpenClaw Gateway...');

    // Load all skills
    await this.toolRegistry.loadSkills();

    // Initialize session manager
    await this.sessionManager.initialize();

    // Setup Express app
    this.app = express();
    this.app.use(helmet());
    this.app.use(express.json());

    // Health check endpoint
    this.app.get('/health', (req, res) => {
      res.json({
        status: 'healthy',
        version: '2.0.0',
        skills: this.toolRegistry.getSkillNames(),
        providers: this.providerManager.getAvailableProviders(),
        channels: Array.from(this.channels.keys()),
        uptime: process.uptime()
      });
    });

    // Capability manifest endpoint (OpenClaw standard)
    this.app.get('/manifest', (req, res) => {
      res.json(this.toolRegistry.getManifest());
    });

    // Execute endpoint (REST API)
    this.app.post('/execute', async (req, res) => {
      try {
        const result = await this.handleFrame({
          sender: req.body.sender || 'rest-api',
          channel: 'rest',
          content: req.body.input,
          metadata: req.body.metadata || {}
        });
        res.json(result);
      } catch (error) {
        this.logger.error('Execute error:', error);
        res.status(500).json({ error: error.message });
      }
    });

    // Start HTTP server
    this.server = this.app.listen(this.options.port, this.options.host, () => {
      this.logger.info(`Gateway listening on ${this.options.host}:${this.options.port}`);
    });

    // Setup WebSocket server
    this.wss = new WebSocketServer({ server: this.server });
    this.wss.on('connection', (ws, req) => this.handleWebSocket(ws, req));

    // Start heartbeat
    this.heartbeat.start();

    this.emit('ready');
    return this;
  }

  /**
   * Register a channel adapter
   */
  registerChannel(name, adapter) {
    this.channels.set(name, adapter);
    adapter.on('message', (frame) => this.handleFrame(frame));
    adapter.on('error', (error) => this.logger.error(`Channel ${name} error:`, error));
    this.logger.info(`Registered channel: ${name}`);
  }

  /**
   * Handle incoming message frame from any channel
   */
  async handleFrame(frame) {
    try {
      this.logger.debug(`Frame from ${frame.channel}/${frame.sender}: ${frame.content}`);

      // Normalize frame
      const normalized = this.normalizeFrame(frame);

      // Check rate limits
      if (!this.safetyEnvelope.checkRateLimit(normalized.sender)) {
        return { error: 'Rate limit exceeded. Please slow down.' };
      }

      // Execute through agent runtime
      const result = await this.agentRuntime.execute(normalized);

      // Send response back through originating channel
      await this.sendResponse(frame, result);

      return result;
    } catch (error) {
      this.logger.error('Frame handling error:', error);
      const errorResponse = { error: error.message, type: 'execution_error' };
      await this.sendResponse(frame, errorResponse);
      return errorResponse;
    }
  }

  /**
   * Normalize frame from any channel to canonical format
   */
  normalizeFrame(frame) {
    return {
      id: frame.id || this.generateId(),
      sender: frame.sender,
      senderName: frame.senderName || frame.sender,
      channel: frame.channel,
      content: frame.content,
      timestamp: frame.timestamp || Date.now(),
      isDM: frame.isDM !== undefined ? frame.isDM : true,
      metadata: frame.metadata || {},
      agentId: frame.agentId || 'default'
    };
  }

  /**
   * Send response back through appropriate channel
   */
  async sendResponse(originalFrame, result) {
    const channel = this.channels.get(originalFrame.channel);
    if (channel && channel.send) {
      await channel.send(originalFrame.sender, result);
    }
  }

  /**
   * Handle WebSocket connections
   */
  handleWebSocket(ws, req) {
    const clientId = this.generateId();
    this.clients.set(clientId, ws);

    this.logger.info(`WebSocket client connected: ${clientId}`);

    ws.on('message', async (data) => {
      try {
        const message = JSON.parse(data);
        const result = await this.handleFrame({
          id: message.id,
          sender: clientId,
          channel: 'websocket',
          content: message.content,
          metadata: message.metadata || {}
        });
        ws.send(JSON.stringify(result));
      } catch (error) {
        ws.send(JSON.stringify({ error: error.message }));
      }
    });

    ws.on('close', () => {
      this.clients.delete(clientId);
      this.logger.info(`WebSocket client disconnected: ${clientId}`);
    });

    ws.on('error', (error) => {
      this.logger.error(`WebSocket error for ${clientId}:`, error);
    });

    // Send welcome message
    ws.send(JSON.stringify({
      type: 'connected',
      clientId,
      message: 'Connected to AgentOS OpenClaw Gateway'
    }));
  }

  /**
   * Execute tool directly (for CLI commands)
   */
  async executeTool(toolName, params, options = {}) {
    return await this.agentRuntime.executeTool(toolName, params, options);
  }

  /**
   * Get system status
   */
  async getStatus() {
    return {
      gateway: {
        running: this.server !== null,
        port: this.options.port,
        connections: this.clients.size
      },
      skills: {
        loaded: this.toolRegistry.getSkillNames(),
        toolCount: this.toolRegistry.getToolCount()
      },
      providers: this.providerManager.getAvailableProviders(),
      channels: Array.from(this.channels.keys()),
      sessions: await this.sessionManager.getStats(),
      uptime: process.uptime()
    };
  }

  async printStatus() {
    const status = await this.getStatus();
    console.log('\\n🤖 AgentOS Status');
    console.log('═══════════════════════════════════════');
    console.log(`Gateway: ${status.gateway.running ? '🟢 Running' : '🔴 Stopped'}`);
    console.log(`Port: ${status.gateway.port}`);
    console.log(`WebSocket Clients: ${status.gateway.connections}`);
    console.log(`\\n📦 Skills Loaded: ${status.skills.loaded.join(', ')}`);
    console.log(`🔧 Total Tools: ${status.skills.toolCount}`);
    console.log(`\\n🤖 AI Providers: ${status.providers.join(', ')}`);
    console.log(`📡 Channels: ${status.channels.join(', ')}`);
    console.log(`\\n⏱️  Uptime: ${Math.floor(status.uptime / 60)}m ${Math.floor(status.uptime % 60)}s`);
    console.log('═══════════════════════════════════════\\n');
  }

  generateId() {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  async stop() {
    this.logger.info('Stopping Gateway...');

    this.heartbeat.stop();

    for (const [name, channel] of this.channels) {
      if (channel.stop) await channel.stop();
    }

    if (this.wss) {
      this.wss.close();
    }

    if (this.server) {
      this.server.close();
    }

    this.emit('stopped');
  }
}

module.exports = { Gateway };

/**
 * startGateway — convenience wrapper used by the CLI command.
 * Initialises a Gateway instance and returns it ready (listening).
 */
async function startGateway(config = {}) {
  const gw = new Gateway(config);
  await gw.initialize();
  return gw;
}

module.exports = { Gateway, startGateway };
