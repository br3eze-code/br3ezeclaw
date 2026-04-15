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
 // Add to static getTools() return object:
'research.papers.sync': {
  risk: 'medium',
  description: 'Sync ReadCube Papers library: articles, PDFs, notes. Requires approval.',
  parameters: {
    type: 'object',
    properties: {
      email: { type: 'string' },
      password: { type: 'string', description: 'or API token' },
      library: { type: 'string', enum: ['personal', 'shared'], default: 'personal' },
      reason: { type: 'string' }
    },
    required: ['email', 'password', 'reason']
  }
},
'research.papers.search': {
  risk: 'low',
  description: 'Search Papers library by title, author, journal, year',
  parameters: {
    type: 'object',
    properties: {
      email: { type: 'string' },
      password: { type: 'string' },
      query: { type: 'string' },
      field: { type: 'string', enum: ['any', 'title', 'author', 'journal'], default: 'any' }
    },
    required: ['email', 'password', 'query']
  }
},
'research.papers.annotate': {
  risk: 'medium',
  description: 'Add note/highlight to Papers PDF. Requires approval.',
  parameters: {
    type: 'object',
    properties: {
      email: { type: 'string' },
      password: { type: 'string' },
      paper_id: { type: 'string' },
      page: { type: 'number' },
      text: { type: 'string' },
      note: { type: 'string' },
      reason: { type: 'string' }
    },
    required: ['email', 'password', 'paper_id', 'page', 'text', 'reason']
  }
},
'research.citavi.import': {
  risk: 'medium',
  description: 'Import Citavi.ctv6 project or.ctv5. Requires approval.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'path to.ctv6 or.ctv5' },
      reason: { type: 'string' }
    },
    required: ['path', 'reason']
  }
},
'research.citavi.search': {
  risk: 'low',
  description: 'Search Citavi refs, knowledge items, quotations',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string' },
      type: { type: 'string', enum: ['reference', 'knowledge', 'quotation', 'any'], default: 'any' }
    },
    required: ['query']
  }
},
'research.citavi.export': {
  risk: 'low',
  description: 'Export Citavi to BibTeX/RIS/Word',
  parameters: {
    type: 'object',
    properties: {
      ids: { type: 'array', items: { type: 'string' } },
      format: { type: 'string', enum: ['bibtex', 'ris', 'word'], default: 'bibtex' }
    },
    required: ['ids', 'format']
  }
}
'research.mendeley.sync': {
  risk: 'medium',
  description: 'Sync Mendeley library: docs, folders, annotations. Requires approval.',
  parameters: {
    type: 'object',
    properties: {
      token: { type: 'string', description: 'Mendeley OAuth token' },
      group_id: { type: 'string', description: 'optional group ID' },
      modified_since: { type: 'string', description: 'ISO date for incremental' },
      reason: { type: 'string' }
    },
    required: ['token', 'reason']
  }
},
'research.mendeley.search': {
  risk: 'low',
  description: 'Search Mendeley library by author, title, tag, year',
  parameters: {
    type: 'object',
    properties: {
      token: { type: 'string' },
      query: { type: 'string' },
      type: { type: 'string', enum: ['all', 'author', 'title', 'tag'], default: 'all' },
      limit: { type: 'number', default: 50 }
    },
    required: ['token', 'query']
  }
},
'research.mendeley.annotate': {
  risk: 'medium',
  description: 'Add highlight/note to Mendeley PDF. Requires approval.',
  parameters: {
    type: 'object',
    properties: {
      token: { type: 'string' },
      document_id: { type: 'string' },
      file_hash: { type: 'string' },
      page: { type: 'number' },
      text: { type: 'string', description: 'highlighted text or note' },
      note: { type: 'string', description: 'annotation comment' },
      reason: { type: 'string' }
    },
    required: ['token', 'document_id', 'file_hash', 'page', 'text', 'reason']
  }
},
'research.endnote.import': {
  risk: 'medium',
  description: 'Import EndNote.enl library or.ris/.bib files. Requires approval.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'path to.enl,.ris, or.bib' },
      reason: { type: 'string' }
    },
    required: ['path', 'reason']
  }
},
'research.endnote.search': {
  risk: 'low',
  description: 'Search imported EndNote library',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string' },
      field: { type: 'string', enum: ['any', 'author', 'title', 'year', 'keywords'], default: 'any' }
    },
    required: ['query']
  }
},
'research.endnote.export': {
  risk: 'low',
  description: 'Export references to BibTeX/RIS/EndNote XML',
  parameters: {
    type: 'object',
    properties: {
      ids: { type: 'array', items: { type: 'string' }, description: 'ref IDs to export' },
      format: { type: 'string', enum: ['bibtex', 'ris', 'xml'], default: 'bibtex' }
    },
    required: ['ids', 'format']
  }
}
'research.roam.sync': {
  risk: 'medium',
  description: 'Sync Roam Research graph via API. Requires approval.',
  parameters: {
    type: 'object',
    properties: {
      graph: { type: 'string', description: 'Roam graph name' },
      token: { type: 'string', description: 'Roam API token' },
      since: { type: 'string', description: 'ISO date for incremental' },
      reason: { type: 'string' }
    },
    required: ['graph', 'token', 'reason']
  }
},
'research.roam.search': {
  risk: 'low',
  description: 'Search Roam graph: pages, blocks, references',
  parameters: {
    type: 'object',
    properties: {
      graph: { type: 'string' },
      token: { type: 'string' },
      query: { type: 'string' },
      mode: { type: 'string', enum: ['page', 'block', 'ref'], default: 'block' }
    },
    required: ['graph', 'token', 'query']
  }
},
'research.roam.write': {
  risk: 'medium',
  description: 'Write block to Roam page. Requires approval.',
  parameters: {
    type: 'object',
    properties: {
      graph: { type: 'string' },
      token: { type: 'string' },
      page: { type: 'string', description: 'page title' },
      content: { type: 'string', description: 'markdown with [[]] refs' },
      parent_uid: { type: 'string', description: 'optional parent block uid' },
      reason: { type: 'string' }
    },
    required: ['graph', 'token', 'page', 'content', 'reason']
  }
},
'research.logseq.sync': {
  risk: 'medium',
  description: 'Sync Logseq graph: parse.md/.org files + block graph. Requires approval.',
  parameters: {
    type: 'object',
    properties: {
      graph_path: { type: 'string', description: 'path to Logseq graph' },
      reason: { type: 'string' }
    },
    required: ['graph_path', 'reason']
  }
},
'research.logseq.search': {
  risk: 'low',
  description: 'Search Logseq: blocks, pages, properties, queries',
  parameters: {
    type: 'object',
    properties: {
      graph_path: { type: 'string' },
      query: { type: 'string' },
      mode: { type: 'string', enum: ['block', 'page', 'property', 'datalog'], default: 'block' }
    },
    required: ['graph_path', 'query']
  }
},
'research.logseq.write': {
  risk: 'medium',
  description: 'Append block to Logseq page with properties. Requires approval.',
  parameters: {
    type: 'object',
    properties: {
      graph_path: { type: 'string' },
      page: { type: 'string', description: 'page name' },
      content: { type: 'string' },
      properties: { type: 'object', description: 'key:: value props' },
      reason: { type: 'string' }
    },
    required: ['graph_path', 'page', 'content', 'reason']
  }
}
'research.obsidian.sync': {
  risk: 'medium',
  description: 'Sync Obsidian vault: index.md files, build backlink graph. Requires approval.',
  parameters: {
    type: 'object',
    properties: {
      vault_path: { type: 'string', description: 'absolute path to vault' },
      reason: { type: 'string' }
    },
    required: ['vault_path', 'reason']
  }
},
'research.obsidian.search': {
  risk: 'low',
  description: 'Search Obsidian vault by tag, content, links',
  parameters: {
    type: 'object',
    properties: {
      vault_path: { type: 'string' },
      query: { type: 'string' },
      mode: { type: 'string', enum: ['content', 'tag', 'backlinks'], default: 'content' }
    },
    required: ['vault_path', 'query']
  }
},
'research.obsidian.write': {
  risk: 'medium',
  description: 'Write note to Obsidian vault with wikilinks + frontmatter. Requires approval.',
  parameters: {
    type: 'object',
    properties: {
      vault_path: { type: 'string' },
      path: { type: 'string', description: 'note path like Research/QEC.md' },
      content: { type: 'string' },
      frontmatter: { type: 'object', description: 'yaml frontmatter' },
      reason: { type: 'string' }
    },
    required: ['vault_path', 'path', 'content', 'reason']
  }
},
'research.readwise.sync': {
  risk: 'medium',
  description: 'Sync Readwise highlights + books. Requires approval.',
  parameters: {
    type: 'object',
    properties: {
      token: { type: 'string', description: 'Readwise access token' },
      updated_after: { type: 'string', description: 'ISO date for incremental sync' },
      reason: { type: 'string' }
    },
    required: ['token', 'reason']
  }
},
'research.readwise.search': {
  risk: 'low',
  description: 'Search Readwise highlights by book, tag, content',
  parameters: {
    type: 'object',
    properties: {
      token: { type: 'string' },
      query: { type: 'string' },
      book: { type: 'string', description: 'filter by book title' }
    },
    required: ['token', 'query']
  }
}
'research.zotero.sync': {
  risk: 'medium',
  description: 'Sync Zotero library: import items, collections, PDFs. Requires approval.',
  parameters: {
    type: 'object',
    properties: {
      user_id: { type: 'string', description: 'Zotero userID' },
      api_key: { type: 'string' },
      collection: { type: 'string', description: 'collection key or name' },
      since_version: { type: 'number', default: 0 },
      reason: { type: 'string' }
    },
    required: ['user_id', 'api_key', 'reason']
  }
},
'research.zotero.search': {
  risk: 'low',
  description: 'Search your Zotero library by tag, author, title',
  parameters: {
    type: 'object',
    properties: {
      user_id: { type: 'string' },
      api_key: { type: 'string' },
      query: { type: 'string' },
      item_type: { type: 'string', enum: ['journalArticle', 'book', 'conferencePaper', 'any'], default: 'any' }
    },
    required: ['user_id', 'api_key', 'query']
  }
},
'research.zotero.add': {
  risk: 'medium',
  description: 'Add item to Zotero from URL or DOI. Requires approval.',
  parameters: {
    type: 'object',
    properties: {
      user_id: { type: 'string' },
      api_key: { type: 'string' },
      url: { type: 'string' },
      collection: { type: 'string' },
      tags: { type: 'array', items: { type: 'string' } },
      reason: { type: 'string' }
    },
    required: ['user_id', 'api_key', 'url', 'reason']
  }
},
'research.notion.export': {
  risk: 'medium',
  description: 'Export research report to Notion page. Requires approval.',
  parameters: {
    type: 'object',
    properties: {
      notion_token: { type: 'string' },
      database_id: { type: 'string', description: 'Notion DB for research' },
      title: { type: 'string' },
      markdown_path: { type: 'string', description: 'path to.md report' },
      properties: { type: 'object', description: 'Notion page props: tags, status, etc' },
      reason: { type: 'string' }
    },
    required: ['notion_token', 'database_id', 'title', 'markdown_path', 'reason']
  }
},
'research.notion.sync': {
  risk: 'low',
  description: 'Sync Notion research DB → local cache for search',
  parameters: {
    type: 'object',
    properties: {
      notion_token: { type: 'string' },
      database_id: { type: 'string' }
    },
    required: ['notion_token', 'database_id']
  }
}
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
          case 'research.papers.sync':
  this.logger.warn(`RESEARCH PAPERS SYNC ${args.library}`, { user: ctx.userId, reason: args.reason })
  // ReadCube Papers uses Firebase auth + private API
  const authRes = await fetch('https://api.readcube.com/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: args.email, password: args.password })
  })
  const { token } = await authRes.json()

  const headers = { 'Authorization': `Bearer ${token}` }
  const libRes = await fetch(`https://api.readcube.com/libraries/${args.library}/articles?limit=1000&expand=annotations,collections`, { headers })
  const articles = await libRes.json()

  const cachePath = path.join(this.outputDir, 'papers.json')
  await fs.writeFile(cachePath, JSON.stringify({ articles, synced_at: new Date().toISOString() }, null, 2))

  // Download PDFs
  const pdfDir = path.join(this.outputDir, 'papers_pdf')
  await fs.mkdir(pdfDir, { recursive: true })
  for (const a of articles.slice(0, 50)) { // limit for demo
    if (a.pdf_url) {
      const pdfRes = await fetch(a.pdf_url, { headers })
      const buf = Buffer.from(await pdfRes.arrayBuffer())
      await fs.writeFile(path.join(pdfDir, `${a.id}.pdf`), buf)
      a.local_pdf = path.join(pdfDir, `${a.id}.pdf`)
    }
  }

  return { library: args.library, articles: articles.length, annotations: articles.reduce((n, a) => n + (a.annotations?.length || 0), 0), cache: cachePath }

