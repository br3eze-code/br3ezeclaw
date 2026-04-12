// src/core/tool-registry.js
class ToolRegistry {
  constructor() {
    this.tools = new Map();
    this.manifest = null;
  }
  
  // Register domain-agnostic tools
  register(name, schema, handler) {
    this.tools.set(name, {
      schema: {
        name,
        description: schema.description,
        parameters: schema.parameters,
        returns: schema.returns
      },
      handler
    });
    this.rebuildManifest();
  }
  
  registerMikroTikSkill() {
    this.register('mikrotik.user.kick', {
      description: 'Disconnect a user from hotspot',
      parameters: { user: 'string' },
      returns: 'boolean'
    }, this.mikrotikHandlers.kick);
    
    this.register('mikrotik.system.reboot', {
      description: 'Reboot router',
      parameters: {},
      returns: 'boolean'
    }, this.mikrotikHandlers.reboot);
  }
  
// Generic system skills
  registerSystemSkills() {
    this.register('file.read', fileReadSchema, fileReadHandler);
    this.register('shell.exec', shellExecSchema, shellExecHandler);
    this.register('web.fetch', webFetchSchema, webFetchHandler);
  }
  
  getManifest() {
    return {
      tools: Array.from(this.tools.values()).map(t => t.schema),
      safety: this.safetyEnvelope.getLimits()
    };
  }
}
