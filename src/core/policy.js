// src/core/policy.js
class PolicyEngine {
  constructor(config) {
    this.rules = new Map();
    this.approvers = new Map();
    this.loadPolicies(config.policies || []);
  }
  
  loadPolicies(policies) {
    for (const policy of policies) {
      this.rules.set(policy.id, {
        match: policy.match,
        action: policy.action,
        reason: policy.reason
      });
    }
  }
  
  evaluate(action, context) {
    const matches = [];
    
    for (const [id, rule] of this.rules) {
      if (this.matchesRule(action, rule.match)) {
        matches.push(rule);
      }
    }
    
    // Sort by specificity
    matches.sort((a, b) => b.match.specificity - a.match.specificity);
    
    const effectiveRule = matches[0] || { action: 'allow' };
    
    return {
      allowed: effectiveRule.action !== 'deny',
      requiresApproval: effectiveRule.action === 'approve',
      approvers: effectiveRule.action === 'approve' ? this.getApprovers(action) : [],
      reason: effectiveRule.reason,
      audit: true
    };
  }
  
  matchesRule(action, match) {
    if (match.domain && match.domain !== action.domain) return false;
    if (match.tool && match.tool !== action.tool) return false;
    if (match.action && match.action !== action.action) return false;
    if (match.resource && !action.params.resource?.includes(match.resource)) return false;
    
    // Time-based rules
    if (match.hours) {
      const hour = new Date().getHours();
      if (hour < match.hours.start || hour > match.hours.end) return false;
    }
    
    return true;
  }
  
  getApprovers(action) {
    // Route to appropriate approvers based on action type
    if (action.domain === 'network' && action.tool === 'firewall') {
      return ['network-admin', 'security-team'];
    }
    if (action.domain === 'developer' && action.params.environment === 'production') {
      return ['tech-lead', 'devops'];
    }
    return ['admin'];
  }
}
