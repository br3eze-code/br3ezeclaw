const fs = require('fs/promises');
const path = require('path');

const create_agent = {
  name: "create_agent",
  description: "Create or update an AgentOS agent with persona, skills, roles, duties, tools",
  parameters: {
    type: "object",
    properties: {
      name: { type: "string", description: "agent name, e.g. router-core1" },
      purpose: { type: "string", description: "What this agent does" },
      persona: { type: "string", default: "Helpful network operator" },
      triggers: { type: "string", default: "manual,schedule,alert" },
      allowed_skills: { type: "string", default: "router_health,memory" },
      roles: { type: "string", default: "operator", description: "Comma list: netops,security,auditor" },
      duties: { type: "string", default: "monitor,maintain", description: "Comma list of duties" },
      tools: { type: "string", default: "routeros-api,gateway", description: "Comma list of tools" },
      memory_namespace: { type: "string", default: "default" },
      auto_run: { type: "boolean", default: false }
    },
    required: ["name", "purpose"]
  },
  run: async ({ name, purpose, persona, triggers, allowed_skills, roles, duties, tools, memory_namespace, auto_run }, { logger, skillRegistry }) => {
    const agentsPath = './knowledge/agents.json';
    await fs.mkdir('./knowledge', { recursive: true });
    await fs.mkdir('./agents', { recursive: true });

    let agents = {};
    try { agents = JSON.parse(await fs.readFile(agentsPath, 'utf8')); } catch {}

    const agentConfig = {
      name,
      purpose,
      persona,
      triggers: triggers.split(',').map(s => s.trim()),
      allowed_skills: allowed_skills.split(',').map(s => s.trim()),
      roles: roles.split(',').map(s => s.trim()),
      duties: duties.split(',').map(s => s.trim()),
      tools: tools.split(',').map(s => s.trim()),
      memory_namespace,
      created: new Date().toISOString(),
      version: (agents[name]?.version || 0) + 1
    };

    agents[name] = agentConfig;
    await fs.writeFile(agentsPath, JSON.stringify(agents, null, 2));

    const stub = `// Agent: ${name}\n// Purpose: ${purpose}\n// Roles: ${agentConfig.roles.join(', ')}\n// Duties: ${agentConfig.duties.join(', ')}\n// Tools: ${agentConfig.tools.join(', ')}\nmodule.exports = {\n name: "${name}",\n config: ${JSON.stringify(agentConfig, null, 2)},\n run: async (input, { skillRegistry, logger }) => {\n logger.info('AGENT ${name}: started');\n const results = [];\n for (const skill of ${JSON.stringify(agentConfig.allowed_skills)}) {\n try { const r = await skillRegistry.execute(skill, input); results.push({skill, ok:true}); } catch(e){ results.push({skill, ok:false, error:e.message}); }\n }\n return { success:true, message: 'Agent ${name} ran '+results.length+' skills', results };\n }\n};\n`;
    await fs.writeFile(`./agents/${name}.js`, stub);

    await fs.appendFile('./knowledge/soul.md', `\n## Agent ${name} v${agentConfig.version} ${new Date().toISOString()}\nRoles: ${roles}\nDuties: ${duties}\n`);

    const msg = `🤖 *Agent: ${name}*\n**Purpose**: ${purpose}\n**Roles**: ${agentConfig.roles.join(', ')}\n**Duties**: ${agentConfig.duties.join(', ')}\n**Tools**: ${agentConfig.tools.join(', ')}\n**Skills**: ${agentConfig.allowed_skills.join(', ')}`;
    return { success: true, message: msg, agent: agentConfig };
  }
};

module.exports = { create_agent };
