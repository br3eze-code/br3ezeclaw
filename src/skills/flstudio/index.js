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
'flstudio.performance': {
  risk: 'low',
  description: 'Performance mode: launch clips, scenes, record loops, track status',
  parameters: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['launch_clip', 'launch_scene', 'stop_clip', 'record_clip', 'get_state'], default: 'launch_clip' },
      track: { type: 'number', description: '1-64', default: 1 },
      clip: { type: 'number', description: '1-64', default: 1 },
      scene: { type: 'number', description: '1-64' },
      quantize: { type: 'string', enum: ['none', '1bar', '2bar', '4bar'], default: '1bar' }
    },
    required: ['action']
  }
},
'flstudio.api': {
  risk: 'medium',
  description: 'FL Studio Python API: deep integration via MIDI Script API',
  parameters: {
    type: 'object',
    properties: {
      module: { type: 'string', enum: ['transport', 'channels', 'mixer', 'playlist', 'patterns', 'plugins', 'ui'], default: 'transport' },
      method: { type: 'string', description: 'start, stop, getChannelVolume, etc' },
      args: { type: 'array', items: { type: 'any' }, default: [] }
    },
    required: ['module', 'method']
  }
},
'flstudio.mixer_fx': {
  risk: 'low',
  description: 'Mixer FX slots: add, remove, bypass, reorder plugins',
  parameters: {
    type: 'object',
    properties: {
      track: { type: 'number', default: 1 },
      slot: { type: 'number', description: '1-10', default: 1 },
      action: { type: 'string', enum: ['add', 'remove', 'bypass', 'move'], default: 'bypass' },
      plugin: { type: 'string', description: 'Fruity Parametric EQ 2' },
      value: { type: 'number', description: '0/1 for bypass' }
    },
    required: ['track', 'slot', 'action']
  }
},
'flstudio.playlist_marker': {
  risk: 'low',
  description: 'Playlist markers: add, jump, loop region',
  parameters: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['add', 'jump', 'loop'], default: 'add' },
      position: { type: 'number', description: 'bar' },
      name: { type: 'string', description: 'Verse, Chorus' },
      color: { type: 'string', description: '#FF0000' }
    },
    required: ['action']
  }
},
'flstudio.browse': {
  risk: 'low',
  description: 'Browser: load sample, preset, project from browser',
  parameters: {
    type: 'object',
    properties: {
      type: { type: 'string', enum: ['sample', 'preset', 'project', 'plugin'], default: 'sample' },
      path: { type: 'string', description: 'Packs/Drums/Kick.wav' },
      target: { type: 'string', enum: ['channel', 'mixer', 'playlist'], default: 'channel' },
      slot: { type: 'number', default: 1 }
    },
    required: ['type', 'path']
  }
}
'flstudio.patcher': {
  risk: 'low',
  description: 'Control Patcher: presets, modules, routing, macros',
  parameters: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['load_preset', 'set_param', 'route', 'macro'], default: 'set_param' },
      preset: { type: 'string', description: 'preset name/path' },
      module: { type: 'string', description: 'Fruity Parametric EQ 2, etc' },
      param: { type: 'string', description: 'Cutoff, Resonance' },
      value: { type: 'number', description: '0-1 normalized' },
      macro: { type: 'number', description: '1-8', default: 1 }
    },
    required: ['action']
  }
},
'flstudio.script': {
  risk: 'medium',
  description: 'MIDI scripting: Python script for FL Studio MIDI Scripting API',
  parameters: {
    type: 'object',
    properties: {
      script: { type: 'string', description: 'Python code for FL MIDI Script' },
      action: { type: 'string', enum: ['install', 'reload', 'test'], default: 'test' },
      name: { type: 'string', description: 'script name', default: 'agentos_script' }
    },
    required: ['script']
  }
},
'flstudio.channel': {
  risk: 'low',
  description: 'Control channel rack: select, mute, solo, volume, pan, plugin params',
  parameters: {
    type: 'object',
    properties: {
      channel: { type: 'number', description: '1-999', default: 1 },
      action: { type: 'string', enum: ['select', 'mute', 'solo', 'volume', 'pan', 'param'], default: 'select' },
      value: { type: 'number' },
      param: { type: 'string', description: 'for param action: cutoff, res' }
    },
    required: ['channel', 'action']
  }
},
'flstudio.plugin': {
  risk: 'low',
  description: 'Control plugins: Harmor, Sytrus, Serum, etc. via OSC',
  parameters: {
    type: 'object',
    properties: {
      plugin: { type: 'string', description: 'Harmor, Sytrus, Serum' },
      channel: { type: 'number', default: 1 },
      param: { type: 'string', description: 'partA_cutoff, osc1_shape' },
      value: { type: 'number', description: '0-1 normalized' }
    },
    required: ['plugin', 'param', 'value']
  }
},
'flstudio.piano_roll': {
  risk: 'low',
  description: 'Piano roll: add notes, clear, quantize, humanize',
  parameters: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['add_note', 'clear', 'quantize', 'humanize'], default: 'add_note' },
      note: { type: 'string', description: 'C4, D#5' },
      position: { type: 'number', description: 'steps from start' },
      length: { type: 'number', description: 'steps', default: 4 },
      velocity: { type: 'number', description: '0-127', default: 100 },
      channel: { type: 'number', default: 1 }
    },
    required: ['action']
  }
}
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
    case 'flstudio.performance':
  this.logger.info(`FL PERFORMANCE ${args.action} T${args.track}C${args.clip}`, { user: ctx.userId })
  const perfMap = {
    launch_clip: `/performance/launch/${args.track}/${args.clip}`,
    stop_clip: `/performance/stop/${args.track}/${args.clip}`,
    launch_scene: `/performance/scene/${args.scene}`,
    record_clip: `/performance/record/${args.track}/${args.clip}`,
    get_state: '/performance/state'
  }
  this._sendOSC(perfMap[args.action], args.quantize === 'none'? 0 : 1)
  return {
    action: args.action,
    track: args.track,
    clip: args.clip,
    scene: args.scene,
    quantize: args.quantize,
    address: perfMap[args.action],
    note: 'Enable Performance Mode in FL: View → Playlist → Performance mode'
  }

