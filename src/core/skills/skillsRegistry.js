// skills/SkillRegistry.js
class SkillRegistry {
  constructor() {
    this.skills = new Map();
    this.loadBuiltinSkills();
  }
  
  register(name, skill) {
    this.skills.set(name, {
      name,
      description: skill.description,
      parameters: skill.parameters,
      execute: skill.execute,
      version: skill.version || '1.0.0'
    });
  }
  
  async execute(skillName, params) {
    const skill = this.skills.get(skillName);
    if (!skill) throw new Error(`Skill ${skillName} not found`);
    return await skill.execute(params);
  }
}