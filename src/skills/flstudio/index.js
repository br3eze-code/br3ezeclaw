const { BaseSkill } = require('../base.js')
const osc = require('osc')
const MidiWriter = require('midi-writer-js')

class FLStudioSkill extends BaseSkill {
  static id = 'flstudio'
  static name = 'FL Studio'
  static description = 'Control FL Studio via OSC/MIDI: transport, mixer, playlist, patterns, automation'

  constructor(config, logger, workspace) {
    super(config, logger, workspace)
    this.oscPort = config.oscPort || 8000
    this.oscHost = config.oscHost || '127.0.0.1'
    this.oscClient = null
  }

  async init() {
    // OSC client for FL Studio OSC Controller
    this.oscClient = new osc.UDPPort({
      localAddress: '0.0.0.0',
      localPort: 8001,
      remoteAddress: this.oscHost,
      remotePort: this.oscPort
    })
    this.oscClient.open()
  }

  static getTools() {
    return {
      'flstudio.transport': {
        risk: 'low',
        description: 'Control transport: play, stop, record, loop, tempo',
        parameters: {
          type: 'object',
          properties: {
            action: { type: 'string', enum: ['play', 'stop', 'record', 'loop', 'tempo'], default: 'play' },
            value: { type: 'number', description: 'BPM for tempo' }
          },
          required: ['action']
        }
      },
      'flstudio.mixer': {
        risk: 'low',
        description: 'Control mixer: volume, pan, mute, solo, fx',
        parameters: {
          type: 'object',
          properties: {
            track: { type: 'number', description: '1-125', default: 1 },
            param: { type: 'string', enum: ['volume', 'pan', 'mute', 'solo'], default: 'volume' },
            value: { type: 'number', description: '0-1 for volume/pan, 0/1 for mute/solo' }
          },
          required: ['track', 'param', 'value']
        }
      },
      'flstudio.pattern': {
        risk: 'low',
        description: 'Generate pattern: notes, steps, drums to MIDI/OSC',
        parameters: {
          type: 'object',
          properties: {
            pattern: { type: 'string', description: 'x...x...x...x...' },
            notes: { type: 'array', items: { type: 'string' }, description: '["C4","E4","G4"]' },
            channel: { type: 'number', default: 1 },
            output: { type: 'string', enum: ['osc', 'midi'], default: 'osc' }
          },
          required: []
        }
      },
      'flstudio.playlist': {
        risk: 'low',
        description: 'Control playlist: add pattern, trigger clip, song position',
        parameters: {
          type: 'object',
          properties: {
            action: { type: 'string', enum: ['play_pattern', 'play_song', 'set_position'], default: 'play_pattern' },
            pattern: { type: 'number', description: 'pattern number' },
            position: { type: 'number', description: 'bar:beat' }
          },
          required: ['action']
        }
      },
      'flstudio.automation': {
        risk: 'low',
        description: 'Create automation: cutoff, volume, any param via OSC',
        parameters: {
          type: 'object',
          properties: {
            target: { type: 'string', description: '/Mixer/track1/volume, /Channel/1/cutoff' },
            curve: { type: 'string', enum: ['linear', 'exp', 'log', 'sine'], default: 'linear' },
            start: { type: 'number', default: 0 },
            end: { type: 'number', default: 1 },
            duration: { type: 'number', description: 'bars', default: 4 }
          },
          required: ['target']
        }
      },
      'flstudio.export': {
        risk: 'low',
        description: 'Export stems/mix: WAV/MP3, render settings',
        parameters: {
          type: 'object',
          properties: {
            mode: { type: 'string', enum: ['mix', 'stems', 'pattern'], default: 'mix' },
            format: { type: 'string', enum: ['wav', 'mp3'], default: 'wav' },
            tracks: { type: 'array', items: { type: 'number' }, description: 'for stems mode' }
          },
          required: ['mode']
        }
      }
    }
  }

  async healthCheck() {
    return { status: 'ok', osc:!!this.oscClient, port: this.oscPort }
  }

  _sendOSC(address, args) {
    if (!this.oscClient) throw new Error('OSC not initialized')
    this.oscClient.send({ address, args: Array.isArray(args)? args : [args] })
  }

