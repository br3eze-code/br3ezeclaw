class BaseSkill {
  static id = 'base'
  static name = 'Base Skill'

  constructor(config, logger, workspace) {
    this.config = config
    this.logger = logger
    this.workspace = workspace
  }

  // Return: { 'tool.name': { risk, description, parameters } }
  static getTools() {
    return {}
  }

  async healthCheck() {
    return { status: 'ok' }
  }

  // ctx = { userId, agent, workspace }
  async execute(toolName, args, ctx) {
    throw new Error(`Skill ${this.constructor.id} does not implement ${toolName}`)
  }
}

module.exports = { BaseSkill }
