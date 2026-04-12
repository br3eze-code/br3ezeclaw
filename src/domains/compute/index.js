// src/domains/compute/index.js
class ComputeDomain extends BaseDomain {
  constructor() {
    super();
    this.name = 'compute';
    
    this.registerTool(new DockerTool());
    this.registerTool(new KubernetesTool());
    this.registerTool(new VmTool());
    this.registerTool(new ServerlessTool());
  }
  
  async plan(intent) {
    switch (intent.action) {
      case 'deploy_container':
        return {
          tool: 'docker',
          action: 'deploy',
          params: {
            image: intent.entities.image,
            ports: intent.entities.ports,
            env: intent.entities.environment,
            replicas: intent.entities.replicas || 1
          }
        };
        
      case 'deploy_k8s':
        return {
          tool: 'kubernetes',
          action: 'apply',
          params: {
            manifest: await this.generateManifest(intent),
            namespace: intent.entities.namespace || 'default'
          }
        };
        
      case 'provision_server':
        return {
          tool: 'vm',
          action: 'create',
          params: {
            provider: intent.entities.provider || 'aws',
            specs: intent.entities.specs,
            region: intent.entities.region
          }
        };
    }
  }
}