case 'research.papers.search':
  this.logger.info(`RESEARCH PAPERS SEARCH ${args.field}: ${args.query}`, { user: ctx.userId })
  const cache = JSON.parse(await fs.readFile(path.join(this.outputDir, 'papers.json'), 'utf8'))
  const q = args.query.toLowerCase()

  const results = cache.articles.filter(a => {
    if (args.field === 'title') return a.title?.toLowerCase().includes(q)
    if (args.field === 'author') return a.authors?.some(au => au.name.toLowerCase().includes(q))
    if (args.field === 'journal') return a.journal?.toLowerCase().includes(q)
    return a.title?.toLowerCase().includes(q) ||
           a.authors?.some(au => au.name.toLowerCase().includes(q)) ||
           a.abstract?.toLowerCase().includes(q)
  }).slice(0, 50)

  return { field: args.field, query: args.query, results: results.map(a => ({
    id: a.id,
    title: a.title,
    authors: a.authors?.map(au => au.name).join(', '),
    year: a.year,
    journal: a.journal,
    doi: a.doi,
    annotations: a.annotations?.length || 0
  })) }

case 'research.papers.annotate':
  this.logger.warn(`RESEARCH PAPERS ANNOTATE ${args.paper_id}`, { user: ctx.userId, reason: args.reason })
  const authRes2 = await fetch('https://api.readcube.com/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: args.email, password: args.password })
  })
  const { token: token2 } = await authRes2.json()
  const headers2 = { 'Authorization': `Bearer ${token2}`, 'Content-Type': 'application/json' }

  const ann = {
    type: args.note? 'note' : 'highlight',
    page: args.page,
    text: args.text,
    color: '#FFEB3B'
  }
  if (args.note) ann.comment = args.note

  const res = await fetch(`https://api.readcube.com/articles/${args.paper_id}/annotations`, {
    method: 'POST',
    headers: headers2,
    body: JSON.stringify(ann)
  })
  const out = await res.json()
  return { id: out.id, paper_id: args.paper_id, page: args.page, created: true }

