// src/core/PluginManager.js
class PluginManager {
  constructor(agent) {
    this.agent = agent;
    this.plugins = new Map();
    this.hooks = {
      preInitialize: [],
      postInitialize: [],
      preSkillExecute: [],
      postSkillExecute: [],
      preShutdown: []
    };
  }

  async load(pluginPath) {
    const Plugin = require(pluginPath);
    const instance = new Plugin(this.agent);
    
    // Register hooks
    if (instance.hooks) {
      for (const [event, handler] of Object.entries(instance.hooks)) {
        if (this.hooks[event]) {
          this.hooks[event].push(handler.bind(instance));
        }
      }
    }
    
    // Initialize plugin
    if (instance.initialize) {
      await instance.initialize();
    }
    
    this.plugins.set(instance.name || pluginPath, instance);
    
    return instance;
  }

  async executeHook(event, ...args) {
    for (const handler of this.hooks[event] || []) {
      await handler(...args);
    }
  }

  async unload(name) {
    const plugin = this.plugins.get(name);
    if (!plugin) return;
    
    if (plugin.destroy) {
      await plugin.destroy();
    }
    
    this.plugins.delete(name);
  }
}

// Example plugin
class AnalyticsPlugin {
  constructor(agent) {
    this.name = 'analytics';
    this.agent = agent;
    this.hooks = {
      postSkillExecute: this.trackSkillUsage.bind(this)
    };
  }

  async trackSkillUsage(result, context) {
    await this.agent.telemetry.record('skill_executed', {
      skill: result.skill,
      userId: context.userId,
      duration: result.duration,
      success: !result.error
    });
  }
}

module.exports = { PluginManager, AnalyticsPlugin };