  async execute(toolName, args, ctx) {
    try {
      switch (toolName) {
        case 'flstudio.transport':
          this.logger.info(`FL TRANSPORT ${args.action}`, { user: ctx.userId })
          const transportMap = {
            play: '/transport/play',
            stop: '/transport/stop',
            record: '/transport/record',
            loop: '/transport/loop',
            tempo: '/transport/tempo'
          }
          this._sendOSC(transportMap[args.action], args.action === 'tempo'? args.value : 1)
          return { action: args.action, value: args.value, address: transportMap[args.action] }

        case 'flstudio.mixer':
          this.logger.info(`FL MIXER T${args.track} ${args.param}=${args.value}`, { user: ctx.userId })
          const addr = `/Mixer/track${args.track}/${args.param}`
          this._sendOSC(addr, args.value)
          return { track: args.track, param: args.param, value: args.value, address: addr }

        case 'flstudio.pattern':
          this.logger.info(`FL PATTERN ${args.output} ch${args.channel}`, { user: ctx.userId })

          if (args.output === 'midi') {
            const track = new MidiWriter.Track()
            const steps = (args.pattern || 'x...').split('')
            const notes = args.notes || ['C4']
            const dur = '8' // 8th notes

            steps.forEach((step, i) => {
              if (step === 'x') {
                track.addEvent(new MidiWriter.NoteEvent({ pitch: notes[i % notes.length], duration: dur }))
              } else {
                track.addEvent(new MidiWriter.NoteEvent({ pitch: [], duration: dur, wait: dur }))
              }
            })

            const write = new MidiWriter.Writer(track)
            const filename = `pattern_ch${args.channel}.mid`
            const filepath = `${this.workspace}/${filename}`
            await require('fs/promises').writeFile(filepath, Buffer.from(write.buildFile()))
            return { output: 'midi', file: filename, path: filepath, steps: steps.length }
          }

          // OSC: send to FL piano roll
          if (args.pattern) {
            this._sendOSC(`/Channel/${args.channel}/pattern`, args.pattern)
          }
          if (args.notes) {
            this._sendOSC(`/Channel/${args.channel}/notes`, args.notes.join(' '))
          }
          return { output: 'osc', channel: args.channel, pattern: args.pattern, notes: args.notes }

        case 'flstudio.playlist':
          this.logger.info(`FL PLAYLIST ${args.action}`, { user: ctx.userId })
          const playlistMap = {
            play_pattern: '/playlist/playPattern',
            play_song: '/playlist/playSong',
            set_position: '/playlist/position'
          }
          const val = args.action === 'play_pattern'? args.pattern :
                     args.action === 'set_position'? args.position : 1
          this._sendOSC(playlistMap[args.action], val)
          return { action: args.action, value: val }

        case 'flstudio.automation':
          this.logger.info(`FL AUTO ${args.target} ${args.curve}`, { user: ctx.userId })
          // FL Studio OSC: automation via /Mixer/trackN/automation or /Channel/N/param
          this._sendOSC(args.target, args.end)
          return {
            target: args.target,
            curve: args.curve,
            range: [args.start, args.end],
            duration: `${args.duration} bars`,
            note: `Send LFO or envelope to ${args.target} for curves. FL: Link to controller.`
          }

        case 'flstudio.export':
          this.logger.info(`FL EXPORT ${args.mode} ${args.format}`, { user: ctx.userId })
          const exportMap = {
            mix: '/file/exportMix',
            stems: '/file/exportStems',
            pattern: '/file/exportPattern'
          }
          this._sendOSC(exportMap[args.mode], args.format === 'mp3'? 1 : 0)
          if (args.mode === 'stems' && args.tracks) {
            this._sendOSC('/file/exportTracks', args.tracks.join(','))
          }
          return {
            mode: args.mode,
            format: args.format,
            tracks: args.tracks,
            note: 'FL Studio will render to disk. Check FL export folder.'
          }

        default:
          throw new Error(`Unknown tool ${toolName}`)
      }
    } catch (e) {
      this.logger.error(`FLStudio ${toolName} failed: ${e.message}`)
      throw e
    }
  }
}

module.exports = FLStudioSkill
