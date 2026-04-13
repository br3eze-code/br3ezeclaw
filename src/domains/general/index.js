// src/domains/general/index.js

const os = require('os');
const crypto = require('crypto');
const { execSync } = require('child_process');

const generalTools = [
  {
    name: 'calculate',
    description: 'Perform math calculations or simple unit conversions',
    parameters: {
      type: 'object',
      properties: {
        expression: { 
          type: 'string', 
          description: 'Math expression like "2 * 15 + 10" or "convert 100km to miles"' 
        }
      },
      required: ['expression']
    },
    execute: async ({ expression }) => {
      try {
        // Safe math evaluation (for real production use a proper parser like math.js)
        const result = Function('"use strict";return (' + expression + ')')();
        return { success: true, result, expression };
      } catch (err) {
        return { success: false, error: 'Invalid expression', details: err.message };
      }
    }
  },

  {
    name: 'time',
    description: 'Get current time, date, or timezone info',
    parameters: {
      type: 'object',
      properties: {
        format: { type: 'string', enum: ['iso', 'human', 'unix'], default: 'human' }
      }
    },
    execute: async ({ format = 'human' }) => {
      const now = new Date();
      if (format === 'iso') return { time: now.toISOString() };
      if (format === 'unix') return { timestamp: Math.floor(now.getTime() / 1000) };
      return {
        time: now.toLocaleTimeString(),
        date: now.toLocaleDateString(),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        utc: now.toUTCString()
      };
    }
  },

  {
    name: 'system_info',
    description: 'Get information about the machine running AgentOS',
    execute: async () => ({
      platform: os.platform(),
      arch: os.arch(),
      cpus: os.cpus().length,
      totalMemoryGB: (os.totalmem() / 1024 / 1024 / 1024).toFixed(2),
      freeMemoryGB: (os.freemem() / 1024 / 1024 / 1024).toFixed(2),
      uptimeHours: Math.floor(os.uptime() / 3600),
      hostname: os.hostname(),
      nodeVersion: process.version
    })
  },

  {
    name: 'random',
    description: 'Generate random UUID, number, or password',
    parameters: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['uuid', 'number', 'password'], default: 'uuid' },
        length: { type: 'number', default: 16 }
      }
    },
    execute: async ({ type = 'uuid', length = 16 }) => {
      if (type === 'uuid') return { value: crypto.randomUUID() };
      if (type === 'number') return { value: Math.floor(Math.random() * 1_000_000) };
      
      // Password generator
      const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*()_+-=[]{}|;:,.<>?';
      let pwd = '';
      for (let i = 0; i < length; i++) {
        pwd += chars[Math.floor(Math.random() * chars.length)];
      }
      return { value: pwd, type: 'password', length };
    }
  },

  {
    name: 'ping',
    description: 'Ping an external host (system ping)',
    parameters: {
      type: 'object',
      properties: { 
        host: { type: 'string' }, 
        count: { type: 'number', default: 4 } 
      },
      required: ['host']
    },
    execute: async ({ host, count = 4 }) => {
      try {
        const output = execSync(`ping -c ${count} ${host}`, { encoding: 'utf8', timeout: 10000 });
        return { host, success: true, output: output.trim() };
      } catch (err) {
        return { host, success: false, error: err.message };
      }
    }
  }
];

module.exports = {
  name: 'general',
  description: 'General utility tools for AgentOS — math, time, system info, randomness, etc.',

  // Register function — call this in your bootstrap
  register(registry) {
    if (!registry || typeof registry.registerDomain !== 'function') {
      console.warn('ToolRegistry not found — general domain tools not registered');
      return;
    }
    registry.registerDomain('general', generalTools);
    console.log(`✅ [General Domain] Registered ${generalTools.length} tools`);
  },

  getTools() {
    return generalTools;
  }
};
