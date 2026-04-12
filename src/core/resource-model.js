// src/core/resource-model.js
/**
 * Universal Resource Model 
 */

class Resource {
  constructor(config) {
    this.id = config.id || generateUUID();
    this.type = config.type; // 'router', 'vm', 'container', 'iot', 'service'
    this.provider = config.provider; // 'mikrotik', 'aws', 'docker', 'kubernetes'
    this.name = config.name;
    this.status = 'unknown';
    this.metadata = config.metadata || {};
    this.capabilities = new Set(config.capabilities || []);
    this.properties = config.properties || {}; // Provider-specific properties
    this.createdAt = new Date().toISOString();
    this.lastSeen = null;
  }

  // Generic capability checking
  can(action) {
    return this.capabilities.has(action);
  }

  // Resource addressing (provider-specific)
  get address() {
    return {
      host: this.properties.host,
      port: this.properties.port,
      protocol: this.properties.protocol || 'https',
      path: this.properties.apiPath
    };
  }

  // Health status abstraction
  get health() {
    return {
      status: this.status,
      lastSeen: this.lastSeen,
      uptime: this.properties.uptime,
      load: this.properties.load || 0
    };
  }
}

// Resource Types Registry
const ResourceTypes = {
  NETWORK_DEVICE: {
    type: 'router',
    defaultCapabilities: ['ping', 'reboot', 'configure', 'monitor'],
    schema: {
      host: { type: 'string', required: true },
      port: { type: 'number', default: 8728 },
      credentials: { type: 'object', required: true }
    }
  },
  
  COMPUTE_INSTANCE: {
    type: 'vm',
    defaultCapabilities: ['start', 'stop', 'restart', 'snapshot', 'monitor'],
    schema: {
      region: { type: 'string', required: true },
      instanceId: { type: 'string', required: true },
      provider: { type: 'string', enum: ['aws', 'azure', 'gcp', 'proxmox'] }
    }
  },
  
  CONTAINER: {
    type: 'container',
    defaultCapabilities: ['start', 'stop', 'restart', 'logs', 'exec', 'monitor'],
    schema: {
      runtime: { type: 'string', enum: ['docker', 'containerd', 'podman'] },
      image: { type: 'string' },
      compose: { type: 'boolean', default: false }
    }
  },
  
  IOT_DEVICE: {
    type: 'iot',
    defaultCapabilities: ['read', 'write', 'firmware', 'location'],
    schema: {
      protocol: { type: 'string', enum: ['mqtt', 'coap', 'http'] },
      sensors: { type: 'array' }
    }
  },
  
  SERVICE: {
    type: 'service',
    defaultCapabilities: ['scale', 'configure', 'logs', 'restart'],
    schema: {
      endpoint: { type: 'string', required: true },
      healthCheck: { type: 'object' }
    }
  }
};

module.exports = { Resource, ResourceTypes };
