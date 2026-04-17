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
'flstudio.ai': {
  risk: 'low',
  description: 'AI composition: MIDI generation, melody/chords, style transfer, inpainting',
  parameters: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['generate_melody', 'generate_chords', 'style_transfer', 'inpaint', 'continue'], default: 'generate_melody' },
      prompt: { type: 'string', description: 'trap 140 BPM, lofi jazz, cyberpunk' },
      key: { type: 'string', default: 'C' },
      scale: { type: 'string', default: 'major' },
      bars: { type: 'number', default: 4 },
      reference_track: { type: 'number', description: 'channel for style_transfer' },
      model: { type: 'string', enum: ['musicgen', 'magenta', 'aiva'], default: 'musicgen' }
    },
    required: ['action']
  }
},
'flstudio.ai_master': {
  risk: 'low',
  description: 'AI stem mastering: isolate, master, rebalance stems',
  parameters: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['separate', 'master', 'rebalance'], default: 'master' },
      file: { type: 'string', description: 'mix.wav or attachment://N' },
      target_lufs: { type: 'number', default: -14 },
      stems: { type: 'array', items: { type: 'string' }, enum: ['vocals', 'drums', 'bass', 'other'], default: ['vocals', 'drums', 'bass', 'other'] },
      reference: { type: 'string', description: 'reference track for match' }
    },
    required: ['action']
  }
},
'flstudio.video': {
  risk: 'low',
  description: 'ZGameEditor Visualizer: load video, sync to audio, export MP4',
  parameters: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['load_video', 'load_effect', 'set_param', 'export'], default: 'load_effect' },
      file: { type: 'string', description: 'video.mp4 or effect.preset' },
      effect: { type: 'string', description: 'Spectrum, Wave, Image, Text' },
      param: { type: 'string', description: 'color, size, speed' },
      value: { type: 'any' },
      resolution: { type: 'string', enum: ['1080p', '4K', '720p'], default: '1080p' }
    },
    required: ['action']
  }
},
'flstudio.sync': {
  risk: 'low',
  description: 'Video/audio sync: timecode, markers to video frames',
  parameters: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['set_tc', 'marker_to_frame', 'video_to_audio'], default: 'set_tc' },
      timecode: { type: 'string', description: '01:00:00' },
      fps: { type: 'number', default: 30 },
      marker: { type: 'string', description: 'marker name' }
    },
    required: ['action']
  }
},
'flstudio.visualizer': {
  risk: 'low',
  description: 'Audio-reactive visuals: spectrum, waveform, MIDI → visuals',
  parameters: {
    type: 'object',
    properties: {
      type: { type: 'string', enum: ['spectrum', 'wave', 'image', 'text', 'particles'], default: 'spectrum' },
      audio_source: { type: 'string', enum: ['master', 'track'], default: 'master' },
      track: { type: 'number', description: 'if audio_source=track' },
      reactive: { type: 'string', enum: ['volume', 'pitch', 'transient'], default: 'volume' },
      color: { type: 'string', default: '#00FF00' }
    },
    required: ['type']
  }
}
'flstudio.arrangement': {
  risk: 'low',
  description: 'Song structure AI: generate arrangements, apply templates, auto-arrange',
  parameters: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['generate', 'apply_template', 'analyze'], default: 'generate' },
      template: { type: 'string', enum: ['pop', 'edm', 'hiphop', 'rock', 'verse_chorus', 'abacab'], default: 'pop' },
      length: { type: 'number', description: 'bars', default: 64 },
      genre: { type: 'string', description: 'for AI generation' },
      energy: { type: 'array', items: { type: 'number' }, description: 'energy curve 0-1' }
    },
    required: ['action']
  }
},
'flstudio.structure': {
  risk: 'low',
  description: 'Build playlist structure: sections, clips, automation points',
  parameters: {
    type: 'object',
    properties: {
      sections: { type: 'array', items: { type: 'object' }, description: '[{name:"Intro",bars:8},{name:"Verse",bars:16}]' },
      clips: { type: 'object', description: '{"Verse":[1,2],"Chorus":[3,4]}' }
    },
    required: ['sections']
  }
},
'flstudio.hardware': {
  risk: 'low',
  description: 'Hardware controllers: Akai Fire, Launchpad, Maschine, LED feedback',
  parameters: {
    type: 'object',
    properties: {
      device: { type: 'string', enum: ['akai_fire', 'launchpad', 'maschine', 'apc40'], default: 'akai_fire' },
      action: { type: 'string', enum: ['pad_led', 'pad_map', 'knob_map', 'display'], default: 'pad_led' },
      pad: { type: 'number', description: '0-63 for 8x8 grid' },
      color: { type: 'string', description: 'red,green,blue,#FF0000,0-127 velocity' },
      map_to: { type: 'string', description: '/Mixer/track1/volume or channel' }
    },
    required: ['device', 'action']
  }
},
'flstudio.fire': {
  risk: 'low',
  description: 'Akai Fire specific: step sequencer, OLED, knobs, performance mode',
  parameters: {
    type: 'object',
    properties: {
      mode: { type: 'string', enum: ['step', 'note', 'drum', 'perform'], default: 'step' },
      pattern: { type: 'string', description: 'x... for step seq' },
      oled_text: { type: 'string', description: 'text for OLED row 1-4' },
      oled_row: { type: 'number', description: '1-4', default: 1 },
      knob: { type: 'number', description: '1-4' },
      knob_value: { type: 'number', description: '0-127' }
    },
    required: ['mode']
  }
},
'flstudio.launchpad': {
  risk: 'low',
  description: 'Novation Launchpad: clip launching, RGB LEDs, user mode',
  parameters: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['led', 'clear', 'map_clip', 'user_mode'], default: 'led' },
      x: { type: 'number', description: '0-7' },
      y: { type: 'number', description: '0-7' },
      color: { type: 'number', description: '0-127 velocity/RGB' },
      track: { type: 'number' },
      clip: { type: 'number' }
    },
    required: ['action']
  }
}
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
             case 'flstudio.ai':
  this.logger.info(`FL AI ${args.action} ${args.model}`, { user: ctx.userId })
  if (!this.agent.registry.skills.llm) throw new Error('AI generation requires llm skill')

  const prompts = {
    generate_melody: `Generate ${args.bars} bar melody in ${args.key} ${args.scale}. Style: ${args.prompt}.
JSON: {"notes":[{"note":"C4","pos":0,"len":1,"vel":100},{"note":"E4","pos":1,"len":1,"vel":90}],"key":"${args.key}","scale":"${args.scale}"}`,
    generate_chords: `Generate ${args.bars} bar chord progression in ${args.key} ${args.scale}. Style: ${args.prompt}.
JSON: {"chords":[{"chord":"Cmaj7","pos":0,"bars":1},{"chord":"Am7","pos":1,"bars":1}],"key":"${args.key}"}`,
    style_transfer: `Transfer style from channel ${args.reference_track} to new ${args.bars} bar phrase.
JSON: {"notes":[...],"features":{"rhythm":"syncopated","contour":"ascending"}}`,
    inpaint: `Inpaint melody. Context: ${args.prompt}. Fill bars 2-3 of ${args.bars} bar phrase.
JSON: {"notes":[...],"masked_bars":[2,3]}`,
    continue: `Continue phrase for ${args.bars} bars. Style: ${args.prompt}.
JSON: {"notes":[...]}`
  }

  const res = await this.agent.registry.execute('llm.chat', { prompt: prompts[args.action], model: 'gpt-4' }, ctx.userId)
  try {
    const data = JSON.parse(res.text)
    // Send to FL piano roll
    if (data.notes) {
      data.notes.forEach(n => {
        this._sendOSC('/PianoRoll/addNote', JSON.stringify(n))
      })
    }
    if (data.chords) {
      this._sendOSC('/PianoRoll/addChords', JSON.stringify(data.chords))
    }
    return { action: args.action, model: args.model, ...data }
  } catch {
    return { action: args.action, result: res.text }
  }

