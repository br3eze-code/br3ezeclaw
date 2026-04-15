const { App } = require('@slack/bolt')
const { BaseSkill } = require('../base.js')

class SlackSkill extends BaseSkill {
  static id = 'slack'
  static name = 'Slack ChatOps'
  static description = 'Send messages, react, open modals, handle slash commands'

  constructor(config, logger, workspace) {
    super(config, logger, workspace)
    this.app = new App({
      token: config.botToken,
      signingSecret: config.signingSecret,
      socketMode: true,
      appToken: config.appToken
    })
    this.agent = null // set by registry after init
  }

  static getTools() {
    return {
      'slack.message.post': {
        risk: 'low',
        description: 'Post message to Slack channel or DM',
        parameters: {
          type: 'object',
          properties: {
            channel: { type: 'string', description: 'channel ID or #name or @user' },
            text: { type: 'string' },
            blocks: { type: 'array', description: 'Block Kit JSON', items: { type: 'object' } }
          },
          required: ['channel', 'text']
        }
      },
      'slack.message.react': {
        risk: 'low',
        description: 'Add emoji reaction to message',
        parameters: {
          type: 'object',
          properties: {
            channel: { type: 'string' },
            ts: { type: 'string', description: 'message timestamp' },
            name: { type: 'string', description: 'emoji name without :: e.g. white_check_mark' }
          },
          required: ['channel', 'ts', 'name']
        }
      },
      'slack.users.lookup': {
        risk: 'low',
        description: 'Get Slack user info by email or ID',
        parameters: {
          type: 'object',
          properties: {
            email: { type: 'string' },
            user: { type: 'string', description: 'Slack user ID' }
          }
        }
      },
      'slack.modal.open': {
        risk: 'low',
        description: 'Open modal to collect input from user',
        parameters: {
          type: 'object',
          properties: {
            trigger_id: { type: 'string' },
            title: { type: 'string', maxLength: 24 },
            blocks: { type: 'array', items: { type: 'object' } }
          },
          required: ['trigger_id', 'title', 'blocks']
        }
      }
    }
  }

  async init(agent) {
    this.agent = agent
    // Slash command: /agentos kick john from site-a
    this.app.command('/agentos', async ({ command, ack, respond, client }) => {
      await ack()
      const userId = `slack:${command.user_id}`
      const text = command.text

      await respond({ text: `Running: \`${text}\``, response_type: 'ephemeral' })

      for await (const event of agent.stream(text, userId)) {
        if (event.type === 'delta') {
          // Stream back as thread replies
          await client.chat.postMessage({ channel: command.channel_id, thread_ts: command.ts, text: event.text })
        }
        if (event.type === 'approval') {
          await client.chat.postMessage({
            channel: command.channel_id,
            text: `Approval required: ${event.message}`,
            blocks: [{
              type: 'actions',
              elements: [
                { type: 'button', text: { type: 'plain_text', text: 'Approve' }, style: 'primary', action_id: 'approve', value: event.id },
                { type: 'button', text: { type: 'plain_text', text: 'Deny' }, style: 'danger', action_id: 'deny', value: event.id }
              ]
            }]
          })
        }
        if (event.type === 'final') {
          await client.chat.postMessage({ channel: command.channel_id, text: event.text })
        }
      }
    })

    // Button handlers for approvals
    this.app.action(/^(approve|deny)$/, async ({ action, ack, body, client }) => {
      await ack()
      const id = action.value
      const decision = action.action_id === 'approve'? 'approve' : 'deny'
      await agent.approvals.resolve(id, decision, `slack:${body.user.id}`)
      await client.chat.update({
        channel: body.channel.id,
        ts: body.message.ts,
        text: `Approval ${id}: ${decision.toUpperCase()} by <@${body.user.id}>`,
        blocks: []
      })
    })

    await this.app.start()
    this.logger.info('Slack Bolt started in Socket Mode')
  }

  async healthCheck() {
    const res = await this.app.client.auth.test()
    return { status: 'ok', bot: res.user }
  }

  async execute(toolName, args, ctx) {
    const client = this.app.client
    switch (toolName) {
      case 'slack.message.post':
        const res = await client.chat.postMessage({
          channel: args.channel,
          text: args.text,
          blocks: args.blocks
        })
        return { ts: res.ts, channel: res.channel }

      case 'slack.message.react':
        await client.reactions.add({
          channel: args.channel,
          timestamp: args.ts,
          name: args.name
        })
        return { ok: true }

      case 'slack.users.lookup':
        const user = args.email
        ? await client.users.lookupByEmail({ email: args.email })
          : await client.users.info({ user: args.user })
        return { id: user.user.id, name: user.user.name, real_name: user.user.real_name }

      case 'slack.modal.open':
        await client.views.open({
          trigger_id: args.trigger_id,
          view: {
            type: 'modal',
            title: { type: 'plain_text', text: args.title },
            blocks: args.blocks
          }
        })
        return { ok: true }

      default:
        throw new Error(`Unknown tool ${toolName}`)
    }
  }

  async disconnect() {
    await this.app.stop()
  }
}

module.exports = SlackSkill
