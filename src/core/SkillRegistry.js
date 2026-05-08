// src/core/SkillRegistry.js
const fs   = require('fs').promises;
const fss  = require('fs');            // sync checks
const path = require('path');
const EventEmitter = require('events');
const { logger } = require('./logger');
const yaml = require('js-yaml');

class SkillRegistry extends EventEmitter {
  constructor(config) {
    super();
    this.config = config;
    this.skills = new Map();
    this.hooks = {
      beforeExecute: [],
      afterExecute: [],
      onError: []
    };
  }

  async loadFromDirectory(skillsPath) {
    try {
      const entries = await fs.readdir(skillsPath, { withFileTypes: true });
      
      for (const entry of entries) {
        logger.debug(`SkillRegistry: Checking entry ${entry.name} (isDirectory: ${entry.isDirectory()})`);
        if (!entry.isDirectory()) continue;
        
        const skillPath = path.join(skillsPath, entry.name);
        await this.loadSkill(skillPath);
      }
      
      this.emit('loaded', this.skills.size);
    } catch (error) {
      if (error.code === 'ENOENT') {
        console.warn(`Skills directory not found: ${skillsPath}`);
        return;
      }
      throw error;
    }
  }

  async loadSkill(skillPath) {
    try {
      // ── 1. Load manifest (manifest.yaml preferred, skill.json fallback) ────
      let manifest;
      const yamlManifest  = path.join(skillPath, 'manifest.yaml');
      const yamlManifest2 = path.join(skillPath, 'manifest.yml');
      const jsonManifest  = path.join(skillPath, 'skill.json');

      if (fss.existsSync(yamlManifest) || fss.existsSync(yamlManifest2)) {
        console.log(`[SkillRegistry] Found YAML manifest for ${path.basename(skillPath)}`);
        const file = fss.existsSync(yamlManifest) ? yamlManifest : yamlManifest2;
        manifest = yaml.load(await fs.readFile(file, 'utf8'));
      } else if (fss.existsSync(jsonManifest)) {
        console.log(`[SkillRegistry] Found JSON manifest for ${path.basename(skillPath)}`);
        manifest = JSON.parse(await fs.readFile(jsonManifest, 'utf8'));
      } else {
        console.log(`[SkillRegistry] No manifest found in ${skillPath}`);
        console.log(`  Checked: ${yamlManifest}`);
        console.log(`  Checked: ${yamlManifest2}`);
        console.log(`  Checked: ${jsonManifest}`);
        throw new Error('No manifest.yaml or skill.json found');
      }

      this.validateManifest(manifest);

      // ── 2. Load implementation (index.js or entry from manifest) ───────────
      const entry = manifest.entry || 'index.js';
      const implPath = path.join(skillPath, entry);

      let impl;
      if (fss.existsSync(implPath)) {
        impl = require(path.resolve(implPath));
      } else {
        impl = {};
      }

      // ── 3. Normalise to { execute, initialize, destroy, validate } ─────────
      const mod = (typeof impl === 'function' && impl.prototype?.execute)
        ? new impl()  // class
        : impl;

      const skill = {
        manifest,
        execute:    this.wrapExecution(
                      (mod.execute || (() => ({ status: 'no-op', skill: manifest.name }))).bind(mod)
                    ),
        validate:   (mod.validate   || this.defaultValidate).bind(mod),
        initialize: (mod.initialize || (() => Promise.resolve())).bind(mod),
        destroy:    (mod.destroy    || (() => Promise.resolve())).bind(mod),
        path: skillPath
      };

      const skillName = manifest.name || path.basename(skillPath);
      logger.info(`SkillRegistry: Initializing ${skillName}...`);
      
      const start = Date.now();
      const timeout = setTimeout(() => {
        logger.warn(`SkillRegistry: Skill ${skillName} is taking a long time to initialize (>2s)...`);
      }, 2000);

      try {
        await skill.initialize(this.config);
      } finally {
        clearTimeout(timeout);
      }

      const duration = Date.now() - start;
      logger.info(`SkillRegistry: ${skillName} initialized in ${duration}ms`);
      
      this.skills.set(manifest.name, skill);
      this.emit('skillLoaded', manifest.name);

    } catch (error) {
      const skillName = path.basename(skillPath);
      logger.error(`Failed to load skill from ${skillName}: ${error.message}`);
      if (error.stack) {
        logger.debug(error.stack);
      }
      this.emit('skillError', { path: skillPath, error });
    }
  }


