// src/plugins/base-adapter.js
/**
 * Base Adapter Interface - All infrastructure providers must implement this
 */

class BaseAdapter extends EventEmitter {
  constructor(config) {
    super();
    this.name = config.name;
    this.type = config.type; // 'network', 'compute', 'container', 'iot'
    this.config = config;
    this.resources = new Map();
    this.connected = false;
    this.healthCheckInterval = null;
  }

  // Required: Connect to provider API
  async connect() {
    throw new Error('Adapter must implement connect()');
  }

  // Required: Disconnect cleanly
  async disconnect() {
    throw new Error('Adapter must implement disconnect()');
  }

  // Required: List all manageable resources
  async discover() {
    throw new Error('Adapter must implement discover()');
  }

  // Required: Execute action on resource
  async execute(resourceId, action, params) {
    throw new Error('Adapter must implement execute()');
  }

  // Required: Get resource metrics
  async getMetrics(resourceId) {
    throw new Error('Adapter must implement getMetrics()');
  }

  // Optional: Watch for changes (real-time updates)
  async watch(callback) {
    // Default: polling-based
    this.healthCheckInterval = setInterval(async () => {
      for (const [id, resource] of this.resources) {
        try {
          const metrics = await this.getMetrics(id);
          callback(id, 'metrics', metrics);
        } catch (error) {
          callback(id, 'error', error);
        }
      }
    }, 30000);
  }

  // Get adapter capabilities
  getCapabilities() {
    return {
      name: this.name,
      type: this.type,
      actions: this.listActions(),
      supportsRealtime: false
    };
  }

  listActions() {
    return [];
  }

  destroy() {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }
    this.removeAllListeners();
  }
}

module.exports = BaseAdapter;
