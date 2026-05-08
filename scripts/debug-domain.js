// scripts/debug-domains.js
const loadAllDomains = require('../src/core/loadDomain');
const registry = require('../src/core/ToolRegistry');
const { logger } = require('../src/core/logger');

async function debugDomains() {
  console.log('--- AgentOS Domain Audit ---');
  
  // Load domains
  loadAllDomains({
    mikrotik: { /* dummy config */ host: '192.168.88.1' }
  });

  const tools = registry.getAllTools();
  console.log(`\nTotal Tools Registered: ${tools.length}`);
  
  const domainStats = {};
  tools.forEach(t => {
    domainStats[t.domain] = (domainStats[t.domain] || 0) + 1;
  });

  console.log('\nDomain Health:');
  Object.entries(domainStats).forEach(([domain, count]) => {
    console.log(`- ${domain.padEnd(12)}: ${count} tools registered [OK]`);
  });

  console.log('\nSample Tool Execution:');
  try {
    const now = await registry.execute('general.now');
    console.log(`- general.now    : ${now}`);
    
    const uuid = await registry.execute('general.uuid');
    console.log(`- general.uuid   : ${uuid}`);
    
    const math = await registry.execute('general.safeMath', ['add', 10, 5]);
    console.log(`- general.safeMath: 10 + 5 = ${math}`);

    const shell = await registry.execute('linux.shell', ['echo "Domain system operational"']);
    console.log(`- linux.shell    : ${shell.trim()}`);
  } catch (err) {
    console.error(`\n[ERROR] Tool execution failed: ${err.message}`);
  }

  console.log('\n--- Audit Complete ---');
}

debugDomains().catch(console.error);