case 'flstudio.ai_master':
  this.logger.info(`FL AI_MASTER ${args.action}`, { user: ctx.userId })
  if (!this.agent.registry.skills.llm) throw new Error('AI mastering requires llm skill')

  if (args.action === 'separate') {
    return {
      action: 'separate',
      file: args.file,
      stems: args.stems,
      command: `demucs -n htdemucs_ft ${args.file}`,
      outputs: args.stems.map(s => `${args.file.replace(/\.[^.]+$/, '')}_${s}.wav`),
      note: 'Run locally: pip install demucs. Outputs 44.1kHz WAV stems.'
    }
  }

  if (args.action === 'master') {
    const prompt = `AI mastering chain for ${args.file}. Target: ${args.target_lufs} LUFS. ${args.reference? `Match: ${args.reference}` : ''}
JSON: {
  "chain":[
    {"fx":"EQ","params":{"low_cut":30,"high_shelf":{"freq":12000,"gain":1.5}}},
    {"fx":"Multiband","params":{"low":{"ratio":"3:1"},"mid":{"ratio":"2:1"}}},
    {"fx":"Limiter","params":{"threshold":-1.0,"lufs":${args.target_lufs}}}
  ],
  "targets":{"lufs":${args.target_lufs},"peak":-1.0,"lra":7}
}`
    const res = await this.agent.registry.execute('llm.chat', { prompt, model: 'gpt-4' }, ctx.userId)
    try { return { action: 'master', ...JSON.parse(res.text) } } catch { return { mastering: res.text } }
  }

  if (args.action === 'rebalance') {
    return {
      action: 'rebalance',
      note: 'Load stems → adjust mixer levels → bounce. Use /Mixer/trackN/volume via OSC.',
      workflow: args.stems.map((s, i) => `/Mixer/track${i+1}/volume`)
    }
  }

