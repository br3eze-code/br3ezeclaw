// ==========================================
// AGENTOS STATUS COMMAND
// Quick system overview with proper error handling
// ==========================================

const _chalk = require('chalk');
const chalk  = _chalk.default || _chalk;
const fs = require('fs');
const _ora = require('ora');
const ora = _ora.default || _ora;

module.exports = (program) => {
  program
    .command('status')
    .description('Show system status')
    .alias('s')
    .option('--json', 'Output as JSON')
    .action(async (options) => {
      const { BRAND, CONFIG_PATH, STATE_PATH } = global.AGENTOS;
      
      const statusData = {
        agentos: {},
        gateway: {},
        router: {},
        timestamp: new Date().toISOString()
      };

      try {
        // Config info
        if (fs.existsSync(CONFIG_PATH)) {
          const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
          statusData.agentos = {
            profile: global.AGENTOS.PROFILE_DIR,
            version: cfg.version,
            created: new Date(cfg.createdAt).toLocaleDateString()
          };
        } else {
          console.log(chalk.yellow('⚠ Not configured - run: agentos onboard'));
          return;
        }

        // Gateway status
        const pidFile = `${STATE_PATH}/gateway.pid`;
        if (fs.existsSync(pidFile)) {
          try {
            const pid = fs.readFileSync(pidFile, 'utf8').trim();
            process.kill(parseInt(pid), 0); // Check if process exists
            statusData.gateway = { 
              status: 'running', 
              pid: parseInt(pid),
              color: 'green'
            };
          } catch (e) {
            statusData.gateway = { 
              status: 'stale', 
              error: 'PID file exists but process not running',
              color: 'yellow'
            };
          }
        } else {
          statusData.gateway = { 
            status: 'stopped',
            color: 'red'
          };
        }

        // MikroTik status with spinner
        const spinner = ora('Connecting to router...').start();
        try {
          const { getMikroTikClient } = require('../../core/mikrotik');
          const mikrotik = await getMikroTikClient();
          const stats = await mikrotik.getSystemStats();
          
          spinner.stop();
          
          // FIXED: Properly access normalized stats
          const cpuLoad = stats['cpu-load'] || '0';
          const uptime = stats['uptime'] || 'unknown';
          const version = stats['version'] || 'unknown';
          const memoryUsage = stats['memory-usage-percent'] || '0';
          
          statusData.router = {
            status: 'connected',
            cpu: `${cpuLoad}%`,
            memory: `${memoryUsage}%`,
            uptime: uptime,
            version: version,
            color: 'green'
          };
        } catch (e) {
          spinner.stop();
          statusData.router = { 
            status: 'disconnected', 
            error: e.message,
            color: 'red'
          };
        }

        // Output
        if (options.json) {
          console.log(JSON.stringify(statusData, null, 2));
        } else {
          renderStatus(statusData, BRAND);
        }

      } catch (error) {
        console.error(chalk.red('Error:'), error.message);
        process.exit(1);
      }
    });
};

function renderStatus(data, brand) {
  console.log(chalk.cyan(`\n${brand.emoji} ${brand.name} Status\n`));
  
  // AgentOS section
  if (data.agentos.version) {
    console.log(chalk.gray('Profile:'), data.agentos.profile);
    console.log(chalk.gray('Version:'), data.agentos.version);
    console.log(chalk.gray('Created:'), data.agentos.created);
  }
  
  // Gateway section
  const gatewayColor = data.gateway.color === 'green' ? chalk.green : 
                       data.gateway.color === 'yellow' ? chalk.yellow : chalk.red;
  console.log(chalk.gray('Gateway:'), gatewayColor(
    data.gateway.status === 'running' ? `running (PID: ${data.gateway.pid})` : data.gateway.status
  ));
  
  // Router section
  if (data.router.status === 'connected') {
    console.log(chalk.gray('Router:'), chalk.green(
      `connected (CPU: ${data.router.cpu}, Memory: ${data.router.memory})`
    ));
    console.log(chalk.gray('Uptime:'), data.router.uptime);
    console.log(chalk.gray('RouterOS:'), data.router.version);
  } else {
    console.log(chalk.gray('Router:'), chalk.red('disconnected'));
    if (data.router.error) {
      console.log(chalk.gray('Error:'), chalk.red(data.router.error));
    }
  }
  
  console.log('');
}