case 'research.citavi.import':
  this.logger.warn(`RESEARCH CITAVI IMPORT ${args.path}`, { user: ctx.userId, reason: args.reason })
  const filePath = path.resolve(this.workspace, args.path)
  const ext = path.extname(filePath)
  const cachePath2 = path.join(this.outputDir, 'citavi.json')

  let refs = [], knowledge = [], quotes = []
  if (ext === '.ctv6') {
    // Citavi 6 is SQLite
    const sqlite3 = require('sqlite3').verbose()
    const db = new sqlite3.Database(filePath)
    const get = promisify(db.all.bind(db))

    const refsRows = await get(`SELECT r.*, GROUP_CONCAT(p.LastName||', '||p.FirstName, '; ') as authors
                                FROM Reference r LEFT JOIN PersonReference pr ON r.ID = pr.ReferenceID
                                LEFT JOIN Person p ON pr.PersonID = p.ID
                                GROUP BY r.ID`)
    refs = refsRows.map(r => ({
      id: String(r.ID),
      type: r.ReferenceType,
      title: r.Title,
      authors: r.authors,
      year: r.Year,
      periodical: r.Periodical,
      doi: r.DOI,
      abstract: r.Abstract
    }))

    const knowRows = await get(`SELECT * FROM KnowledgeItem`)
    knowledge = knowRows.map(k => ({
      id: String(k.ID),
      category: k.CategoryID,
      core_statement: k.CoreStatement,
      text: k.Text,
      ref_id: String(k.ReferenceID)
    }))

    const quoteRows = await get(`SELECT * FROM Quotation`)
    quotes = quoteRows.map(q => ({
      id: String(q.ID),
      text: q.Text,
      page: q.PageRange,
      ref_id: String(q.ReferenceID)
    }))

    db.close()
  } else {
    throw new Error('Only.ctv6 supported. For.ctv5, export to RIS/BibTeX first')
  }

  await fs.writeFile(cachePath2, JSON.stringify({ refs, knowledge, quotes, imported_at: new Date().toISOString() }, null, 2))
  return { path: args.path, references: refs.length, knowledge_items: knowledge.length, quotations: quotes.length, cache: cachePath2 }

