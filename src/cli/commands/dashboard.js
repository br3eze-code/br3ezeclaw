// ==========================================
// AGENTOS DASHBOARD COMMAND
// Comprehensive system overview
// ==========================================

const _chalk = require('chalk');
const chalk  = _chalk.default || _chalk;
const _ora = require('ora');
const ora = _ora.default || _ora;
const { getMikroTikClient } = require('../../core/mikrotik');

module.exports = (program) => {
  program
    .command('dashboard')
    .description('Show comprehensive system dashboard')
    .option('--refresh <seconds>', 'Auto-refresh interval', false)
    .action(async (options) => {
      const render = async () => {
        console.clear();
        console.log(chalk.cyan.bold('\n📊 AgentOS Dashboard\n'));
        
        const spinner = ora('Loading...').start();
        
        try {
          const mikrotik = await getMikroTikClient();
          
          // Fetch all data in parallel
          const [stats, activeUsers, allUsers, interfaces] = await Promise.all([
            mikrotik.getSystemStats(),
            mikrotik.getActiveUsers(),
            mikrotik.getAllHotspotUsers(),
            mikrotik.getInterfaces()
          ]);
          
          spinner.stop();
          
          // System Stats Box
          console.log(chalk.bold('🖥️  System Health'));
          console.log(chalk.gray('─'.repeat(40)));
          console.log(`CPU Load:    ${renderBar(stats['cpu-load'] || 0)} ${stats['cpu-load'] || 0}%`);
          console.log(`Memory:      ${renderBar(stats['memory-usage-percent'] || 0)} ${stats['memory-usage-percent'] || 0}%`);
          console.log(`Uptime:      ${chalk.green(stats.uptime || 'N/A')}`);
          console.log(`RouterOS:    v${stats.version || 'N/A'} (${stats['architecture-name'] || 'N/A'})`);
          console.log(`Board:       ${stats['board-name'] || 'N/A'}`);
          console.log('');
          
          // Users Box
          console.log(chalk.bold('👥 User Activity'));
          console.log(chalk.gray('─'.repeat(40)));
          console.log(`Active Sessions: ${chalk.green(activeUsers.length)}`);
          console.log(`Total Users:     ${chalk.cyan(allUsers.length)}`);
          console.log(`Disabled Users:  ${chalk.yellow(allUsers.filter(u => u.disabled === 'yes').length)}`);
          console.log('');
          
          // Active Users Detail
          if (activeUsers.length > 0) {
            console.log(chalk.bold('🔌 Active Connections'));
            console.log(chalk.gray('─'.repeat(40)));
            activeUsers.slice(0, 5).forEach((user, i) => {
              const dataIn = formatBytes(user['bytes-in'] || 0);
              const dataOut = formatBytes(user['bytes-out'] || 0);
              console.log(`${i + 1}. ${chalk.bold(user.user)}`);
              console.log(`   IP: ${user.address} | MAC: ${user['mac-address']}`);
              console.log(`   Uptime: ${user.uptime} | Data: ↓${dataIn} ↑${dataOut}`);
            });
            if (activeUsers.length > 5) {
              console.log(chalk.gray(`   ... and ${activeUsers.length - 5} more`));
            }
            console.log('');
          }
          
          // Interfaces
          console.log(chalk.bold('🌐 Interfaces'));
          console.log(chalk.gray('─'.repeat(40)));
          interfaces.slice(0, 4).forEach(iface => {
            const status = iface.running === 'true' ? chalk.green('●') : chalk.red('●');
            console.log(`${status} ${iface.name} (${iface.type})`);
          });
          console.log('');
          
          // Footer
          console.log(chalk.gray(`Last updated: ${new Date().toLocaleTimeString()}`));
          console.log(chalk.gray('Press Ctrl+C to exit'));
          
        } catch (error) {
          spinner.fail(chalk.red(`Error: ${error.message}`));
        }
      };
      
      // Initial render
      await render();
      
      // Auto-refresh if requested
      if (options.refresh) {
        const interval = parseInt(options.refresh) * 1000;
        console.log(chalk.cyan(`\nAuto-refreshing every ${options.refresh} seconds...`));
        setInterval(render, interval);
      }
    });
};

function renderBar(percentage) {
  const width = 20;
  const filled = Math.round((percentage / 100) * width);
  const empty = width - filled;
  const bar = '█'.repeat(filled) + '░'.repeat(empty);
  
  let color = chalk.green;
  if (percentage > 70) color = chalk.yellow;
  if (percentage > 90) color = chalk.red;
  
  return color(bar);
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}
