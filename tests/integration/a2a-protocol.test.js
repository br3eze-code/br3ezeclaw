const { A2AProtocolAdapter } = require('../../core/plugins/a2a-protocol/a2a-adapter.js');

class Br3ezeTestHarness {
    constructor() {
        this.agents = new Map();
    }

    async start() {}
    async stop() {}

    async createAgent(config) {
        const a2aConfig = config.plugins['@br3eze/a2a-protocol'];
        const spiffeID = a2aConfig.spiffeID || `spiffe://br3eze.test/agent/${config.id}`;
        
        // Setup adapter
        const adapter = new A2AProtocolAdapter({
            spiffeID,
            ...a2aConfig,
            capabilities: Object.entries(config.capabilities || {}).map(([name, cap]) => ({
                name,
                handler: cap.handler
            }))
        });

        // Mock transport to route directly between adapters
        adapter.transport.send = async (message, targetSPIFFE) => {
            const targetAgent = this.agents.get(targetSPIFFE);
            if (!targetAgent) {
                throw new Error(`Target agent ${targetSPIFFE} not found in harness`);
            }
            return await targetAgent.a2a.handleIncomingMessage(message);
        };

        // Initialize adapter
        await adapter.initialize();

        const agent = {
            id: config.id,
            a2a: adapter,
            capabilities: config.capabilities || {}
        };
        
        this.agents.set(spiffeID, agent);
        return agent;
    }
}

describe('A2A Protocol Plugin', () => {
    let harness, agent1, agent2;

    beforeAll(async () => {
        harness = new Br3ezeTestHarness();
        await harness.start();

        agent1 = await harness.createAgent({
            id: 'invoice-agent',
            plugins: {
                '@br3eze/a2a-protocol': {
                    spiffeID: 'spiffe://br3eze.test/agent/invoice-agent',
                    trustedAgents: [{ spiffeID: 'spiffe://br3eze.test/agent/planner-agent' }],
                    mTLS: { enabled: false },
                    modelArmor: { enabled: false }
                }
            },
            capabilities: {
                process_invoice: {
                    handler: async () => ({ total: 100 })
                }
            }
        });

        agent2 = await harness.createAgent({
            id: 'planner-agent',
            plugins: {
                '@br3eze/a2a-protocol': {
                    spiffeID: 'spiffe://br3eze.test/agent/planner-agent',
                    trustedAgents: [{ spiffeID: 'spiffe://br3eze.test/agent/invoice-agent' }],
                    mTLS: { enabled: false },
                    modelArmor: { enabled: false }
                }
            }
        });
    });

    afterAll(async () => {
        await harness.stop();
    });

    test('A2A task request works', async () => {
        const result = await agent2.a2a.sendTask('spiffe://br3eze.test/agent/invoice-agent', {
            capability: 'process_invoice',
            parameters: { pdf_url: 'test.pdf' }
        });
        console.log('Result from sendTask:', result);
        expect(result.total).toBe(100);
    });

    test('Untrusted agent blocked', async () => {
        const evil = await harness.createAgent({
            id: 'evil',
            plugins: { '@br3eze/a2a-protocol': { spiffeID: 'spiffe://br3eze.test/agent/evil', mTLS: { enabled: false }, modelArmor: { enabled: false } } }
        });
        await expect(
            evil.a2a.sendTask('spiffe://br3eze.test/agent/invoice-agent', {
                capability: 'process_invoice',
                parameters: {}
            })
        ).rejects.toThrow('not trusted');
    });
});