'use strict';
/**
 * askAI handler — routes a natural language query to Gemini Enterprise
 *
 * Capability: ask_ai
 * Injected args: (parameters, session, senderSPIFFE, a2aAdapter)
 */

const { AIOrchestrator } = require('../../../src/core/ai-orchestrator');

// Singleton orchestrator — initialized once per process
let _orchestrator = null;
async function getOrchestrator(a2aAdapter) {
    if (!_orchestrator) {
        _orchestrator = new AIOrchestrator({
            // Vertex AI (enterprise) — picked up from env
            project:  process.env.GOOGLE_CLOUD_PROJECT,
            location: process.env.GEMINI_LOCATION || 'us-central1',
            model:    process.env.GEMINI_MODEL    || 'gemini-2.0-flash-001',
            // Fallback
            apiKey:   process.env.GEMINI_API_KEY,
            // Wire the A2A adapter so Gemini can delegate to sub-agents
            a2aAdapter,
            agentRoutes: [
                {
                    intent:     'process_invoice',
                    spiffeID:   'spiffe://br3eze.prod/agent/invoice-processor',
                    capability: 'process_invoice'
                },
                {
                    intent:     'query_network',
                    spiffeID:   'spiffe://br3eze.prod/agent/network-agent',
                    capability: 'mikrotik.getActiveUsers'
                }
            ]
        });
        await _orchestrator.initialize();
    }
    return _orchestrator;
}

/**
 * @param {{ query: string, context?: object }} parameters
 * @param {object}  session      - A2A session
 * @param {string}  senderSPIFFE
 * @param {object}  a2aAdapter   - A2AProtocolAdapter instance
 */
module.exports = async function askAI(parameters, session, senderSPIFFE, a2aAdapter) {
    const { query, context = {} } = parameters;

    if (!query || typeof query !== 'string') {
        throw new Error('Parameter "query" is required and must be a string');
    }

    const orchestrator = await getOrchestrator(a2aAdapter);

    const result = await orchestrator.generate(query, {
        sessionId: session.id,
        context: {
            ...context,
            senderAgent: senderSPIFFE,
            sessionTrace: session.traceId
        },
        // Expose agent capabilities as Gemini tools for function calling
        tools: [
            {
                name:        'process_invoice',
                description: 'Extract and validate an invoice PDF, then create a payment plan',
                parameters: {
                    type: 'object',
                    properties: {
                        pdf_url:      { type: 'string', description: 'URL or GCS path to the invoice PDF' },
                        jurisdiction: { type: 'string', description: 'Tax jurisdiction (optional)' }
                    },
                    required: ['pdf_url']
                }
            },
            {
                name:        'query_network',
                description: 'Get active users or MikroTik network statistics',
                parameters: {
                    type: 'object',
                    properties: {
                        query_type: {
                            type: 'string',
                            enum: ['active_users', 'stats', 'interfaces', 'dhcp']
                        }
                    },
                    required: ['query_type']
                }
            }
        ]
    });

    return {
        answer:              result.text,
        functionCallResults: result.functionCallResults || [],
        tokensUsed:          result.usage?.totalTokenCount || null,
        model:               process.env.GEMINI_MODEL || 'gemini-2.0-flash-001',
        sessionId:           session.id
    };
};
