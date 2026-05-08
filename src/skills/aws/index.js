const { EC2Client, DescribeInstancesCommand, RebootInstancesCommand } = require('@aws-sdk/client-ec2')
const { S3Client, ListBucketsCommand } = require('@aws-sdk/client-s3')
const { BaseSkill } = require('../base.js')

class AWSSkill extends BaseSkill {
  static id = 'aws'
  static name = 'Amazon Web Services'

  constructor(config, logger, workspace) {
    super(config, logger, workspace)
    this.clients = new Map() // accountId -> { ec2, s3 }
  }

  static getTools() {
    return {
      'aws.ec2.list': {
        risk: 'low',
        description: 'List EC2 instances in an AWS account',
        parameters: {
          type: 'object',
          properties: {
            account: { type: 'string', description: 'accountId from workspace' },
            state: { type: 'string', enum: ['running', 'stopped', 'all'], default: 'running' }
          },
          required: ['account']
        }
      },
      'aws.ec2.reboot': {
        risk: 'high',
        description: 'Reboot EC2 instances. Requires approval.',
        parameters: {
          type: 'object',
          properties: {
            account: { type: 'string' },
            instanceIds: { type: 'array', items: { type: 'string' }, maxItems: 10 },
            reason: { type: 'string', maxLength: 200 }
          },
          required: ['account', 'instanceIds', 'reason']
        }
      },
      'aws.s3.buckets': {
        risk: 'low',
        description: 'List S3 buckets in an AWS account',
        parameters: {
          type: 'object',
          properties: {
            account: { type: 'string' }
          },
          required: ['account']
        }
      }
    }
  }

  _getClients(accountId) {
    if (this.clients.has(accountId)) return this.clients.get(accountId)
    const account = this.workspace.aws_accounts[accountId]
    if (!account || account.driver!== 'aws') throw new Error(`AWS account ${accountId} not found`)

    const cfg = { region: account.region || 'us-east-1' }
    // Uses AWS SDK credential chain: env vars, ~/.aws/credentials, IAM role
    const clients = {
      ec2: new EC2Client(cfg),
      s3: new S3Client(cfg)
    }
    this.clients.set(accountId, clients)
    return clients
  }

  async healthCheck() {
    const firstAccount = Object.keys(this.workspace.aws_accounts || {})[0]
    if (!firstAccount) return { status: 'ok', note: 'no AWS accounts configured' }
    const { ec2 } = this._getClients(firstAccount)
    await ec2.send(new DescribeInstancesCommand({ MaxResults: 5 }))
    return { status: 'ok' }
  }

  async execute(toolName, args, ctx) {
    const { ec2, s3 } = this._getClients(args.account)

    switch (toolName) {
      case 'aws.ec2.list':
        const res = await ec2.send(new DescribeInstancesCommand({}))
        const instances = res.Reservations.flatMap(r => r.Instances).map(i => ({
          id: i.InstanceId,
          type: i.InstanceType,
          state: i.State.Name,
          name: i.Tags?.find(t => t.Key === 'Name')?.Value || '',
          az: i.Placement.AvailabilityZone
        }))
        if (args.state!== 'all') {
          return instances.filter(i => i.state === args.state)
        }
        return instances

      case 'aws.ec2.reboot':
        this.logger.warn(`EC2 REBOOT ${args.account}`, { user: ctx.userId, instances: args.instanceIds, reason: args.reason })
        const cmd = new RebootInstancesCommand({ InstanceIds: args.instanceIds })
        return await ec2.send(cmd)

      case 'aws.s3.buckets':
        const buckets = await s3.send(new ListBucketsCommand({}))
        return buckets.Buckets.map(b => ({ name: b.Name, created: b.CreationDate }))

      default:
        throw new Error(`Unknown tool ${toolName}`)
    }
  }
}

module.exports = AWSSkill