case 'flstudio.api':
  this.logger.info(`FL API ${args.module}.${args.method}`, { user: ctx.userId })
  // FL Studio Python API via MIDI Script - returns code to execute
  const apiModules = {
    transport: {
      start: 'transport.start()',
      stop: 'transport.stop()',
      record: 'transport.record()',
      getSongPos: 'transport.getSongPos()',
      setSongPos: `transport.setSongPos(${args.args[0]})`
    },
    channels: {
      getChannelName: `channels.getChannelName(${args.args[0]})`,
      setChannelVolume: `channels.setChannelVolume(${args.args[0]}, ${args.args[1]})`,
      getChannelVolume: `channels.getChannelVolume(${args.args[0]})`,
      isChannelMuted: `channels.isChannelMuted(${args.args[0]})`,
      muteChannel: `channels.muteChannel(${args.args[0]})`
    },
    mixer: {
      setTrackVolume: `mixer.setTrackVolume(${args.args[0]}, ${args.args[1]})`,
      getTrackVolume: `mixer.getTrackVolume(${args.args[0]})`,
      getTrackName: `mixer.getTrackName(${args.args[0]})`,
      isTrackMuted: `mixer.isTrackMuted(${args.args[0]})`
    },
    playlist: {
      jumpToMarker: `playlist.jumpToMarker(${args.args[0]})`,
      getVisTrackCount: 'playlist.getVisTrackCount()'
    },
    patterns: {
      getPatternName: `patterns.getPatternName(${args.args[0]})`,
      patternCount: 'patterns.patternCount()'
    },
    ui: {
      showNotification: `ui.showNotification("${args.args[0]}")`,
      setHintMsg: `ui.setHintMsg("${args.args[0]}")`
    }
  }

  const code = apiModules[args.module]?.[args.method]
  if (!code) throw new Error(`Unknown API: ${args.module}.${args.method}`)

  return {
    module: args.module,
    method: args.method,
    code,
    note: 'Add to FL MIDI Script OnMidiMsg/OnRefresh. See: https://il.be/FLP/API'
  }

case 'flstudio.mixer_fx':
  this.logger.info(`FL MIXER_FX T${args.track}S${args.slot} ${args.action}`, { user: ctx.userId })
  const fxMap = {
    add: `/Mixer/track${args.track}/slot${args.slot}/add`,
    remove: `/Mixer/track${args.track}/slot${args.slot}/remove`,
    bypass: `/Mixer/track${args.track}/slot${args.slot}/bypass`,
    move: `/Mixer/track${args.track}/slot${args.slot}/move`
  }
  const val = args.action === 'add'? args.plugin : args.action === 'bypass'? args.value : args.slot
  this._sendOSC(fxMap[args.action], val)
  return {
    track: args.track,
    slot: args.slot,
    action: args.action,
    plugin: args.plugin,
    address: fxMap[args.action]
  }

case 'flstudio.playlist_marker':
  this.logger.info(`FL MARKER ${args.action} ${args.name}`, { user: ctx.userId })
  const markerMap = {
    add: '/Playlist/addMarker',
    jump: '/Playlist/jumpToMarker',
    loop: '/Playlist/setLoopPoints'
  }
  const val = args.action === 'add'? JSON.stringify({pos: args.position, name: args.name, color: args.color}) :
              args.position
  this._sendOSC(markerMap[args.action], val)
  return { action: args.action, position: args.position, name: args.name, address: markerMap[args.action] }

