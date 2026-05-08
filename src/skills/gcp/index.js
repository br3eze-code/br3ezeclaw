const { InstancesClient } = require('@google-cloud/compute').v1
const { Storage } = require('@google-cloud/storage')
const { BaseSkill } = require('../base.js')

class GCPSkill extends BaseSkill {
  static id = 'gcp'
  static name = 'Google Cloud Platform'

  constructor(config, logger, workspace) {
    super(config, logger, workspace)
    this.compute = new InstancesClient()
    this.storage = new Storage()
  }

  static getTools() {
    return {
      'gcp.compute.list': {
        risk: 'low',
        description: 'List GCE instances in a project/zone',
        parameters: {
          type: 'object',
          properties: {
            project: { type: 'string', description: 'projectId from workspace' },
            zone: { type: 'string', default: 'us-central1-a' },
            status: { type: 'string', enum: ['RUNNING', 'STOPPED', 'ALL'], default: 'RUNNING' }
          },
          required: ['project']
        }
      },
      'gcp.compute.reboot': {
        risk: 'high',
        description: 'Reset GCE instance. Requires approval.',
        parameters: {
          type: 'object',
          properties: {
            project: { type: 'string' },
            zone: { type: 'string' },
            instance: { type: 'string' },
            reason: { type: 'string', maxLength: 200 }
          },
          required: ['project', 'zone', 'instance', 'reason']
        }
      },
      'gcp.storage.buckets': {
        risk: 'low',
        description: 'List GCS buckets in a project',
        parameters: {
          type: 'object',
          properties: {
            project: { type: 'string' }
          },
          required: ['project']
        }
      }
    }
  }

  async healthCheck() {
    const project = Object.keys(this.workspace.gcp_projects || {})[0]
    if (!project) return { status: 'ok', note: 'no GCP projects configured' }
    await this.compute.list({ project, zone: 'us-central1-a', maxResults: 1 })
    return { status: 'ok' }
  }

  async execute(toolName, args, ctx) {
    const project = this.workspace.gcp_projects[args.project]
    if (!project || project.driver!== 'gcp') throw new Error(`GCP project ${args.project} not found`)

    switch (toolName) {
      case 'gcp.compute.list':
        const [instances] = await this.compute.list({
          project: args.project,
          zone: args.zone || 'us-central1-a'
        })
        let filtered = instances
        if (args.status!== 'ALL') {
          filtered = instances.filter(i => i.status === args.status)
        }
        return filtered.map(i => ({
          name: i.name,
          id: i.id,
          status: i.status,
          machineType: i.machineType.split('/').pop(),
          zone: i.zone.split('/').pop()
        }))

      case 'gcp.compute.reboot':
        this.logger.warn(`GCE RESET ${args.project}/${args.zone}/${args.instance}`, {
          user: ctx.userId,
          reason: args.reason
        })
        const [operation] = await this.compute.reset({
          project: args.project,
          zone: args.zone,
          instance: args.instance
        })
        return { operation: operation.name, status: 'submitted' }

      case 'gcp.storage.buckets':
        const [buckets] = await this.storage.getBuckets({ projectId: args.project })
        return buckets.map(b => ({ name: b.name, location: b.metadata.location }))

      default:
        throw new Error(`Unknown tool ${toolName}`)
    }
  }
}

module.exports = GCPSkill
