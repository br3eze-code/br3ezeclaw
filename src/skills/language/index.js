const { BaseSkill } = require('../base.js')
const franc = require('franc')
const nlp = require('compromise')

class LanguageSkill extends BaseSkill {
  static id = 'language'
  static name = 'Language'
  static description = 'Translation, grammar check, style rewrite, language detect, vocabulary, readability'

  constructor(config, logger, workspace) {
    super(config, logger, workspace)
    this.deeplKey = config.deeplKey || process.env.DEEPL_KEY
  }

  static getTools() {
'language.dialect': {
  risk: 'low',
  description: 'Map dialects: identify variety, features, regional variants, sociolects',
  parameters: {
    type: 'object',
    properties: {
      text: { type: 'string' },
      lang: { type: 'string', default: 'en' },
      mode: { type: 'string', enum: ['identify', 'features', 'convert', 'map'], default: 'identify' },
      target_dialect: { type: 'string', description: 'for convert mode: en-US, en-GB, en-AU, es-MX, es-ES, etc' }
    },
    required: ['text']
  }
},
'language.syntax': {
  risk: 'low',
  description: 'Syntax parsing: dependencies, constituency, POS, grammatical relations',
  parameters: {
    type: 'object',
    properties: {
      text: { type: 'string' },
      lang: { type: 'string', default: 'en' },
      format: { type: 'string', enum: ['dependencies', 'constituency', 'both'], default: 'dependencies' }
    },
    required: ['text']
  }
},
'language.register': {
  risk: 'low',
  description: 'Analyze register: formal/informal, register shifts, appropriateness',
  parameters: {
    type: 'object',
    properties: {
      text: { type: 'string' },
      context: { type: 'string', description: 'academic, business, casual, legal, etc' }
    },
    required: ['text']
  }
},
'language.variation': {
  risk: 'low',
  description: 'Sociolinguistic variation: age, gender, class, region markers in text',
  parameters: {
    type: 'object',
    properties: {
      text: { type: 'string' },
      lang: { type: 'string', default: 'en' }
    },
    required: ['text']
  }
}
'language.prosody': {
  risk: 'low',
  description: 'Analyze prosody: intonation, rhythm, stress, pitch contour, meter',
  parameters: {
    type: 'object',
    properties: {
      text: { type: 'string' },
      lang: { type: 'string', default: 'en' },
      mode: { type: 'string', enum: ['stress', 'rhythm', 'intonation', 'meter', 'all'], default: 'all' }
    },
    required: ['text']
  }
},
'language.morphology': {
  risk: 'low',
  description: 'Morphological analysis: morphemes, roots, affixes, word formation',
  parameters: {
    type: 'object',
    properties: {
      word: { type: 'string' },
      lang: { type: 'string', default: 'en' },
      type: { type: 'string', enum: ['breakdown', 'inflection', 'derivation', 'compound'], default: 'breakdown' }
    },
    required: ['word']
  }
},
'language.scan': {
  risk: 'low',
  description: 'Scansion: analyze poetic meter iambic/trochaic/dactylic/etc',
  parameters: {
    type: 'object',
    properties: {
      text: { type: 'string', description: 'line or stanza' },
      lang: { type: 'string', default: 'en' }
    },
    required: ['text']
  }
},
'language.etymon': {
  risk: 'low',
  description: 'Find etymons: proto-forms, PIE roots, cognates across languages',
  parameters: {
    type: 'object',
    properties: {
      word: { type: 'string' },
      lang: { type: 'string', default: 'en' },
      depth: { type: 'string', enum: ['immediate', 'pie', 'full'], default: 'full' }
    },
    required: ['word']
  }
}
    return {
'language.ipa': {
  risk: 'low',
  description: 'Convert text to IPA pronunciation, phonetics, syllables, stress',
  parameters: {
    type: 'object',
    properties: {
      text: { type: 'string' },
      lang: { type: 'string', default: 'en-us', description: 'en-us, en-gb, es, fr, de, etc' },
      format: { type: 'string', enum: ['ipa', 'arpa', 'both'], default: 'ipa' }
    },
    required: ['text']
  }
},
'language.phonetics': {
  risk: 'low',
  description: 'Analyze phonetics: syllable count, stress pattern, sounds',
  parameters: {
    type: 'object',
    properties: {
      word: { type: 'string' },
      lang: { type: 'string', default: 'en' }
    },
    required: ['word']
  }
},
'language.corpus': {
  risk: 'low',
  description: 'Corpus analysis: frequency, collocations, n-grams, usage trends',
  parameters: {
    type: 'object',
    properties: {
      word: { type: 'string' },
      corpus: { type: 'string', enum: ['google_books', 'coca', 'bnc', 'general'], default: 'general' },
      metric: { type: 'string', enum: ['frequency', 'collocations', 'ngrams', 'trends', 'all'], default: 'all' },
      n: { type: 'number', description: 'n for n-grams', default: 2 }
    },
    required: ['word']
  }
},
'language.compare': {
  risk: 'low',
  description: 'Compare two words: similarity, frequency, register, usage',
  parameters: {
    type: 'object',
    properties: {
      word1: { type: 'string' },
      word2: { type: 'string' },
      lang: { type: 'string', default: 'en' }
    },
    required: ['word1', 'word2']
  }
}
'language.thesaurus': {
  risk: 'low',
  description: 'Advanced thesaurus: hypernyms, hyponyms, meronyms, holonyms, related terms',
  parameters: {
    type: 'object',
    properties: {
      word: { type: 'string' },
      lang: { type: 'string', default: 'en' },
      relation: { type: 'string', enum: ['synonym', 'antonym', 'hypernym', 'hyponym', 'meronym', 'holonym', 'related', 'all'], default: 'all' },
      limit: { type: 'number', default: 10 }
    },
    required: ['word']
  }
},
'language.etymology': {
  risk: 'low',
  description: 'Word origin, etymology, historical evolution, cognates',
  parameters: {
    type: 'object',
    properties: {
      word: { type: 'string' },
      lang: { type: 'string', default: 'en' }
    },
    required: ['word']
  }
},
'language.rhymes': {
  risk: 'low',
  description: 'Find rhymes, near-rhymes, alliteration for creative writing',
  parameters: {
    type: 'object',
    properties: {
      word: { type: 'string' },
      type: { type: 'string', enum: ['perfect', 'near', 'alliteration', 'consonant'], default: 'perfect' },
      limit: { type: 'number', default: 20 }
    },
    required: ['word']
  }
}
      'language.detect': {
        risk: 'low',
        description: 'Detect language of text',
        parameters: {
          type: 'object',
          properties: {
            text: { type: 'string' }
          },
          required: ['text']
        }
      },
      'language.translate': {
        risk: 'low',
        description: 'Translate text between languages',
        parameters: {
          type: 'object',
          properties: {
            text: { type: 'string' },
            target: { type: 'string', description: 'ISO 639-1: en, es, fr, de, zh, ja, etc' },
            source: { type: 'string', description: 'auto if omitted' },
            formality: { type: 'string', enum: ['default', 'more', 'less'], default: 'default' }
          },
          required: ['text', 'target']
        }
      },
      'language.grammar': {
        risk: 'low',
        description: 'Check grammar + suggest corrections',
        parameters: {
          type: 'object',
          properties: {
            text: { type: 'string' },
            language: { type: 'string', default: 'en' }
          },
          required: ['text']
        }
      },
      'language.rewrite': {
        risk: 'low',
        description: 'Rewrite text: tone, clarity, concision, formality',
        parameters: {
          type: 'object',
          properties: {
            text: { type: 'string' },
            style: { type: 'string', enum: ['formal', 'casual', 'academic', 'simple', 'concise', 'persuasive'], default: 'concise' },
            preserve_meaning: { type: 'boolean', default: true }
          },
          required: ['text']
        }
      },
      'language.readability': {
        risk: 'low',
        description: 'Analyze readability: Flesch, grade level, complexity',
        parameters: {
          type: 'object',
          properties: {
            text: { type: 'string' }
          },
          required: ['text']
        }
      },
      'language.vocab': {
        risk: 'low',
        description: 'Extract key terms, define, or simplify vocabulary',
        parameters: {
          type: 'object',
          properties: {
            text: { type: 'string' },
            action: { type: 'string', enum: ['extract', 'define', 'simplify'], default: 'extract' },
            level: { type: 'string', enum: ['elementary', 'highschool', 'college'], default: 'highschool' }
          },
          required: ['text']
        }
      }
    }
  }