case 'flstudio.video':
  this.logger.info(`FL VIDEO ${args.action}`, { user: ctx.userId })
  const videoMap = {
    load_video: '/ZGameEditor/loadVideo',
    load_effect: '/ZGameEditor/loadEffect',
    set_param: `/ZGameEditor/${args.param}`,
    export: '/ZGameEditor/export'
  }

  if (args.action === 'load_video' || args.action === 'load_effect') {
    this._sendOSC(videoMap[args.action], args.file || args.effect)
    return { action: args.action, file: args.file || args.effect }
  }

  if (args.action === 'set_param') {
    this._sendOSC(videoMap.set_param, args.value)
    return { action: 'set_param', param: args.param, value: args.value }
  }

  if (args.action === 'export') {
    this._sendOSC(videoMap.export, args.resolution)
    return { action: 'export', resolution: args.resolution, note: 'Renders to FL Studio/Projects/Rendered' }
  }

case 'flstudio.sync':
  this.logger.info(`FL SYNC ${args.action}`, { user: ctx.userId })
  const syncMap = {
    set_tc: '/Sync/timecode',
    marker_to_frame: '/Sync/markerToFrame',
    video_to_audio: '/Sync/videoToAudio'
  }

  const val = args.action === 'set_tc'? JSON.stringify({ tc: args.timecode, fps: args.fps }) :
              args.action === 'marker_to_frame'? args.marker :
              1
  this._sendOSC(syncMap[args.action], val)
  return { action: args.action, timecode: args.timecode, fps: args.fps, marker: args.marker }

case 'flstudio.visualizer':
  this.logger.info(`FL VISUALIZER ${args.type} ${args.reactive}`, { user: ctx.userId })
  const visConfig = {
    type: args.type,
    source: args.audio_source,
    track: args.track,
    reactive: args.reactive,
    color: args.color
  }
  this._sendOSC('/ZGameEditor/visualizer', JSON.stringify(visConfig))
  return {
    ...visConfig,
    note: `ZGameEditor will react to ${args.reactive} from ${args.audio_source}. Link param in ZGE to audio input.`
  }
          case 'flstudio.arrangement':
  this.logger.info(`FL ARRANGEMENT ${args.action} ${args.template}`, { user: ctx.userId })
  if (!this.agent.registry.skills.llm) throw new Error('Arrangement AI requires llm skill')

  const templates = {
    pop: [{ name: 'Intro', bars: 4 }, { name: 'Verse', bars: 8 }, { name: 'Pre', bars: 4 }, { name: 'Chorus', bars: 8 }, { name: 'Verse', bars: 8 }, { name: 'Pre', bars: 4 }, { name: 'Chorus', bars: 8 }, { name: 'Bridge', bars: 8 }, { name: 'Chorus', bars: 8 }, { name: 'Outro', bars: 4 }],
    edm: [{ name: 'Intro', bars: 8 }, { name: 'Build', bars: 16 }, { name: 'Drop', bars: 16 }, { name: 'Break', bars: 8 }, { name: 'Build', bars: 16 }, { name: 'Drop', bars: 16 }, { name: 'Outro', bars: 8 }],
    hiphop: [{ name: 'Intro', bars: 4 }, { name: 'Hook', bars: 8 }, { name: 'Verse', bars: 16 }, { name: 'Hook', bars: 8 }, { name: 'Verse', bars: 16 }, { name: 'Hook', bars: 8 }, { name: 'Outro', bars: 4 }],
    abacab: [{ name: 'A', bars: 8 }, { name: 'B', bars: 8 }, { name: 'A', bars: 8 }, { name: 'C', bars: 8 }, { name: 'A', bars: 8 }, { name: 'B', bars: 8 }]
  }

  if (args.action === 'apply_template') {
    const struct = templates[args.template]
    const total = struct.reduce((s, sec) => s + sec.bars, 0)
    let pos = 0
    const markers = struct.map(sec => {
      const m = { name: sec.name, position: pos, bars: sec.bars }
      pos += sec.bars
      return m
    })

    // Send markers to FL
    markers.forEach(m => this._sendOSC('/Playlist/addMarker', JSON.stringify(m)))
    return { template: args.template, total_bars: total, sections: markers }
  }

  if (args.action === 'generate') {
    const prompt = `Generate ${args.genre || 'pop'} song structure ${args.length} bars. Energy curve: ${args.energy?.join(',') || 'rise-fall'}.
JSON: {"sections":[{"name":"Intro","bars":4,"energy":0.2,"clips":["drums"]},{"name":"Verse","bars":8,"energy":0.4}],"total_bars":${args.length}}`
    const res = await this.agent.registry.execute('llm.chat', { prompt, model: 'gpt-4' }, ctx.userId)
    try { return JSON.parse(res.text) } catch { return { arrangement: res.text } }
  }

  if (args.action === 'analyze') {
    const prompt = `Analyze song structure. Return typical arrangement for ${args.genre}.`
    const res = await this.agent.registry.execute('llm.chat', { prompt }, ctx.userId)
    try { return JSON.parse(res.text) } catch { return { analysis: res.text } }
  }

