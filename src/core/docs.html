// src/core/docs.js
const fs = require('fs')
const path = require('path')
const { marked } = require('marked')

class DocsGenerator {
  constructor(registry) {
    this.registry = registry
  }

  generateMarkdown() {
    let md = `# AgentOS Skills & Tools\n\n`
    md += `Generated: ${new Date().toISOString()}\n\n`
    md += `Total: ${this.registry.tools.size} tools across ${this.registry.drivers.size} skills\n\n`

    // Group by skill
    const bySkill = {}
    for (const [name, { skillId, schema }] of this.registry.tools.entries()) {
      if (!bySkill[skillId]) bySkill[skillId] = []
      bySkill[skillId].push({ name,...schema })
    }

    for (const [skillId, tools] of Object.entries(bySkill)) {
      const driver = this.registry.drivers.get(skillId)
      md += `## ${driver.constructor.name} \`${skillId}\`\n\n`
      if (driver.constructor.description) md += `${driver.constructor.description}\n\n`

      md += `| Tool | Risk | Description | Params |\n`
      md += `| --- | --- |\n`
      for (const t of tools.sort((a, b) => a.name.localeCompare(b.name))) {
        const params = Object.keys(t.parameters?.properties || {}).join(', ') || 'none'
        md += `| \`${t.name}\` | ${t.risk} | ${t.description} | ${params} |\n`
      }
      md += `\n`
    }

    md += `## RBAC Matrix\n`
    md += `See \`src/policies/roles.json\` for full definitions. Wildcards like \`system.*\` grant all sub-tools.\n\n`
    return md
  }

  generateHTML(markdown) {
    const css = `
      body{font-family:system-ui,sans-serif;max-width:1000px;margin:40px auto;padding:0 20px;line-height:1.6}
      code{background:#f4f4f4;padding:2px 6px;border-radius:4px}
      table{border-collapse:collapse;width:100%;margin:20px 0}
      th,td{border:1px solid #ddd;padding:8px;text-align:left}
      th{background:#f7f7}
      h2{border-bottom:2px solid #eee;padding-bottom:8px;margin-top:40px}
    `
    const html = marked.parse(markdown)
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>AgentOS Docs</title><style>${css}</style></head><body>${html}</body></html>`
  }

  async writeStatic(publicDir = 'public') {
    if (!fs.existsSync(publicDir)) fs.mkdirSync(publicDir, { recursive: true })
    const md = this.generateMarkdown()
    const html = this.generateHTML(md)
    fs.writeFileSync(path.join(publicDir, 'docs.md'), md)
    fs.writeFileSync(path.join(publicDir, 'docs.html'), html)
    return { md, html }
  }
}

module.exports = { DocsGenerator }