case 'research.citavi.search':
  this.logger.info(`RESEARCH CITAVI SEARCH ${args.type}: ${args.query}`, { user: ctx.userId })
  const cache2 = JSON.parse(await fs.readFile(path.join(this.outputDir, 'citavi.json'), 'utf8'))
  const q2 = args.query.toLowerCase()

  let results2 = []
  if (args.type === 'reference' || args.type === 'any') {
    results2.push(...cache2.refs.filter(r =>
      r.title?.toLowerCase().includes(q2) || r.authors?.toLowerCase().includes(q2) || r.abstract?.toLowerCase().includes(q2)
    ).map(r => ({...r, _type: 'reference' })))
  }
  if (args.type === 'knowledge' || args.type === 'any') {
    results2.push(...cache2.knowledge.filter(k =>
      k.core_statement?.toLowerCase().includes(q2) || k.text?.toLowerCase().includes(q2)
    ).map(k => ({...k, _type: 'knowledge' })))
  }
  if (args.type === 'quotation' || args.type === 'any') {
    results2.push(...cache2.quotes.filter(q => q.text?.toLowerCase().includes(q2)).map(q => ({...q, _type: 'quotation' })))
  }

  return { type: args.type, query: args.query, results: results2.slice(0, 50) }

case 'research.citavi.export':
  this.logger.info(`RESEARCH CITAVI EXPORT ${args.format}`, { user: ctx.userId })
  const cache3 = JSON.parse(await fs.readFile(path.join(this.outputDir, 'citavi.json'), 'utf8'))
  const refs2 = cache3.refs.filter(r => args.ids.includes(r.id))

  let output = ''
  if (args.format === 'bibtex') {
    output = refs2.map(r => {
      const key = r.authors?.split(';')[0].split(',')[0].replace(/\s/g, '') + r.year
      return `@article{${key},\n title={${r.title}},\n author={${r.authors}},\n year={${r.year}},\n journal={${r.periodical}},\n doi={${r.doi}}\n}`
    }).join('\n\n')
  } else if (args.format === 'ris') {
    output = refs2.map(r => {
      return `TY - JOUR\nTI - ${r.title}\nAU - ${r.authors}\nPY - ${r.year}\nJO - ${r.periodical}\nDO - ${r.doi}\nAB - ${r.abstract}\nER - `
    }).join('\n\n')
  } else {
    // Word = simple RTF
    output = refs2.map(r => `${r.authors} (${r.year}). ${r.title}. ${r.periodical}.`).join('\n\n')
  }

  const outPath = path.join(this.outputDir, `citavi_export_${Date.now()}.${args.format === 'bibtex'? 'bib' : args.format === 'ris'? 'ris' : 'rtf'}`)
  await fs.writeFile(outPath, output)
  return { format: args.format, count: refs2.length, path: outPath }
          case 'research.mendeley.sync':
  this.logger.warn(`RESEARCH MENDELEY SYNC`, { user: ctx.userId, reason: args.reason })
  const headers = { 'Authorization': `Bearer ${args.token}`, 'Accept': 'application/vnd.mendeley-document.1+json' }
  const base = 'https://api.mendeley.com'
  const cachePath = path.join(this.outputDir, 'mendeley.json')

  // Fetch documents
  let docs = []
  let next = `${base}/documents?limit=500&view=all`
  if (args.group_id) next = `${base}/groups/${args.group_id}/documents?limit=500&view=all`
  if (args.modified_since) next += `&modified_since=${args.modified_since}`

  while (next) {
    const res = await fetch(next, { headers })
    const data = await res.json()
    docs.push(...data)
    next = res.headers.get('Link')?.match(/<(.+)>; rel="next"/)?.[1]
  }

  // Fetch annotations for each doc with file
  for (const doc of docs) {
    if (doc.file_attached) {
      const fileRes = await fetch(`${base}/files?document_id=${doc.id}`, { headers })
      const files = await fileRes.json()
      if (files[0]) {
        doc.file_hash = files[0].filehash
        const annRes = await fetch(`${base}/annotations?document_id=${doc.id}`, { headers })
        doc.annotations = await annRes.json()
      }
    }
  }

  await fs.writeFile(cachePath, JSON.stringify({ docs, synced_at: new Date().toISOString() }, null, 2))
  return { documents: docs.length, annotations: docs.reduce((n, d) => n + (d.annotations?.length || 0), 0), cache: cachePath }

case 'research.mendeley.search':
  this.logger.info(`RESEARCH MENDELEY SEARCH ${args.type}: ${args.query}`, { user: ctx.userId })
  const cache = JSON.parse(await fs.readFile(path.join(this.outputDir, 'mendeley.json'), 'utf8'))
  const q = args.query.toLowerCase()

  const results = cache.docs.filter(d => {
    if (args.type === 'author') return d.authors?.some(a => `${a.first_name} ${a.last_name}`.toLowerCase().includes(q))
    if (args.type === 'title') return d.title?.toLowerCase().includes(q)
    if (args.type === 'tag') return d.tags?.some(t => t.toLowerCase().includes(q))
    return d.title?.toLowerCase().includes(q) ||
           d.authors?.some(a => `${a.first_name} ${a.last_name}`.toLowerCase().includes(q)) ||
           d.abstract?.toLowerCase().includes(q)
  }).slice(0, args.limit)

  return { query: args.query, type: args.type, results: results.map(d => ({
    id: d.id,
    title: d.title,
    authors: d.authors?.map(a => `${a.first_name} ${a.last_name}`).join(', '),
    year: d.year,
    doi: d.identifiers?.doi,
    tags: d.tags,
    annotations: d.annotations?.length || 0
  })) }

case 'research.mendeley.annotate':
  this.logger.warn(`RESEARCH MENDELEY ANNOTATE doc ${args.document_id}`, { user: ctx.userId, reason: args.reason })
  const headers2 = { 'Authorization': `Bearer ${args.token}`, 'Content-Type': 'application/vnd.mendeley-annotation.1+json' }

  const ann = {
    type: args.note? 'note' : 'highlight',
    text: args.text,
    document_id: args.document_id,
    file_hash: args.file_hash,
    positions: [{ page: args.page }],
    color: { r: 255, g: 235, b: 59 }
  }
  if (args.note) ann.note = args.note

  const res = await fetch('https://api.mendeley.com/annotations', {
    method: 'POST',
    headers: headers2,
    body: JSON.stringify(ann)
  })
  const out = await res.json()
  return { id: out.id, document_id: args.document_id, page: args.page, created: true }

