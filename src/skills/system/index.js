const os = require('os')
const { exec } = require('child_process')
const { promisify } = require('util')
const execAsync = promisify(exec)
const { BaseDriver } = require('../base.js')

class SystemDriver extends BaseDriver {
  static id = 'system'
  static name = 'AgentOS System'
  static description = 'Built-in system tools: ping, health, audit, help'

  constructor(config, logger) {
    super(config, logger)
  }

  static getTools() {
    return {
      'system.ping': {
        risk: 'low',
        description: 'Ping a host from the AgentOS server itself',
        parameters: {
          type: 'object',
          properties: {
            host: { type: 'string', description: 'IP or hostname to ping' },
            count: { type: 'number', default: 4, maximum: 10 }
          },
          required: ['host']
        }
      },
      'system.doctor': {
        risk: 'low',
        description: 'Run health checks on AgentOS and all drivers',
        parameters: { type: 'object', properties: {} }
      },
      'system.audit': {
        risk: 'low',
        description: 'Get recent audit logs',
        parameters: {
          type: 'object',
          properties: {
            hours: { type: 'number', default: 24, maximum: 168 },
            status: { type: 'string', enum: ['SUCCESS', 'DENIED', 'ERROR'] }
          }
        }
      },
      'system.help': {
        risk: 'low',
        description: 'List available tools for current user',
        parameters: { type: 'object', properties: {} }
      },
      'system.info': {
        risk: 'low',
        description: 'Get AgentOS server info: uptime, load, memory',
        parameters: { type: 'object', properties: {} }
      }
    }
  }

  async healthCheck() {
    return { status: 'ok', uptime: os.uptime() }
  }

  async execute(toolName, args, ctx) {
    // ctx = { userId, registry, db, auth } passed from registry
    switch (toolName) {
      case 'system.ping':
        return this._ping(args.host, args.count || 4)

      case 'system.doctor':
        return this._doctor(ctx.registry)

      case 'system.audit':
        return ctx.db.getAuditLogs({
          hours: args.hours || 24,
          status: args.status,
          userId: ctx.userId
        })

      case 'system.help':
        return this._help(ctx.auth, ctx.registry, ctx.userId)

      case 'system.info':
        return {
          hostname: os.hostname(),
          platform: os.platform(),
          uptime_sec: os.uptime(),
          loadavg: os.loadavg(),
          memory: {
            total: os.totalmem(),
            free: os.freemem()
          },
          agentos_version: '0.2.0',
          node: process.version
        }

      default:
        throw new Error(`Tool ${toolName} not implemented in system driver`)
    }
  }

  async _ping(host, count) {
    // Basic input validation to prevent injection
    if (!/^[a-zA-Z0-9.-]+$/.test(host)) throw new Error('Invalid host')
    const cmd = process.platform === 'win32'
     ? `ping -n ${count} ${host}`
      : `ping -c ${count} ${host}`
    try {
      const { stdout } = await execAsync(cmd, { timeout: 10000 })
      return { host, output: stdout.trim() }
    } catch (e) {
      return { host, error: e.message }
    }
  }

  async _doctor(registry) {
    const results = { agentos: 'ok', drivers: {} }
    for (const [id, driver] of registry._drivers.entries()) {
      try {
        results.drivers[id] = await driver.healthCheck()
      } catch (e) {
        results.drivers[id] = { status: 'error', error: e.message }
      }
    }
    return results
  }

  _help(auth, registry, userId) {
    const role = auth.getUserRole(userId)
    const allowed = []
    for (const [name, { schema }] of registry._tools.entries()) {
      const canUse = auth._roles[role]?.tools.includes(name) || auth._roles[role]?.tools.includes('*')
      if (canUse) {
        allowed.push({
          tool: name,
          risk: schema.risk,
          desc: schema.description
        })
      }
    }
    return { role, tools: allowed }
  }
}

module.exports = SystemDriver
