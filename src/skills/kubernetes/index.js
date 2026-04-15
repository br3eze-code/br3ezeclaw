const k8s = require('@kubernetes/client-node')
const { BaseSkill } = require('../base.js')

class KubernetesSkill extends BaseSkill {
  static id = 'kubernetes'
  static name = 'Kubernetes'

  constructor(config, logger, workspace) {
    super(config, logger, workspace)
    this.kc = new k8s.KubeConfig()
    this.kc.loadFromDefault() // in-cluster or ~/.kube/config
    this.k8sApi = this.kc.makeApiClient(k8s.CoreV1Api)
    this.appsV1 = this.kc.makeApiClient(k8s.AppsV1Api)
    this.exec = new k8s.Exec(this.kc)
    this.log = new k8s.Log(this.kc)
  }

  static getTools() {
    return {
      'k8s.pods.list': {
        risk: 'low',
        description: 'List pods in namespace',
        parameters: {
          type: 'object',
          properties: {
            cluster: { type: 'string', description: 'clusterId from workspace' },
            namespace: { type: 'string', default: 'default' },
            labelSelector: { type: 'string', description: 'e.g. app=nginx' }
          },
          required: ['cluster']
        }
      },
      'k8s.pods.logs': {
        risk: 'low',
        description: 'Get pod logs',
        parameters: {
          type: 'object',
          properties: {
            cluster: { type: 'string' },
            namespace: { type: 'string', default: 'default' },
            pod: { type: 'string' },
            container: { type: 'string' },
            tail: { type: 'number', default: 100 }
          },
          required: ['cluster', 'pod']
        }
      },
      'k8s.pods.delete': {
        risk: 'high',
        description: 'Delete pod. Requires approval.',
        parameters: {
          type: 'object',
          properties: {
            cluster: { type: 'string' },
            namespace: { type: 'string', default: 'default' },
            pod: { type: 'string' },
            reason: { type: 'string', maxLength: 200 }
          },
          required: ['cluster', 'pod', 'reason']
        }
      },
      'k8s.deployments.list': {
        risk: 'low',
        description: 'List deployments',
        parameters: {
          type: 'object',
          properties: {
            cluster: { type: 'string' },
            namespace: { type: 'string', default: 'default' }
          },
          required: ['cluster']
        }
      },
      'k8s.deployments.restart': {
        risk: 'medium',
        description: 'Rolling restart deployment. Requires approval.',
        parameters: {
          type: 'object',
          properties: {
            cluster: { type: 'string' },
            namespace: { type: 'string', default: 'default' },
            name: { type: 'string' },
            reason: { type: 'string' }
          },
          required: ['cluster', 'name', 'reason']
        }
      },
      'k8s.deployments.scale': {
        risk: 'high',
        description: 'Scale deployment replicas. Requires approval.',
        parameters: {
          type: 'object',
          properties: {
            cluster: { type: 'string' },
            namespace: { type: 'string', default: 'default' },
            name: { type: 'string' },
            replicas: { type: 'number', minimum: 0, maximum: 100 },
            reason: { type: 'string' }
          },
          required: ['cluster', 'name', 'replicas', 'reason']
        }
      }
    }
  }

  _checkCluster(clusterId, ctx) {
    const cluster = this.workspace.k8s_clusters[clusterId]
    if (!cluster || cluster.driver!== 'kubernetes') throw new Error(`K8s cluster ${clusterId} not found`)
    // Future: switch kubeconfig context if multi-cluster
    return cluster
  }

  _checkNamespace(ns, ctx) {
    const allowed = ctx.resources?.namespaces || ['default']
    if (allowed[0]!== '*' &&!allowed.includes(ns)) {
      throw new Error(`Namespace ${ns} not allowed for user`)
    }
  }

  async healthCheck() {
    await this.k8sApi.listNamespace()
    return { status: 'ok' }
  }

  async execute(toolName, args, ctx) {
    const cluster = this._checkCluster(args.cluster, ctx)
    const ns = args.namespace || 'default'
    this._checkNamespace(ns, ctx)

    try {
      switch (toolName) {
        case 'k8s.pods.list':
          const { body } = await this.k8sApi.listNamespacedPod(ns, undefined, args.labelSelector)
          return body.items.map(p => ({
            name: p.metadata.name,
            phase: p.status.phase,
            ip: p.status.podIP,
            node: p.spec.nodeName,
            restarts: p.status.containerStatuses?.[0]?.restartCount || 0,
            age: p.metadata.creationTimestamp
          }))

        case 'k8s.pods.logs':
          const logStream = await this.log(ns, args.pod, args.container, undefined, undefined, undefined, undefined, args.tail || 100)
          return logStream

        case 'k8s.pods.delete':
          this.logger.warn(`K8S POD DELETE ${ns}/${args.pod}`, { user: ctx.userId, reason: args.reason })
          await this.k8sApi.deleteNamespacedPod(args.pod, ns)
          return { deleted: args.pod, namespace: ns }

        case 'k8s.deployments.list':
          const { body: deps } = await this.appsV1.listNamespacedDeployment(ns)
          return deps.items.map(d => ({
            name: d.metadata.name,
            replicas: d.spec.replicas,
            ready: d.status.readyReplicas || 0,
            available: d.status.availableReplicas || 0,
            image: d.spec.template.spec.containers[0].image
          }))

        case 'k8s.deployments.restart':
          this.logger.warn(`K8S RESTART ${ns}/${args.name}`, { user: ctx.userId, reason: args.reason })
          const patch = {
            spec: {
              template: {
                metadata: {
                  annotations: { 'kubectl.kubernetes.io/restartedAt': new Date().toISOString() }
                }
              }
            }
          await this.appsV1.patchNamespacedDeployment(args.name, ns, patch, undefined, { headers: { 'Content-Type': 'application/strategic-merge-patch+json' } })
          return { restarted: args.name, namespace: ns }

        case 'k8s.deployments.scale':
          this.logger.warn(`K8S SCALE ${ns}/${args.name} -> ${args.replicas}`, { user: ctx.userId, reason: args.reason })
          const scale = { spec: { replicas: args.replicas } }
          await this.appsV1.patchNamespacedDeploymentScale(args.name, ns, scale, undefined, { headers: { 'Content-Type': 'application/merge-patch+json' } })
          return { name: args.name, replicas: args.replicas }

        default:
          throw new Error(`Unknown tool ${toolName}`)
      }
    } catch (e) {
      this.logger.error(`Kubernetes ${toolName} failed: ${e.message}`)
      throw e
    }
  }
}

module.exports = KubernetesSkill
