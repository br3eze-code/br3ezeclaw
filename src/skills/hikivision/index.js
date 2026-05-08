const DigestFetch = require('digest-fetch')
const { parseStringPromise } = require('xml2js')
const { BaseSkill } = require('../base.js')

class HikvisionSkill extends BaseSkill {
  static id = 'hikvision'
  static name = 'Hikvision CCTV'
  static description = 'Control Hikvision cameras/NVRs via ISAPI'

  constructor(config, logger, workspace) {
    super(config, logger, workspace)
    this.clients = new Map()
  }

  static getTools() {
    return {
      'hik.device.info': {
        risk: 'low',
        description: 'Get device info: model, firmware, serial',
        parameters: {
          type: 'object',
          properties: { device: { type: 'string' } },
          required: ['device']
        }
      },
      'hik.snapshot.get': {
        risk: 'low',
        description: 'Get JPEG snapshot from channel',
        parameters: {
          type: 'object',
          properties: {
            device: { type: 'string' },
            channel: { type: 'number', default: 101, description: '101=ch1 main, 102=ch1 sub' }
          },
          required: ['device']
        }
      },
      'hik.ptz.move': {
        risk: 'medium',
        description: 'PTZ continuous move. Requires approval.',
        parameters: {
          type: 'object',
          properties: {
            device: { type: 'string' },
            channel: { type: 'number', default: 1 },
            pan: { type: 'number', minimum: -100, maximum: 100, default: 0 },
            tilt: { type: 'number', minimum: -100, maximum: 100, default: 0 },
            zoom: { type: 'number', minimum: -100, maximum: 100, default: 0 },
            duration: { type: 'number', default: 1000, maximum: 5000 },
            reason: { type: 'string' }
          },
          required: ['device', 'reason']
        }
      },
      'hik.ptz.preset': {
        risk: 'medium',
        description: 'Go to PTZ preset. Requires approval.',
        parameters: {
          type: 'object',
          properties: {
            device: { type: 'string' },
            channel: { type: 'number', default: 1 },
            preset: { type: 'number', minimum: 1, maximum: 300 },
            reason: { type: 'string' }
          },
          required: ['device', 'preset', 'reason']
        }
      },
      'hik.events.search': {
        risk: 'low',
        description: 'Search event logs: VMD, linedetection, fielddetection',
        parameters: {
          type: 'object',
          properties: {
            device: { type: 'string' },
            eventTypes: { type: 'array', items: { type: 'string' }, default: ['VMD'] },
            minutes: { type: 'number', default: 60, maximum: 1440 }
          },
          required: ['device']
        }
      },
      'hik.system.reboot': {
        risk: 'high',
        description: 'Reboot device. Requires approval.',
        parameters: {
          type: 'object',
          properties: {
            device: { type: 'string' },
            reason: { type: 'string' }
          },
          required: ['device', 'reason']
        }
      }
    }
  }

  _client(deviceId) {
    if (this.clients.has(deviceId)) return this.clients.get(deviceId)
    const dev = this.workspace.hikvision_devices && this.workspace.hikvision_devices[deviceId]
    const supported = ['hikvision', 'annke', 'lts', 'trendnet', 'laview', 'ezviz']
    if (!dev || !supported.includes((dev.driver || '').toLowerCase())) {
        throw new Error(`Hikvision/OEM device ${deviceId} not found or unsupported driver`)
    }
    const client = new DigestFetch(dev.user, dev.password)
    const base = `http://${dev.host}:${dev.port || 80}/ISAPI`
    this.clients.set(deviceId, { client, base })
    return { client, base }
  }

  async _get(deviceId, path) {
    const { client, base } = this._client(deviceId)
    const res = await client.fetch(`${base}/${path}`)
    if (!res.ok) throw new Error(`Hikvision API ${res.status}: ${await res.text()}`)
    return res
  }

