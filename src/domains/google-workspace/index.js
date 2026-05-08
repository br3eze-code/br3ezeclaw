// src/domains/google-workspace/index.js
const BaseDomain = require('../BaseDomain');
const GoogleWorkspaceSkill = require('../../skills/google-workspace/index');

class GoogleWorkspaceDomain extends BaseDomain {
  constructor(agentOS) {
    super();
    this.name = 'google-workspace';
    
    // Provide a config object so this.config is defined
    const config = agentOS?.config || {};
    const logger = agentOS?.logger || console;
    this.skill = new GoogleWorkspaceSkill(config, logger, null);
    
    const tools = GoogleWorkspaceSkill.getTools();
    
    // Register each tool defined in the Skill into the Domain
    for (const [toolName, config] of Object.entries(tools)) {
      this.registerTool({
        name: toolName.replace(/\./g, '_'), // e.g., google_docs_list
        description: config.description,
        parameters: config.parameters,
        execute: async (params) => {
          return await this.skill.execute(toolName, params);
        }
      });
    }
  }
}

module.exports = GoogleWorkspaceDomain;
