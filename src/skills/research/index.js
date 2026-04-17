const { exec } = require('child_process')
const { promisify } = require('util')
const path = require('path')
const fs = require('fs/promises')
const pdf = require('pdf-parse')
const cheerio = require('cheerio')
const { BaseSkill } = require('../base.js')

const execAsync = promisify(exec)

class ResearchSkill extends BaseSkill {
  static id = 'research'
  static name = 'Research'
  static description = 'Deep research: search, scrape, parse PDFs, track citations, synthesize reports'

  constructor(config, logger, workspace) {
    super(config, logger, workspace)
    this.outputDir = config.outputDir || '/workspace/research'
    this.cache = new Map() // url -> { title, text, citations }
  }

  static getTools() {
    return {
      'research.search': {
        risk: 'low',
        description: 'Web search with academic/news focus',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string' },
            focus: { type: 'string', enum: ['academic', 'news', 'general'], default: 'general' },
            max_results: { type: 'number', default: 10 }
          },
          required: ['query']
        }
      },
      'research.fetch': {
        risk: 'low',
        description: 'Fetch + extract text from URL or PDF',
        parameters: {
          type: 'object',
          properties: {
            url: { type: 'string' },
            extract_tables: { type: 'boolean', default: false }
          },
          required: ['url']
        }
      },
      'research.pdf': {
        risk: 'low',
        description: 'Parse local PDF: extract text, metadata, references',
        parameters: {
          type: 'object',
          properties: { path: { type: 'string', description: 'path to PDF' } },
          required: ['path']
        }
      },
      'research.synthesize': {
        risk: 'medium',
        description: 'Synthesize multiple sources into report with citations. Requires approval.',
        parameters: {
          type: 'object',
          properties: {
            topic: { type: 'string' },
            sources: { type: 'array', items: { type: 'string' }, description: 'URLs or file paths' },
            format: { type: 'string', enum: ['markdown', 'latex', 'html'], default: 'markdown' },
            style: { type: 'string', enum: ['apa', 'mla', 'chicago', 'ieee'], default: 'apa' },
            reason: { type: 'string' }
          },
          required: ['topic', 'sources', 'reason']
        }
      },
      'research.citations': {
        risk: 'low',
        description: 'Extract + format citations from sources',
        parameters: {
          type: 'object',
          properties: {
            sources: { type: 'array', items: { type: 'string' } },
            style: { type: 'string', enum: ['apa', 'mla', 'chicago', 'ieee', 'bibtex'], default: 'apa' }
          },
          required: ['sources']
        }
      }
    }
  }

  async healthCheck() {
    await fs.mkdir(this.outputDir, { recursive: true })
    return { status: 'ok', cache_size: this.cache.size }
  }

  async _fetchText(url) {
    if (this.cache.has(url)) return this.cache.get(url)

    const res = await fetch(url, { headers: { 'User-Agent': 'AgentOS-Research/1.0' } })
    const buf = await res.arrayBuffer()
    const contentType = res.headers.get('content-type') || ''

    let text = '', title = url
    if (contentType.includes('application/pdf')) {
      const data = await pdf(Buffer.from(buf))
      text = data.text
      title = data.info?.Title || url
    } else {
      const html = new TextDecoder().decode(buf)
      const $ = cheerio.load(html)
      title = $('title').text() || $('meta[property="og:title"]').attr('content') || url
      $('script, style, nav, footer').remove()
      text = $('body').text().replace(/\s+/g, ' ').trim()
    }

    const result = { title, text: text.slice(0, 50000), url, fetched_at: new Date().toISOString() }
    this.cache.set(url, result)
    return result
  }

  async execute(toolName, args, ctx) {
    try {
      switch (toolName) {
        case 'research.search':
          this.logger.info(`RESEARCH SEARCH ${args.focus}: ${args.query}`, { user: ctx.userId })
          // Use browser.search tool if available, else fallback to DuckDuckGo
          const searchUrl = args.focus === 'academic'
           ? `https://scholar.google.com/scholar?q=${encodeURIComponent(args.query)}`
            : `https://html.duckduckgo.com/html/?q=${encodeURIComponent(args.query)}`

          const { stdout } = await execAsync(`curl -sL "${searchUrl}"`)
          const $ = cheerio.load(stdout)
          const results = []

          $('.result,.gs_r').slice(0, args.max_results).each((i, el) => {
            const title = $(el).find('a').first().text()
            const href = $(el).find('a').first().attr('href')
            const snippet = $(el).find('.result__snippet,.gs_rs').text()
            if (href) results.push({ title, url: href, snippet })
          })

          return { query: args.query, focus: args.focus, results }

        case 'research.fetch':
          this.logger.info(`RESEARCH FETCH ${args.url}`, { user: ctx.userId })
          const data = await this._fetchText(args.url)
          return {...data, text: data.text.slice(0, 10000) } // truncate for response

        case 'research.pdf':
          this.logger.info(`RESEARCH PDF ${args.path}`, { user: ctx.userId })
          const pdfPath = path.resolve(this.workspace, args.path)
          const buffer = await fs.readFile(pdfPath)
          const pdfData = await pdf(buffer)

          // Extract refs section heuristically
          const refs = pdfData.text.match(/References|Bibliography([\s\S]*)/i)?.[1]?.slice(0, 5000) || ''

          return {
            path: args.path,
            title: pdfData.info?.Title,
            author: pdfData.info?.Author,
            pages: pdfData.numpages,
            text: pdfData.text.slice(0, 20000),
            references: refs
          }

        case 'research.synthesize':
          this.logger.warn(`RESEARCH SYNTHESIZE ${args.topic}`, { user: ctx.userId, reason: args.reason })

          // 1. Fetch all sources
          const docs = []
          for (const src of args.sources) {
            try {
              const doc = src.startsWith('http')? await this._fetchText(src) : await this.execute('research.pdf', { path: src }, ctx)
              docs.push(doc)
            } catch (e) {
              this.logger.warn(`Failed to fetch ${src}: ${e.message}`)
            }
          }

          // 2. Build context for LLM
          const context = docs.map((d, i) => `[${i + 1}] ${d.title || d.url}\n${d.text.slice(0, 3000)}`).join('\n\n')

          // 3. Generate report - call LLM skill if available
          const prompt = `Write a comprehensive research report on "${args.topic}" using the sources below. Use ${args.style} citations [1], [2], etc. Format: ${args.format}.

Sources:
${context}

Structure: Executive Summary, Key Findings, Analysis, Conclusion, References.`

          let report = `Used LLM skill`
          if (this.agent.registry.skills.llm) {
            const res = await this.agent.registry.execute('llm.chat', { prompt, model: 'gpt-4' }, ctx.userId)
            report = res.text
          } else {
            report = `# ${args.topic}\n\n## Sources\n${docs.map((d, i) => `[${i + 1}] ${d.title} - ${d.url}`).join('\n')}\n\n## Summary\n${context.slice(0, 2000)}...`
          }

          // 4. Append bibliography
          const bib = await this.execute('research.citations', { sources: args.sources, style: args.style }, ctx)
          const final = `${report}\n\n## References\n${bib.citations.join('\n')}`

          // 5. Save
          const outPath = path.join(this.outputDir, `${args.topic.replace(/\W+/g, '_')}_${Date.now()}.${args.format === 'latex'? 'tex' : args.format === 'html'? 'html' : 'md'}`)
          await fs.writeFile(outPath, final)

          return { topic: args.topic, sources: docs.length, format: args.format, output: outPath, preview: final.slice(0, 1000) }

        case 'research.citations':
          this.logger.info(`RESEARCH CITATIONS ${args.style}`, { user: ctx.userId })
          const cites = []

          for (const src of args.sources) {
            const doc = this.cache.get(src) || await this._fetchText(src).catch(() => null)
            if (!doc) continue

            const date = new Date(doc.fetched_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
            const domain = new URL(doc.url).hostname

            let cite = ''
            switch (args.style) {
              case 'apa':
                cite = `${doc.title}. (${new Date().getFullYear()}). Retrieved ${date}, from ${doc.url}`
                break
              case 'mla':
                cite = `"${doc.title}." ${domain}, ${date}, ${doc.url}.`
                break
              case 'bibtex':
                const key = doc.title.slice(0, 10).replace(/\W/g, '') + new Date().getFullYear()
                cite = `@misc{${key},\n title={${doc.title}},\n url={${doc.url}},\n note={Accessed: ${date}}\n}`
                break
              default:
                cite = `[${doc.title}](${doc.url})`
            }
            cites.push(cite)
          }

          return { style: args.style, citations: cites }

        default:
          throw new Error(`Unknown tool ${toolName}`)
      }
    } catch (e) {
      this.logger.error(`Research ${toolName} failed: ${e.message}`)
      throw e
    }
  }
}

module.exports = ResearchSkill
