const PagerDuty = require('node-pagerduty')
const { BaseSkill } = require('../base.js')

class PagerDutySkill extends BaseSkill {
  static id = 'pagerduty'
  static name = 'PagerDuty'
  static description = 'Manage incidents, on-call, services'

  constructor(config, logger, workspace) {
    super(config, logger, workspace)
    this.pd = new PagerDuty(config.apiToken)
  }

  static getTools() {
    return {
      'pd.incidents.list': {
        risk: 'low',
        description: 'List open PagerDuty incidents',
        parameters: {
          type: 'object',
          properties: {
            service: { type: 'string', description: 'serviceId from workspace' },
            statuses: { type: 'array', items: { type: 'string', enum: ['triggered', 'acknowledged'] }, default: ['triggered'] },
            urgencies: { type: 'array', items: { type: 'string', enum: ['high', 'low'] } }
          }
        }
      },
      'pd.incidents.ack': {
        risk: 'low',
        description: 'Acknowledge incident',
        parameters: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'incident ID like P123ABC' },
            note: { type: 'string', description: 'optional note' }
          },
          required: ['id']
        }
      },
      'pd.incidents.resolve': {
        risk: 'medium',
        description: 'Resolve incident. Requires approval for high urgency.',
        parameters: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            resolution: { type: 'string', maxLength: 500 },
            reason: { type: 'string' }
          },
          required: ['id', 'resolution', 'reason']
        }
      },
      'pd.incidents.trigger': {
        risk: 'high',
        description: 'Trigger new incident. Requires approval.',
        parameters: {
          type: 'object',
          properties: {
            service: { type: 'string', description: 'serviceId from workspace' },
            title: { type: 'string', maxLength: 1024 },
            details: { type: 'string' },
            urgency: { type: 'string', enum: ['high', 'low'], default: 'high' },
            reason: { type: 'string' }
          },
          required: ['service', 'title', 'reason']
        }
      },
      'pd.oncall.list': {
        risk: 'low',
        description: 'List current on-call users for service',
        parameters: {
          type: 'object',
          properties: {
            service: { type: 'string' }
          },
          required: ['service']
        }
      },
      'pd.services.status': {
        risk: 'low',
        description: 'Get service status and integration health',
        parameters: {
          type: 'object',
          properties: {
            service: { type: 'string' }
          },
          required: ['service']
        }
      }
    }
  }

  _svcId(serviceKey) {
    const svc = this.workspace.pd_services[serviceKey]
    if (!svc || svc.driver!== 'pagerduty') throw new Error(`PD service ${serviceKey} not found`)
    return svc.id
  }

  async healthCheck() {
    const res = await this.pd.abilities.list()
    return { status: 'ok', abilities: res.body.abilities.length }
  }

  async execute(toolName, args, ctx) {
    try {
      switch (toolName) {
        case 'pd.incidents.list':
          const query = {
            statuses: args.statuses || ['triggered'],
            urgencies: args.urgencies,
            'service_ids[]': args.service? [this._svcId(args.service)] : undefined,
            limit: 25
          }
          const { body } = await this.pd.incidents.listIncidents(query)
          return body.incidents.map(i => ({
            id: i.id,
            number: i.incident_number,
            title: i.title,
            status: i.status,
            urgency: i.urgency,
            service: i.service.summary,
            url: i.html_url,
            created_at: i.created_at
          }))

        case 'pd.incidents.ack':
          this.logger.info(`PD ACK ${args.id}`, { user: ctx.userId, note: args.note })
          await this.pd.incidents.manageIncidents({
            incidents: [{ id: args.id, type: 'incident_reference', status: 'acknowledged' }]
          })
          if (args.note) {
            await this.pd.incidents.createNote(args.id, { note: { content: args.note } })
          }
          return { id: args.id, status: 'acknowledged' }

        case 'pd.incidents.resolve':
          this.logger.warn(`PD RESOLVE ${args.id}`, { user: ctx.userId, reason: args.reason })
          await this.pd.incidents.manageIncidents({
            incidents: [{ id: args.id, type: 'incident_reference', status: 'resolved' }],
            resolution: args.resolution
          })
          return { id: args.id, status: 'resolved' }

        case 'pd.incidents.trigger':
          this.logger.warn(`PD TRIGGER ${args.service}`, { user: ctx.userId, title: args.title, reason: args.reason })
          const { body: inc } = await this.pd.incidents.createIncident({
            incident: {
              type: 'incident',
              title: args.title,
              service: { id: this._svcId(args.service), type: 'service_reference' },
              body: { type: 'incident_body', details: args.details },
              urgency: args.urgency || 'high'
            }
          })
          return { id: inc.incident.id, number: inc.incident.incident_number, url: inc.incident.html_url }

        case 'pd.oncall.list':
          const { body: oncalls } = await this.pd.oncalls.listOncalls({
            'service_ids[]': [this._svcId(args.service)]
          })
          return oncalls.oncalls.map(o => ({
            user: o.user.summary,
            email: o.user.email,
            escalation_level: o.escalation_level,
            start: o.start,
            end: o.end
          }))

        case 'pd.services.status':
          const { body: svc } = await this.pd.services.getService(this._svcId(args.service))
          return {
            name: svc.service.name,
            status: svc.service.status,
            integrations: svc.service.integrations.map(i => ({ name: i.summary, type: i.type }))
          }

        default:
          throw new Error(`Unknown tool ${toolName}`)
      }
    } catch (e) {
      this.logger.error(`PagerDuty ${toolName} failed: ${e.message}`)
      throw e
    }
  }
}

module.exports = PagerDutySkill
