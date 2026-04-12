// config/schema.js
const { z } = require('zod');

const SkillSchema = z.object({
  name: z.string(),
  version: z.string(),
  description: z.string(),
  domain: z.string(),
  entry: z.string().default('index.js'),
  timeout: z.number().default(30000),
  permissions: z.array(z.string()).default([]),
  parameters: z.record(z.object({
    type: z.enum(['string', 'number', 'boolean', 'array', 'object']),
    required: z.boolean().default(false),
    enum: z.array(z.any()).optional(),
    description: z.string().optional()
  })).default({})
});

const ChannelSchema = z.object({
  type: z.enum(['telegram', 'whatsapp', 'websocket', 'slack', 'discord', 'cli']),
  config: z.record(z.any()).default({}),
  enabled: z.boolean().default(true)
});

const ConfigSchema = z.object({
  id: z.string().default(() => crypto.randomUUID()),
  skillsPath: z.string().default('./skills'),
  
  memory: z.object({
    adapter: z.enum(['memory', 'firebase', 'redis', 'sqlite']).default('memory'),
    config: z.record(z.any()).default({})
  }).default({}),
  
  llm: z.object({
    provider: z.enum(['gemini', 'openai', 'anthropic', 'local']).default('gemini'),
    config: z.record(z.any()).default({})
  }).default({}),
  
  channels: z.array(ChannelSchema).default([]),
  
  security: z.object({
    rateLimit: z.object({
      windowMs: z.number().default(60000),
      maxRequests: z.number().default(100)
    }).default({}),
    jwtSecret: z.string().optional()
  }).default({}),
  
  telemetry: z.object({
    enabled: z.boolean().default(false),
    endpoint: z.string().optional(),
    logFile: z.string().optional()
  }).default({}),
  
  plugins: z.array(z.string()).default([])
});

module.exports = { ConfigSchema, SkillSchema, ChannelSchema };
