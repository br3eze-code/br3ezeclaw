// src/core/skills/SkillRegistry.js
class SkillRegistry {
  constructor() {
    this.skills = new Map();
    this.manifests = new Map();
  }

  async loadFromDirectory(skillsPath) {
    const fs = require('fs').promises;
    const path = require('path');
    
    const entries = await fs.readdir(skillsPath, { withFileTypes: true });
    
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const manifestPath = path.join(skillsPath, entry.name, 'skill.json');
        const codePath = path.join(skillsPath, entry.name, 'index.js');
        
        try {
          const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
          const skillModule = require(codePath);
          
          this.register(manifest, skillModule);
        } catch (err) {
          console.warn(`Failed to load skill ${entry.name}:`, err.message);
        }
      }
    }
  }

  register(manifest, implementation) {
    this.skills.set(manifest.name, {
      manifest,
      execute: implementation.execute,
      validate: implementation.validate || (() => true)
    });
    this.manifests.set(manifest.name, manifest);
  }

  async execute(skillName, params, context = {}) {
    const skill = this.skills.get(skillName);
    if (!skill) throw new Error(`Skill '${skillName}' not found`);
    
    // Validate parameters
    if (skill.manifest.parameters) {
      this.validateParams(params, skill.manifest.parameters);
    }
    
    return await skill.execute(params, context);
  }

  validateParams(params, schema) {
    for (const [key, config] of Object.entries(schema)) {
      if (config.required && !(key in params)) {
        throw new Error(`Missing required parameter: ${key}`);
      }
    }
  }

  list() {
    return Array.from(this.manifests.values());
  }
}

module.exports = SkillRegistry;
