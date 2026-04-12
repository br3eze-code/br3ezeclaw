// src/dashboard/missionControl.js
class MissionControl {
  constructor(kernel) {
    this.kernel = kernel;
    this.snapshot = null;
  }

  // Real-time topology canvas
  async getTopology() {
    return {
      domains: Array.from(this.kernel.domains.entries()).map(([id, d]) => ({
        id,
        type: d.adapter.constructor.name,
        status: d.health,
        agents: d.adapter.getActiveAgents(),
        // Visual positioning for canvas
        position: this.layoutEngine.getPosition(id)
      })),
      connections: this.discoverConnections()
    };
  }

  // Workspace-centric organization
  getWorkspaces() {
    return this.kernel.sessions.getAll().map(s => ({
      id: s.id,
      domain: s.domainId,
      agents: s.agents,
      artifacts: s.artifacts,
      // Router-specific: network topology, vouchers, users
      // Cloud-specific: resources, costs, deployments
      context: s.domainContext
    }));
  }
}
