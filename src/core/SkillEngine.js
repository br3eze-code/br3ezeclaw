// src/core/SkillEngine.js
'use strict';

class SkillEngine {
  constructor(logger = console) {
    this.skills = new Map();
    this.hooks = {
      beforeExecute: [],
      afterExecute: []
    };
    this.logger = logger;
  }

  register(name, skill) {
    if (!skill || typeof skill.execute !== 'function') {
      throw new Error(`Skill ${name} must have an execute function`);
    }
    
    this.skills.set(name, {
      ...skill,
      name,
      execute: this.wrapWithHooks(skill.execute)
    });
  }

  wrapWithHooks(fn) {
    return async (params, context) => {
      // Run before hooks with error isolation
      for (const hook of this.hooks.beforeExecute) {
        try {
          await hook(params, context);
        } catch (hookError) {
          this.logger.error(`[SkillEngine] Before-hook failed:`, hookError);
          throw hookError; // Fail fast on before-hook errors
        }
      }
      
      const result = await fn(params, context);
      
      // Run after hooks fire-and-forget so they don't block response
      this.hooks.afterExecute.forEach(hook => {
        hook(result, context).catch(err => 
          this.logger.error(`[SkillEngine] After-hook failed:`, err)
        );
      });
      
      return result;
    };
  }

  async execute(skillName, params, context = {}) {
    const skill = this.skills.get(skillName);
    if (!skill) {
      throw new Error(`Skill '${skillName}' not found. Available: ${Array.from(this.skills.keys()).join(', ')}`);
    }
    return skill.execute(params, context);
  }

  addHook(timing, fn) {
    if (!this.hooks[timing]) throw new Error(`Invalid hook timing: ${timing}`);
    if (typeof fn !== 'function') throw new Error('Hook must be a function');
    this.hooks[timing].push(fn);
  }
}

module.exports = SkillEngine;
}
