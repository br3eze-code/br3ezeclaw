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
    return {
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
