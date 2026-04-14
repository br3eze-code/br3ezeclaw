const fs = require('fs/promises');

const skill_create = {
  name: "skill_create",
  description: "Create entirely new skills when existing tools can't solve a problem.",
  parameters: {
    type: "object",
    properties: {
      name: { type: "string" },
      purpose: { type: "string" },
      trigger: { type: "string" },
      code: { type: "string" }
    },
    required: ["name", "purpose", "trigger", "code"]
  },

  run: async ({ name, purpose, trigger, code }, { gemini }) => {
    const soul = await fs.readFile('./knowledge/soul.md', 'utf8');
    if (!soul.includes('skill_create enabled: true')) {
      throw new Error('Blocked: skill_create not authorized. Run freeze unfreeze first.');
    }

    const filePath = `./skills/${name}.js`;
    const validation = await gemini.generate({
      prompt: `Validate AgentOS skill. Must export { ${name} } with name,description,parameters,run. Check RouterOS safety.\nCode:\n${code}\nReply: VALID or INVALID: <reason>`
    });
    if (!validation.text.includes('VALID')) throw new Error(`Skill invalid: ${validation.text}`);

    await fs.writeFile(filePath, code);
    await fs.appendFile('./knowledge/soul.md',
      `\n## Skill Genesis ${new Date().toISOString()}\nCreated: ${name}.js\nPurpose: ${purpose}\nTrigger: "${trigger}"\n`);
    await fs.appendFile('./knowledge/mikrotik-patterns.md',
      `\n## Auto-generated skill: ${name}\nTriggered by: "${trigger}"\nPurpose: ${purpose}\nFile: ${filePath}\n`);

    return { success: true, skill: name, file: filePath, warning: 'Restart AgentOS to load new skill' };
  }
};

module.exports = { skill_create };