case 'flstudio.structure':
  this.logger.info(`FL STRUCTURE ${args.sections.length} sections`, { user: ctx.userId })
  let pos = 0
  const layout = args.sections.map(sec => {
    const start = pos
    pos += sec.bars
    return { ...sec, start, end: pos }
  })

  // Send to FL playlist
  layout.forEach(sec => {
    this._sendOSC('/Playlist/addMarker', JSON.stringify({ pos: sec.start, name: sec.name }))
    if (args.clips?.[sec.name]) {
      args.clips[sec.name].forEach(pattern => {
        this._sendOSC('/Playlist/addClip', JSON.stringify({ pattern, pos: sec.start, len: sec.bars }))
      })
    }
  })

  return { total_bars: pos, sections: layout, clips: args.clips }

case 'flstudio.hardware':
  this.logger.info(`FL HARDWARE ${args.device} ${args.action}`, { user: ctx.userId })
  const deviceMap = {
    akai_fire: '/Fire',
    launchpad: '/Launchpad',
    maschine: '/Maschine',
    apc40: '/APC40'
  }
  const base = deviceMap[args.device]

  if (args.action === 'pad_led') {
    this._sendOSC(`${base}/pad/${args.pad}/color`, args.color)
    return { device: args.device, pad: args.pad, color: args.color, address: `${base}/pad/${args.pad}/color` }
  }

  if (args.action === 'pad_map') {
    this._sendOSC(`${base}/pad/${args.pad}/map`, args.map_to)
    return { device: args.device, pad: args.pad, mapped_to: args.map_to }
  }

  if (args.action === 'knob_map') {
    this._sendOSC(`${base}/knob/${args.pad}/map`, args.map_to)
    return { device: args.device, knob: args.pad, mapped_to: args.map_to }
  }

  if (args.action === 'display') {
    this._sendOSC(`${base}/display`, args.map_to)
    return { device: args.device, display: args.map_to }
  }

case 'flstudio.fire':
  this.logger.info(`FL FIRE ${args.mode}`, { user: ctx.userId })
  if (args.mode === 'step' && args.pattern) {
    this._sendOSC('/Fire/stepSeq', args.pattern)
    return { mode: 'step', pattern: args.pattern }
  }

  if (args.oled_text) {
    this._sendOSC(`/Fire/oled/${args.oled_row}`, args.oled_text)
    return { mode: args.mode, oled_row: args.oled_row, text: args.oled_text }
  }

  if (args.knob) {
    this._sendOSC(`/Fire/knob/${args.knob}`, args.knob_value)
    return { mode: args.mode, knob: args.knob, value: args.knob_value }
  }

  this._sendOSC('/Fire/mode', args.mode)
  return { mode: args.mode }

case 'flstudio.launchpad':
  this.logger.info(`FL LAUNCHPAD ${args.action}`, { user: ctx.userId })
  if (args.action === 'led') {
    this._sendOSC(`/Launchpad/led/${args.x}/${args.y}`, args.color)
    return { x: args.x, y: args.y, color: args.color }
  }

  if (args.action === 'clear') {
    for (let x = 0; x < 8; x++) for (let y = 0; y < 8; y++) this._sendOSC(`/Launchpad/led/${x}/${y}`, 0)
    return { action: 'clear', pads: 64 }
  }

  if (args.action === 'map_clip') {
    this._sendOSC(`/Launchpad/map/${args.x}/${args.y}`, JSON.stringify({ track: args.track, clip: args.clip }))
    return { x: args.x, y: args.y, track: args.track, clip: args.clip }
  }

  if (args.action === 'user_mode') {
    this._sendOSC('/Launchpad/userMode', 1)
    return { action: 'user_mode', note: 'Launchpad in User Mode for custom mapping' }
  }
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
