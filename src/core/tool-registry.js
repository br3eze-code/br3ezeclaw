
/**
 * Tool Registry

 */

const fs = require('fs').promises;
const path = require('path');
const yaml = require('js-yaml');
const { logger } = require('./logger');

class ToolRegistry {
  constructor(options = {}) {
    this.skillsPath = options.skillsPath || path.join(process.cwd(), 'src/skills');
    this.tools = new Map();
    this.skills = new Map();
    this.hooks = new Map();
    this.logger = logger;
    this.manifestCache = null;
  }
  
  /**
   * Load all skills from skills directory
   */
  async loadSkills() {
    this.logger.info(`Loading skills from: ${this.skillsPath}`);
    
    try {
      const skillDirs = await fs.readdir(this.skillsPath, { withFileTypes: true });
      
      for (const dir of skillDirs) {
        if (dir.isDirectory()) {
          await this.loadSkill(dir.name);
        }
      }
      
      this.logger.info(`Loaded ${this.skills.size} skills with ${this.tools.size} tools`);
    } catch (error) {
      this.logger.error('Failed to load skills:', error);
    }
  }
  
  /**
   * Load a single skill — tries manifest.yaml → manifest.yml → skill.json
   */
  async loadSkill(skillName) {
    const skillPath = path.join(this.skillsPath, skillName);

    // ── Resolve manifest (yaml preferred, json fallback) ──────────────────────
    let manifestContent, manifestFile, manifest;
    const candidates = [
      { file: path.join(skillPath, 'manifest.yaml'), type: 'yaml' },
      { file: path.join(skillPath, 'manifest.yml'),  type: 'yaml' },
      { file: path.join(skillPath, 'skill.json'),    type: 'json' }
    ];

    for (const candidate of candidates) {
      try {
        await fs.access(candidate.file);
        manifestFile    = candidate.file;
        manifestContent = await fs.readFile(candidate.file, 'utf8');
        manifest = candidate.type === 'yaml'
          ? yaml.load(manifestContent)
          : JSON.parse(manifestContent);
        break;
      } catch (_) { /* try next */ }
    }

    if (!manifest) {
      this.logger.warn(`No manifest found for skill "${skillName}" (checked manifest.yaml / manifest.yml / skill.json)`);
      return false;
    }

    try {
      
      this.logger.info(`Loading skill: ${manifest.name} v${manifest.version}`);
      
      // Load tools
      const tools = new Map();
      if (manifest.tools) {
        for (const toolDef of manifest.tools) {
          const toolPath = path.join(skillPath, 'tools', `${toolDef.name.replace(/\\./g, '-')}.js`);
          
          try {
            // Clear require cache for hot reload
            delete require.cache[require.resolve(toolPath)];
            const toolModule = require(toolPath);
            
            tools.set(toolDef.name, {
              schema: toolDef,
              handler: toolModule.handler || toolModule.default,
              skill: manifest.name
            });
            
            // Register in global registry with namespaced name
            const fullName = `${manifest.name}.${toolDef.name}`;
            this.tools.set(fullName, {
              schema: toolDef,
              handler: toolModule.handler || toolModule.default,
              skill: manifest.name
            });
            
          } catch (error) {
            this.logger.error(`Failed to load tool ${toolDef.name}:`, error.message);
          }
        }
      }
      
      // Load hooks
      const hooks = {};
      const hooksPath = path.join(skillPath, 'hooks');
      try {
        const hookFiles = await fs.readdir(hooksPath);
        for (const hookFile of hookFiles) {
          if (hookFile.endsWith('.js')) {
            const hookName = path.basename(hookFile, '.js');
            const hookPath = path.join(hooksPath, hookFile);
            delete require.cache[require.resolve(hookPath)];
            hooks[hookName] = require(hookPath);
          }
        }
      } catch (e) {
        // No hooks directory is fine
      }
      
      // Store skill
      this.skills.set(manifest.name, {
        manifest,
        tools,
        hooks,
        path: skillPath,
        enabled: true
      });
      
      // Run on-enable hook
      if (hooks['on-enable']) {
        try {
          await hooks['on-enable']({ config: manifest.config || {} });
        } catch (error) {
          this.logger.error(`on-enable hook failed for ${manifest.name}:`, error);
        }
      }
      
      this.manifestCache = null; // Invalidate cache
      return true;
      
    } catch (error) {
      this.logger.error(`Failed to load skill ${skillName}:`, error.message);
      return false;
    }
  }
  
  /**
   * Unload a skill
   */
  async unloadSkill(skillName) {
    const skill = this.skills.get(skillName);
    if (!skill) return false;
    
    // Run on-disable hook
    if (skill.hooks['on-disable']) {
      try {
        await skill.hooks['on-disable']();
      } catch (error) {
        this.logger.error(`on-disable hook failed for ${skillName}:`, error);
      }
    }
    
    // Remove tools
    for (const [name, tool] of this.tools) {
      if (tool.skill === skillName) {
        this.tools.delete(name);
      }
    }
    
    // Remove skill
    this.skills.delete(skillName);
    this.manifestCache = null;
    
    this.logger.info(`Unloaded skill: ${skillName}`);
    return true;
  }
  
  /**
   * Reload a skill
   */
  async reloadSkill(skillName) {
    await this.unloadSkill(skillName);
    return await this.loadSkill(skillName);
  }
  
  /**
   * Get a tool by name
   */
  getTool(name) {
    return this.tools.get(name);
  }
  
  /**
   * Get all tools
   */
  getAllTools() {
    return Array.from(this.tools.values());
  }
  
  /**
   * Get tools by skill
   */
  getToolsBySkill(skillName) {
    const skill = this.skills.get(skillName);
    return skill ? Array.from(skill.tools.values()) : [];
  }
  
  /**
   * Get capability manifest (OpenClaw standard)
   */
  getManifest() {
    if (this.manifestCache) return this.manifestCache;
    
    const tools = Array.from(this.tools.values()).map(tool => ({
      name: tool.schema.name,
      description: tool.schema.description,
      parameters: tool.schema.parameters || [],
      returns: tool.schema.returns || 'any',
      skill: tool.skill
    }));
    
    this.manifestCache = {
      version: '2.0.0',
      agent: 'AgentOS OpenClaw',
      skills: Array.from(this.skills.keys()),
      tools,
      safety: {
        maxToolsPerRequest: 10,
        allowedOperations: tools.map(t => t.name)
      }
    };
    
    return this.manifestCache;
  }
  
  /**
   * Get skill names
   */
  getSkillNames() {
    return Array.from(this.skills.keys());
  }
  
  /**
   * Get skill info
   */
  getSkillInfo(skillName) {
    const skill = this.skills.get(skillName);
    if (!skill) return null;
    
    return {
      ...skill.manifest,
      toolCount: skill.tools.size,
      enabled: skill.enabled
    };
  }
  
  /**
   * Get total tool count
   */
  getToolCount() {
    return this.tools.size;
  }
  
  /**
   * Enable/disable skill
   */
  setSkillEnabled(skillName, enabled) {
    const skill = this.skills.get(skillName);
    if (skill) {
      skill.enabled = enabled;
    }
  }
}

module.exports = { ToolRegistry };

