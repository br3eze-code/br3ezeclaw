const { PythonShell } = require('python-shell')
const path = require('path')
const { BaseSkill } = require('../base.js')

class VMwareSkill extends BaseSkill {
  static id = 'vmware'
  static name = 'VMware vSphere'

  constructor(config, logger, workspace) {
    super(config, logger, workspace)
    this.bridgePath = path.join(__dirname, 'bridge.py')
  }

  static getTools() {
    return {
      'vmw.vms.list': {
        risk: 'low',
        description: 'List VMs in a vCenter',
        parameters: {
          type: 'object',
          properties: {
            vcenter: { type: 'string', description: 'vcenterId from workspace' }
          },
          required: ['vcenter']
        }
      },
      'vmw.vm.power': {
        risk: 'high',
        description: 'Power on/off VM. Requires approval.',
        parameters: {
          type: 'object',
          properties: {
            vcenter: { type: 'string' },
            vm: { type: 'string', description: 'VM name' },
            state: { type: 'string', enum: ['on', 'off'] },
            reason: { type: 'string', maxLength: 200 }
          },
          required: ['vcenter', 'vm', 'state', 'reason']
        }
      },
      'vmw.vm.reboot': {
        risk: 'medium',
        description: 'Guest OS reboot. Requires approval.',
        parameters: {
          type: 'object',
          properties: {
            vcenter: { type: 'string' },
            vm: { type: 'string' },
            reason: { type: 'string', maxLength: 200 }
          },
          required: ['vcenter', 'vm', 'reason']
        }
      }
    }
  }

  async _call(action, args) {
    const vc = this.workspace.vcenters[args.vcenter]
    if (!vc || vc.driver!== 'vmware') throw new Error(`vCenter ${args.vcenter} not found`)

    const payload = {
      host: vc.host,
      user: this.config.user,
      password: this.config.password,
      action,
    ...args
    }

    return new Promise((resolve, reject) => {
      const py = new PythonShell(this.bridgePath, { mode: 'json' })
      py.send(payload)
      py.on('message', msg => resolve(msg))
      py.on('error', reject)
      py.on('pythonError', reject)
      py.end()
    })
  }

  async healthCheck() {
    const first = Object.keys(this.workspace.vcenters || {})[0]
    if (!first) return { status: 'ok', note: 'no vCenters configured' }
    await this._call('vms.list', { vcenter: first })
    return { status: 'ok' }
  }

  async execute(toolName, args, ctx) {
    switch (toolName) {
      case 'vmw.vms.list':
        return await this._call('vms.list', args)

      case 'vmw.vm.power':
        this.logger.warn(`VMWARE POWER ${args.state} ${args.vm}`, { user: ctx.userId, reason: args.reason })
        return await this._call('vm.power', args)

      case 'vmw.vm.reboot':
        this.logger.warn(`VMWARE REBOOT ${args.vm}`, { user: ctx.userId, reason: args.reason })
        return await this._call('vm.reboot', args)

      default:
        throw new Error(`Unknown tool ${toolName}`)
    }
  }
}

module.exports = VMwareSkill