case 'research.endnote.import':
  this.logger.warn(`RESEARCH ENDNOTE IMPORT ${args.path}`, { user: ctx.userId, reason: args.reason })
  const filePath = path.resolve(this.workspace, args.path)
  const ext = path.extname(filePath)
  const cachePath2 = path.join(this.outputDir, 'endnote.json')

  let refs = []
  if (ext === '.ris' || ext === '.bib') {
    const content = await fs.readFile(filePath, 'utf8')
    const bibtex = require('bibtex')

    if (ext === '.bib') {
      const parsed = bibtex.parse(content)
      refs = Object.entries(parsed.entries).map(([key, e]) => ({
        id: key,
        type: e.type,
        title: e.fields.title,
        authors: e.fields.author,
        year: e.fields.year,
        journal: e.fields.journal || e.fields.booktitle,
        doi: e.fields.doi,
        url: e.fields.url
      }))
    } else {
      // RIS parsing
      const entries = content.split(/^ER\s*-\s*$/m)
      refs = entries.map(e => {
        const fields = {}
        e.split('\n').forEach(l => {
          const m = l.match(/^([A-Z0-9]{2})\s*-\s*(.+)/)
          if (m) fields[m[1]] = (fields[m[1]]? fields[m[1]] + '; ' : '') + m[2]
        })
        return {
          id: fields.ID || crypto.randomUUID(),
          type: fields.TY,
          title: fields.TI || fields.T1,
          authors: fields.AU || fields.A1,
          year: fields.PY || fields.Y1,
          journal: fields.JO || fields.T2,
          doi: fields.DO,
          url: fields.UR
        }
      }).filter(r => r.title)
    }
  } else if (ext === '.enl') {
    // EndNote.enl is SQLite
    const sqlite3 = require('sqlite3').verbose()
    const db = new sqlite3.Database(filePath)
    const get = promisify(db.all.bind(db))
    const rows = await get(`SELECT refs.*, GROUP_CONCAT(authors.last_name||', '||authors.first_name, '; ') as authors
                            FROM refs LEFT JOIN authors ON refs.record_id = authors.record_id
                            GROUP BY refs.record_id`)
    refs = rows.map(r => ({
      id: String(r.record_id),
      type: r.ref_type,
      title: r.title,
      authors: r.authors,
      year: r.year,
      journal: r.secondary_title,
      doi: r.doi,
      url: r.url
    }))
    db.close()
  }

  await fs.writeFile(cachePath2, JSON.stringify({ refs, imported_at: new Date().toISOString() }, null, 2))
  return { path: args.path, references: refs.length, cache: cachePath2 }

case 'research.endnote.search':
  this.logger.info(`RESEARCH ENDNOTE SEARCH ${args.field}: ${args.query}`, { user: ctx.userId })
  const cache2 = JSON.parse(await fs.readFile(path.join(this.outputDir, 'endnote.json'), 'utf8'))
  const q2 = args.query.toLowerCase()

  const results2 = cache2.refs.filter(r => {
    if (args.field === 'author') return r.authors?.toLowerCase().includes(q2)
    if (args.field === 'title') return r.title?.toLowerCase().includes(q2)
    if (args.field === 'year') return String(r.year) === q2
    if (args.field === 'keywords') return r.keywords?.toLowerCase().includes(q2)
    return Object.values(r).some(v => String(v).toLowerCase().includes(q2))
  }).slice(0, 50)

  return { field: args.field, query: args.query, results: results2 }

case 'research.endnote.export':
  this.logger.info(`RESEARCH ENDNOTE EXPORT ${args.format}`, { user: ctx.userId })
  const cache3 = JSON.parse(await fs.readFile(path.join(this.outputDir, 'endnote.json'), 'utf8'))
  const refs2 = cache3.refs.filter(r => args.ids.includes(r.id))

  let output = ''
  if (args.format === 'bibtex') {
    output = refs2.map(r => {
      const key = r.authors?.split(';')[0].split(',')[0].replace(/\s/g, '') + r.year
      return `@article{${key},\n title={${r.title}},\n author={${r.authors}},\n year={${r.year}},\n journal={${r.journal}},\n doi={${r.doi}}\n}`
    }).join('\n\n')
  } else if (args.format === 'ris') {
    output = refs2.map(r => {
      return `TY - JOUR\nTI - ${r.title}\nAU - ${r.authors}\nPY - ${r.year}\nJO - ${r.journal}\nDO - ${r.doi}\nUR - ${r.url}\nER - `
    }).join('\n\n')
  } else {
    output = `<?xml version="1.0"?><records>${refs2.map(r =>
      `<record><title>${r.title}</title><author>${r.authors}</author><year>${r.year}</year></record>`
    ).join('')}</records>`
  }

  const outPath = path.join(this.outputDir, `export_${Date.now()}.${args.format === 'bibtex'? 'bib' : args.format === 'ris'? 'ris' : 'xml'}`)
  await fs.writeFile(outPath, output)
  return { format: args.format, count: refs2.length, path: outPath }
          case 'research.roam.sync':
  this.logger.warn(`RESEARCH ROAM SYNC ${args.graph}`, { user: ctx.userId, reason: args.reason })
  const headers = { 'Authorization': `Bearer ${args.token}`, 'Content-Type': 'application/json' }
  const base = `https://api.roamresearch.com/api/graph/${args.graph}`

  // Pull all pages + blocks since date
  const q = args.since
 ? `[:find (pull?b [*]) :where [?b :block/uid?u] [?b :edit/time?t] [(>?t ${new Date(args.since).getTime()})]]`
    : `[:find (pull?p [:block/uid :node/title {:block/children...}]) :where [?p :node/title]]`

  const res = await fetch(`${base}/q`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ query: q })
  })
  const data = await res.json()

  const cachePath = path.join(this.outputDir, `roam_${args.graph}.json`)
  await fs.writeFile(cachePath, JSON.stringify(data, null, 2))
  return { graph: args.graph, entities: data.length, cache: cachePath }