  async _put(deviceId, path, xml) {
    const { client, base } = this._client(deviceId)
    const res = await client.fetch(`${base}/${path}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/xml' },
      body: xml
    })
    if (!res.ok) throw new Error(`Hikvision API ${res.status}: ${await res.text()}`)
    return res
  }

  async healthCheck() {
    const first = Object.keys(this.workspace.hikvision_devices || {})[0]
    if (!first) return { status: 'ok', note: 'no Hikvision devices configured' }
    await this._get(first, 'System/deviceInfo')
    return { status: 'ok' }
  }

  async execute(toolName, args, ctx) {
    try {
      switch (toolName) {
        case 'hik.device.info':
          const res = await this._get(args.device, 'System/deviceInfo')
          const xml = await res.text()
          const json = await parseStringPromise(xml)
          const info = json.DeviceInfo
          return {
            device: args.device,
            deviceName: info.deviceName[0],
            model: info.model[0],
            serial: info.serialNumber[0],
            firmware: info.firmwareVersion[0]
          }

        case 'hik.snapshot.get':
          const ch = args.channel || 101
          const snap = await this._get(args.device, `Streaming/channels/${ch}/picture`)
          const buf = Buffer.from(await snap.arrayBuffer())
          return { channel: ch, mime: 'image/jpeg', base64: buf.toString('base64'), size: buf.length }

        case 'hik.ptz.move':
          this.logger.warn(`HIK PTZ MOVE ${args.device}`, { user: ctx.userId, reason: args.reason })
          const ch1 = args.channel || 1
          const xml1 = `<PTZData><pan>${args.pan || 0}</pan><tilt>${args.tilt || 0}</tilt><zoom>${args.zoom || 0}</zoom></PTZData>`
          await this._put(args.device, `PTZCtrl/channels/${ch1}/continuous`, xml1)
          // Auto-stop
          setTimeout(async () => {
            const stop = '<PTZData><pan>0</pan><tilt>0</tilt><zoom>0</zoom></PTZData>'
            await this._put(args.device, `PTZCtrl/channels/${ch1}/continuous`, stop)
          }, args.duration || 1000)
          return { device: args.device, channel: ch1, status: 'moving' }

        case 'hik.ptz.preset':
          this.logger.warn(`HIK PRESET ${args.preset} on ${args.device}`, { user: ctx.userId, reason: args.reason })
          const ch2 = args.channel || 1
          await this._get(args.device, `PTZCtrl/channels/${ch2}/presets/${args.preset}/goto`)
          return { device: args.device, channel: ch2, preset: args.preset }

        case 'hik.events.search':
          const end = new Date().toISOString()
          const start = new Date(Date.now() - (args.minutes || 60) * 60000).toISOString()
          const searchXML = `<?xml version="1.0" encoding="UTF-8"?>
<CMSSearchDescription>
<searchID>${Date.now()}</searchID>
<trackIDList><trackID>101</trackID></trackIDList>
<timeSpanList><timeSpan><startTime>${start}</startTime><endTime>${end}</endTime></timeSpan></timeSpanList>
<maxResults>50</maxResults>
<searchResultPostion>0</searchResultPostion>
<metadataList><metadataDescriptor>//recordType.meta.std-cgi.com/${args.eventTypes[0]}</metadataDescriptor></metadataList>
</CMSSearchDescription>`
          const search = await this._put(args.device, 'ContentMgmt/search', searchXML)
          const searchText = await search.text()
          const searchJson = await parseStringPromise(searchText)
          const matches = searchJson.CMSSearchResult?.matchList?.[0]?.searchMatchItem || []
          return matches.map(m => ({
            time: m.timeSpan[0].startTime[0],
            type: m.metadataList[0].metadataDescriptor[0],
            source: m.trackID[0]
          }))

        case 'hik.system.reboot':
          this.logger.warn(`HIK REBOOT ${args.device}`, { user: ctx.userId, reason: args.reason })
          await this._put(args.device, 'System/reboot', '')
          return { device: args.device, status: 'rebooting' }

        default:
          throw new Error(`Unknown tool ${toolName}`)
      }
    } catch (e) {
      this.logger.error(`Hikvision ${toolName} failed: ${e.message}`)
      throw e
    }
  }
}

module.exports = HikvisionSkill