  validateManifest(manifest) {
    const required = ['name', 'version', 'description'];
    for (const field of required) {
      if (!manifest[field]) {
        throw new Error(`Missing required field: ${field}`);
      }
    }
    
    if (!/^[a-z0-9._-]+$/.test(manifest.name)) {
      throw new Error(`Invalid skill name: ${manifest.name}`);
    }
  }

  wrapExecution(executeFn) {
    return async (params, context) => {
      // Run before hooks
      for (const hook of this.hooks.beforeExecute) {
        await hook(params, context);
      }
      
      try {
        // Validate parameters
        if (context.skill?.manifest?.parameters) {
          this.validateParams(params, context.skill.manifest.parameters);
        }
        
        // Execute
        const result = await executeFn(params, context);
        
        // Run after hooks
        for (const hook of this.hooks.afterExecute) {
          await hook(result, context);
        }
        
        return result;
        
      } catch (error) {
        // Run error hooks
        for (const hook of this.hooks.onError) {
          await hook(error, context);
        }
        throw error;
      }
    };
  }

  validateParams(params, schema) {
    for (const [key, config] of Object.entries(schema)) {
      const value = params[key];
      
      if (config.required && (value === undefined || value === null)) {
        throw new Error(`Missing required parameter: ${key}`);
      }
      
      if (value !== undefined && config.type) {
        const actualType = Array.isArray(value) ? 'array' : typeof value;
        if (actualType !== config.type) {
          throw new Error(`Invalid type for ${key}: expected ${config.type}, got ${actualType}`);
        }
      }
      
      if (value !== undefined && config.enum && !config.enum.includes(value)) {
        throw new Error(`Invalid value for ${key}: must be one of ${config.enum.join(', ')}`);
      }
    }
  }

  defaultValidate() {
    return true;
  }

  get(name) {
    return this.skills.get(name);
  }

  has(name) {
    return this.skills.has(name);
  }

  count() {
    return this.skills.size;
  }

  list() {
    return Array.from(this.skills.keys());
  }

  getDescriptions() {
    return Array.from(this.skills.values()).map(s => ({
      name: s.manifest.name,
      description: s.manifest.description,
      version: s.manifest.version,
      parameters: s.manifest.parameters,
      examples: s.manifest.examples,
      tools: s.manifest.tools || []
    }));
  }

  /** Returns all tools across all skills in a format for the LLM */
  getAllToolDefinitions() {
    const definitions = [];
    for (const [skillName, skill] of this.skills) {
      if (skill.manifest.tools) {
        for (const tool of skill.manifest.tools) {
          definitions.push({
            name: `${skillName}.${tool.name}`,
            description: tool.description,
            parameters: tool.parameters,
            returns: tool.returns
          });
        }
      } else {
        // Fallback for legacy skills without a tools array
        definitions.push({
          name: skillName,
          description: skill.manifest.description,
          parameters: skill.manifest.parameters || {},
          returns: 'any'
        });
      }
    }
    return definitions;
  }

  async executeTool(toolFullName, params, context) {
    const [skillName, ...toolPath] = toolFullName.split('.');
    const toolName = toolPath.join('.');
    
    const skill = this.skills.get(skillName);
    if (!skill) throw new Error(`Skill not found: ${skillName}`);
    
    // If the skill has multiple tools, pass the toolName to the execute function
    if (toolName) {
      return await skill.execute(toolName, params, context);
    }
    
    // Otherwise just execute the skill with params
    return await skill.execute(params, context);
  }

  addHook(type, handler) {
    if (this.hooks[type]) {
      this.hooks[type].push(handler);
    }
  }

  async reload(name) {
    const skill = this.skills.get(name);
    if (!skill) throw new Error(`Skill not found: ${name}`);
    
    await skill.destroy();
    this.skills.delete(name);
    
    await this.loadSkill(skill.path);
  }

  async destroy() {
    for (const [name, skill] of this.skills) {
      try {
        await skill.destroy();
      } catch (error) {
        console.error(`Error destroying skill ${name}:`, error);
      }
    }
    this.skills.clear();
  }
}

module.exports = SkillRegistry;
