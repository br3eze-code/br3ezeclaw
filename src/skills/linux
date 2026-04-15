const { Client } = require('ssh2')
const { BaseSkill } = require('../base.js')

class LinuxSkill extends BaseSkill {
  static id = 'linux'
  static name = 'Linux Server'

  constructor(config, logger, workspace) {
    super(config, logger, workspace)
  }

  static getTools() {
    return {
      'lin.system.info': {
        risk: 'low',
        description: 'Get distro, kernel, uptime, load, memory, disk',
        parameters: {
          type: 'object',
          properties: { host: { type: 'string', description: 'hostId from workspace' } },
          required: ['host']
        }
      },
      'lin.service.status': {
        risk: 'low',
        description: 'Check systemd service status',
        parameters: {
          type: 'object',
          properties: {
            host: { type: 'string' },
            name: { type: 'string', description: 'service name like nginx' }
          },
          required: ['host', 'name']
        }
      },
      'lin.service.restart': {
        risk: 'medium',
        description: 'Restart systemd service. Requires approval.',
        parameters: {
          type: 'object',
          properties: {
            host: { type: 'string' },
            name: { type: 'string' },
            reason: { type: 'string', maxLength: 200 }
          },
          required: ['host', 'name', 'reason']
        }
      },
      'lin.process.list': {
        risk: 'low',
        description: 'Top processes by CPU or memory',
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
      'lin.process.kill': {
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
      'lin.logs.journal': {
        risk: 'low',
        description: 'Query journalctl logs',
        parameters: {
          type: 'object',
          properties: {
            host: { type: 'string' },
            unit: { type: 'string', description: 'systemd unit like nginx.service' },
            since: { type: 'string', default: '1h', pattern: '^[0-9]+[mhd]$' },
            priority: { type: 'string', enum: ['emerg', 'alert', 'crit', 'err', 'warning'], default: 'err' }
          },
          required: ['host']
        }
      },
      'lin.pkg.outdated': {
        risk: 'low',
        description: 'List outdated packages. Auto-detects apt/yum/dnf',
        parameters: {
          type: 'object',
          properties: { host: { type: 'string' } },
          required: ['host']
        }
      },
      'lin.system.reboot': {
        risk: 'high',
        description: 'Reboot Linux host. Requires approval.',
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
    const host = this.workspace.linux_hosts[hostId]
    if (!host || host.driver!== 'linux') throw new Error(`Linux host ${hostId} not found`)

    return new Promise((resolve, reject) => {
      const conn = new Client()
      conn.on('ready', () => {
        const finalCmd = sudo? `sudo -S ${cmd}` : cmd
        conn.exec(finalCmd, { pty: sudo }, (err, stream) => {
          if (err) return reject(err)
          let out = '', errOut = ''
          stream.on('data', d => out += d)
          stream.stderr.on('data', d => errOut += d)
          if (sudo && this.config.sudoPassword) stream.write(this.config.sudoPassword + '\n')
          stream.on('close', code => {
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
    const firstHost = Object.keys(this.workspace.linux_hosts || {})[0]
    if (!firstHost) return { status: 'ok', note: 'no Linux hosts configured' }
    await this._exec(firstHost, 'uptime')
    return { status: 'ok' }
  }

  async execute(toolName, args, ctx) {
    try {
      switch (toolName) {
        case 'lin.system.info':
          const info = await this._exec(args.host, `
            echo "{"
            echo "\\"distro\\": \\"$(. /etc/os-release && echo $PRETTY_NAME)\\","
            echo "\\"kernel\\": \\"$(uname -r)\\","
            echo "\\"uptime\\": \\"$(uptime -p)\\","
            echo "\\"load\\": \\"$(cat /proc/loadavg | awk '{print $1,$2,$3}')\\","
            echo "\\"memory\\":"
            free -h | awk '/Mem:/ {print "{\\"total\\":\\""$2"\\", \\"used\\":\\""$3"\\", \\"free\\":\\""$4"\\"}"}',"
            echo "\\"disk\\":"
            df -h / | tail -1 | awk '{print "{\\"used\\":\\""$3"\\", \\"avail\\":\\""$4"\\", \\"pct\\":\\""$5"\\"}" }'
            echo "}"
          `)
          return JSON.parse(info)

        case 'lin.service.status':
          return await this._exec(args.host, `systemctl show ${args.name} --no-page -p LoadState,ActiveState,SubState | tr '\n' ' '`)

        case 'lin.service.restart':
          this.logger.warn(`LINUX SERVICE RESTART ${args.host}`, { user: ctx.userId, service: args.name, reason: args.reason })
          return await this._exec(args.host, `systemctl restart ${args.name}`, true)

        case 'lin.process.list':
          const sort = args.sort === 'mem'? '--sort=-%mem' : '--sort=-%cpu'
          const ps = await this._exec(args.host, `ps -eo pid,user,%cpu,%mem,comm ${sort} | head -n ${(args.top || 10) + 1}`)
          return ps.split('\n').slice(1).map(l => {
            const p = l.trim().split(/\s+/)
            return { pid: +p[0], user: p[1], cpu: +p[2], mem: +p[3], command: p.slice(4).join(' ') }
          })

        case 'lin.process.kill':
          this.logger.warn(`LINUX KILL PID ${args.pid} on ${args.host}`, { user: ctx.userId, reason: args.reason })
          return await this._exec(args.host, `kill -9 ${args.pid}`, true)

        case 'lin.logs.journal':
          const unit = args.unit? `-u ${args.unit}` : ''
          const prio = args.priority || 'err'
          return await this._exec(args.host, `journalctl ${unit} -p ${prio} --since="${args.since || '1h'}" --no-pager -n 50`)

        case 'lin.pkg.outdated':
          // Auto-detect package manager
          const pm = await this._exec(args.host, `command -v apt && echo apt || command -v dnf && echo dnf || command -v yum && echo yum`)
          if (pm === 'apt') return await this._exec(args.host, `apt list --upgradable 2>/dev/null | tail -n +2`)
          if (pm === 'dnf') return await this._exec(args.host, `dnf check-update -q || true`)
          if (pm === 'yum') return await this._exec(args.host, `yum check-update -q || true`)
          throw new Error('No supported package manager found')

        case 'lin.system.reboot':
          this.logger.warn(`LINUX REBOOT ${args.host}`, { user: ctx.userId, reason: args.reason })
          return await this._exec(args.host, `reboot`, true)

        default:
          throw new Error(`Unknown tool ${toolName}`)
      }
    } catch (e) {
      this.logger.error(`Linux ${toolName} failed: ${e.message}`)
      throw e
    }
  }
}

module.exports = LinuxSkill
