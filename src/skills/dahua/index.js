const DigestFetch = require('digest-fetch')
const { BaseSkill } = require('../base.js')

class DahuaSkill extends BaseSkill {
  static id = 'dahua'
  static name = 'Dahua CCTV'
  static description = 'Control Dahua cameras/NVRs: PTZ, snapshots, events, device mgmt'

  constructor(config, logger, workspace) {
    super(config, logger, workspace)
    this.clients = new Map() // deviceId -> DigestFetch client
  }

  static getTools() {
    return {
      'dahua.device.list': {
        risk: 'low',
        description: 'List all available Dahua devices in the workspace',
        parameters: {
          type: 'object',
          properties: {},
          required: []
        }
      },
      'dahua.device.info': {
        risk: 'low',
        description: 'Get device info: model, firmware, serial',
        parameters: {
          type: 'object',
          properties: {
            device: { type: 'string', description: 'deviceId from workspace (optional, defaults to first)' }
          },
          required: []
        }
      },
      'dahua.snapshot.get': {
        risk: 'low',
        description: 'Get JPEG snapshot from camera channel',
        parameters: {
          type: 'object',
          properties: {
            device: { type: 'string', description: 'Optional device ID' },
            channel: { type: 'number', default: 1, description: 'channel for NVRs' }
          },
          required: []
        }
      },
      'dahua.ptz.move': {
        risk: 'medium',
        description: 'PTZ move: Up, Down, Left, Right, ZoomIn, ZoomOut. Requires approval.',
        parameters: {
          type: 'object',
          properties: {
            device: { type: 'string', description: 'Optional device ID' },
            channel: { type: 'number', default: 1 },
            action: { type: 'string', enum: ['Up', 'Down', 'Left', 'Right', 'LeftUp', 'LeftDown', 'RightUp', 'RightDown', 'ZoomWide', 'ZoomTele', 'Stop'] },
            speed: { type: 'number', minimum: 1, maximum: 8, default: 4 },
            reason: { type: 'string', maxLength: 200 }
          },
          required: ['action', 'reason']
        }
      },
      'dahua.ptz.preset': {
        risk: 'medium',
        description: 'Go to PTZ preset. Requires approval.',
        parameters: {
          type: 'object',
          properties: {
            device: { type: 'string', description: 'Optional device ID' },
            channel: { type: 'number', default: 1 },
            preset: { type: 'number', minimum: 1, maximum: 255 },
            reason: { type: 'string' }
          },
          required: ['preset', 'reason']
        }
      },
      'dahua.events.subscribe': {
        risk: 'low',
        description: 'Get recent alarm events: motion, IVS, alarm',
        parameters: {
          type: 'object',
          properties: {
            device: { type: 'string', description: 'Optional device ID' },
            codes: { type: 'array', items: { type: 'string' }, default: ['VideoMotion', 'CrossLineDetection'] },
            minutes: { type: 'number', default: 60, maximum: 1440 }
          },
          required: []
        }
      },
      'dahua.system.reboot': {
        risk: 'high',
        description: 'Reboot Dahua device. Requires approval.',
        parameters: {
          type: 'object',
          properties: {
            device: { type: 'string', description: 'Optional device ID' },
            reason: { type: 'string', maxLength: 200 }
          },
          required: ['reason']
        }
      }
    }
  }

  _client(deviceId) {
    const targetDevice = deviceId || Object.keys(this.workspace.dahua_devices || {})[0]
    if (!targetDevice) {
      throw new Error('No Dahua devices configured in workspace')
    }

    if (this.clients.has(targetDevice)) return this.clients.get(targetDevice)

    const dev = this.workspace.dahua_devices && this.workspace.dahua_devices[targetDevice]
    const supported = ['dahua', 'amcrest', 'lorex', 'qsee', 'icrealtime']
    if (!dev || !supported.includes((dev.driver || '').toLowerCase())) {
        throw new Error(`Dahua/OEM device ${targetDevice} not found or unsupported driver`)
    }

    const client = new DigestFetch(dev.user, dev.password)
    this.clients.set(targetDevice, { client, base: `http://${dev.host}:${dev.port || 80}/cgi-bin`, deviceId: targetDevice })
    return this.clients.get(targetDevice)
  }

  async _get(deviceId, path) {
    const { client, base, deviceId: resolvedId } = this._client(deviceId)
    const res = await client.fetch(`${base}/${path}`)
    if (!res.ok) throw new Error(`Dahua API ${res.status} on device ${resolvedId}: ${await res.text()}`)
    return res
  }

