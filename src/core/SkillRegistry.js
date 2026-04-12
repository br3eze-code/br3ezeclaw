// src/core/SkillRegistry.js
const fs = require('fs').promises;
const path = require('path');
const EventEmitter = require('events');

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
    const manifestPath = path.join(skillPath, 'skill.json');
    
    try {
      // Load and validate manifest
      const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
      this.validateManifest(manifest);
      
      // Load implementation
      const implPath = path.join(skillPath, manifest.entry || 'index.js');
      const implementation = require(implPath);
      
      // Create skill wrapper
      const skill = {
        manifest,
        execute: this.wrapExecution(implementation.execute.bind(implementation)),
        validate: implementation.validate || this.defaultValidate,
        initialize: implementation.initialize || (() => Promise.resolve()),
        destroy: implementation.destroy || (() => Promise.resolve()),
        path: skillPath
      };

      // Initialize skill
      await skill.initialize(this.config);
      
      this.skills.set(manifest.name, skill);
      this.emit('skillLoaded', manifest.name);
      
    } catch (error) {
      console.error(`Failed to load skill from ${skillPath}:`, error.message);
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
      examples: s.manifest.examples
    }));
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
