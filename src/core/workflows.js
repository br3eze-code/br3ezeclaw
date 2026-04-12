// src/core/workflows.js
class WorkflowEngine {
  constructor(runtime) {
    this.runtime = runtime;
    this.workflows = new Map();
  }
  
  registerWorkflow(definition) {
    this.workflows.set(definition.name, definition);
  }
  
  async executeWorkflow(name, params) {
    const workflow = this.workflows.get(name);
    if (!workflow) throw new Error(`Unknown workflow: ${name}`);
    
    const context = new WorkflowContext(params);
    const results = [];
    
    for (const step of workflow.steps) {
      // Check condition
      if (step.condition && !await this.evaluateCondition(step.condition, context)) {
        continue;
      }
      
      // Execute step
      const result = await this.executeStep(step, context);
      results.push(result);
      
      // Update context
      context.set(step.id, result);
      
      // Check for failure
      if (!result.success && !step.continueOnError) {
        if (step.rollback) {
          await this.rollback(results);
        }
        throw new Error(`Workflow failed at step ${step.id}: ${result.error}`);
      }
    }
    
    return results;
  }
  
  async executeStep(step, context) {
    const action = typeof step.action === 'function' 
      ? step.action(context) 
      : step.action;
      
    return this.runtime.execute(action);
  }
}

// Pre-defined workflows
const secureDeploymentWorkflow = {
  name: 'secure-deploy',
  description: 'Deploy application with security hardening',
  steps: [
    {
      id: 'build',
      domain: 'developer',
      action: { tool: 'build', action: 'dockerize', params: '{{inputs}}' }
    },
    {
      id: 'scan',
      domain: 'security',
      action: { tool: 'scan', action: 'containerScan', params: { image: '{{build.image}}' } },
      condition: (ctx) => ctx.get('build').success
    },
    {
      id: 'provision',
      domain: 'compute',
      action: { tool: 'vm', action: 'create', params: { specs: '{{inputs.specs}}' } }
    },
    {
      id: 'network-prep',
      domain: 'network',
      action: { 
        tool: 'firewall', 
        action: 'configure', 
        params: { 
          rules: [
            { port: 443, action: 'allow' },
            { port: 22, source: '{{inputs.adminIp}}', action: 'allow' },
            { default: 'deny' }
          ]
        } 
      }
    },
    {
      id: 'deploy',
      domain: 'compute',
      action: { tool: 'docker', action: 'deploy', params: { image: '{{build.image}}', host: '{{provision.ip}}' } },
      dependsOn: ['network-prep']
    },
    {
      id: 'cert',
      domain: 'security',
      action: { tool: 'cert', action: 'issue', params: { domain: '{{inputs.domain}}' } }
    },
    {
      id: 'dns',
      domain: 'network',
      action: { tool: 'dns', action: 'configure', params: { domain: '{{inputs.domain}}', ip: '{{provision.ip}}' } }
    },
    {
      id: 'test',
      domain: 'developer',
      action: { tool: 'test', action: 'smoke', params: { url: 'https://{{inputs.domain}}' } },
      rollback: (ctx) => this.runtime.execute({ domain: 'compute', tool: 'docker', action: 'rollback' })
    }
  ]
};
