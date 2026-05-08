const { Octokit } = require('@octokit/rest')
const { BaseSkill } = require('../base.js')

class GitHubSkill extends BaseSkill {
  static id = 'github'
  static name = 'GitHub'

  constructor(config, logger, workspace) {
    super(config, logger, workspace)
    this.octokit = new Octokit({ auth: config.token })
  }

  static getTools() {
    return {
      'gh.issues.list': {
        risk: 'low',
        description: 'List issues in a repo',
        parameters: {
          type: 'object',
          properties: {
            repo: { type: 'string', description: 'repoId from workspace like org/repo' },
            state: { type: 'string', enum: ['open', 'closed', 'all'], default: 'open' },
            labels: { type: 'string', description: 'comma-separated' }
          },
          required: ['repo']
        }
      },
      'gh.issues.create': {
        risk: 'medium',
        description: 'Create GitHub issue. Requires approval for some repos.',
        parameters: {
          type: 'object',
          properties: {
            repo: { type: 'string' },
            title: { type: 'string', maxLength: 256 },
            body: { type: 'string' },
            labels: { type: 'array', items: { type: 'string' } },
            assignees: { type: 'array', items: { type: 'string' } }
          },
          required: ['repo', 'title']
        }
      },
      'gh.pr.create': {
        risk: 'medium',
        description: 'Create pull request',
        parameters: {
          type: 'object',
          properties: {
            repo: { type: 'string' },
            title: { type: 'string' },
            head: { type: 'string', description: 'branch name' },
            base: { type: 'string', default: 'main' },
            body: { type: 'string' },
            draft: { type: 'boolean', default: false }
          },
          required: ['repo', 'title', 'head']
        }
      },
      'gh.pr.merge': {
        risk: 'high',
        description: 'Merge pull request. Requires approval.',
        parameters: {
          type: 'object',
          properties: {
            repo: { type: 'string' },
            number: { type: 'number', description: 'PR number' },
            method: { type: 'string', enum: ['merge', 'squash', 'rebase'], default: 'squash' },
            reason: { type: 'string', maxLength: 200 }
          },
          required: ['repo', 'number', 'reason']
        }
      },
      'gh.comments.add': {
        risk: 'low',
        description: 'Comment on issue or PR',
        parameters: {
          type: 'object',
          properties: {
            repo: { type: 'string' },
            number: { type: 'number' },
            body: { type: 'string' }
          },
          required: ['repo', 'number', 'body']
        }
      }
    }
  }

  _parseRepo(repoId) {
    const repo = this.workspace.github_repos[repoId]
    if (!repo || repo.driver!== 'github') throw new Error(`GitHub repo ${repoId} not found`)
    const [owner, repoName] = repo.name.split('/')
    return { owner, repo: repoName }
  }

  async healthCheck() {
    const { data } = await this.octokit.rest.users.getAuthenticated()
    return { status: 'ok', user: data.login }
  }

  async execute(toolName, args, ctx) {
    try {
      switch (toolName) {
        case 'gh.issues.list':
          const { owner, repo } = this._parseRepo(args.repo)
          const { data: issues } = await this.octokit.rest.issues.listForRepo({
            owner, repo,
            state: args.state || 'open',
            labels: args.labels,
            per_page: 30
          })
          return issues.map(i => ({
            number: i.number,
            title: i.title,
            state: i.state,
            labels: i.labels.map(l => l.name),
            url: i.html_url
          }))

        case 'gh.issues.create':
          const r1 = this._parseRepo(args.repo)
          this.logger.info(`GH ISSUE CREATE ${args.repo}`, { user: ctx.userId, title: args.title })
          const { data: issue } = await this.octokit.rest.issues.create({
         ...r1,
            title: args.title,
            body: args.body,
            labels: args.labels,
            assignees: args.assignees
          })
          return { number: issue.number, url: issue.html_url }

        case 'gh.pr.create':
          const r2 = this._parseRepo(args.repo)
          this.logger.info(`GH PR CREATE ${args.repo}`, { user: ctx.userId, head: args.head })
          const { data: pr } = await this.octokit.rest.pulls.create({
         ...r2,
            title: args.title,
            head: args.head,
            base: args.base || 'main',
            body: args.body,
            draft: args.draft || false
          })
          return { number: pr.number, url: pr.html_url }

        case 'gh.pr.merge':
          const r3 = this._parseRepo(args.repo)
          this.logger.warn(`GH PR MERGE ${args.repo}#${args.number}`, { user: ctx.userId, reason: args.reason })
          const { data: merge } = await this.octokit.rest.pulls.merge({
         ...r3,
            pull_number: args.number,
            merge_method: args.method || 'squash'
          })
          return { merged: merge.merged, sha: merge.sha }

        case 'gh.comments.add':
          const r4 = this._parseRepo(args.repo)
          const { data: comment } = await this.octokit.rest.issues.createComment({
         ...r4,
            issue_number: args.number,
            body: args.body
          })
          return { id: comment.id, url: comment.html_url }

        default:
          throw new Error(`Unknown tool ${toolName}`)
      }
    } catch (e) {
      this.logger.error(`GitHub ${toolName} failed: ${e.message}`)
      throw e
    }
  }
}

module.exports = GitHubSkill
