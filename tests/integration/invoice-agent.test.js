const { A2AProtocolAdapter } = require('../../core/plugins/a2a-protocol/a2a-adapter.js');

jest.mock('../../agents/invoice-agent/lib/pdf-extractor.js', () => ({
    extractPDF: jest.fn().mockResolvedValue({
        text: 'Invoice Number: INV-123\nDate: 2026-04-26\nTotal: $1,200.00',
        pages: 1,
        method: 'mock'
    }),
    parseInvoiceFields: jest.requireActual('../../agents/invoice-agent/lib/pdf-extractor.js').parseInvoiceFields
}));

const processInvoice = require('../../agents/invoice-agent/handlers/processInvoice.js');

class Br3ezeTestHarness {
    constructor() {
        this.agents = new Map();
    }

    async start() {}
    async stop() {
        for (const agent of this.agents.values()) {
            if (agent.a2a && typeof agent.a2a.stop === 'function') {
                agent.a2a.stop();
            }
        }
    }

    async createAgent(config) {
        const a2aConfig = config.plugins['@br3eze/a2a-protocol'];
        const spiffeID = a2aConfig.spiffeID || `spiffe://br3eze.test/agent/${config.id}`;
        
        const adapter = new A2AProtocolAdapter({
            spiffeID,
            ...a2aConfig,
            capabilities: Object.entries(config.capabilities || {}).map(([name, cap]) => ({
                name,
                handler: cap.handler
            }))
        });

        adapter.transport.send = async (message, targetSPIFFE) => {
            const targetAgent = this.agents.get(targetSPIFFE);
            if (!targetAgent) {
                throw new Error(`Target agent ${targetSPIFFE} not found in harness`);
            }
            return await targetAgent.a2a.handleIncomingMessage(message);
        };

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

describe('Invoice Agent E2E', () => {
    let harness, invoiceAgent, plannerAgent, clientAgent;

    beforeAll(async () => {
        harness = new Br3ezeTestHarness();
        await harness.start();

        // The mock Gemini Planner
        plannerAgent = await harness.createAgent({
            id: 'gemini-planner',
            plugins: {
                '@br3eze/a2a-protocol': {
                    spiffeID: 'spiffe://google.adk/agent/gemini-planner',
                    trustedAgents: [{ spiffeID: 'spiffe://br3eze.test/agent/invoice-agent' }],
                    mTLS: { enabled: false },
                    modelArmor: { enabled: false }
                }
            },
            capabilities: {
                plan: {
                    handler: async (params) => {
                        return {
                            plan: 'Validation successful',
                            validated_fields: params.data.fields,
                            status: 'APPROVED'
                        };
                    }
                }
            }
        });

        // The Invoice Agent
        invoiceAgent = await harness.createAgent({
            id: 'invoice-agent',
            plugins: {
                '@br3eze/a2a-protocol': {
                    spiffeID: 'spiffe://br3eze.test/agent/invoice-agent',
                    trustedAgents: [
                        { spiffeID: 'spiffe://br3eze.test/agent/client' },
                        { spiffeID: 'spiffe://google.adk/agent/gemini-planner' }
                    ],
                    mTLS: { enabled: false },
                    modelArmor: { enabled: false }
                }
            },
            capabilities: {
                process_invoice: {
                    handler: processInvoice
                }
            }
        });

        // The Client sending the request
        clientAgent = await harness.createAgent({
            id: 'client',
            plugins: {
                '@br3eze/a2a-protocol': {
                    spiffeID: 'spiffe://br3eze.test/agent/client',
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

    test('Full invoice processing pipeline', async () => {
        try {
            const result = await clientAgent.a2a.sendTask('spiffe://br3eze.test/agent/invoice-agent', {
                capability: 'process_invoice',
                parameters: { pdf_url: 'dummy.pdf' }
            });
            console.log('Result:', result);

            expect(result).toBeDefined();
            expect(result.source).toBe('dummy.pdf');
            expect(result.fields).toBeDefined();
            
            // Should have delegated to planner
            expect(result.plan).toBeDefined();
            expect(result.plan.status).toBe('APPROVED');
        } finally {
            // cleanup if needed
        }
    });
});
