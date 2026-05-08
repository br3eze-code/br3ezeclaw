// src/core/agentKernel.js
class AgentKernel {
  constructor() {
    this.domains = new Map();   
    this.agents = new Map();  
    this.sessions = new SessionManager();
    this.mcp = new MCPRouter(); 
  }

  registerDomain(domainId, adapter) {
    this.domains.set(domainId, {
      adapter,
      health: 'unknown',
      capabilities: adapter.getCapabilities()
    });
  }

  async dispatch(agentConfig, context) {
    const domain = this.resolveDomain(context.intent);
    const agent = await this.spawnAgent(agentConfig, domain);
    return agent.execute(context);
  }
}
