// src/domains/network/index.js
class NetworkDomain extends BaseDomain {
  constructor() {
    super();
    this.name = 'network';
    this.tools = new Map();
    
    // Register network tools
    this.registerTool(new MikroTikTool());
    this.registerTool(new VoucherTool());
    this.registerTool(new FirewallTool());
    this.registerTool(new TrafficMonitorTool());
    this.registerTool(new DnsTool());
    this.registerTool(new LoadBalancerTool());
  }
  
  async plan(parsedIntent) {
    const { entities } = parsedIntent;
    
    switch (parsedIntent.intent) {
      case 'configure_firewall':
        return {
          id: crypto.randomUUID(),
          tool: 'firewall',
          action: 'configure',
          params: {
            rules: entities.rules,
            applyTo: entities.routers || ['default']
          },
          rollback: { tool: 'firewall', action: 'restore', params: {} }
        };
        
      case 'generate_voucher':
        return {
          id: crypto.randomUUID(),
          tool: 'voucher',
          action: 'create',
          params: {
            plan: entities.plan || '1Day',
            quantity: entities.quantity || 1,
            payment: entities.paymentMethod
          }
        };
        
      case 'monitor_traffic':
        return {
          id: crypto.randomUUID(),
          tool: 'trafficMonitor',
          action: 'watch',
          params: {
            interface: entities.interface,
            duration: entities.duration,
            alertThreshold: entities.threshold
          }
        };
        
      default:
        throw new Error(`Unknown network intent: ${parsedIntent.intent}`);
    }
  }
  
  async deriveRequirement(primaryAction) {
    // Auto-generate network configs for compute deployments
    if (primaryAction.domain === 'compute' && primaryAction.type === 'deploy') {
      return {
        id: crypto.randomUUID(),
        tool: 'firewall',
        action: 'preconfigure',
        params: {
          openPorts: primaryAction.params.ports || [80, 443],
          sourceIps: primaryAction.params.allowedIps
        }
      };
    }
    return null;
  }
}
