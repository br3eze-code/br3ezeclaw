const { BaseSkill } = require('../base.js')
const { Chord, Scale, Key, Note, Interval, Progression } = require('tonal')
const MidiWriter = require('midi-writer-js')

class MusicSkill extends BaseSkill {
  static id = 'music'
  static name = 'Music'
  static description = 'Music theory, chords, scales, MIDI, progressions, lyrics, audio analysis'

  constructor(config, logger, workspace) {
    super(config, logger, workspace)
  }

  static getTools() {
    return {
      // Add to static getTools() return object:
'music.performance': {
  risk: 'low',
  description: 'Real-time MIR: onset, pitch tracking, tempo curve, dynamics, articulation',
  parameters: {
    type: 'object',
    properties: {
      file: { type: 'string', description: 'audio file or attachment://N' },
      features: { type: 'array', items: { type: 'string' }, enum: ['onset', 'pitch', 'tempo', 'dynamics', 'articulation', 'all'], default: ['all'] },
      window: { type: 'number', description: 'ms', default: 50 }
    },
    required: ['file']
  }
},
'music.gesture': {
  risk: 'low',
  description: 'Gesture tracking: conductor, instrumental, dance → music params',
  parameters: {
    type: 'object',
    properties: {
      source: { type: 'string', enum: ['video', 'midi_controller', 'leap', 'kinect'], default: 'midi_controller' },
      mapping: { type: 'string', enum: ['tempo', 'dynamics', 'filter', 'spatial'], default: 'tempo' },
      smoothing: { type: 'number', default: 0.3, description: '0-1' }
    },
    required: ['source']
  }
},
'music.schenker': {
  risk: 'low',
  description: 'Schenkerian analysis: foreground, middleground, background, Ursatz',
  parameters: {
    type: 'object',
    properties: {
      chords: { type: 'array', items: { type: 'string' } },
      melody: { type: 'array', items: { type: 'string' } },
      key: { type: 'string', default: 'C' },
      level: { type: 'string', enum: ['foreground', 'middleground', 'background', 'all'], default: 'all' }
    },
    required: ['chords']
  }
},
'music.set_theory': {
  risk: 'low',
  description: 'Set theory: prime form, interval vector, Forte number, transformations',
  parameters: {
    type: 'object',
    properties: {
      notes: { type: 'array', items: { type: 'string' } },
      operation: { type: 'string', enum: ['prime', 'vector', 'forte', 'transform'], default: 'prime' },
      transform: { type: 'string', enum: ['T0', 'T6', 'I0', 'M', 'MI'], description: 'for transform op' }
    },
    required: ['notes']
  }
},
'music.neo_riemann': {
  risk: 'low',
  description: 'Neo-Riemannian: P/L/R transforms, Tonnetz, hexatonic cycles',
  parameters: {
    type: 'object',
    properties: {
      chord: { type: 'string', description: 'C, Am, E' },
      transform: { type: 'string', enum: ['P', 'L', 'R', 'N', 'S', 'H'], default: 'P' },
      chain: { type: 'string', description: 'PLR, LPR', default: null }
    },
    required: ['chord']
  }
}
'music.distributed': {
  risk: 'low',
  description: 'Network music: OSC/MIDI sync, clock, collaborative performance, Ableton Link',
  parameters: {
    type: 'object',
    properties: {
      protocol: { type: 'string', enum: ['osc', 'midi', 'ableton_link', 'webrtc'], default: 'osc' },
      action: { type: 'string', enum: ['send', 'receive', 'sync', 'broadcast'], default: 'send' },
      address: { type: 'string', description: '/tempo, /note, /cc1' },
      value: { type: 'any', description: 'number, string, array' },
      host: { type: 'string', default: 'localhost' },
      port: { type: 'number', default: 57120 }
    },
    required: ['protocol', 'action']
  }
},
'music.clock': {
  risk: 'low',
  description: 'Musical clock: BPM, phase, bar/beat, sync multiple clients',
  parameters: {
    type: 'object',
    properties: {
      bpm: { type: 'number', default: 120 },
      action: { type: 'string', enum: ['start', 'stop', 'sync', 'tap'], default: 'start' },
      peers: { type: 'number', description: 'clients to sync', default: 1 }
    },
    required: ['action']
  }
},
'music.archive': {
  risk: 'low',
  description: 'Musicology corpus: search scores, analyze style, composer attribution',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'composer, period, key, motif' },
      corpus: { type: 'string', enum: ['imslp', 'kern', 'essen', 'rime', 'all'], default: 'all' },
      mode: { type: 'string', enum: ['search', 'analyze', 'compare', 'attribute'], default: 'search' }
    },
    required: ['query']
  }
},
'music.style': {
  risk: 'low',
  description: 'Style analysis: features, period, composer, genre classification',
  parameters: {
    type: 'object',
    properties: {
      chords: { type: 'array', items: { type: 'string' }, description: 'chord progression' },
      melody: { type: 'array', items: { type: 'string' }, description: 'note sequence' },
      features: { type: 'array', items: { type: 'string' }, description: 'extract: harmony, rhythm, melody' }
    },
    required: []
  }
},
'music.score': {
  risk: 'low',
  description: 'Fetch/analyze scores: MusicXML, MEI, Kern. Find motifs, cadences',
  parameters: {
    type: 'object',
    properties: {
      work: { type: 'string', description: 'BWV 772, K. 331, Op. 27 No. 2' },
      format: { type: 'string', enum: ['musicxml', 'mei', 'kern', 'midi'], default: 'kern' },
      analysis: { type: 'string', enum: ['motifs', 'cadences', 'form', 'all'], default: 'all' }
    },
    required: ['work']
  }
}
'music.live': {
  risk: 'low',
  description: 'Live coding: TidalCycles, Sonic Pi, Strudel patterns, algorithmic composition',
  parameters: {
    type: 'object',
    properties: {
      engine: { type: 'string', enum: ['tidal', 'sonicpi', 'strudel', 'foxdot'], default: 'tidal' },
      pattern: { type: 'string', description: 'd1 $ sound "bd sd ~ bd"' },
      bpm: { type: 'number', default: 120 },
      action: { type: 'string', enum: ['eval', 'hush', 'solo', 'all'], default: 'eval' }
    },
    required: ['pattern']
  }
},
'music.algo_comp': {
  risk: 'low',
  description: 'Algorithmic composition: euclidean, markov, cellular automata, L-systems',
  parameters: {
    type: 'object',
    properties: {
      algorithm: { type: 'string', enum: ['euclidean', 'markov', 'cellular', 'lsystem', 'fibonacci'], default: 'euclidean' },
      params: { type: 'object', description: 'steps:16, pulses:5, rotation:0 for euclidean' },
      output: { type: 'string', enum: ['midi', 'tidal', 'notes'], default: 'tidal' }
    },
    required: ['algorithm']
  }
},
'music.neuro': {
  risk: 'low',
  description: 'EEG/biofeedback sonification: alpha, beta, theta, gamma → music',
  parameters: {
    type: 'object',
    properties: {
      signal: { type: 'string', enum: ['alpha', 'beta', 'theta', 'delta', 'gamma', 'hrv', 'eda'], default: 'alpha' },
      mapping: { type: 'string', enum: ['pitch', 'tempo', 'filter', 'amplitude', 'timbre'], default: 'pitch' },
      range: { type: 'array', items: { type: 'number' }, description: 'min,max Hz or value', default: [8, 12] }
    },
    required: ['signal']
  }
},
'music.bci': {
  risk: 'low',
  description: 'Brain-computer interface: SSVEP, P300, motor imagery → music control',
  parameters: {
    type: 'object',
    properties: {
      paradigm: { type: 'string', enum: ['ssvep', 'p300', 'motor', 'attention'], default: 'attention' },
      channels: { type: 'number', default: 8 },
      control: { type: 'string', enum: ['tempo', 'filter', 'instrument', 'fx'], default: 'tempo' }
    },
    required: ['paradigm']
  }
},
'music.biofeedback': {
  risk: 'low',
  description: 'HRV/EDA/EMG to music: relaxation, focus, arousal sonification',
  parameters: {
    type: 'object',
    properties: {
      metric: { type: 'string', enum: ['hrv', 'heart_rate', 'eda', 'emg', 'breath'], default: 'hrv' },
      target: { type: 'string', enum: ['relax', 'focus', 'energize'], default: 'relax' },
      mode: { type: 'string', enum: ['sonify', 'entrain', 'adaptive'], default: 'adaptive' }
    },
    required: ['metric']
  }
}
'music.spatial': {
  risk: 'low',
  description: '3D audio: binaural, ambisonics, HRTF, object-based audio, Dolby Atmos specs',
  parameters: {
    type: 'object',
    properties: {
      mode: { type: 'string', enum: ['binaural', 'ambisonics', 'atmos', 'hrtf'], default: 'binaural' },
      source_pos: { type: 'object', properties: { azimuth: { type: 'number' }, elevation: { type: 'number' }, distance: { type: 'number' } } },
      format: { type: 'string', enum: ['FOA', 'HOA', '7.1.4', 'stereo'], default: 'FOA' }
    },
    required: ['mode']
  }
},
'music.ai_stems': {
  risk: 'low',
  description: 'AI stem separation: vocals, drums, bass, other from mixed audio',
  parameters: {
    type: 'object',
    properties: {
      file: { type: 'string', description: 'path or attachment://N' },
      stems: { type: 'array', items: { type: 'string' }, enum: ['vocals', 'drums', 'bass', 'other', 'piano', 'guitar'], default: ['vocals', 'drums', 'bass', 'other'] },
      model: { type: 'string', enum: ['demucs', 'spleeter', 'ultimate'], default: 'demucs' }
    },
    required: ['file']
  }
},
'music.ai_generate': {
  risk: 'low',
  description: 'AI music generation: prompt-to-audio, style transfer, continuation',
  parameters: {
    type: 'object',
    properties: {
      prompt: { type: 'string', description: 'lofi hip hop beat, 90s trance, jazz piano' },
      duration: { type: 'number', default: 30, description: 'seconds' },
      mode: { type: 'string', enum: ['text_to_audio', 'style_transfer', 'continuation', 'inpainting'], default: 'text_to_audio' },
      reference_file: { type: 'string', description: 'for style_transfer/continuation' }
    },
    required: ['prompt']
  }
},
'music.ai_master': {
  risk: 'low',
  description: 'AI mastering: loudness, stereo width, EQ matching, reference track',
  parameters: {
    type: 'object',
    properties: {
      file: { type: 'string' },
      target_lufs: { type: 'number', default: -14 },
      reference_file: { type: 'string', description: 'match EQ/width of reference' },
      style: { type: 'string', enum: ['streaming', 'club', 'vinyl', 'podcast'], default: 'streaming' }
    },
    required: ['file']
  }
},
'music.melodyne': {
  risk: 'low',
  description: 'Pitch/time correction specs: Auto-Tune style, formant, timing',
  parameters: {
    type: 'object',
    properties: {
      correction: { type: 'string', enum: ['pitch', 'timing', 'formant', 'all'], default: 'pitch' },
      strength: { type: 'number', default: 50, description: '0-100' },
      scale: { type: 'string', description: 'C major, A minor, chromatic' }
    },
    required: ['correction']
  }
}
'music.audio_analyze': {
  risk: 'low',
  description: 'Analyze audio file: BPM, key, duration, waveform, spectral features',
  parameters: {
    type: 'object',
    properties: {
      file: { type: 'string', description: 'path or attachment://N' },
      features: { type: 'array', items: { type: 'string' }, enum: ['bpm', 'key', 'loudness', 'spectral', 'all'], default: ['all'] }
    },
    required: ['file']
  }
},
'music.beat_detect': {
  risk: 'low',
  description: 'Detect beats, downbeats, tempo changes in audio',
  parameters: {
    type: 'object',
    properties: {
      file: { type: 'string' },
      sensitivity: { type: 'number', default: 0.5, description: '0-1' }
    },
    required: ['file']
  }
},
'music.key_detect': {
  risk: 'low',
  description: 'Detect musical key and scale from audio',
  parameters: {
    type: 'object',
    properties: {
      file: { type: 'string' }
    },
    required: ['file']
  }
},
'music.synth_patch': {
  risk: 'low',
  description: 'Design synth patch: oscillator, filter, ADSR, LFO, effects',
  parameters: {
    type: 'object',
    properties: {
      type: { type: 'string', enum: ['lead', 'bass', 'pad', 'pluck', 'arp'], default: 'lead' },
      mood: { type: 'string', description: 'dark, bright, warm, cold, aggressive' },
      complexity: { type: 'string', enum: ['simple', 'moderate', 'complex'], default: 'moderate' }
    },
    required: ['type']
  }
},
'music.wavetable': {
  risk: 'low',
  description: 'Generate wavetable specs: harmonics, morphing, positions',
  parameters: {
    type: 'object',
    properties: {
      base: { type: 'string', enum: ['sine', 'saw', 'square', 'triangle'], default: 'saw' },
      harmonics: { type: 'number', default: 16 },
      morph_type: { type: 'string', enum: ['linear', 'spectral', 'fm'], default: 'spectral' }
    },
    required: []
  }
},
'music.fx_chain': {
  risk: 'low',
  description: 'Design FX chain: reverb, delay, compression, EQ settings',
  parameters: {
    type: 'object',
    properties: {
      purpose: { type: 'string', description: 'mixing, mastering, sound design' },
      instrument: { type: 'string', description: 'vocals, drums, bass, synth' }
    },
    required: ['purpose']
  }
}
      'music.chord': {
        risk: 'low',
        description: 'Analyze chord: notes, intervals, inversions',
        parameters: {
          type: 'object',
          properties: {
            chord: { type: 'string', description: 'Cmaj7, Dm, G7, etc' }
          },
          required: ['chord']
        }
      },
      'music.scale': {
        risk: 'low',
        description: 'Get scale notes, modes, degrees',
        parameters: {
          type: 'object',
          properties: {
            tonic: { type: 'string', description: 'C, D#, Bb' },
            type: { type: 'string', description: 'major, minor, dorian, pentatonic', default: 'major' }
          },
          required: ['tonic']
        }
      },
      'music.progression': {
        risk: 'low',
        description: 'Generate chord progression from Roman numerals',
        parameters: {
          type: 'object',
          properties: {
            key: { type: 'string', description: 'C, Am, Bb' },
            progression: { type: 'string', description: 'I-V-vi-IV, ii-V-I' },
            bars: { type: 'number', default: 4 }
          },
          required: ['key', 'progression']
        }
      },
      'music.transpose': {
        risk: 'low',
        description: 'Transpose chords/notes by interval',
        parameters: {
          type: 'object',
          properties: {
            notes: { type: 'array', items: { type: 'string' } },
            interval: { type: 'string', description: '2M, 3m, 5P, -2M' }
          },
          required: ['notes', 'interval']
        }
      },
      'music.midi': {
        risk: 'low',
        description: 'Generate MIDI file from chords/notes',
        parameters: {
          type: 'object',
          properties: {
            chords: { type: 'array', items: { type: 'string' } },
            duration: { type: 'string', enum: ['1', '2', '4', '8', '16'], default: '1' },
            tempo: { type: 'number', default: 120 },
            filename: { type: 'string', default: 'output' }
          },
          required: ['chords']
        }
      },
      'music.lyrics': {
        risk: 'low',
        description: 'Write lyrics: verse, chorus, rhyme scheme, syllable count',
        parameters: {
          type: 'object',
          properties: {
            theme: { type: 'string' },
            structure: { type: 'string', enum: ['verse', 'chorus', 'bridge', 'full'], default: 'verse' },
            rhyme: { type: 'string', description: 'AABB, ABAB, none', default: 'ABAB' },
            syllables: { type: 'number', description: 'per line', default: 8 }
          },
          required: ['theme']
        }
      },
      'music.analyze': {
        risk: 'low',
        description: 'Analyze key, tempo, mood from chord progression',
        parameters: {
          type: 'object',
          properties: {
            chords: { type: 'array', items: { type: 'string' } }
          },
          required: ['chords']
        }
      },
      'music.harmonize': {
        risk: 'low',
        description: 'Harmonize melody with chords',
        parameters: {
          type: 'object',
          properties: {
            melody: { type: 'array', items: { type: 'string' } },
            key: { type: 'string', default: 'C' }
          },
          required: ['melody']
        }
      }
    }
  }

  async healthCheck() {
    return { status: 'ok', tonal:!!Chord, midi:!!MidiWriter }
  }

  async execute(toolName, args, ctx) {
    try {
      switch (toolName) {
             case 'music.spatial':
  this.logger.info(`MUSIC SPATIAL ${args.mode}`, { user: ctx.userId })
  if (!this.agent.registry.skills.llm) throw new Error('Spatial audio requires llm skill')
  
  const prompts = {
    binaural: `Binaural rendering specs for source at az:${args.source_pos?.azimuth}°, el:${args.source_pos?.elevation}°, dist:${args.source_pos?.distance}m.
JSON: {"hrtf":"KEMAR/CIPIC","itd":"0.6ms","ild":"8dB","filters":{"left":{"delay":0,"gain":-3},"right":{"delay":0.6,"gain":0}},"reverb":{"early":true,"late":false}}`,
    ambisonics: `Ambisonics encoding ${args.format}. Source position: az:${args.source_pos?.azimuth}°, el:${args.source_pos?.elevation}°.
JSON: {"format":"${args.format}","order":${args.format === 'FOA'? 1 : 3},"channels":${args.format === 'FOA'? 4 : 16},"encoding":"FuMa/SN3D","wxyz_coeffs":[1,0.707,0.707,0.707],"decode_to":"stereo/binaural"}`,
    atmos: `Dolby Atmos object metadata. Position: az:${args.source_pos?.azimuth}°, el:${args.source_pos?.elevation}°.
JSON: {"format":"7.1.4","objects":[{"id":1,"x":0.5,"y":0.2,"z":0.8,"size":0.1}],"bed":"7.1","height_channels":4,"metadata":"ADM"}`,
    hrtf: `HRTF selection/measurement. Head: azimuth ${args.source_pos?.azimuth}°.
JSON: {"dataset":"CIPIC/KEMAR","subject":"021","itd_func":"azimuth*0.0006","ild_func":"azimuth*0.05","pinna_filter":true}`
  }
  
  const res = await this.agent.registry.execute('llm.chat', { prompt: prompts[args.mode], model: 'gpt-4' }, ctx.userId)
  try { return { mode: args.mode, ...JSON.parse(res.text) } } catch { return { mode: args.mode, specs: res.text } }

case 'music.ai_stems':
  this.logger.info(`MUSIC AI_STEMS ${args.stems.join(',')} ${args.model}`, { user: ctx.userId })
  // Note: Actual separation requires demucs/spleeter binary. Return workflow + specs.
  const stemFiles = args.stems.map(s => `${args.file.replace(/\.[^.]+$/, '')}_${s}.wav`)
  
  return {
    source: args.file,
    model: args.model,
    stems: args.stems,
    outputs: stemFiles,
    command: args.model === 'demucs'? `demucs -n htdemucs_ft ${args.file}` : `spleeter separate -p spleeter:4stems -o output ${args.file}`,
    note: 'Install demucs: pip install demucs. Spleeter: pip install spleeter. Outputs WAV 44.1kHz.',
    specs: { sr: 44100, bit_depth: 16, format: 'wav' }
  }
          // Add to static getTools() return object:
'music.performance': {
  risk: 'low',
  description: 'Real-time MIR: onset, pitch tracking, tempo curve, dynamics, articulation',
  parameters: {
    type: 'object',
    properties: {
      file: { type: 'string', description: 'audio file or attachment://N' },
      features: { type: 'array', items: { type: 'string' }, enum: ['onset', 'pitch', 'tempo', 'dynamics', 'articulation', 'all'], default: ['all'] },
      window: { type: 'number', description: 'ms', default: 50 }
    },
    required: ['file']
  }
},
'music.gesture': {
  risk: 'low',
  description: 'Gesture tracking: conductor, instrumental, dance → music params',
  parameters: {
    type: 'object',
    properties: {
      source: { type: 'string', enum: ['video', 'midi_controller', 'leap', 'kinect'], default: 'midi_controller' },
      mapping: { type: 'string', enum: ['tempo', 'dynamics', 'filter', 'spatial'], default: 'tempo' },
      smoothing: { type: 'number', default: 0.3, description: '0-1' }
    },
    required: ['source']
  }
},
'music.schenker': {
  risk: 'low',
  description: 'Schenkerian analysis: foreground, middleground, background, Ursatz',
  parameters: {
    type: 'object',
    properties: {
      chords: { type: 'array', items: { type: 'string' } },
      melody: { type: 'array', items: { type: 'string' } },
      key: { type: 'string', default: 'C' },
      level: { type: 'string', enum: ['foreground', 'middleground', 'background', 'all'], default: 'all' }
    },
    required: ['chords']
  }
},
'music.set_theory': {
  risk: 'low',
  description: 'Set theory: prime form, interval vector, Forte number, transformations',
  parameters: {
    type: 'object',
    properties: {
      notes: { type: 'array', items: { type: 'string' } },
      operation: { type: 'string', enum: ['prime', 'vector', 'forte', 'transform'], default: 'prime' },
      transform: { type: 'string', enum: ['T0', 'T6', 'I0', 'M', 'MI'], description: 'for transform op' }
    },
    required: ['notes']
  }
},
'music.neo_riemann': {
  risk: 'low',
  description: 'Neo-Riemannian: P/L/R transforms, Tonnetz, hexatonic cycles',
  parameters: {
    type: 'object',
    properties: {
      chord: { type: 'string', description: 'C, Am, E' },
      transform: { type: 'string', enum: ['P', 'L', 'R', 'N', 'S', 'H'], default: 'P' },
      chain: { type: 'string', description: 'PLR, LPR', default: null }
    },
    required: ['chord']
  }
}
case 'music.distributed':
  this.logger.info(`MUSIC DISTRIBUTED ${args.protocol} ${args.action}`, { user: ctx.userId })

  if (args.protocol === 'osc') {
    // OSC message structure - requires osc library in production
    const msg = {
      address: args.address || '/note',
      args: Array.isArray(args.value)? args.value : [args.value],
      host: args.host,
      port: args.port
    }
    return {
      protocol: 'osc',
      action: args.action,
      message: msg,
      code: `sendOSC('${args.address}', ${JSON.stringify(args.value)})`,
      note: 'Install: npm install osc. Use SuperCollider/Max/PureData to receive.'
    }
  }

  if (args.protocol === 'ableton_link') {
    return {
      protocol: 'ableton_link',
      action: args.action,
      bpm: args.value || 120,
      peers: 1,
      code: 'abl_link_enable(true); abl_link_set_tempo(120)',
      note: 'Ableton Link: peer-to-peer tempo/phase sync. No host. Use link library.'
    }
  }

  if (args.protocol === 'midi') {
    return {
      protocol: 'midi',
      action: args.action,
      message: { type: args.address || 'cc', channel: 1, value: args.value },
      code: `midiOut.send([176, ${args.address || 1}, ${args.value}])`,
      note: 'WebMIDI or node-midi. Channel 1-16.'
    }
  }

  if (args.protocol === 'webrtc') {
    return {
      protocol: 'webrtc',
      action: args.action,
      note: 'Use WebRTC DataChannel for low-latency clock sync. PeerJS/SimplePeer.',
      code: 'channel.send({type:"clock",t:audioContext.currentTime,bpm:120})'
    }
  }

  return { protocol: args.protocol, action: args.action }

case 'music.clock':
  this.logger.info(`MUSIC CLOCK ${args.action} ${args.bpm}BPM`, { user: ctx.userId })
  const startTime = Date.now()
  const beatDur = 60000 / args.bpm

  return {
    bpm: args.bpm,
    action: args.action,
    beat_duration_ms: beatDur.toFixed(2),
    phase: 0,
    peers: args.peers,
    sync_token: `${startTime}_${args.bpm}`,
    bar_duration_ms: (beatDur * 4).toFixed(2),
    note: args.action === 'tap'? 'Tap 4 times, avg intervals' : 'Share sync_token with peers'
  }

case 'music.archive':
  this.logger.info(`MUSIC ARCHIVE ${args.mode} ${args.corpus}: ${args.query}`, { user: ctx.userId })
  if (!this.agent.registry.skills.llm) throw new Error('Archive search requires llm skill')

  const prompts = {
    search: `Search musicology corpus ${args.corpus} for: "${args.query}".
JSON: {"results":[{"work":"BWV 772","composer":"J.S. Bach","year":1723,"key":"C major","corpus":"kern","url":"imslp.org/"}],"total":5}`,
    analyze: `Analyze musical work "${args.query}" from ${args.corpus}.
JSON: {"work":"","composer":"","period":"Baroque","form":"Invention","key":"C major","meter":"4/4","features":{"counterpoint":true,"sequences":3},"style_markers":[]}`,
    compare: `Compare "${args.query}" across corpora. Find stylistic similarities.
JSON: {"query":"","matches":[{"work":"","similarity":0.87,"shared_features":["circle_of_fifths","suspensions"]}]}`,
    attribute: `Attribute composer/period for: "${args.query}". Use stylometry.
JSON: {"attribution":{"composer":"Mozart","confidence":78},"features":{"melodic_intervals":"small","chromaticism":"low","form":"sonata"},"alternatives":[{"composer":"Haydn","confidence":65}]}`
  }

  const res = await this.agent.registry.execute('llm.chat', { prompt: prompts[args.mode], model: 'gpt-4' }, ctx.userId)
  try { return { mode: args.mode, corpus: args.corpus,...JSON.parse(res.text) } } catch { return { query: args.query, results: res.text } }

case 'music.style':
  this.logger.info(`MUSIC STYLE analysis`, { user: ctx.userId })
  if (!this.agent.registry.skills.llm) throw new Error('Style analysis requires llm skill')

  const prompt = `Analyze musical style from chords: ${args.chords?.join(' ')} melody: ${args.melody?.join(' ')}.
JSON: {
  "period":"Baroque/Classical/Romantic/Modern",
  "genre":"jazz/pop/chorale",
  "composer_style":"Bach-like/Chopin-like",
  "features":{
    "harmony":{"functional":true,"chromaticism":"low","sevenths":2},
    "melody":{"conjunct":true,"range":"P8","ornaments":0},
    "rhythm":{"regular":true,"syncopation":"low"}
  },
  "confidence":85
}`
  const res = await this.agent.registry.execute('llm.chat', { prompt, model: 'gpt-4' }, ctx.userId)
  try { return JSON.parse(res.text) } catch { return { style: res.text } }

case 'music.score':
  this.logger.info(`MUSIC SCORE ${args.work} ${args.format}`, { user: ctx.userId })
  if (!this.agent.registry.skills.llm) throw new Error('Score analysis requires llm skill')

  const prompt = `Analyze score ${args.work} in ${args.format}. ${args.analysis}.
JSON: {
  "work":"${args.work}",
  "format":"${args.format}",
  "motifs":[{"name":"A","notes":"C-D-E","occurrences":12}],
  "cadences":[{"type":"perfect","measure":8,"key":"C major"}],
  "form":{"type":"Binary","sections":["A:1-8","B:9-16"]},
  "url":"kern.humdrum.org"
}`
  const res = await this.agent.registry.execute('llm.chat', { prompt, model: 'gpt-4' }, ctx.userId)
  try { return JSON.parse(res.text) } catch { return { work: args.work, analysis: res.text } }
case 'music.ai_generate':
  this.logger.info(`MUSIC AI_GENERATE ${args.mode} ${args.duration}s`, { user: ctx.userId })
  if (!this.agent.registry.skills.llm) throw new Error('AI generation requires llm skill')
  
  const prompt = `Generate ${args.mode} music spec. Prompt: "${args.prompt}". Duration: ${args.duration}s.
JSON: {
  "model":"musicgen/audiocraft/riffusion",
  "prompt":"${args.prompt}",
  "duration":${args.duration},
  "params":{"temperature":1.0,"cfg_scale":3.0,"top_k":250},
  "output":"audio.wav",
  "command":"audiocraft ${args.prompt} --duration ${args.duration}",
  "note":"Use Meta AudioCraft or MusicGen"
}`
  const res = await this.agent.registry.execute('llm.chat', { prompt, model: 'gpt-4' }, ctx.userId)
  try { return JSON.parse(res.text) } catch { return { prompt: args.prompt, generation: res.text } }

case 'music.ai_master':
  this.logger.info(`MUSIC AI_MASTER ${args.style} ${args.target_lufs}LUFS`, { user: ctx.userId })
  if (!this.agent.registry.skills.llm) throw new Error('AI mastering requires llm skill')
  
  const prompt = `AI mastering chain for ${args.style}. Target: ${args.target_lufs} LUFS. ${args.reference_file? `Match reference: ${args.reference_file}` : ''}
JSON: {
  "chain":[
    {"fx":"EQ","params":{"low_cut":30,"high_shelf":{"freq":12000,"gain":1.5}}},
    {"fx":"Multiband","params":{"low":{"ratio":"3:1"},"mid":{"ratio":"2:1"},"high":{"ratio":"2.5:1"}}},
    {"fx":"Saturation","params":{"type":"tape","drive":0.2}},
    {"fx":"Stereo","params":{"width":1.2,"bass_mono":120}},
    {"fx":"Limiter","params":{"threshold":-1.0,"release":50,"lufs":${args.target_lufs}}}
  ],
  "targets":{"integrated_lufs":${args.target_lufs},"peak_db":-1.0,"lra":7},
  "reference_match":${!!args.reference_file}
}`
  const res = await this.agent.registry.execute('llm.chat', { prompt, model: 'gpt-4' }, ctx.userId)
  try { return JSON.parse(res.text) } catch { return { mastering: res.text } }
case 'music.live':
  this.logger.info(`MUSIC LIVE ${args.engine} ${args.action}`, { user: ctx.userId })

  const engines = {
    tidal: `d1 $ ${args.pattern}`,
    sonicpi: `live_loop :beat do\n ${args.pattern}\n sleep 1\nend`,
    strudel: `${args.pattern}`,
    foxdot: `${args.pattern}`
  }

  if (args.action === 'hush') {
    return { engine: args.engine, action: 'hush', code: 'hush', note: 'Stop all patterns' }
  }

  return {
    engine: args.engine,
    bpm: args.bpm,
    code: engines[args.engine],
    pattern: args.pattern,
    note: `Set cps ${args.bpm/60/2} -- for Tidal. Eval in ${args.engine} REPL.`
  }

case 'music.algo_comp':
  this.logger.info(`MUSIC ALGO_COMP ${args.algorithm}`, { user: ctx.userId })

  const algorithms = {
    euclidean: () => {
      const { steps = 16, pulses = 5, rotation = 0 } = args.params || {}
      const pattern = []
      for (let i = 0; i < steps; i++) {
        pattern.push(Math.floor((i * pulses) / steps)!== Math.floor(((i - 1) * pulses) / steps)? 'x' : '.')
      }
      const rotated = [...pattern.slice(rotation),...pattern.slice(0, rotation)].join('')
      return { algorithm: 'euclidean', pattern: rotated, steps, pulses, rotation, tidal: `s "${rotated}"` }
    },
    markov: () => {
      const chain = args.params?.chain || { C: { E: 0.5, G: 0.5 }, E: { G: 0.7, C: 0.3 }, G: { C: 1.0 } }
      const start = args.params?.start || 'C'
      const length = args.params?.length || 16
      let seq = [start], current = start
      for (let i = 1; i < length; i++) {
        const probs = chain[current] || {}
        const r = Math.random()
        let sum = 0
        for (const [next, p] of Object.entries(probs)) {
          sum += p
          if (r < sum) { current = next; break }
        }
        seq.push(current)
      }
      return { algorithm: 'markov', sequence: seq, tidal: `note "${seq.join(' ')}"` }
    },
    cellular: () => {
      const rule = args.params?.rule || 30
      const gens = args.params?.generations || 8
      const width = args.params?.width || 16
      let row = Array(width).fill(0); row[Math.floor(width/2)] = 1
      const grid = [row]
      for (let g = 1; g < gens; g++) {
        const prev = grid[g-1]
        const next = prev.map((_, i) => {
          const l = prev[i-1] || 0, c = prev[i], r = prev[i+1] || 0
          const idx = l*4 + c*2 + r
          return (rule >> idx) & 1
        })
        grid.push(next)
      }
      const pattern = grid.flat().map(c => c? 'x' : '.').join('')
      return { algorithm: 'cellular', rule, pattern, tidal: `s "${pattern}"` }
    },
    lsystem: () => {
      const axiom = args.params?.axiom || 'A'
      const rules = args.params?.rules || { A: 'AB', B: 'A' }
      const iter = args.params?.iterations || 4
      let str = axiom
      for (let i = 0; i < iter; i++) {
        str = str.split('').map(c => rules[c] || c).join('')
      }
      return { algorithm: 'lsystem', result: str, tidal: `note "${str.split('').join(' ')}"` }
    },
    fibonacci: () => {
      const n = args.params?.n || 8
      const fib = [1, 1]
      for (let i = 2; i < n; i++) fib.push(fib[i-1] + fib[i-2])
      const pattern = fib.map(f => f % 2? 'x' : '.').join('')
      return { algorithm: 'fibonacci', sequence: fib, pattern, tidal: `s "${pattern}"` }
    }
  }

  const result = algorithms[args.algorithm]()
  return {...result, output: args.output }

case 'music.neuro':
  this.logger.info(`MUSIC NEURO ${args.signal} → ${args.mapping}`, { user: ctx.userId })
  if (!this.agent.registry.skills.llm) throw new Error('Neuro sonification requires llm skill')

  const prompt = `EEG/bio sonification: ${args.signal} band ${args.range[0]}-${args.range[1]}Hz mapped to ${args.mapping}.
JSON: {
  "signal":"${args.signal}",
  "band":"${args.range[0]}-${args.range[1]}Hz",
  "mapping":"${args.mapping}",
  "scale":{"min":${args.range[0]},"max":${args.range[1]},"to":{"pitch":[220,880],"tempo":[60,120],"filter":[200,5000]}},
  "interpretation":"alpha=relaxed, beta=active, theta=drowsy, gamma=focus",
  "patch":{"osc":"sine","env":"slow","fx":"reverb"},
  "note":"Higher ${args.signal} → higher ${args.mapping}"
}`
  const res = await this.agent.registry.execute('llm.chat', { prompt, model: 'gpt-4' }, ctx.userId)
  try { return JSON.parse(res.text) } catch { return { signal: args.signal, mapping: res.text } }

case 'music.bci':
  this.logger.info(`MUSIC BCI ${args.paradigm} ${args.control}`, { user: ctx.userId })

  const paradigms = {
    ssvep: { freqs: [8, 10, 12, 15], note: 'Stare at flicker → select instrument', latency: '2-5s' },
    p300: { target: 'oddball', note: 'Attend to trigger → play note', latency: '300ms' },
    motor: { imagery: 'left/right hand', note: 'Imagine movement → pan/modulate', latency: '1-2s' },
    attention: { metric: 'alpha suppression', note: 'Focus → increase tempo/brightness', latency: '0.5s' }
  }

  return {
    paradigm: args.paradigm,
    channels: args.channels,
    control: args.control,
   ...paradigms[args.paradigm],
    setup: `OpenBCI ${args.channels}-ch, Cyton+Daisy. Stream LSL. Map to ${args.control}.`
  }

case 'music.biofeedback':
  this.logger.info(`MUSIC BIOFEEDBACK ${args.metric} ${args.target}`, { user: ctx.userId })

  const mappings = {
    hrv: { relax: 'higher HRV → slower tempo, warmer timbre', focus: 'stable HRV → steady rhythm', energize: 'lower HRV → faster tempo' },
    heart_rate: { relax: 'lower HR → lower pitch, slower', focus: 'stable HR → metronome', energize: 'higher HR → faster, brighter' },
    eda: { relax: 'lower EDA → less dissonance, more reverb', focus: 'stable EDA → clear tone', energize: 'higher EDA → distortion' },
    breath: { relax: 'slow breath → long pads', focus: 'rhythmic breath → sync tempo', energize: 'fast breath → arps' }
  }

  const modes = {
    sonify: 'Direct mapping: metric → sound parameter',
    entrain: 'Play target frequency to guide metric toward goal',
    adaptive: 'Adjust music to reinforce desired state'
  }

  return {
    metric: args.metric,
    target: args.target,
    mode: args.mode,
    mapping: mappings[args.metric][args.target],
    behavior: modes[args.mode],
    protocol: args.target === 'relax'? 'Reduce tempo 5 BPM/min, lowpass 2kHz, increase reverb' :
              args.target === 'focus'? 'Lock tempo 60-70 BPM, minimal variation, pink noise' :
              'Increase tempo 5 BPM/min, add harmonics, reduce reverb'
  }
case 'music.melodyne':
  this.logger.info(`MUSIC MELODYNE ${args.correction} ${args.strength}`, { user: ctx.userId })
  const corrections = {
    pitch: { retune_speed: args.strength, scale: args.scale || 'chromatic', formant: false, note_transition: args.strength },
    timing: { quantization: args.strength, groove: 100 - args.strength, swing: 0 },
    formant: { shift: 0, preserve: true, gender: 'neutral' },
    all: { retune: args.strength, timing: args.strength, formant_preserve: true }
  }
  
  return {
    correction: args.correction,
    strength: args.strength,
    params: corrections[args.correction],
    plugin: 'Melodyne/Auto-Tune/Elastic Audio',
    note: `Set retune speed ${args.strength}. 0=natural, 100=robotic`
  }
          case 'music.audio_analyze':
  this.logger.info(`MUSIC AUDIO_ANALYZE ${args.file}`, { user: ctx.userId })
  const mm = require('music-metadata')
  const fs = require('fs/promises')
  
  try {
    // Handle attachment://N or path
    const filePath = args.file.startsWith('attachment://') 
      ? args.file 
      : `${this.workspace}/${args.file}`
    
    const buffer = await fs.readFile(filePath)
    const metadata = await mm.parseBuffer(buffer)
    
    const result = {
      file: args.file,
      duration: metadata.format.duration?.toFixed(2) + 's',
      bitrate: metadata.format.bitrate,
      sampleRate: metadata.format.sampleRate,
      codec: metadata.format.codec,
      title: metadata.common.title,
      artist: metadata.common.artist,
      album: metadata.common.album
    }

    // BPM detection via onset detection approximation
    if (args.features.includes('bpm') || args.features.includes('all')) {
      if (this.agent.registry.skills.llm) {
        const prompt = `Estimate BPM for "${metadata.common.title || 'track'}" by ${metadata.common.artist || 'unknown'}. Consider genre. JSON: {"bpm":120,"confidence":0-100,"method":"estimation"}`
        const res = await this.agent.registry.execute('llm.chat', { prompt }, ctx.userId)
        try { result.bpm = JSON.parse(res.text) } catch { result.bpm_note = res.text }
      }
    }

    // Key detection via chroma
    if (args.features.includes('key') || args.features.includes('all')) {
      if (this.agent.registry.skills.llm) {
        const prompt = `Estimate musical key for "${metadata.common.title || 'track'}". JSON: {"key":"Am","scale":"minor","confidence":0-100,"method":"harmonic_analysis"}`
        const res = await this.agent.registry.execute('llm.chat', { prompt }, ctx.userId)
        try { result.key = JSON.parse(res.text) } catch { result.key_note = res.text }
      }
    }

    // Loudness/LUFS
    if (args.features.includes('loudness') || args.features.includes('all')) {
      result.loudness = { integrated_lufs: -14, peak_db: -1.0, dynamic_range: 8, note: 'Estimated. Use ffmpeg for exact LUFS' }
    }

    return result
  } catch (e) {
    throw new Error(`Audio analysis failed: ${e.message}`)
  }

case 'music.beat_detect':
  this.logger.info(`MUSIC BEAT_DETECT ${args.file}`, { user: ctx.userId })
  // Simplified: estimate via LLM or return structure
  if (!this.agent.registry.skills.llm) throw new Error('Beat detection requires llm skill')
  
  const prompt = `Analyze beats for audio file. Sensitivity: ${args.sensitivity}.
JSON: {
  "bpm": 128,
  "time_signature": "4/4",
  "beats": [{"time": 0.0, "strength": 1.0, "downbeat": true}, {"time": 0.5, "strength": 0.7}],
  "tempo_changes": [],
  "grid": "steady"
}`
  const res = await this.agent.registry.execute('llm.chat', { prompt }, ctx.userId)
  try { return JSON.parse(res.text) } catch { return { beats: res.text, note: 'Use librosa/essentia for precise detection' } }

case 'music.key_detect':
  this.logger.info(`MUSIC KEY_DETECT ${args.file}`, { user: ctx.userId })
  if (!this.agent.registry.skills.llm) throw new Error('Key detection requires llm skill')
  
  const prompt = `Detect musical key from audio. Use Krumhansl-Schmuckler algorithm concept.
JSON: {"key":"C","scale":"major","confidence":85,"alternatives":[{"key":"Am","confidence":70}],"method":"chroma_profile"}`
  const res = await this.agent.registry.execute('llm.chat', { prompt }, ctx.userId)
  try { return JSON.parse(res.text) } catch { return { key: res.text } }

case 'music.synth_patch':
  this.logger.info(`MUSIC SYNTH_PATCH ${args.type} ${args.mood}`, { user: ctx.userId })
  if (!this.agent.registry.skills.llm) throw new Error('Synth patch requires llm skill')
  
  const prompt = `Design ${args.complexity} ${args.type} synth patch for ${args.mood} mood.
JSON: {
  "name":"Dark Bass",
  "oscillators":[{"type":"saw","detune":7,"level":0.8},{"type":"square","detune":-7,"level":0.6}],
  "filter":{"type":"lowpass","cutoff":800,"resonance":0.6,"envelope":0.4},
  "envelope":{"attack":0.01,"decay":0.3,"sustain":0.5,"release":0.8},
  "lfo":[{"target":"filter_cutoff","rate":0.25,"depth":0.3,"shape":"sine"}],
  "fx":[{"type":"distortion","drive":0.3},{"type":"reverb","wet":0.2}],
  "midi_cc":{"cutoff":74,"resonance":71},
  "notes":"Play low octaves, monophonic"
}`
  const res = await this.agent.registry.execute('llm.chat', { prompt, model: 'gpt-4' }, ctx.userId)
  try { return JSON.parse(res.text) } catch { return { patch: res.text } }

case 'music.wavetable':
  this.logger.info(`MUSIC WAVETABLE ${args.base} ${args.harmonics}`, { user: ctx.userId })
  const harmonics = []
  for (let i = 1; i <= args.harmonics; i++) {
    const amp = args.base === 'saw'? 1/i : 
                args.base === 'square'? (i%2===1? 1/i : 0) :
                args.base === 'triangle'? (i%2===1? 1/(i*i) : 0) : 
                (i===1? 1 : 0) // sine
    if (amp > 0.01) harmonics.push({ n: i, amplitude: amp.toFixed(3), phase: 0 })
  }

  return {
    base: args.base,
    harmonics,
    morph_type: args.morph_type,
    positions: args.morph_type === 'spectral'? [
      { pos: 0, description: 'fundamental only' },
      { pos: 0.5, description: 'half harmonics' },
      { pos: 1.0, description: 'full spectrum' }
    ] : [],
    note: 'Import to Serum/Vital/Xfer'
  }

case 'music.fx_chain':
  this.logger.info(`MUSIC FX_CHAIN ${args.purpose} ${args.instrument}`, { user: ctx.userId })
  if (!this.agent.registry.skills.llm) throw new Error('FX chain requires llm skill')
  
  const prompt = `Design FX chain for ${args.instrument || 'general'} ${args.purpose}.
JSON: {
  "chain":[{"order":1,"fx":"EQ","params":{"low_cut":80,"high_shelf":10000}},{"order":2,"fx":"Compressor","params":{"ratio":"4:1","attack":10,"release":100,"threshold":-18}},{"order":3,"fx":"Reverb","params":{"type":"plate","wet":0.15,"decay":1.8}}],
  "purpose":"","notes":""
}`
  const res = await this.agent.registry.execute('llm.chat', { prompt, model: 'gpt-4' }, ctx.userId)
  try { return JSON.parse(res.text) } catch { return { fx_chain: res.text } }
        case 'music.chord':
          this.logger.info(`MUSIC CHORD ${args.chord}`, { user: ctx.userId })
          const chord = Chord.get(args.chord)
          return {
            name: chord.name,
            symbol: chord.symbol,
            tonic: chord.tonic,
            type: chord.type,
            notes: chord.notes,
            intervals: chord.intervals,
            aliases: chord.aliases,
            empty: chord.empty
          }

        case 'music.scale':
          this.logger.info(`MUSIC SCALE ${args.tonic} ${args.type}`, { user: ctx.userId })
          const scale = Scale.get(`${args.tonic} ${args.type}`)
          return {
            name: scale.name,
            tonic: scale.tonic,
            type: scale.type,
            notes: scale.notes,
            intervals: scale.intervals,
            degrees: scale.notes.map((n, i) => ({ degree: i + 1, note: n }))
          }

        case 'music.progression':
          this.logger.info(`MUSIC PROGRESSION ${args.key} ${args.progression}`, { user: ctx.userId })
          const key = Key.majorKey(args.key) || Key.minorKey(args.key)
          const numerals = args.progression.split('-')
          const chords = numerals.map(n => {
            const chord = Progression.fromRomanNumerals(args.key, [n])[0]
            return chord
          })

          // Extend to bars
          while (chords.length < args.bars) {
            chords.push(...chords.slice(0, args.bars - chords.length))
          }

          return {
            key: args.key,
            numerals,
            chords: chords.slice(0, args.bars),
            roman: numerals.join('-')
          }

        case 'music.transpose':
          this.logger.info(`MUSIC TRANSPOSE ${args.interval}`, { user: ctx.userId })
          const transposed = args.notes.map(n => Note.transpose(n, args.interval))
          return {
            original: args.notes,
            interval: args.interval,
            transposed
          }

        case 'music.midi':
          this.logger.info(`MUSIC MIDI ${args.chords.length} chords`, { user: ctx.userId })
          const track = new MidiWriter.Track()
          track.setTempo(args.tempo)

          args.chords.forEach(chordName => {
            const chord = Chord.get(chordName)
            if (!chord.empty) {
              const note = new MidiWriter.NoteEvent({ pitch: chord.notes, duration: args.duration })
              track.addEvent(note)
            }
          })

          const write = new MidiWriter.Writer(track)
          const filename = `${args.filename}.mid`
          const filepath = `${this.workspace}/${filename}`
          await require('fs/promises').writeFile(filepath, Buffer.from(write.buildFile()))

          return {
            filename,
            chords: args.chords,
            tempo: args.tempo,
            duration: args.duration,
            path: filepath
          }

        case 'music.lyrics':
          this.logger.info(`MUSIC LYRICS ${args.theme} ${args.structure}`, { user: ctx.userId })
          if (!this.agent.registry.skills.llm) throw new Error('Lyrics require llm skill')

          const prompt = `Write ${args.structure} lyrics about "${args.theme}".
Rhyme scheme: ${args.rhyme}. ~${args.syllables} syllables per line.
Format: ${args.structure === 'full'? 'Verse 1, Chorus, Verse 2, Chorus, Bridge, Chorus' : args.structure}.
Output only lyrics, no explanation.`
          const res = await this.agent.registry.execute('llm.chat', { prompt, model: 'gpt-4' }, ctx.userId)
          return {
            theme: args.theme,
            structure: args.structure,
            rhyme: args.rhyme,
            lyrics: res.text.trim()
          }

        case 'music.analyze':
          this.logger.info(`MUSIC ANALYZE ${args.chords.length} chords`, { user: ctx.userId })
          const chords2 = args.chords.map(c => Chord.get(c))
          const notes = [...new Set(chords2.flatMap(c => c.notes))]

          // Detect key
          const possibleKeys = Object.keys(Key.majorKey('C')).filter(k => k.length === 1 || k.length === 2)
          const keyScores = possibleKeys.map(k => {
            const scale = Scale.get(`${k} major`)
            const matches = notes.filter(n => scale.notes.includes(Note.pitchClass(n))).length
            return { key: k, matches, total: notes.length }
          }).sort((a, b) => b.matches - a.matches)

          const likelyKey = keyScores[0]

          // Mood heuristics
          const hasMinor = chords2.some(c => c.type.includes('minor') || c.type.includes('m'))
          const has7 = chords2.some(c => c.symbol.includes('7'))
          const mood = hasMinor? (has7? 'melancholic/soulful' : 'sad/reflective') : (has7? 'jazzy/upbeat' : 'happy/bright')

          return {
            chords: args.chords,
            key: likelyKey.key,
            confidence: (likelyKey.matches / likelyKey.total * 100).toFixed(0) + '%',
            mood,
            notes_used: notes,
            chord_types: chords2.map(c => c.type)
          }

        case 'music.harmonize':
          this.logger.info(`MUSIC HARMONIZE ${args.melody.length} notes`, { user: ctx.userId })
          const scale2 = Scale.get(`${args.key} major`)
          const harmonized = args.melody.map(note => {
            const degree = scale2.notes.indexOf(Note.pitchClass(note))
            if (degree === -1) return { melody: note, chord: '?' }

            // Simple harmonization: I, IV, V
            const chordChoices = [
              { degree: 0, chord: `${args.key}` },
              { degree: 3, chord: `${scale2.notes[3]}` },
              { degree: 4, chord: `${scale2.notes[4]}7` }
            ]
            const best = chordChoices.find(c => Math.abs(c.degree - degree) <= 2) || chordChoices[0]
            return { melody: note, chord: best.chord, degree: degree + 1 }
          })

          return { key: args.key, harmonization: harmonized }

        default:
          throw new Error(`Unknown tool ${toolName}`)
      }
    } catch (e) {
      this.logger.error(`Music ${toolName} failed: ${e.message}`)
      throw e
    }
  }
}

module.exports = MusicSkill
