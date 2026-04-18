// src/core/agentKernel.js

const crypto = require('node:crypto');
const EventEmitter = require('node:events');
const SessionManager = require('./SessionManager');
const MCPRouter = require('./MCPRouter');

/**
 * AgentKernel - Core orchestrator for AgentOS
 * Manages domains, agents, sessions, and message routing
 */
class AgentKernel {
  constructor(config = {}) {
    super();
    this.domains = new Map();   
    this.agents = new Map();  
    SessionManager(config.session);
    this.mcp = new MCPRouter();
    this.config = config;
    this.initialized = false;
  }
 /**
     * Initialize the kernel and all subsystems
     */
  async initialize() {
        if (this.initialized) {
            return;
        }

        try {
            // Initialize session manager
            await this.sessions.initialize();
            
            // Initialize MCP router
            await this.mcp.initialize();

            this.initialized = true;
            this.emit('initialized');
            console.log('✅ AgentKernel initialized');
        } catch (error) {
            this.emit('error', error);
            throw error;
        }
    }
    /**
     * Register a domain with the kernel
     * @param {string} domainId - Unique domain identifier
     * @param {object} adapter - Domain adapter instance
     */

 registerDomain(domainId, adapter) {
        if (this.domains.has(domainId)) {
            throw new Error(`Domain "${domainId}" is already registered`);
        }

        const domain = {
            id: domainId,
            adapter,
            health: 'unknown',
            capabilities: adapter.getCapabilities ? adapter.getCapabilities() : [],
            registeredAt: new Date().toISOString()
        };

        this.domains.set(domainId, domain);
        this.emit('domain:registered', domain);
        
        console.log(`📦 Domain registered: ${domainId} (${domain.capabilities.length} capabilities)`);
        return domain;
    }

    /**
     * Unregister a domain
     */
    unregisterDomain(domainId) {
        const domain = this.domains.get(domainId);
        if (!domain) {
            throw new Error(`Domain "${domainId}" not found`);
        }

        this.domains.delete(domainId);
        this.emit('domain:unregistered', { id: domainId });
        
        return true;
    }

    /**
     * Get a registered domain
     */
    getDomain(domainId) {
        return this.domains.get(domainId);
    }

    /**
     * List all registered domains
     */
    listDomains() {
        return Array.from(this.domains.values()).map(d => ({
            id: d.id,
            health: d.health,
            capabilities: d.capabilities,
            registeredAt: d.registeredAt
        }));
    }

    /**
     * Spawn a new agent for a specific domain
     */
    async spawnAgent(agentConfig, domainId) {
        const domain = this.domains.get(domainId);
        if (!domain) {
            throw new Error(`Domain "${domainId}" not found`);
        }

        const agentId = crypto.randomUUID();
        const agent = {
            id: agentId,
            domain: domainId,
            config: agentConfig,
            state: 'initializing',
            createdAt: new Date().toISOString(),
            adapter: domain.adapter
        };

        this.agents.set(agentId, agent);
        
        // Create a session for this agent
        const session = await this.sessions.createSession({
            agentId,
            domain: domainId,
            worktree: agentConfig.worktree
        });

        agent.sessionId = session.id;
        agent.state = 'ready';

        this.emit('agent:spawned', agent);
        
        return agent;
    }

    /**
     * Execute a task through an agent
     */
    async dispatch(agentConfig, context) {
        const { intent, domain: domainHint } = context;
        
        // Resolve domain from intent or hint
        const domainId = domainHint || this.resolveDomain(intent);
        
        if (!domainId) {
            throw new Error('Could not resolve domain from intent');
        }

        // Spawn or reuse agent
        const agent = await this.spawnAgent(agentConfig, domainId);

        try {
            // Execute through domain adapter
            const result = await agent.adapter.execute(agent.sessionId, context);
            
            agent.state = 'completed';
            this.emit('agent:completed', { agentId: agent.id, result });
            
            return {
                success: true,
                agentId: agent.id,
                domain: domainId,
                result
            };
        } catch (error) {
            agent.state = 'failed';
            this.emit('agent:failed', { agentId: agent.id, error });
            
            throw error;
        }
    }

    /**
     * Resolve domain from intent string
     */
    resolveDomain(intent) {
        if (!intent) return null;

        const intentLower = intent.toLowerCase();
        
        // Simple keyword matching - can be enhanced with NLP
        const domainMappings = {
            mikrotik: ['mikrotik', 'router', 'hotspot', 'firewall', 'pppoe', 'wireless'],
            linux: ['linux', 'server', 'ssh', 'systemd', 'docker'],
            network: ['network', 'ping', 'traceroute', 'dns', 'dhcp'],
            developer: ['code', 'generate', 'debug', 'refactor', 'develop']
        };

        for (const [domain, keywords] of Object.entries(domainMappings)) {
            if (keywords.some(kw => intentLower.includes(kw))) {
                // Check if domain is registered
                if (this.domains.has(domain)) {
                    return domain;
                }
            }
        }

        // Return first available domain as fallback
        return this.domains.keys().next().value;
    }

    /**
     * Get kernel health status
     */
    getHealth() {
        return {
            initialized: this.initialized,
            domains: this.domains.size,
            agents: this.agents.size,
            sessions: this.sessions.getCount ? this.sessions.getCount() : 0,
            timestamp: new Date().toISOString()
        };
    }

    /**
     * Graceful shutdown
     */
    async shutdown() {
        this.emit('shutdown');
        
        // Clean up agents
        for (const [id, agent] of this.agents) {
            if (agent.sessionId) {
                await this.sessions.destroySession(agent.sessionId);
            }
        }
        
        this.agents.clear();
        this.domains.clear();
        
        this.initialized = false;
        console.log('🛑 AgentKernel shutdown complete');
    }
}

module.exports = AgentKernel;
