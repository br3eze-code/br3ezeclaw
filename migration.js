// migration.js
/**
 * Migrate from MikroTik-only to Domain-Agnostic
 */

async function migrate() {
  console.log('🔄 Migrating to Domain-Agnostic AgentOS...');
  
  // 1. Load old config
  const oldConfig = require('./old-config.json');
  
  // 2. Create new workspace
  const workspace = {
    name: 'Network Infrastructure',
    domain: 'network',
    adapters: [{
      type: 'mikrotik',
      name: 'Legacy Router',
      config: {
        host: oldConfig.mikrotik.host,
        user: oldConfig.mikrotik.user,
        password: oldConfig.mikrotik.pass
      }
    }],
    billing: {
      voucherTypes: [{
        resourceType: 'network',
        plans: Object.keys(oldConfig.plans || {}).map(key => ({
          id: key,
          price: oldConfig.plans[key].price,
          value: oldConfig.plans[key].duration
        }))
      }]
    }
  };
  
  // 3. Import existing vouchers
  const db = require('./src/core/database');
  const oldVouchers = await db.getAllVouchers();
  
  for (const v of oldVouchers) {
    await newdb.saveVoucher({
      ...v,
      type: 'access',
      resourceType: 'network',
      metadata: { migrated: true }
    });
  }
  
  // 4. Save new config
  require('fs').writeFileSync('./agentos.yaml', 
    require('yaml').stringify(workspace)
  );
  
  console.log('✅ Migration complete!');
}
