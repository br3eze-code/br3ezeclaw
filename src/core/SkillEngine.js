// src/core/SkillEngine.js
class SkillEngine {
  constructor() {
    this.skills = new Map();
    this.hooks = {
      beforeExecute: [],
      afterExecute: []
    };
  }

  register(name, skill) {
    this.skills.set(name, {
      ...skill,
      execute: this.wrapWithHooks(skill.execute)
    });
  }

  wrapWithHooks(fn) {
    return async (params, context) => {
      for (const hook of this.hooks.beforeExecute) {
        await hook(params, context);
      }
      
      const result = await fn(params, context);
      
      for (const hook of this.hooks.afterExecute) {
        await hook(result, context);
      }
      
      return result;
    };
  }
}