  async healthCheck() {
    return { status: 'ok', deepl:!!this.deeplKey }
  }

  async execute(toolName, args, ctx) {
    try {
      switch (toolName) {
        case 'language.detect':
          this.logger.info(`LANGUAGE DETECT`, { user: ctx.userId })
          const code = franc(args.text)
          const names = { eng: 'English', spa: 'Spanish', fra: 'French', deu: 'German', zho: 'Chinese', jpn: 'Japanese', por: 'Portuguese', rus: 'Russian' }
          return { code, language: names[code] || code, confidence: code === 'und'? 0 : 1 }
          case 'language.dialect':
  this.logger.info(`LANGUAGE DIALECT ${args.mode} ${args.lang}`, { user: ctx.userId })
  if (!this.agent.registry.skills.llm) throw new Error('Dialect analysis requires llm skill')

  const prompts = {
    identify: `Identify the dialect/variety of this ${args.lang} text. JSON: {"dialect":"en-US/en-GB/en-AU/en-IN/en-SG/etc","confidence":0-100,"features":[{"feature":"rhoticity","value":"rhotic","note":"pronounces r"}]}. Text:\n${args.text}`,
    features: `List dialectal features in this ${args.lang} text. JSON: {"dialect":"","phonology":["drops r"],"lexicon":["lorry=truck"],"grammar":["use of 'got'"],"pragmatics":[]}. Text:\n${args.text}`,
    convert: `Convert this ${args.lang} text to ${args.target_dialect}. Preserve meaning. Only output converted text. Text:\n${args.text}`,
    map: `Map regional variants for key terms in this text. JSON: {"terms":[{"standard":"","variants":[{"dialect":"en-GB","form":"lift"},{"dialect":"en-US","form":"elevator"}]}]}. Text:\n${args.text}`
  }

  const res = await this.agent.registry.execute('llm.chat', { prompt: prompts[args.mode], model: 'gpt-4' }, ctx.userId)

  if (args.mode === 'convert') {
    return { source: args.lang, target: args.target_dialect, text: res.text.trim() }
  }
  try {
    return { mode: args.mode, lang: args.lang,...JSON.parse(res.text) }
  } catch {
    return { mode: args.mode, analysis: res.text }
  }

case 'language.syntax':
  this.logger.info(`LANGUAGE SYNTAX ${args.format}`, { user: ctx.userId })
  const nlp = require('compromise')
  const doc = nlp(args.text)

  const result = { text: args.text, lang: args.lang }

  if (args.format === 'dependencies' || args.format === 'both') {
    // Basic dependencies via compromise + LLM for full parse
    const terms = doc.terms().json()
    result.pos = terms.map(t => ({ text: t.text, tags: t.tags, normal: t.normal }))

    if (this.agent.registry.skills.llm) {
      const prompt = `Dependency parse for ${args.lang}. Universal Dependencies format. JSON: {"tokens":[{"id":1,"form":"","lemma":"","upos":"","head":0,"deprel":"root/nsubj/obj/etc"}],"root":1}
Text: ${args.text}`
      const res = await this.agent.registry.execute('llm.chat', { prompt }, ctx.userId)
      try { result.dependencies = JSON.parse(res.text) } catch { result.dependency_note = res.text }
    }
  }

  if (args.format === 'constituency' || args.format === 'both') {
    if (this.agent.registry.skills.llm) {
      const prompt = `Constituency parse for ${args.lang}. Penn Treebank format. JSON: {"tree":"(S (NP (DT The) (NN cat)) (VP (VBD sat)))","phrases":[{"type":"NP","text":"The cat"}]}
Text: ${args.text}`
      const res = await this.agent.registry.execute('llm.chat', { prompt }, ctx.userId)
      try { result.constituency = JSON.parse(res.text) } catch { result.constituency_note = res.text }
    }
  }

  return result

case 'language.register':
  this.logger.info(`LANGUAGE REGISTER ${args.context || 'general'}`, { user: ctx.userId })
  if (!this.agent.registry.skills.llm) throw new Error('Register analysis requires llm skill')

  const prompt = `Analyze register/formality of this text. Context: ${args.context || 'general'}.
JSON: {
  "register":"formal/informal/neutral/mixed",
  "score":1-10,
  "features":{"lexical":["utilize=formal","gonna=informal"],"grammatical":["passive voice","contractions"]},
  "appropriateness":"appropriate/inappropriate for ${args.context || 'general'}",
  "shifts":[{"span":"text","from":"formal","to":"informal"}],
  "suggestion":""
}
Text:\n${args.text}`
  const res = await this.agent.registry.execute('llm.chat', { prompt, model: 'gpt-4' }, ctx.userId)
  try { return JSON.parse(res.text) } catch { return { text: args.text, analysis: res.text } }

case 'language.variation':
  this.logger.info(`LANGUAGE VARIATION ${args.lang}`, { user: ctx.userId })
  if (!this.agent.registry.skills.llm) throw new Error('Variation analysis requires llm skill')

  const prompt = `Analyze sociolinguistic variation in this ${args.lang} text. Identify markers of:
age, gender, class, region, ethnicity, education level.
JSON: {
  "markers":{
    "regional":[{"feature":"y'all","region":"US South"},{"feature":"innit","region":"UK"}],
    "class":[{"feature":"ain't","register":"nonstandard"}],
    "age":[{"feature":"slay","cohort":"GenZ"}]
  },
  "overall":"assessment",
  "dominant_variety":""
}
Text:\n${args.text}`
  const res = await this.agent.registry.execute('llm.chat', { prompt, model: 'gpt-4' }, ctx.userId)
  try { return JSON.parse(res.text) } catch { return { text: args.text, analysis: res.text } }
    case 'language.prosody':
  this.logger.info(`LANGUAGE PROSODY ${args.mode}: ${args.text.slice(0, 40)}`, { user: ctx.userId })
  const nlp = require('compromise')
  const doc = nlp(args.text)
  const terms = doc.terms().json()

  const result = { text: args.text, lang: args.lang }

  if (args.mode === 'stress' || args.mode === 'all') {
    // Syllables + stress via espeak if available
    try {
      const { execSync } = require('child_process')
      const ipa = execSync(`espeak-ng -v ${args.lang} -q -x --ipa "${args.text.replace(/"/g, '\\"')}"`, { encoding: 'utf8' }).trim()
      const stress_marks = [...ipa.matchAll(/[ˈˌ]/g)].map((m, i) => ({ position: m.index, type: m[0] === 'ˈ'? 'primary' : 'secondary' }))
      result.stress = { ipa, marks: stress_marks, pattern: ipa.replace(/[^ˈˌ]/g, '').split('').join('-') }
    } catch {
      result.stress = { note: 'Install espeak-ng for stress marks. Syllables estimated.', syllables: terms.map(t => t.syllables || t.text.length / 3) }
    }
  }

  if (args.mode === 'rhythm' || args.mode === 'all') {
    const words = args.text.split(/\s+/)
    const syllables = words.map(w => w.toLowerCase().replace(/[^a-z]/g, '').replace(/[aeiouy]+/g, 'a').length || 1)
    result.rhythm = {
      words: words.length,
      syllables: syllables.reduce((a, b) => a + b, 0),
      avg_syllables_per_word: (syllables.reduce((a, b) => a + b, 0) / words.length).toFixed(2),
      pattern: syllables.map(s => 'x'.repeat(s)).join('-')
    }
  }

  if (args.mode === 'intonation' || args.mode === 'all') {
    // LLM for intonation contours
    if (this.agent.registry.skills.llm) {
      const prompt = `Analyze intonation contour of "${args.text}" in ${args.lang}. JSON: {"contour":"falling/rising/fall-rise/rise-fall","focus":"word with emphasis","boundary_tones":["H%","L%"],"note":""}`
      const res = await this.agent.registry.execute('llm.chat', { prompt }, ctx.userId)
      try { result.intonation = JSON.parse(res.text) } catch { result.intonation = { note: res.text } }
    }
  }

  if (args.mode === 'meter' || args.mode === 'all') {
    // Basic meter detection: iambic = unstressed-stressed
    if (result.stress?.pattern) {
      const p = result.stress.pattern
      if (/^([ˌ]?ˈ)+$/.test(p.replace(/-/g, ''))) result.meter = { type: 'iambic', pattern: p }
      else if (/^(ˈ[ˌ]?)+$/.test(p.replace(/-/g, ''))) result.meter = { type: 'trochaic', pattern: p }
      else result.meter = { type: 'mixed/irregular', pattern: p }
    }
  }

  return result

case 'language.morphology':
  this.logger.info(`LANGUAGE MORPHOLOGY ${args.word} ${args.type}`, { user: ctx.userId })
  if (!this.agent.registry.skills.llm) throw new Error('Morphology requires llm skill')

  const prompts = {
    breakdown: `Break down "${args.word}" in ${args.lang} into morphemes. JSON: {"word":"","morphemes":[{"morph":"","type":"root/prefix/suffix/infix","meaning":"","origin":""}],"structure":"root+suffix"}`,
    inflection: `Give inflectional paradigm for "${args.word}" in ${args.lang}. JSON: {"lemma":"","pos":"","inflections":{"plural":"","past":"","gerund":"","comparative":""}}`,
    derivation: `Give derivational family of "${args.word}" in ${args.lang}. JSON: {"base":"","derivatives":[{"word":"","process":"suffixation","meaning":""}]}`,
    compound: `If "${args.word}" is compound in ${args.lang}, analyze. JSON: {"is_compound":true,"elements":[{"word":"","meaning":""}],"type":"endocentric/exocentric","head":""}`
  }

  const res = await this.agent.registry.execute('llm.chat', { prompt: prompts[args.type], model: 'gpt-4' }, ctx.userId)
  try {
    return { word: args.word, lang: args.lang, type: args.type,...JSON.parse(res.text) }
  } catch {
    return { word: args.word, analysis: res.text }
  }

case 'language.scan':
  this.logger.info(`LANGUAGE SCAN: ${args.text.slice(0, 30)}`, { user: ctx.userId })
  if (!this.agent.registry.skills.llm) throw new Error('Scansion requires llm skill')

  const prompt = `Scan this ${args.lang} poetry for meter. Mark stressed/unstressed: ˈ = stressed, ˘ = unstressed.
Identify meter type: iambic pentameter, trochaic tetrameter, dactylic hexameter, etc.
JSON: {"text":"","scansion":"˘ˈ ˘ˈ ˘ˈ ˘ˈ ˘ˈ","meter":"iambic pentameter","feet":5,"pattern":"unstressed-stressed","irregularities":[]}

Text:\n${args.text}`
  const res = await this.agent.registry.execute('llm.chat', { prompt, model: 'gpt-4' }, ctx.userId)
  try { return JSON.parse(res.text) } catch { return { text: args.text, scansion: res.text } }

case 'language.etymon':
  this.logger.info(`LANGUAGE ETYMON ${args.word} ${args.depth}`, { user: ctx.userId })
  if (!this.agent.registry.skills.llm) throw new Error('Etymon requires llm skill')

  const prompt = `Trace etymology of "${args.word}" in ${args.lang} to ${args.depth === 'pie'? 'Proto-Indo-European' : args.depth === 'immediate'? 'immediate source' : 'deepest root'}.
JSON: {
  "word":"","pos":"",
  "immediate_source":{"lang":"","form":"","meaning":"","date":""},
  "intermediate":[{"lang":"","form":"","meaning":"","date":""}],
  "root":{"lang":"PIE/Proto-Germanic/etc","form":"*wérh₁-","meaning":"","reconstruction":true},
  "cognates":[{"lang":"de","word":"","meaning":""},{"lang":"la","word":"","meaning":""}],
  "semantic_shift":[{"period":"","meaning":""}]
}`
  const res = await this.agent.registry.execute('llm.chat', { prompt, model: 'gpt-4' }, ctx.userId)
  try { return JSON.parse(res.text) } catch { return { word: args.word, etymology: res.text } }
  case 'language.ipa':
  this.logger.info(`LANGUAGE IPA ${args.lang}: ${args.text.slice(0, 30)}`, { user: ctx.userId })
  // Use eSpeak NG if available, else LLM
  try {
    const { execSync } = require('child_process')
    const escaped = args.text.replace(/"/g, '\\"')
    const voice = args.lang.replace('-', '_') // en-us -> en_us
    let cmd = `espeak-ng -v ${voice} -q -x --ipa "${escaped}"`

    if (args.format === 'arpa') cmd = `espeak-ng -v ${voice} -q -x --phonout "${escaped}"`

    const ipa = execSync(cmd, { encoding: 'utf8', timeout: 5000 }).trim()

    if (args.format === 'both') {
      const arpa = execSync(`espeak-ng -v ${voice} -q -x --phonout "${escaped}"`, { encoding: 'utf8' }).trim()
      return { text: args.text, lang: args.lang, ipa, arpa }
    }
    return { text: args.text, lang: args.lang, [args.format]: ipa }
  } catch {
    // LLM fallback
    if (!this.agent.registry.skills.llm) throw new Error('IPA requires espeak-ng or llm skill')
    const prompt = `Convert to ${args.format === 'arpa'? 'ARPAbet' : 'IPA'} phonetic transcription for ${args.lang}. Output only transcription:\n\n${args.text}`
    const res = await this.agent.registry.execute('llm.chat', { prompt }, ctx.userId)
    return { text: args.text, lang: args.lang, [args.format]: res.text.trim() }
  }

case 'language.phonetics':
  this.logger.info(`LANGUAGE PHONETICS ${args.word}`, { user: ctx.userId })
  const nlp = require('compromise')
  const doc = nlp(args.word)
  const term = doc.terms().json()[0] || {}

  // Syllable estimation
  const syllables = args.word.toLowerCase().replace(/[^a-z]/g, '').replace(/[aeiouy]+/g, 'a').length || 1

  // Try espeak for stress pattern
  let stress = null, phonemes = null
  try {
    const { execSync } = require('child_process')
    const ipa = execSync(`espeak-ng -v en -q -x --ipa "${args.word}"`, { encoding: 'utf8' }).trim()
    stress = (ipa.match(/ˈ/g) || []).length? 'primary' : 'none'
    if (ipa.includes('ˌ')) stress = 'secondary'
    phonemes = ipa.split('').filter(c => c.trim())
  } catch {}

  return {
    word: args.word,
    syllables,
    stress,
    phonemes,
    ipa: phonemes?.join(' '),
    sounds: term.tags || []
  }

case 'language.corpus':
  this.logger.info(`LANGUAGE CORPUS ${args.word} ${args.metric}`, { user: ctx.userId })
  // Use Datamuse + Google Ngrams approximation via LLM
  const base = 'https://api.datamuse.com/words'

  try {
    const results = {}
    if (args.metric === 'frequency' || args.metric === 'all') {
      const res = await fetch(`${base}?sp=${encodeURIComponent(args.word)}&md=f&max=1`)
      const data = await res.json()
      results.frequency = data[0]?.tags?.find(t => t.startsWith('f:'))?.slice(2)
      results.frequency_note = results.frequency? `f:${results.frequency} = occurs ~${Math.pow(10, parseFloat(results.frequency)).toFixed(0)} per million words` : 'unknown'
    }

    if (args.metric === 'collocations' || args.metric === 'all') {
      const res = await fetch(`${base}?rel_bga=${encodeURIComponent(args.word)}&max=15`) // bga = frequent followers
      const before = await res.json()
      const res2 = await fetch(`${base}?rel_bgb=${encodeURIComponent(args.word)}&max=15`) // bgb = frequent predecessors
      const after = await res2.json()
      results.collocations = {
        before: after.map(w => w.word), // words that come before
        after: before.map(w => w.word) // words that come after
      }
    }

    if (args.metric === 'ngrams' || args.metric === 'all') {
      // Approximate with Datamuse rel_trg = triggers/related
      const res = await fetch(`${base}?rel_trg=${encodeURIComponent(args.word)}&max=20`)
      const related = await res.json()
      results.related_terms = related.map(w => w.word)
      results.ngram_note = `${args.n}-grams require Google Ngrams API. Related terms shown instead.`
    }

    if (args.metric === 'trends' || args.metric === 'all') {
      // LLM for historical trends
      if (this.agent.registry.skills.llm) {
        const prompt = `Give usage trend of "${args.word}" from 1800-2020. JSON: {"1800s":"rare","1900s":"common","2000s":"peak","trend":"rising/falling/stable","peak_year":2005}`
        const res = await this.agent.registry.execute('llm.chat', { prompt }, ctx.userId)
        try { results.trends = JSON.parse(res.text) } catch { results.trends_note = res.text }
      }
    }

    return { word: args.word, corpus: args.corpus,...results }
  } catch (e) {
    throw new Error(`Corpus analysis failed: ${e.message}`)
  }

case 'language.compare':
  this.logger.info(`LANGUAGE COMPARE ${args.word1} vs ${args.word2}`, { user: ctx.userId })
  if (!this.agent.registry.skills.llm) throw new Error('Compare requires llm skill')

  const prompt = `Compare "${args.word1}" vs "${args.word2}" in ${args.lang}.
JSON: {
  "similarity": 0-100,
  "word1": {"frequency":"high/medium/low","register":"formal/informal/neutral","connotation":"positive/negative/neutral","example":""},
  "word2": {"frequency":"high/medium/low","register":"formal/informal/neutral","connotation":"positive/negative/neutral","example":""},
  "difference":"key distinction",
  "when_to_use_each":""
}`
  const res = await this.agent.registry.execute('llm.chat', { prompt, model: 'gpt-4' }, ctx.userId)
  try { return JSON.parse(res.text) } catch { return { word1: args.word1, word2: args.word2, analysis: res.text } }
case 'language.thesaurus':
  this.logger.info(`LANGUAGE THESAURUS ${args.word} ${args.relation}`, { user: ctx.userId })
  // Datamuse API supports semantic relations
  const base = 'https://api.datamuse.com/words'
  const relMap = {
    synonym: 'ml', // means like
    antonym: 'rel_ant', // antonyms
    hypernym: 'rel_spc', // more specific = hypernym of query
    hyponym: 'rel_gen', // more general = hyponym of query
    meronym: 'rel_par', // part of
    holonym: 'rel_com', // comprises
    related: 'rel_trg' // triggers/related
  }

  try {
    if (args.relation === 'all') {
      const results = {}
      for (const [rel, code] of Object.entries(relMap)) {
        const url = `${base}?${code}=${encodeURIComponent(args.word)}&max=${args.limit}`
        const res = await fetch(url)
        results[rel] = (await res.json()).map(w => w.word)
      }
      return { word: args.word, lang: args.lang, relations: results }
    } else {
      const code = relMap[args.relation]
      const url = `${base}?${code}=${encodeURIComponent(args.word)}&max=${args.limit}`
      const res = await fetch(url)
      const words = await res.json()
      return { word: args.word, relation: args.relation, terms: words.map(w => w.word) }
    }
  } catch {
    // LLM fallback with WordNet-style relations
    if (!this.agent.registry.skills.llm) throw new Error('Thesaurus requires network or llm skill')
    const prompt = `For "${args.word}" in ${args.lang}, list ${args.relation === 'all'? 'all semantic relations' : args.relation}.
JSON: {"synonym":[],"antonym":[],"hypernym":[],"hyponym":[],"meronym":[],"holonym":[],"related":[]}
Hypernym = broader category. Hyponym = specific type. Meronym = part of. Holonym = whole of.`
    const res = await this.agent.registry.execute('llm.chat', { prompt, model: 'gpt-4' }, ctx.userId)
    try { return { word: args.word, lang: args.lang,...JSON.parse(res.text) } } catch { return { word: args.word, note: res.text } }
  }

case 'language.etymology':
  this.logger.info(`LANGUAGE ETYMOLOGY ${args.word}`, { user: ctx.userId })
  // Wiktionary API
  try {
    const url = `https://en.wiktionary.org/api/rest_v1/page/definition/${encodeURIComponent(args.word)}`
    const res = await fetch(url)
    if (!res.ok) throw new Error('Not found')

    // Etymology is in page HTML, not definition API. Use LLM for structured data.
    if (this.agent.registry.skills.llm) {
      const prompt = `Give etymology of "${args.word}" in ${args.lang}.
JSON: {"word":"","language_of_origin":"","root":"","first_attested":"","evolution":[{"period":"","form":"","meaning":""}],"cognates":[{"lang":"","word":""}],"note":""}
Be concise but scholarly.`
      const llmRes = await this.agent.registry.execute('llm.chat', { prompt, model: 'gpt-4' }, ctx.userId)
      try { return JSON.parse(llmRes.text) } catch { return { word: args.word, etymology: llmRes.text } }
    }
    throw new Error('Etymology requires llm skill')
  } catch (e) {
    throw new Error(`Etymology lookup failed: ${e.message}`)
  }

case 'language.rhymes':
  this.logger.info(`LANGUAGE RHYMES ${args.word} ${args.type}`, { user: ctx.userId })
  const rhymeBase = 'https://api.datamuse.com/words'
  const typeMap = {
    perfect: 'rel_rhy', // perfect rhymes
    near: 'rel_nry', // near rhymes
    alliteration: 'rel_bga', // begins with same sound
    consonant: 'rel_cns' // consonant match
  }

  try {
    const url = `${rhymeBase}?${typeMap[args.type]}=${encodeURIComponent(args.word)}&max=${args.limit}`
    const res = await fetch(url)
    const words = await res.json()
    return { word: args.word, type: args.type, rhymes: words.map(w => w.word) }
  } catch {
    if (!this.agent.registry.skills.llm) throw new Error('Rhymes requires network or llm skill')
    const prompt = `List ${args.limit} ${args.type} rhymes for "${args.word}". JSON: {"rhymes":[]}`
    const res = await this.agent.registry.execute('llm.chat', { prompt }, ctx.userId)
    try { return { word: args.word, type: args.type,...JSON.parse(res.text) } } catch { return { word: args.word, note: res.text } }
  }
        case 'language.translate':
          this.logger.info(`LANGUAGE TRANSLATE to ${args.target}`, { user: ctx.userId })

          // Use DeepL if key available, else LLM fallback
          if (this.deeplKey) {
            const deepl = require('deepl-node')
            const translator = new deepl.Translator(this.deeplKey)
            const res = await translator.translateText(args.text, args.source || null, args.target, { formality: args.formality })
            return { source: res.detectedSourceLang, target: args.target, text: res.text }
          } else if (this.agent.registry.skills.llm) {
            const prompt = `Translate to ${args.target}. Output only the translation, no notes:\n\n${args.text}`
            const res = await this.agent.registry.execute('llm.chat', { prompt }, ctx.userId)
            return { source: args.source || 'auto', target: args.target, text: res.text }
          } else {
            throw new Error('No translation backend: set DEEPL_KEY or enable llm skill')
          }

        case 'language.grammar':
          this.logger.info(`LANGUAGE GRAMMAR ${args.language}`, { user: ctx.userId })
          const doc = nlp(args.text)

          const issues = []
          // Basic checks with compromise
          if (doc.match('#Verb #Verb').found) issues.push({ type: 'double_verb', text: doc.match('#Verb #Verb').text() })
          if (doc.match('a #Vowel').found) issues.push({ type: 'a_an', text: doc.match('a #Vowel').text(), fix: doc.match('a #Vowel').text().replace('a ', 'an ') })

          // LLM for deeper grammar if available
          let suggestions = []
          if (this.agent.registry.skills.llm) {
            const prompt = `Check grammar. List errors as JSON [{"error":"text","fix":"corrected","rule":"explanation"}]. If none, []. Text:\n\n${args.text}`
            const res = await this.agent.registry.execute('llm.chat', { prompt, model: 'gpt-4' }, ctx.userId)
            try { suggestions = JSON.parse(res.text) } catch { suggestions = [{ note: res.text }] }
          }

          return { language: args.language, issues, suggestions, corrected: doc.text('normal') }

        case 'language.rewrite':
          this.logger.info(`LANGUAGE REWRITE ${args.style}`, { user: ctx.userId })
          if (!this.agent.registry.skills.llm) throw new Error('Rewrite requires llm skill')

          const prompt = `Rewrite in ${args.style} style.${args.preserve_meaning? ' Preserve exact meaning.' : ''} Output only rewritten text:\n\n${args.text}`
          const res = await this.agent.registry.execute('llm.chat', { prompt }, ctx.userId)
          return { style: args.style, original: args.text, rewritten: res.text }

        case 'language.readability':
          this.logger.info(`LANGUAGE READABILITY`, { user: ctx.userId })
          const words = args.text.split(/\s+/).length
          const sentences = args.text.split(/[.!?]+/).length - 1 || 1
          const syllables = args.text.toLowerCase().replace(/[^a-z]/g, '').replace(/[aeiouy]+/g, 'a').length

          const flesch = 206.835 - 1.015 * (words / sentences) - 84.6 * (syllables / words)
          const grade = 0.39 * (words / sentences) + 11.8 * (syllables / words) - 15.59

          let level = 'college'
          if (flesch > 80) level = 'elementary'
          else if (flesch > 60) level = 'highschool'

          return {
            words,
            sentences,
            avg_sentence_length: (words / sentences).toFixed(1),
            flesch_score: flesch.toFixed(1),
            grade_level: grade.toFixed(1),
            level
          }

        case 'language.vocab':
          this.logger.info(`LANGUAGE VOCAB ${args.action}`, { user: ctx.userId })
          if (args.action === 'extract') {
            const doc2 = nlp(args.text)
            const nouns = doc2.nouns().out('array')
            const terms = doc2.match('#Noun+').out('array')
            return { action: 'extract', terms: [...new Set([...nouns,...terms])].slice(0, 30) }
          } else if (args.action === 'define') {
            if (!this.agent.registry.skills.llm) throw new Error('Define requires llm skill')
            const prompt2 = `Define key terms from this text at ${args.level} level. JSON [{"term":"x","def":"y"}]:\n\n${args.text}`
            const res2 = await this.agent.registry.execute('llm.chat', { prompt: prompt2 }, ctx.userId)
            try { return { action: 'define', definitions: JSON.parse(res2.text) } } catch { return { action: 'define', text: res2.text } }
          } else {
            if (!this.agent.registry.skills.llm) throw new Error('Simplify requires llm skill')
            const prompt3 = `Simplify vocabulary to ${args.level} level. Keep meaning. Output only simplified text:\n\n${args.text}`
            const res3 = await this.agent.registry.execute('llm.chat', { prompt: prompt3 }, ctx.userId)
            return { action: 'simplify', level: args.level, text: res3.text }
          }

        default:
          throw new Error(`Unknown tool ${toolName}`)
      }
    } catch (e) {
      this.logger.error(`Language ${toolName} failed: ${e.message}`)
      throw e
    }
  }
}

module.exports = LanguageSkill