case 'flstudio.browse':
  this.logger.info(`FL BROWSE ${args.type} ${args.path}`, { user: ctx.userId })
  const browseMap = {
    sample: '/Browser/loadSample',
    preset: '/Browser/loadPreset',
    project: '/Browser/loadProject',
    plugin: '/Browser/loadPlugin'
  }
  this._sendOSC(browseMap[args.type], JSON.stringify({path: args.path, target: args.target, slot: args.slot}))
  return {
    type: args.type,
    path: args.path,
    target: args.target,
    slot: args.slot,
    note: 'Path relative to FL Browser root. E.g: Packs/Drums/Kicks/808.wav'
  }
          case 'flstudio.patcher':
  this.logger.info(`FL PATCHER ${args.action}`, { user: ctx.userId })
  const patcherMap = {
    load_preset: '/Patcher/loadPreset',
    set_param: `/Patcher/${args.module}/${args.param}`,
    macro: `/Patcher/Macro${args.macro}`,
    route: '/Patcher/connect'
  }
  const addr = patcherMap[args.action]
  const val = args.action === 'load_preset'? args.preset : 
              args.action === 'macro'? args.value : 
              args.value
  this._sendOSC(addr, val)
  return {
    action: args.action,
    address: addr,
    value: val,
    note: args.action === 'load_preset'? 'Load .fst preset' : 'Value 0-1 normalized'
  }

case 'flstudio.script':
  this.logger.info(`FL SCRIPT ${args.action} ${args.name}`, { user: ctx.userId })
  const fs = require('fs/promises')
  const path = require('path')

  const scriptPath = `${this.workspace}/fl_scripts`
  await fs.mkdir(scriptPath, { recursive: true })
  const filePath = path.join(scriptPath, `${args.name}.py`)

  if (args.action === 'install' || args.action === 'test') {
    const template = `# FL Studio MIDI Script - ${args.name}
# Name: ${args.name}
# Author: AgentOS

import midi
import channels
import mixer
import transport
import ui

def OnInit():
    print('${args.name} loaded')

def OnMidiMsg(event):
    event.handled = False
    # User script below
${args.script.split('\n').map(l => '    ' + l).join('\n')}

def OnRefresh(flags):
    pass
`
    await fs.writeFile(filePath, template)
  }

  if (args.action === 'reload') {
    this._sendOSC('/script/reload', args.name)
  }

  return {
    action: args.action,
    name: args.name,
    path: filePath,
    note: 'Copy to: Documents/Image-Line/FL Studio/Settings/Hardware/' + args.name + '/device_' + args.name + '.py',
    install: 'Restart FL Studio → Options → MIDI Settings → select controller → Script'
  }

case 'flstudio.channel':
  this.logger.info(`FL CHANNEL ${args.channel} ${args.action}`, { user: ctx.userId })
  const channelMap = {
    select: '/Channel/select',
    mute: '/Channel/mute',
    solo: '/Channel/solo',
    volume: `/Channel/${args.channel}/volume`,
    pan: `/Channel/${args.channel}/pan`,
    param: `/Channel/${args.channel}/${args.param}`
  }
  const val = args.action === 'select'? args.channel :
              args.action === 'mute' || args.action === 'solo'? (args.value? 1 : 0) :
              args.value
  this._sendOSC(channelMap[args.action], val)
  return { channel: args.channel, action: args.action, value: val, address: channelMap[args.action] }

case 'flstudio.plugin':
  this.logger.info(`FL PLUGIN ${args.plugin} ${args.param}=${args.value}`, { user: ctx.userId })
  const addr = `/Plugin/${args.plugin}/${args.param}`
  this._sendOSC(addr, args.value)
  return {
    plugin: args.plugin,
    channel: args.channel,
    param: args.param,
    value: args.value,
    address: addr,
    note: 'Link plugin param to OSC in FL: Right-click → Link to controller → OSC'
  }

case 'flstudio.piano_roll':
  this.logger.info(`FL PIANO_ROLL ${args.action}`, { user: ctx.userId })
  const pianoMap = {
    add_note: '/PianoRoll/addNote',
    clear: '/PianoRoll/clear',
    quantize: '/PianoRoll/quantize',
    humanize: '/PianoRoll/humanize'
  }

  if (args.action === 'add_note') {
    const noteData = {
      note: args.note,
      pos: args.position,
      len: args.length,
      vel: args.velocity,
      ch: args.channel
    }
    this._sendOSC(pianoMap.add_note, JSON.stringify(noteData))
    return { action: 'add_note', note: args.note, position: args.position, channel: args.channel }
  }

  this._sendOSC(pianoMap[args.action], 1)
  return { action: args.action, channel: args.channel }
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
