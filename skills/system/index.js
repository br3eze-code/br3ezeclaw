const os = require('os')
const { exec } = require('child_process')
const { promisify } = require('util')
const execAsync = promisify(exec)
const { BaseSkill } = require('../base.js')

class SystemSkill extends BaseSkill {
  static id = 'system'
  static name = 'AgentOS System'

  static getTools() {
    return {
      'sys.ping': {
        risk: 'low',
        description: 'Ping a host from the AgentOS server',
        parameters: {
          type: 'object',
          properties: {
            host: { type: 'string' },
            count: { type: 'number', default: 4, maximum: 10 }
          },
          required: ['host']
        }
      },
      'sys.doctor': {
        risk: 'low',
        description: 'Run health checks on AgentOS and all skills',
        parameters: { type: 'object', properties: {} }
      },
      'sys.audit': {
        risk: 'low',
        description: 'Get recent audit logs for current user',
        parameters: {
          type: 'object',
          properties: {
            hours: { type: 'number', default: 24, maximum: 168 }
          }
        }
      },
      'sys.help': {
        risk: 'low',
        description: 'List available tools for current user',
        parameters: { type: 'object', properties: {} }
      }
    }
  }

  async execute(toolName, args, ctx) {
    switch (toolName) {
      case 'sys.ping':
        if (!/^[a-zA-Z0-9.-]+$/.test(args.host)) throw new Error('Invalid host')
        const cmd = process.platform === 'win32'? `ping -n ${args.count || 4} ${args.host}` : `ping -c ${args.count || 4} ${args.host}`
        const { stdout } = await execAsync(cmd, { timeout: 10000 })
        return { host: args.host, output: stdout.trim() }

      case 'sys.doctor':
        const results = { agentos: 'ok', skills: {} }
        for (const [id, skill] of ctx.agent.registry.drivers.entries()) {
          try { results.skills[id] = await skill.healthCheck() }
          catch (e) { results.skills[id] = { status: 'error', error: e.message } }
        return results

      case 'sys.audit':
        return ctx.agent.db.getAuditLogs({ hours: args.hours || 24, userId: ctx.userId })

      case 'sys.help':
        const role = ctx.agent.auth.getUserRole(ctx.userId)
        const tools = [...ctx.agent.registry.tools.entries()]
        .filter(([name]) => ctx.agent.auth.canUseTool(role, name))
        .map(([name, { schema }]) => ({ tool: name, risk: schema.risk, desc: schema.description }))
        return { role, tools }

      default:
        throw new Error(`Unknown tool ${toolName}`)
    }
  }
}

module.exports = SystemSkill
