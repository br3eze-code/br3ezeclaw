# A2A Protocol Plugin

The A2A Protocol plugin enables Br3eze agents to communicate with Google Gemini Enterprise Agent Platform, CrewAI, LangGraph, AutoGen, and other A2A v1.0 compatible agents using SPIFFE identity and mTLS.

## Quickstart

### 1. Enable the plugin

Add to your agent config `/agents/your-agent/agent.json`:

```json
{
  "id": "invoice-processor",
  "plugins": {
    "@br3eze/a2a-protocol": {
      "spiffeID": "spiffe://br3eze.prod/agent/invoice-processor",
      "trustedAgents": [
        {
          "spiffeID": "spiffe://google.adk/agent/gemini-planner",
          "capabilities": ["plan", "decompose", "research"]
        }
      ],
      "mTLS": { "enabled": true, "certPath": "/spiffe/certs" },
      "modelArmor": { "policyId": "br3eze-a2a-strict" }
    }
  },
  "capabilities": {
    "process_invoice": {
      "description": "Extract line items and validate totals",
      "inputSchema": {
        "required": ["pdf_url"],
        "properties": { "pdf_url": { "type": "string" } }
      },
      "handler": "./handlers/processInvoice.js"
    }
  }
}