case 'research.roam.search':
  this.logger.info(`RESEARCH ROAM SEARCH ${args.mode}: ${args.query}`, { user: ctx.userId })
  const headers2 = { 'Authorization': `Bearer ${args.token}`, 'Content-Type': 'application/json' }
  const base2 = `https://api.roamresearch.com/api/graph/${args.graph}`

  let q2 = ''
  if (args.mode === 'page') {
    q2 = `[:find (pull?p [:block/uid :node/title]) :where [?p :node/title?t] [(clojure.string/includes??t "${args.query}")]]`
  } else if (args.mode === 'ref') {
    q2 = `[:find (pull?b [:block/uid :block/string {:block/page [:node/title]}]) :where [?b :block/refs?r] [?r :node/title "${args.query}"]]`
  } else {
    q2 = `[:find (pull?b [:block/uid :block/string {:block/page [:node/title]}]) :where [?b :block/string?s] [(clojure.string/includes??s "${args.query}")]]`
  }

  const res2 = await fetch(`${base2}/q`, { method: 'POST', headers: headers2, body: JSON.stringify({ query: q2 }) })
  const results = await res2.json()
  return { mode: args.mode, query: args.query, results: results.slice(0, 50) }

case 'research.roam.write':
  this.logger.warn(`RESEARCH ROAM WRITE ${args.page}`, { user: ctx.userId, reason: args.reason })
  const headers3 = { 'Authorization': `Bearer ${args.token}`, 'Content-Type': 'application/json' }
  const base3 = `https://api.roamresearch.com/api/graph/${args.graph}`

  // Create page if missing
  const create = [{ action: 'create-page', page: { title: args.page } }]
  await fetch(`${base3}/write`, { method: 'POST', headers: headers3, body: JSON.stringify({ action: 'batch-actions', actions: create }) }).catch(() => {})

  // Write block
  const block = {
    action: 'create-block',
    location: args.parent_uid? { 'parent-uid': args.parent_uid, order: 'last' } : { 'page-title': args.page, order: 'last' },
    block: { string: args.content }
  }
  const res3 = await fetch(`${base3}/write`, { method: 'POST', headers: headers3, body: JSON.stringify({ action: 'batch-actions', actions: [block] }) })
  const out = await res3.json()
  return { page: args.page, uid: out[0]?.uid, written: true }

case 'research.logseq.sync':
  this.logger.warn(`RESEARCH LOGSEQ SYNC ${args.graph_path}`, { user: ctx.userId, reason: args.reason })
  const graph = path.resolve(args.graph_path)
  const idxPath = path.join(this.outputDir, 'logseq_index.json')

  const pages = []
  const blocks = []
  const graphLinks = {} // block_uid -> [linked_uids]
  const props = {} // block_uid -> {key: val}

  async function walk(dir) {
    const entries = await fs.readdir(dir, { withFileTypes: true })
    for (const e of entries) {
      const full = path.join(dir, e.name)
      if (e.isDirectory() &&!e.name.startsWith('.')) {
        await walk(full)
      } else if (e.name.endsWith('.md') || e.name.endsWith('.org')) {
        const rel = path.relative(graph, full)
        const content = await fs.readFile(full, 'utf8')
        const pageName = e.name.replace(/\.(md|org)$/, '')

        // Parse blocks - Logseq uses - or * for blocks
        const lines = content.split('\n')
        let currentBlock = null
        let indent = 0

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]
          const match = line.match(/^(\s*)(-|\*)\s+(.+)/)
          if (match) {
            const level = match[1].length / 2
            const text = match[3]
            const uid = `${pageName}-${i}`

            // Properties key:: value
            const propMatch = text.match(/^([a-zA-Z0-9_-]+)::\s*(.+)/)
            if (propMatch) {
              if (!props[uid]) props[uid] = {}
              props[uid][propMatch[1]] = propMatch[2]
            }

            // Links [[page]] or ((block-id))
            const links = [...text.matchAll(/\[\[([^\]]+)\]\]/g)].map(m => m[1])
            const refs = [...text.matchAll(/\(\(([^\)]+)\)\)/g)].map(m => m[1])
            graphLinks[uid] = [...links,...refs]

            blocks.push({ uid, page: pageName, content: text, level, path: rel, line: i })
          }
        }
        pages.push({ name: pageName, path: rel, blocks: blocks.filter(b => b.page === pageName).length })
      }
    }
  }

  await walk(path.join(graph, 'pages'))
  await fs.writeFile(idxPath, JSON.stringify({ pages, blocks, graphLinks, props, synced_at: new Date().toISOString() }, null, 2))
  return { graph_path: args.graph_path, pages: pages.length, blocks: blocks.length, index: idxPath }

case 'research.logseq.search':
  this.logger.info(`RESEARCH LOGSEQ SEARCH ${args.mode}: ${args.query}`, { user: ctx.userId })
  const idx2 = JSON.parse(await fs.readFile(path.join(this.outputDir, 'logseq_index.json'), 'utf8'))
  const q3 = args.query.toLowerCase()

  let results2 = []
  if (args.mode === 'page') {
    results2 = idx2.pages.filter(p => p.name.toLowerCase().includes(q3))
  } else if (args.mode === 'property') {
    const [key, val] = args.query.split('::').map(s => s.trim())
    results2 = idx2.blocks.filter(b => idx2.props[b.uid]?.[key]?.toLowerCase().includes(val.toLowerCase()))
  } else if (args.mode === 'datalog') {
    // Pass raw datalog query to user - Logseq uses datascript
    results2 = [{ info: 'Run in Logseq: ' + args.query }]
  } else {
    results2 = idx2.blocks.filter(b => b.content.toLowerCase().includes(q3)).slice(0, 50)
  }
  return { mode: args.mode, query: args.query, results: results2 }

