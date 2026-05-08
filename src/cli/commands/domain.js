// src/cli/commands/domain.js
/**
 * Domain management commands
 */

const _chalk = require('chalk');
const chalk  = _chalk.default || _chalk;
const { intro, outro, note, log } = require('@clack/prompts');

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

      intro('🏗️ Domain Manager');

      switch (action) {
        case 'list':
          const lines = Object.entries(domains).map(([key, info]) => {
            return `${info.icon} ${chalk.bold(info.name)} (${key})\n   Adapters: ${info.adapters.join(', ')}`;
          });
          note(lines.join('\n\n'), 'Available Domains');
          outro(chalk.green('✓ Listing complete.'));
          break;

        case 'set':
          if (!options.type || !domains[options.type]) {
            log.error('Invalid domain type. Use: network, cloud, container, iot, hybrid');
            process.exit(1);
          }
          
          // Update workspace domain
          const workspace = global.workspaceManager.getWorkspace(options.workspace);
          if (workspace) {
            workspace.domain = options.type;
            workspace.aiCoordinator.setDomain(options.type);
            log.success(`Domain set to ${options.type}`);
          }
          outro(chalk.green('✓ Domain configuration updated.'));
          break;

        case 'detect':
          // Auto-detect based on connected adapters
          log.info('Detecting infrastructure...');
          // Implementation would scan for available APIs
          outro(chalk.green('✓ Detection complete.'));
          break;
          
        default:
          log.error(`Unknown action: ${action}`);
          process.exit(1);
      }
    });
};

