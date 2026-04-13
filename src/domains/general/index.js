// src/domains/general/index.js


const os = require('os');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync } = require('child_process');

const generalTools = [
  {
    name: 'calculate',
    description: 'Perform mathematical calculations or unit conversions',
    parameters: {
      type: 'object',
      properties: {
        expression: { type: 'string', description: 'Math expression, e.g. "2 + 2 * 10" or "convert 5km to miles"' }
      },
      required: ['expression']
    },
    execute: async (params) => {
      try {
        // Simple safe eval for math (use a proper math parser in production if needed)
        const result = eval(params.expression); // Caution: only use with trusted input
        return { result, expression: params.expression };
      } catch (e) {
        return { error: 'Invalid expression', details: e.message };
      }
    }
  },

  {
    name: 'time',
    description: 'Get current time, date, or timezone information',
    parameters: {
      type: 'object',
      properties: {
        format: { type: 'string', enum: ['iso', 'human', 'unix'], default: 'human' }
      }
    },
    execute: async (params) => {
      const now = new Date();
      if (params.format === 'iso') return { time: now.toISOString() };
      if (params.format === 'unix') return { timestamp: Math.floor(now.getTime() / 1000) };
      return {
        time: now.toLocaleTimeString(),
        date: now.toLocaleDateString(),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone
      };
    }
  },

  {
    name: 'system_info',
    description: 'Get information about the host system running AgentOS',
    execute: async () => ({
      platform: os.platform(),
      arch: os.arch(),
      cpus: os.cpus().length,
      totalMemory: `${(os.totalmem() / 1024 / 1024 / 1024).toFixed(2)} GB`,
      freeMemory: `${(os.freemem() / 1024 / 1024 / 1024).toFixed(2)} GB`,
      uptime: `${Math.floor(os.uptime() / 3600)} hours`,
      hostname: os.hostname()
    })
  },

  {
    name: 'random',
    description: 'Generate random numbers, UUIDs, or passwords',
    parameters: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['uuid', 'number', 'password'], default: 'uuid' },
        length: { type: 'number', default: 16 }
      }
    },
    execute: async (params) => {
      if (params.type === 'uuid') return { value: crypto.randomUUID() };
      if (params.type === 'number') return { value: Math.floor(Math.random() * 1000000) };
      // Simple password generator
      const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*';
      let pwd = '';
      for (let i = 0; i < params.length; i++) {
        pwd += chars[Math.floor(Math.random() * chars.length)];
      }
      return { value: pwd, type: 'password' };
    }
  },

  {
    name: 'web_search',
    description: 'Perform a quick web search (placeholder — integrate with real search API later)',
    parameters: {
      type: 'object',
      properties: { query: { type: 'string' } },
      required: ['query']
    },
    execute: async (params) => {
      // Placeholder — replace with real search (e.g. Serper, Tavily, or Grok API)
      return {
        query: params.query,
        note: 'Web search integration coming soon. For now, this is a placeholder.',
        suggestion: 'Try asking me to calculate, get time, or system info instead.'
      };
    }
  },

  {
    name: 'ping_external',
    description: 'Ping an external host (uses system ping)',
    parameters: {
      type: 'object',
      properties: { host: { type: 'string' }, count: { type: 'number', default: 4 } }
    },
    execute: async (params) => {
      try {
        const result = execSync(`ping -c ${params.count} ${params.host}`, { encoding: 'utf8' });
        return { host: params.host, output: result.trim() };
      } catch (e) {
        return { error: 'Ping failed', details: e.message };
      }
    }
  }
];

module.exports = {
  name: 'general',
  description: 'General-purpose utilities available to the AgentOS AI across all domains',
  
  register(registry) {
    registry.registerDomain('general', generalTools);
    console.log(`✅ General domain registered with ${generalTools.length} tools`);
  },

  getTools() {
    return generalTools;
  }
};
