const { A2AProtocolAdapter } = require('./a2a-adapter');
const { EventEmitter } = require('events');

class A2APlugin extends EventEmitter {
    constructor() {
        super();
        this.adapters = new Map(); // agentId -> adapter
    }

    async onBootstrap(ctx) {
        ctx.logger.info(' Plugin loaded');
        this.ctx = ctx;
    }

    async onAgentInit(ctx, agent) {
        const pluginConfig = agent.config.plugins?.['@br3eze/a2a-protocol'];
        if (!pluginConfig) return;

        const spiffeID = pluginConfig.spiffeID || `spiffe://br3eze.local/agent/${agent.id}`;

        const adapter = new A2AProtocolAdapter({
            spiffeID,
            trustedAgents: pluginConfig.trustedAgents || [],
            mTLS: {
                enabled: pluginConfig.mTLS?.enabled ?? true,
                certPath: pluginConfig.mTLS?.certPath || '/spiffe/certs'
            },
            modelArmor: pluginConfig.modelArmor || {},
            rateLimiting: pluginConfig.rateLimiting || {},
            sessionTTL: 3600000,
            protocolVersion: '1.0'
        });

        // Register all existing agent capabilities
        for (const [name, cap] of agent.capabilities.entries()) {
            adapter.registerCapability(name, {
                description: cap.description,
                inputSchema: cap.inputSchema,
                version: cap.version || '1.0'
            }, cap.handler, cap.streamingHandler);
        }

        // Register transport endpoints for all trusted agents
        // agent.json trustedAgents entries can include an optional `endpoint` field
        for (const ta of (pluginConfig.trustedAgents || [])) {
            if (ta.endpoint) {
                adapter.transport.registerEndpoint(ta.spiffeID, ta.endpoint);
            }
        }

        adapter.on('task:sent', (e) => ctx.metrics.increment('a2a.task.sent', e));
        adapter.on('task:complete', (e) => ctx.metrics.histogram('a2a.task.duration', e.duration));
        adapter.on('task:error', (e) => ctx.metrics.increment('a2a.task.error'));

        await adapter.initialize();
        this.adapters.set(agent.id, adapter);
        agent.a2a = adapter;

        ctx.logger.info(` Initialized for agent ${agent.id} as ${spiffeID}`);
    }

    async onRegisterRoutes(ctx, router) {
        // Br3eze gateway hook - register /a2a endpoint
        router.post('/a2a/:agentId', async (req, res) => {
            try {
                const adapter = this.adapters.get(req.params.agentId);
                if (!adapter) {
                    return res.status(404).json({
                        type: 'ERROR',
                        error: { code: 'NOT_FOUND', message: `Agent ${req.params.agentId} not found or A2A not enabled` }
                    });
                }
                const response = await adapter.handleIncomingMessage(req.body);
                res.json(response);
            } catch (error) {
                this.ctx.logger.error(' Route error:', error);
                res.status(500).json({
                    type: 'ERROR',
                    error: { code: 'INTERNAL', message: error.message }
                });
            }
        });

        ctx.logger.info(' Registered route POST /a2a/:agentId');
    }

    async onCapabilityRegister(ctx, agent, name, def) {
        const adapter = this.adapters.get(agent.id);
        if (adapter) {
            adapter.registerCapability(name, def, agent.capabilities.get(name).handler, agent.capabilities.get(name).streamingHandler);
        }
    }
}

module.exports = new A2APlugin();