case 'research.logseq.write':
  this.logger.warn(`RESEARCH LOGSEQ WRITE ${args.page}`, { user: ctx.userId, reason: args.reason })
  const graph2 = path.resolve(args.graph_path)
  const pagePath = path.join(graph2, 'pages', `${args.page}.md`)
  await fs.mkdir(path.dirname(pagePath), { recursive: true })

  let block = `- ${args.content}`
  if (args.properties) {
    const propLines = Object.entries(args.properties).map(([k, v]) => ` ${k}:: ${v}`).join('\n')
    block += `\n${propLines}`
  }

  await fs.appendFile(pagePath, `\n${block}\n`)
  return { page: args.page, written: true }
          case 'research.obsidian.sync':
  this.logger.warn(`RESEARCH OBSIDIAN SYNC ${args.vault_path}`, { user: ctx.userId, reason: args.reason })
  const vault = path.resolve(args.vault_path)
  const indexPath = path.join(this.outputDir, 'obsidian_index.json')

  const notes = []
  const linkGraph = {} // note -> [linked_notes]
  const tagIndex = {} // tag -> [notes]

  async function walk(dir) {
    const entries = await fs.readdir(dir, { withFileTypes: true })
    for (const e of entries) {
      const full = path.join(dir, e.name)
      if (e.isDirectory() &&!e.name.startsWith('.')) {
        await walk(full)
      } else if (e.name.endsWith('.md')) {
        const rel = path.relative(vault, full)
        const content = await fs.readFile(full, 'utf8')

        // Frontmatter
        const fmMatch = content.match(/^---\n([\s\S]*?)\n---/)
        let frontmatter = {}
        if (fmMatch) {
          try { frontmatter = require('js-yaml').load(fmMatch[1]) } catch {}
        }

        // Wikilinks [[Note]] and [[Note|Alias]]
        const links = [...content.matchAll(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g)].map(m => m[1])
        linkGraph[rel] = links

        // Tags #tag or frontmatter tags
        const tags = [...content.matchAll(/#([a-zA-Z0-9_-]+)/g)].map(m => m[1])
        if (frontmatter.tags) tags.push(...frontmatter.tags)
        tags.forEach(t => { tagIndex[t] = tagIndex[t] || []; tagIndex[t].push(rel) })

        notes.push({ path: rel, title: e.name.replace('.md', ''), frontmatter, links, tags, size: content.length })
      }
    }
  }

  await walk(vault)
  await fs.writeFile(indexPath, JSON.stringify({ notes, linkGraph, tagIndex, synced_at: new Date().toISOString() }, null, 2))
  return { vault_path: args.vault_path, notes: notes.length, tags: Object.keys(tagIndex).length, index: indexPath }

case 'research.obsidian.search':
  this.logger.info(`RESEARCH OBSIDIAN SEARCH ${args.mode}: ${args.query}`, { user: ctx.userId })
  const idx = JSON.parse(await fs.readFile(path.join(this.outputDir, 'obsidian_index.json'), 'utf8'))

  let results = []
  if (args.mode === 'tag') {
    results = (idx.tagIndex[args.query] || []).map(p => idx.notes.find(n => n.path === p))
  } else if (args.mode === 'backlinks') {
    results = Object.entries(idx.linkGraph)
     .filter(([_, links]) => links.includes(args.query))
     .map(([p]) => idx.notes.find(n => n.path === p))
  } else {
    const q = args.query.toLowerCase()
    for (const n of idx.notes) {
      const full = await fs.readFile(path.join(args.vault_path, n.path), 'utf8')
      if (full.toLowerCase().includes(q)) {
        const excerpt = full.slice(full.toLowerCase().indexOf(q) - 50, full.toLowerCase().indexOf(q) + 150)
        results.push({...n, excerpt })
      }
    }
  }
  return { mode: args.mode, query: args.query, results: results.slice(0, 20) }

case 'research.obsidian.write':
  this.logger.warn(`RESEARCH OBSIDIAN WRITE ${args.path}`, { user: ctx.userId, reason: args.reason })
  const vault2 = path.resolve(args.vault_path)
  const notePath = path.join(vault2, args.path)
  await fs.mkdir(path.dirname(notePath), { recursive: true })

  let content = args.content
  if (args.frontmatter && Object.keys(args.frontmatter).length) {
    const yaml = require('js-yaml').dump(args.frontmatter)
    content = `---\n${yaml}---\n\n${content}`
  }

  await fs.writeFile(notePath, content)
  return { path: args.path, written: true, size: content.length }

case 'research.readwise.sync':
  this.logger.warn(`RESEARCH READWISE SYNC`, { user: ctx.userId, reason: args.reason })
  const headers = { 'Authorization': `Token ${args.token}` }
  const base = 'https://readwise.io/api/v2'
  const cachePath = path.join(this.outputDir, 'readwise.json')

  // Fetch books
  const booksRes = await fetch(`${base}/books/?page_size=1000`, { headers })
  const books = (await booksRes.json()).results

  // Fetch highlights
  let highlights = []
  let next = `${base}/highlights/?page_size=1000`
  if (args.updated_after) next += `&updated__gt=${args.updated_after}`

  while (next) {
    const res = await fetch(next, { headers })
    const data = await res.json()
    highlights.push(...data.results)
    next = data.next
  }

  const data = { books, highlights, synced_at: new Date().toISOString() }
  await fs.writeFile(cachePath, JSON.stringify(data, null, 2))
  return { books: books.length, highlights: highlights.length, cache: cachePath }

case 'research.readwise.search':
  this.logger.info(`RESEARCH READWISE SEARCH ${args.query}`, { user: ctx.userId })
  const cache = JSON.parse(await fs.readFile(path.join(this.outputDir, 'readwise.json'), 'utf8'))
  const q = args.query.toLowerCase()

  let books = cache.books
  if (args.book) books = books.filter(b => b.title.toLowerCase().includes(args.book.toLowerCase()))
  const bookIds = new Set(books.map(b => b.id))

  const results = cache.highlights
   .filter(h => bookIds.has(h.book_id) && h.text.toLowerCase().includes(q))
   .map(h => {
      const book = books.find(b => b.id === h.book_id)
      return {
        text: h.text,
        note: h.note,
        book: book?.title,
        author: book?.author,
        location: h.location,
        url: h.url,
        tags: h.tags?.map(t => t.name)
      }
    })
   .slice(0, 50)

  return { query: args.query, book: args.book, results }
          case 'research.zotero.sync':
  this.logger.warn(`RESEARCH ZOTERO SYNC ${args.collection || 'all'}`, { user: ctx.userId, reason: args.reason })
  const base = `https://api.zotero.org/users/${args.user_id}`
  const headers = { 'Zotero-API-Key': args.api_key, 'Zotero-API-Version': '3' }

  // Get collections if name provided
  let collectionKey = args.collection
  if (args.collection &&!args.collection.match(/^[A-Z0-9]{8}$/)) {
    const colRes = await fetch(`${base}/collections`, { headers })
    const cols = await colRes.json()
    collectionKey = cols.find(c => c.data.name === args.collection)?.key
  }

  // Fetch items
  const url = collectionKey
  ? `${base}/collections/${collectionKey}/items?since=${args.since_version}&format=json&include=data,bib,attachment`
    : `${base}/items?since=${args.since_version}&format=json&include=data,bib,attachment&limit=100`

  const res = await fetch(url, { headers })
  const items = await res.json()

  // Cache + download PDFs
  const zoteroCache = path.join(this.outputDir, 'zotero')
  await fs.mkdir(zoteroCache, { recursive: true })

  for (const item of items) {
    if (item.data.itemType === 'attachment' && item.data.contentType === 'application/pdf') {
      const pdfUrl = `${base}/items/${item.key}/file`
      const pdfRes = await fetch(pdfUrl, { headers })
      const buf = Buffer.from(await pdfRes.arrayBuffer())
      await fs.writeFile(path.join(zoteroCache, `${item.key}.pdf`), buf)
      item.local_pdf = path.join(zoteroCache, `${item.key}.pdf`)
    }
  }

  await fs.writeFile(path.join(zoteroCache, 'items.json'), JSON.stringify(items, null, 2))
  return { user_id: args.user_id, collection: args.collection, items: items.length, version: res.headers.get('Last-Modified-Version') }

case 'research.zotero.search':
  this.logger.info(`RESEARCH ZOTERO SEARCH ${args.query}`, { user: ctx.userId })
  const base2 = `https://api.zotero.org/users/${args.user_id}`
  const headers2 = { 'Zotero-API-Key': args.api_key, 'Zotero-API-Version': '3' }
  const q = encodeURIComponent(args.query)
  const type = args.item_type === 'any'? '' : `&itemType=${args.item_type}`

  const res2 = await fetch(`${base2}/items?q=${q}${type}&format=json&include=bib&limit=25`, { headers: headers2 })
  const items2 = await res2.json()

  return {
    query: args.query,
    results: items2.map(i => ({
      key: i.key,
      type: i.data.itemType,
      title: i.data.title,
      creators: i.data.creators?.map(c => `${c.firstName} ${c.lastName}`).join(', '),
      date: i.data.date,
      url: i.data.url,
      doi: i.data.DOI,
      bib: i.bib
    }))
  }

case 'research.zotero.add':
  this.logger.warn(`RESEARCH ZOTERO ADD ${args.url}`, { user: ctx.userId, reason: args.reason })
  const base3 = `https://api.zotero.org/users/${args.user_id}`
  const headers3 = { 'Zotero-API-Key': args.api_key, 'Zotero-API-Version': '3', 'Content-Type': 'application/json' }

  // Use Zotero translation server
  const transRes = await fetch('https://translation-server.zotero.org/web', {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: args.url
  })
  const items3 = await transRes.json()
  if (!items3.length) throw new Error('Zotero could not parse URL')

  const item = items3[0]
  if (args.tags) item.tags = args.tags.map(t => ({ tag: t }))
  if (args.collection) item.collections = [args.collection]

  const createRes = await fetch(`${base3}/items`, {
    method: 'POST',
    headers: headers3,
    body: JSON.stringify([item])
  })
  const created = await createRes.json()

  return { key: created.successful['0'].key, title: item.title, added: true }

case 'research.notion.export':
  this.logger.warn(`RESEARCH NOTION EXPORT ${args.title}`, { user: ctx.userId, reason: args.reason })
  const { Client } = require('@notionhq/client')
  const notion = new Client({ auth: args.notion_token })

  const md = await fs.readFile(path.resolve(this.workspace, args.markdown_path), 'utf8')
  const blocks = this._mdToNotionBlocks(md) // helper below

  const page = await notion.pages.create({
    parent: { database_id: args.database_id },
    properties: {
      Name: { title: [{ text: { content: args.title } }] },
     ...Object.entries(args.properties || {}).reduce((acc, [k, v]) => {
        acc[k] = Array.isArray(v)? { multi_select: v.map(n => ({ name: n })) } : { rich_text: [{ text: { content: String(v) } }] }
        return acc
      }, {})
    },
    children: blocks.slice(0, 100) // Notion limit
  })

  return { page_id: page.id, url: page.url, blocks: blocks.length }

case 'research.notion.sync':
  this.logger.info(`RESEARCH NOTION SYNC DB`, { user: ctx.userId })
  const { Client: Client2 } = require('@notionhq/client')
  const notion2 = new Client2({ auth: args.notion_token })

  const db = await notion2.databases.query({ database_id: args.database_id, page_size: 100 })
  const pages = db.results.map(p => ({
    id: p.id,
    title: p.properties.Name?.title?.[0]?.text?.content,
    url: p.url,
    tags: p.properties.Tags?.multi_select?.map(t => t.name),
    created: p.created_time
  }))

  const cachePath = path.join(this.outputDir, 'notion_cache.json')
  await fs.writeFile(cachePath, JSON.stringify(pages, null, 2))
  return { database_id: args.database_id, pages: pages.length, cache: cachePath }
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
