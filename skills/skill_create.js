// skills/skill_create.js
export const skill_create = {
  name: "skill_create",
  description: "Create entirely new skills for AgentOS when existing tools can't solve a problem. Used for self-enhancement.",
  parameters: {
    type: "object",
    properties: {
      name: { type: "string", description: "Skill name like 'firewall_block', 'speedtest'" },
      purpose: { type: "string", description: "What this skill does" },
      trigger: { type: "string", description: "User request that revealed this gap" },
      code: { type: "string", description: "Full ES module code for skills/NAME.js" }
    },
    required: ["name", "purpose", "trigger", "code"]
  },

  run: async ({ name, purpose, trigger, code }, { gemini }) => {
    const filePath = `./skills/${name}.js`;

    // Validate code structure with Gemini
    const validation = await gemini.generate({
      prompt: `Validate this new AgentOS skill. Must export const ${name} with name, description, parameters, run. Check for RouterOS safety.

Code:
${code}

Reply: VALID or INVALID: <reason>`
    });

    if (!validation.text.includes('VALID')) {
      throw new Error(`Skill code invalid: ${validation.text}`);
    }

    await fs.writeFile(filePath, code);

    // Log to soul.md
    await fs.appendFile('./knowledge/soul.md',
      `\n## Skill Genesis ${new Date().toISOString()}\nCreated: ${name}.js\nPurpose: ${purpose}\nTrigger: "${trigger}"\n`
    );

    // Add to patterns
    await fs.appendFile('./knowledge/mikrotik-patterns.md',
      `\n## Auto-generated skill: ${name}\nTriggered by: "${trigger}"\nPurpose: ${purpose}\nFile: ${filePath}\n`
    );

    return {
      success: true,
      skill: name,
      file: filePath,
      warning: 'New skill created. Restart AgentOS to load it.',
      next_step: 'Run: pm2 restart agentos or npm run gateway:restart'
    };
  }
}