  async healthCheck() {
    const first = Object.keys(this.workspace.dahua_devices || {})[0]
    if (!first) return { status: 'ok', note: 'no Dahua devices configured' }
    await this._get(first, 'magicBox.cgi?action=getMachineName')
    return { status: 'ok' }
  }

  async execute(toolName, args, ctx) {
    try {
      switch (toolName) {
        case 'dahua.device.list':
          return Object.keys(this.workspace.dahua_devices || {}).map(id => {
            const dev = this.workspace.dahua_devices[id];
            return { id, host: dev.host, driver: dev.driver, name: dev.name || id };
          });

        case 'dahua.device.info':
          const targetInfoDevice = args.device || Object.keys(this.workspace.dahua_devices || {})[0];
          const info = await this._get(targetInfoDevice, 'magicBox.cgi?action=getDeviceType')
          const name = await this._get(targetInfoDevice, 'magicBox.cgi?action=getMachineName')
          const serial = await this._get(targetInfoDevice, 'magicBox.cgi?action=getSerialNo')
          const version = await this._get(targetInfoDevice, 'magicBox.cgi?action=getSoftwareVersion')
          return {
            device: targetInfoDevice,
            type: (await info.text()).split('=')[1]?.trim(),
            name: (await name.text()).split('=')[1]?.trim(),
            serial: (await serial.text()).split('=')[1]?.trim(),
            version: (await version.text()).split('=')[1]?.trim()
          }

        case 'dahua.snapshot.get':
          const ch = args.channel || 1
          const snap = await this._get(args.device, `snapshot.cgi?channel=${ch}`)
          const buf = Buffer.from(await snap.arrayBuffer())
          // Return base64 for Slack/Telegram. AgentOS gateway can convert to file.
          return {
            channel: ch,
            mime: 'image/jpeg',
            base64: buf.toString('base64'),
            size: buf.length
          }

        case 'dahua.ptz.move':
          const targetMoveDevice = args.device || Object.keys(this.workspace.dahua_devices || {})[0];
          this.logger.warn(`DAHUA PTZ ${args.action} on ${targetMoveDevice}`, { user: ctx.userId, reason: args.reason })
          const ch1 = args.channel || 1
          const cmd = `ptz.cgi?action=start&channel=${ch1}&code=${args.action}&arg1=0&arg2=${args.speed || 4}&arg3=0`
          await this._get(targetMoveDevice, cmd)
          // Auto-stop after 1s for safety
          setTimeout(() => this._get(targetMoveDevice, `ptz.cgi?action=stop&channel=${ch1}&code=${args.action}`), 1000)
          return { device: targetMoveDevice, channel: ch1, action: args.action, status: 'moving' }

        case 'dahua.ptz.preset':
          const targetPresetDevice = args.device || Object.keys(this.workspace.dahua_devices || {})[0];
          this.logger.warn(`DAHUA PRESET ${args.preset} on ${targetPresetDevice}`, { user: ctx.userId, reason: args.reason })
          const ch2 = args.channel || 1
          await this._get(targetPresetDevice, `ptz.cgi?action=start&channel=${ch2}&code=GotoPreset&arg1=0&arg2=${args.preset}&arg3=0`)
          return { device: targetPresetDevice, channel: ch2, preset: args.preset }

        case 'dahua.events.subscribe':
          // Get event log via log.cgi
          const end = Math.floor(Date.now() / 1000)
          const start = end - (args.minutes || 60) * 60
          const codes = (args.codes || ['VideoMotion']).join(',')
          const events = await this._get(args.device, `log.cgi?action=find&startTime=${start}&endTime=${end}&types=${codes}`)
          const text = await events.text()
          // Parse: items[0].Time=... items[0].Type=VideoMotion
          const items = []
          text.split('\n').forEach(line => {
            const m = line.match(/items\[(\d+)\]\.(\w+)=(.*)/)
            if (m) {
              const [, idx, key, val] = m
              items[idx] = items[idx] || {}
              items[idx][key] = val.trim()
            }
          })
          return items.filter(Boolean).slice(-50) // last 50

        case 'dahua.system.reboot':
          const targetRebootDevice = args.device || Object.keys(this.workspace.dahua_devices || {})[0];
          this.logger.warn(`DAHUA REBOOT ${targetRebootDevice}`, { user: ctx.userId, reason: args.reason })
          await this._get(targetRebootDevice, 'magicBox.cgi?action=reboot')
          return { device: targetRebootDevice, status: 'rebooting' }

        default:
          throw new Error(`Unknown tool ${toolName}`)
      }
    } catch (e) {
      this.logger.error(`Dahua ${toolName} failed: ${e.message}`)
      throw e
    }
  }
}

module.exports = DahuaSkill
