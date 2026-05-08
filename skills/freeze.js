const fs = require('fs/promises');

const freeze = {
  name: "freeze",
  description: "EMERGENCY: Disable AgentOS self-modification. Sets self_edit enabled: false in soul.md",
  parameters: {
    type: "object",
    properties: {
      action: { type: "string", enum: ["freeze", "unfreeze", "status"] }
    },
    required: ["action"]
  },

  run: async ({ action }) => {
    const soulPath = './knowledge/soul.md';
    let soul = await fs.readFile(soulPath, 'utf8');

    if (action === 'status') {
      const frozen = soul.includes('self_edit enabled: false');
      return {
        success: true,
        message: frozen?
          `🛑 *FROZEN*: Self-modification disabled. AgentOS cannot edit itself or create skills.` :
          `✅ *ACTIVE*: Self-modification enabled. AgentOS can self-edit and create skills.`
      };
    }

    if (action === 'freeze') {
      soul = soul.replace(/self_edit enabled: true/g, 'self_edit enabled: false');
      soul = soul.replace(/skill_create enabled: true/g, 'skill_create enabled: false');
      await fs.writeFile(soulPath, soul);
      await fs.appendFile(soulPath, `\n## FREEZE ${new Date().toISOString()}\nUser executed /freeze. Self-modification disabled.\n`);
      return { success: true, message: `🛑 *FROZEN*: Self-modification disabled.\n\nself_edit: false\nskill_create: false\n\nUse \`freeze unfreeze\` to re-enable.` };
    }

    if (action === 'unfreeze') {
      soul = soul.replace(/self_edit enabled: false/g, 'self_edit enabled: true');
      soul = soul.replace(/skill_create enabled: false/g, 'skill_create enabled: true');
      await fs.writeFile(soulPath, soul);
      await fs.appendFile(soulPath, `\n## UNFREEZE ${new Date().toISOString()}\nUser executed /unfreeze. Self-modification re-enabled.\n`);
      return { success: true, message: `✅ *UNFROZEN*: Self-modification re-enabled.\n\nself_edit: true\nskill_create: true` };
    }
  }
};

module.exports = { freeze };
