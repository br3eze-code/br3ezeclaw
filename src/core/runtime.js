// src/core/runtime.js
class Runtime {
  constructor(config) {
    this.config = config;
    this.llm = new GeminiProvider(config.gemini);
    
    // Domain registries
    this.domains = new Map();
    this.context = new ExecutionContext();
    this.policy = new PolicyEngine(config.policy);
    this.audit = new AuditLogger();
    
    // Initialize domains
    this.registerDomain('network', new NetworkDomain());
    this.registerDomain('compute', new ComputeDomain());
    this.registerDomain('developer', new DeveloperDomain());
    this.registerDomain('security', new SecurityDomain());
  }
  
  registerDomain(name, domain) {
    domain.setRuntime(this);
    this.domains.set(name, domain);
    this.audit.log('domain.registered', { name });
  }
  
  async execute(intent) {
    const startTime = Date.now();
    
    try {
      // Parse intent
      const parsed = await this.parseIntent(intent);
      
      // Route to domain(s)
      const plan = await this.orchestrate(parsed);
      
      // Execute with policy enforcement
      const result = await this.executePlan(plan);
      
      // Audit and return
      this.audit.log('execution.completed', {
        intent: parsed.intent,
        duration: Date.now() - startTime,
        result: result.status
      });
      
      return result;
      
    } catch (error) {
      this.audit.log('execution.failed', { error: error.message });
      throw error;
    }
  }
  
  async parseIntent(input) {
    const classification = await this.llm.classify({
      input,
      categories: Array.from(this.domains.keys()),
      examples: this.getTrainingExamples()
    });
    
    return {
      raw: input,
      intent: classification.intent,
      primaryDomain: classification.domain,
      secondaryDomains: classification.related || [],
      entities: classification.entities,
      confidence: classification.confidence
    };
  }
  
  async orchestrate(parsed) {
    const plan = new ExecutionPlan();
    
    // Primary domain action
    const primary = this.domains.get(parsed.primaryDomain);
    const primaryAction = await primary.plan(parsed);
    plan.addStep(primaryAction);
    
    // Cross-domain dependencies
    for (const domainName of parsed.secondaryDomains) {
      const domain = this.domains.get(domainName);
      const dependency = await domain.deriveRequirement(primaryAction);
      if (dependency) {
        plan.addStep(dependency, { dependsOn: primaryAction.id });
      }
    }
    
    return plan.optimize();
  }
  
  async executePlan(plan) {
    const executor = new PlanExecutor(this.policy);
    return executor.run(plan);
  }
}
