// src/core/SkillRegistry.js
const fs   = require('fs').promises;
const fss  = require('fs');            // sync checks
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
    try {
      // ── 1. Load manifest (skill.json preferred, manifest.yaml fallback) ────
      let manifest;
      const jsonManifest  = path.join(skillPath, 'skill.json');
      const yamlManifest  = path.join(skillPath, 'manifest.yaml');
      const yamlManifest2 = path.join(skillPath, 'manifest.yml');

      if (fss.existsSync(jsonManifest)) {
        manifest = JSON.parse(await fs.readFile(jsonManifest, 'utf8'));
      } else if (fss.existsSync(yamlManifest) || fss.existsSync(yamlManifest2)) {
        const file = fss.existsSync(yamlManifest) ? yamlManifest : yamlManifest2;
        // Parse minimal YAML without an external dep (name/version/description lines)
        const raw = await fs.readFile(file, 'utf8');
        manifest = this._parseSimpleYaml(raw);
      } else {
        throw new Error('No skill.json or manifest.yaml found');
      }

      this.validateManifest(manifest);

      // ── 2. Load implementation (index.js or entry from manifest) ───────────
      const entry = manifest.entry || 'index.js';
      const implPath = path.join(skillPath, entry);

      let impl;
      if (fss.existsSync(implPath)) {
        impl = require(implPath);
      } else {
        // Stub implementation — skill is metadata-only
        impl = {};
      }

      // ── 3. Normalise to { execute, initialize, destroy, validate } ─────────
      // Handles: plain object exports, class instances, or factories
      const mod = (typeof impl === 'function' && impl.prototype?.execute)
        ? new impl()  // class
        : impl;

      const skill = {
        manifest,
        execute:    this.wrapExecution(
                      (mod.execute || (() => ({ status: 'no-op', skill: manifest.name }))).bind(mod)
                    ),
        validate:   mod.validate    || this.defaultValidate,
        initialize: mod.initialize  || (() => Promise.resolve()),
        destroy:    mod.destroy     || (() => Promise.resolve()),
        path: skillPath
      };

      await skill.initialize(this.config);
      this.skills.set(manifest.name, skill);
      this.emit('skillLoaded', manifest.name);

    } catch (error) {
      console.error(`Failed to load skill from ${path.basename(skillPath)}:`, error.message);
      this.emit('skillError', { path: skillPath, error });
    }
  }

  /** Tiny YAML scalar parser — handles top-level string/number fields only */
  _parseSimpleYaml(raw) {
    const result = {};
    for (const line of raw.split('\n')) {
      const m = line.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s*:\s*(.+)$/);
      if (m) {
        const [, key, val] = m;
        const trimmed = val.trim().replace(/^['"]|['"]$/g, '');
        result[key] = isNaN(trimmed) ? trimmed : Number(trimmed);
      }
    }
    return result;
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
