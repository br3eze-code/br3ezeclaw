const { NodePowerShell } = require('node-powershell')
const { BaseSkill } = require('../base.js')

class WindowsSkill extends BaseSkill {
  static id = 'windows'
  static name = 'Windows Server'

  constructor(config, logger, workspace) {
    super(config, logger, workspace)
    this.sessions = new Map() // hostId -> ps session
  }

  static getTools() {
    return {
      'win.service.status': {
        risk: 'low',
        description: 'Get status of Windows services',
        parameters: {
          type: 'object',
          properties: {
            host: { type: 'string', description: 'hostId from workspace' },
            name: { type: 'string', description: 'service name, * for all' }
          },
          required: ['host']
        }
      },
      'win.service.restart': {
        risk: 'medium',
        description: 'Restart a Windows service. Requires approval for critical services.',
        parameters: {
          type: 'object',
          properties: {
            host: { type: 'string' },
            name: { type: 'string', description: 'service name like Spooler' },
            reason: { type: 'string', maxLength: 200 }
          },
          required: ['host', 'name', 'reason']
        }
      },
      'win.process.list': {
        risk: 'low',
        description: 'List top processes by CPU/memory',
        parameters: {
          type: 'object',
          properties: {
            host: { type: 'string' },
            sort: { type: 'string', enum: ['cpu', 'memory'], default: 'cpu' },
            top: { type: 'number', default: 10, maximum: 50 }
          },
          required: ['host']
        }
      },
      'win.process.kill': {
        risk: 'high',
        description: 'Kill process by PID. Requires approval.',
        parameters: {
          type: 'object',
          properties: {
            host: { type: 'string' },
            pid: { type: 'number' },
            reason: { type: 'string', maxLength: 200 }
          },
          required: ['host', 'pid', 'reason']
        }
      },
      'win.eventlog.query': {
        risk: 'low',
        description: 'Query Windows Event Log',
        parameters: {
          type: 'object',
          properties: {
            host: { type: 'string' },
            log: { type: 'string', enum: ['System', 'Application', 'Security'], default: 'System' },
            level: { type: 'string', enum: ['Error', 'Warning', 'Information'], default: 'Error' },
            hours: { type: 'number', default: 24, maximum: 168 }
          },
          required: ['host']
        }
      },
      'win.ad.user.unlock': {
        risk: 'medium',
        description: 'Unlock AD user account',
        parameters: {
          type: 'object',
          properties: {
            host: { type: 'string', description: 'domain controller hostId' },
            samAccountName: { type: 'string', pattern: '^[a-zA-Z0-9._-]{1,20}$' },
            reason: { type: 'string' }
          },
          required: ['host', 'samAccountName', 'reason']
        }
      },
      'win.system.reboot': {
        risk: 'high',
        description: 'Reboot Windows server. Requires approval.',
        parameters: {
          type: 'object',
          properties: {
            host: { type: 'string' },
            reason: { type: 'string', maxLength: 200 }
          },
          required: ['host', 'reason']
        }
      }
    }
  }

  async _ps(hostId, script) {
    const host = this.workspace.windows_hosts[hostId]
    if (!host || host.driver!== 'windows') throw new Error(`Windows host ${hostId} not found`)

    const ps = new NodePowerShell({
      executionPolicy: 'Bypass',
      noProfile: true
    })

    // Use WinRM: New-PSSession -ComputerName host -Credential
    const credScript = `
      $secpass = ConvertTo-SecureString '${this.config.password}' -AsPlainText -Force
      $cred = New-Object System.Management.Automation.PSCredential ('${this.config.user}', $secpass)
      Invoke-Command -ComputerName ${host.hostname} -Credential $cred -ScriptBlock { ${script} }
    `

    await ps.addCommand(credScript)
    const output = await ps.invoke()
    await ps.dispose()
    return JSON.parse(output || '[]')
  }

  async healthCheck() {
    const firstHost = Object.keys(this.workspace.windows_hosts || {})[0]
    if (!firstHost) return { status: 'ok', note: 'no Windows hosts configured' }
    await this._ps(firstHost, 'Get-Date | ConvertTo-Json')
    return { status: 'ok' }
  }

  async execute(toolName, args, ctx) {
    try {
      switch (toolName) {
        case 'win.service.status':
          const name = args.name || '*'
          return await this._ps(args.host, `Get-Service -Name ${name} | Select Name,Status,StartType | ConvertTo-Json`)

        case 'win.service.restart':
          this.logger.warn(`WIN SERVICE RESTART ${args.host}`, { user: ctx.userId, service: args.name, reason: args.reason })
          return await this._ps(args.host, `Restart-Service -Name ${args.name} -Force -PassThru | ConvertTo-Json`)

        case 'win.process.list':
          const sort = args.sort === 'memory'? 'WS' : 'CPU'
          return await this._ps(args.host, `Get-Process | Sort-Object ${sort} -Descending | Select -First ${args.top || 10} Id,ProcessName,${sort},StartTime | ConvertTo-Json`)

        case 'win.process.kill':
          this.logger.warn(`WIN KILL PID ${args.pid} on ${args.host}`, { user: ctx.userId, reason: args.reason })
          return await this._ps(args.host, `Stop-Process -Id ${args.pid} -Force -PassThru | ConvertTo-Json`)

        case 'win.eventlog.query':
          const since = new Date(Date.now() - (args.hours || 24) * 3600_000).toISOString()
          const level = { Error: 2, Warning: 3, Information: 4 }[args.level || 'Error']
          return await this._ps(args.host, `Get-WinEvent -FilterHashtable @{LogName='${args.log || 'System'}'; Level=${level}; StartTime='${since}'} | Select -First 50 TimeCreated,Id,LevelDisplayName,Message | ConvertTo-Json`)

        case 'win.ad.user.unlock':
          this.logger.warn(`AD UNLOCK ${args.samAccountName} on ${args.host}`, { user: ctx.userId, reason: args.reason })
          return await this._ps(args.host, `Unlock-ADAccount -Identity ${args.samAccountName} -PassThru | ConvertTo-Json`)

        case 'win.system.reboot':
          this.logger.warn(`WIN REBOOT ${args.host}`, { user: ctx.userId, reason: args.reason })
          return await this._ps(args.host, `Restart-Computer -Force`)

        default:
          throw new Error(`Unknown tool ${toolName}`)
      }
    } catch (e) {
      this.logger.error(`Windows ${toolName} failed: ${e.message}`)
      throw e
    }
  }

  async disconnect() {
    // WinRM sessions auto-close
  }
}

module.exports = WindowsSkill
