const { Client } = require('ssh2')
const { BaseSkill } = require('../base.js')

class MacOSSkill extends BaseSkill {
  static id = 'macos'
  static name = 'macOS'

  constructor(config, logger, workspace) {
    super(config, logger, workspace)
    this.connections = new Map() // hostId -> ssh client
  }

  static getTools() {
    return {
      'mac.system.info': {
        risk: 'low',
        description: 'Get macOS version, uptime, load, disk, memory',
        parameters: {
          type: 'object',
          properties: {
            host: { type: 'string', description: 'hostId from workspace' }
          },
          required: ['host']
        }
      },
      'mac.process.list': {
        risk: 'low',
        description: 'List top processes by CPU or memory',
        parameters: {
          type: 'object',
          properties: {
            host: { type: 'string' },
            sort: { type: 'string', enum: ['cpu', 'mem'], default: 'cpu' },
            top: { type: 'number', default: 10, maximum: 50 }
          },
          required: ['host']
        }
      },
      'mac.process.kill': {
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
      'mac.service.restart': {
        risk: 'medium',
        description: 'Restart launchd service. Requires approval for system daemons.',
        parameters: {
          type: 'object',
          properties: {
            host: { type: 'string' },
            label: { type: 'string', description: 'launchd label like com.apple.screensharing' },
            reason: { type: 'string' }
          },
          required: ['host', 'label', 'reason']
        }
      },
      'mac.disk.usage': {
        risk: 'low',
        description: 'Get disk usage per volume',
        parameters: {
          type: 'object',
          properties: { host: { type: 'string' } },
          required: ['host']
        }
      },
      'mac.log.query': {
        risk: 'low',
        description: 'Query unified log with predicate',
        parameters: {
          type: 'object',
          properties: {
            host: { type: 'string' },
            predicate: { type: 'string', description: 'e.g. process == "kernel"' },
            last: { type: 'string', default: '1h', pattern: '^[0-9]+[smhd]$' }
          },
          required: ['host', 'predicate']
        }
      },
      'mac.brew.outdated': {
        risk: 'low',
        description: 'List outdated Homebrew packages',
        parameters: {
          type: 'object',
          properties: { host: { type: 'string' } },
          required: ['host']
        }
      },
      'mac.system.reboot': {
        risk: 'high',
        description: 'Reboot macOS host. Requires approval.',
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

  async _exec(hostId, cmd, sudo = false) {
    const host = this.workspace.macos_hosts[hostId]
    if (!host || host.driver!== 'macos') throw new Error(`macOS host ${hostId} not found`)

    return new Promise((resolve, reject) => {
      const conn = new Client()
      conn.on('ready', () => {
        const finalCmd = sudo? `sudo -S ${cmd}` : cmd
        conn.exec(finalCmd, { pty: sudo }, (err, stream) => {
          if (err) return reject(err)
          let out = '', errOut = ''
          stream.on('data', d => out += d)
          stream.stderr.on('data', d => errOut += d)
          if (sudo) stream.write(this.config.sudoPassword + '\n')
          stream.on('close', (code) => {
            conn.end()
            if (code!== 0) reject(new Error(errOut || `Exit ${code}`))
            else resolve(out.trim())
          })
        })
      }).on('error', reject).connect({
        host: host.hostname,
        port: host.port || 22,
        username: this.config.user,
        privateKey: this.config.privateKey,
        password: this.config.password,
        readyTimeout: 10000
      })
    })
  }

  async healthCheck() {
    const firstHost = Object.keys(this.workspace.macos_hosts || {})[0]
    if (!firstHost) return { status: 'ok', note: 'no macOS hosts configured' }
    await this._exec(firstHost, 'uptime')
    return { status: 'ok' }
  }

  async execute(toolName, args, ctx) {
    try {
      switch (toolName) {
        case 'mac.system.info':
          const info = await this._exec(args.host, `
            echo "{"
            echo "\\"os\\": \\"$(sw_vers -productName) $(sw_vers -productVersion) ($(sw_vers -buildVersion))\\","
            echo "\\"uptime\\": \\"$(uptime)\\","
            echo "\\"load\\": \\"$(sysctl -n vm.loadavg)\\","
            echo "\\"memory\\": { \\"pressure\\": $(memory_pressure | head -1 | awk '{print $4}') },"
            echo "\\"disk\\":"
            df -h / | tail -1 | awk '{print "{\\"used\\":\\""$3"\\", \\"avail\\":\\""$4"\\", \\"pct\\":\\""$5"\\"} "}'
            echo "}"
          `)
          return JSON.parse(info)

        case 'mac.process.list':
          const sortKey = args.sort === 'mem'? '-m' : '-r'
          const ps = await this._exec(args.host, `ps aux ${sortKey} | head -n ${(args.top || 10) + 1}`)
          const lines = ps.split('\n').slice(1)
          return lines.map(l => {
            const p = l.trim().split(/\s+/)
            return { user: p[0], pid: +p[1], cpu: +p[2], mem: +p[3], command: p.slice(10).join(' ') }
          })

        case 'mac.process.kill':
          this.logger.warn(`MAC KILL PID ${args.pid} on ${args.host}`, { user: ctx.userId, reason: args.reason })
          return await this._exec(args.host, `kill -9 ${args.pid}`, true)

        case 'mac.service.restart':
          this.logger.warn(`MAC SERVICE RESTART ${args.host}`, { user: ctx.userId, label: args.label, reason: args.reason })
          return await this._exec(args.host, `launchctl kickstart -k system/${args.label}`, true)

        case 'mac.disk.usage':
          const df = await this._exec(args.host, `df -h | tail -n +2`)
          return df.split('\n').map(l => {
            const p = l.trim().split(/\s+/)
            return { filesystem: p[0], size: p[1], used: p[2], avail: p[3], pct: p[4], mounted: p[8] }
          })

        case 'mac.log.query':
          // Sanitize predicate to avoid injection
          if (!/^[a-zA-Z0-9_.\s=<>!'"-]+$/.test(args.predicate)) throw new Error('Invalid predicate')
          return await this._exec(args.host, `log show --predicate '${args.predicate}' --last ${args.last || '1h'} --style compact`)

        case 'mac.brew.outdated':
          return await this._exec(args.host, `brew outdated --json || echo "[]"`)

        case 'mac.system.reboot':
          this.logger.warn(`MAC REBOOT ${args.host}`, { user: ctx.userId, reason: args.reason })
          return await this._exec(args.host, `shutdown -r now`, true)

        default:
          throw new Error(`Unknown tool ${toolName}`)
      }
    } catch (e) {
      this.logger.error(`macOS ${toolName} failed: ${e.message}`)
      throw e
    }
  }
}

module.exports = MacOSSkill
