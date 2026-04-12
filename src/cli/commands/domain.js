// src/cli/commands/domain.js
/**
 * Domain management commands
 */

const chalk = require('chalk');

module.exports = (program) => {
  program
    .command('domain <action>')
    .description('Manage infrastructure domains (network, cloud, container, iot)')
    .option('--type <type>', 'Domain type: network, cloud, container, iot, hybrid')
    .option('--workspace <id>', 'Target workspace')
    .action(async (action, options) => {
      const domains = {
        network: { name: 'Network Infrastructure', icon: '📡', adapters: ['mikrotik', 'unifi', 'cisco'] },
        cloud: { name: 'Cloud Compute', icon: '☁️', adapters: ['aws', 'azure', 'gcp'] },
        container: { name: 'Container Orchestration', icon: '📦', adapters: ['docker', 'kubernetes'] },
        iot: { name: 'IoT Device Management', icon: '📟', adapters: ['mqtt', 'aws-iot'] },
        hybrid: { name: 'Hybrid Infrastructure', icon: '🔀', adapters: ['all'] }
      };

      switch (action) {
        case 'list':
          console.log(chalk.cyan('\n🏗️  Available Domains:\n'));
          Object.entries(domains).forEach(([key, info]) => {
            console.log(`${info.icon} ${chalk.bold(info.name)} (${key})`);
            console.log(`   Adapters: ${info.adapters.join(', ')}\n`);
          });
          break;

        case 'set':
          if (!options.type || !domains[options.type]) {
            console.log(chalk.red('❌ Invalid domain type. Use: network, cloud, container, iot, hybrid'));
            return;
          }
          
          // Update workspace domain
          const workspace = global.workspaceManager.getWorkspace(options.workspace);
          if (workspace) {
            workspace.domain = options.type;
            workspace.aiCoordinator.setDomain(options.type);
            console.log(chalk.green(`✅ Domain set to ${options.type}`));
          }
          break;

        case 'detect':
          // Auto-detect based on connected adapters
          console.log(chalk.cyan('\n🔍 Detecting infrastructure...'));
          // Implementation would scan for available APIs
          break;
      }
    });
};
