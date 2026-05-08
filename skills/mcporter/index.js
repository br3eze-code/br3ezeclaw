const RouterOSClient = require('routeros-client').RouterOSClient;

class McPorterSkill {
  constructor() {
    this.connections = new Map();
  }

  async initialize(config) {
    this.config = config;
  }

  async execute(params, context) {
    const { action, router, filename } = params;
    
    const routerConfig = await this.getRouterConfig(router, context);
    if (!routerConfig) {
      throw new Error(`Router not found: ${router}`);
    }

    const client = await this.getConnection(routerConfig);
    
    try {
      switch (action) {
        case 'backup.save':
          const backupName = filename || `backup_${new Date().toISOString().replace(/[:.]/g, '-')}`;
          await client.menu('/system backup').save({ name: backupName });
          return { success: true, filename: `${backupName}.backup`, message: 'Backup created on router' };

        case 'backup.list':
          const files = await client.menu('/file').print();
          return {
            backups: files.filter(f => f.type === 'backup' || f.name.endsWith('.backup')),
            exports: files.filter(f => f.name.endsWith('.rsc'))
          };

        case 'export.run':
          const exportName = filename || `config_${new Date().toISOString().replace(/[:.]/g, '-')}`;
          await client.write(['/export', `file=${exportName}`]);
          return { success: true, filename: `${exportName}.rsc`, message: 'Configuration exported to RSC file' };

        case 'restore':
          if (!filename) throw new Error('Filename required for restore');
          if (!params.confirm) {
            return {
              requiresConfirmation: true,
              message: `Restoring ${filename} will REBOOT the router. Set 'confirm: true' to proceed.`
            };
          }
          await client.menu('/system backup').load({ name: filename });
          return { success: true, message: 'Restore initiated. Router is rebooting...' };

        default:
          throw new Error(`Unknown mcporter action: ${action}`);
      }
    } finally {
      this.releaseConnection(routerConfig, client);
    }
  }

  async getConnection(routerConfig) {
    const key = `${routerConfig.host}:${routerConfig.port}`;
    let conn = this.connections.get(key);
    
    if (!conn) {
      conn = new RouterOSClient({
        host: routerConfig.host,
        port: routerConfig.port,
        user: routerConfig.user,
        password: routerConfig.password,
        timeout: 30000
      });
      await conn.connect();
      this.connections.set(key, conn);
    }
    return conn;
  }

  releaseConnection(routerConfig, client) {
    // For now we keep it open for performance, or we could close it.
    // In this skill, we'll keep it simple.
  }

  async getRouterConfig(routerId, context) {
    const routers = await context.memory?.get('config:routers') || {};
    // Fallback to global config if no router memory
    if (!routers[routerId] && routerId === 'default') {
        return this.config.mikrotik;
    }
    return routers[routerId];
  }

  validate(params) {
    return params.action && params.router;
  }

  async destroy() {
    for (const conn of this.connections.values()) {
      conn.close();
    }
    this.connections.clear();
  }
}

module.exports = new McPorterSkill();
