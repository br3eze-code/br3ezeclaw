// src/core/skills/SkillRegistry.js
const { logger } = require('../logger');

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
        const dirPath = path.join(skillsPath, entry.name);
        let manifest = null;
        
        try {
          // Try skill.json first, then manifest.yaml
          const jsonPath = path.join(dirPath, 'skill.json');
          const yamlPath = path.join(dirPath, 'manifest.yaml');
          
          if (require('fs').existsSync(jsonPath)) {
            manifest = JSON.parse(await fs.readFile(jsonPath, 'utf8'));
          } else if (require('fs').existsSync(yamlPath)) {
            const yaml = require('js-yaml');
            manifest = yaml.load(await fs.readFile(yamlPath, 'utf8'));
          }
          
          if (!manifest) continue;

          const entryFile = manifest.entry || 'index.js';
          const codePath = path.join(dirPath, entryFile);
          
          if (!require('fs').existsSync(codePath)) {
            logger.warn(`Skill ${entry.name} entry file not found: ${entryFile}`);
            continue;
          }

          const skillModule = require(codePath);
          this.register(manifest, skillModule);
          logger.info(`Skill loaded: ${manifest.name} v${manifest.version || '1.0.0'}`);
        } catch (err) {
          logger.error(`Failed to load skill ${entry.name}: ${err.stack || err.message || err}`);
        }
      }
    }
  }

  register(manifest, implementation) {
    let executor;

    if (typeof implementation === 'function' && implementation.prototype?.execute) {
      // Class-based skill (e.g. DahuaSkill extends BaseSkill)
      // Instantiate with empty stubs so it doesn't crash at load time
      const instance = new implementation(
        {},                                      // config
        logger,                                  // logger
        {}                                       // workspace — populated at execute time
      );
      executor = (toolName, args, ctx) => instance.execute(toolName, args, ctx || {});
    } else if (typeof implementation?.execute === 'function') {
      // Plain object with execute fn
      executor = (toolName, args, ctx) =>
        implementation.execute.call(implementation, toolName, args, ctx);
    } else if (typeof implementation === 'function') {
      // Plain function
      executor = (params, ctx) => implementation(params, ctx);
    } else {
      logger.warn(`Skill "${manifest.name}": no execute implementation found — registering as no-op`);
      executor = () => ({ status: 'no-op', skill: manifest.name });
    }

    this.skills.set(manifest.name, {
      manifest,
      execute: executor,
      validate: implementation.validate || (() => true)
    });
    this.manifests.set(manifest.name, manifest);
  }

  async execute(skillName, toolName, args = {}, context = {}) {
    const skill = this.skills.get(skillName);
    if (!skill) throw new Error(`Skill '${skillName}' not found`);
    
    let actualToolName = toolName;
    let actualArgs = args;
    let actualContext = context;

    if (typeof toolName === 'object') {
      actualToolName = skillName;
      actualArgs = toolName;
      actualContext = args || {};
    }

    return await skill.execute(actualToolName, actualArgs, actualContext);
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
