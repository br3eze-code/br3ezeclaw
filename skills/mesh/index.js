// skills/mesh/index.js
// manage_mesh dispatcher — multi-router NodeRegistry operations
// SPEC.md §14 Node Registry

class MeshSkill {
  async execute(params, context) {
    const { action } = params;
    switch (action) {
      case 'nodes.list':     return this.listNodes(context);
      case 'nodes.register': return this.registerNode(params, context);
      case 'nodes.exec':     return this.execOnNode(params, context);
      case 'mesh.exec':      return this.execOnAll(params, context);
      default:
        throw new Error(`Unknown mesh action: ${action}`);
    }
  }

  async listNodes(context) {
    const registry = context.nodeRegistry;
    if (!registry) throw new Error('NodeRegistry not available');
    const nodes = registry.list();
    return { success: true, count: nodes.length, nodes };
  }

  async registerNode({ name, host, port = 8728, user = 'admin', password, role = 'branch' }, context) {
    if (!name || !host || !password) throw new Error('name, host, and password are required');
    const registry = context.nodeRegistry;
    if (!registry) throw new Error('NodeRegistry not available');
    registry.register({ name, host, port, user, password, role });
    return { success: true, registered: name, host, role };
  }

  async execOnNode({ name, tool, params: toolParams = {} }, context) {
    if (!name || !tool) throw new Error('name and tool are required');
    const registry = context.nodeRegistry;
    if (!registry) throw new Error('NodeRegistry not available');
    const node = registry.get(name);
    if (!node) throw new Error(`Node not found: ${name}`);
    const result = await registry.exec(name, tool, toolParams);
    return { success: true, node: name, tool, result };
  }

  async execOnAll({ tool, params: toolParams = {} }, context) {
    if (!tool) throw new Error('tool is required');
    const registry = context.nodeRegistry;
    if (!registry) throw new Error('NodeRegistry not available');
    const nodes   = registry.list();
    const results = await Promise.allSettled(
      nodes.map(n => registry.exec(n.name, tool, toolParams)
        .then(r  => ({ node: n.name, success: true,  result: r }))
        .catch(e => ({ node: n.name, success: false, error:  e.message }))
      )
    );
    const data = results.map(r => r.value || r.reason);
    const ok   = data.filter(r => r.success).length;
    return { success: ok > 0, tool, executed: data.length, succeeded: ok, results: data };
  }

  validate(params) {
    return !!params.action;
  }
}

module.exports = new MeshSkill();
