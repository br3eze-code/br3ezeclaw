'use strict';

const dgram = require('dgram');
const chalk = require('chalk');
const server = dgram.createSocket('udp4');

const PORT = 5001;
const HOST = '127.0.0.1';

// Custom icons and colors for logs
const THEME = {
  fatal: { color: chalk.bgRed.white.bold, icon: '💀' },
  error: { color: chalk.red.bold, icon: '✘' },
  warn: { color: chalk.yellow.bold, icon: '⚠' },
  success: { color: chalk.green.bold, icon: '✔' },
  info: { color: chalk.blue.bold, icon: 'ℹ' },
  cyber: { color: chalk.cyan.bold, icon: '◆' },
  debug: { color: chalk.magenta.bold, icon: '◇' },
  trace: { color: chalk.gray, icon: '◌' }
};

server.on('listening', async () => {
  const address = server.address();
  let boxen;
  try {
    const boxenModule = await import('boxen');
    boxen = boxenModule.default;
  } catch (e) {
    // Fallback if boxen import fails
    boxen = (text) => `\n${text}\n`;
  }

  console.log(boxen(
    chalk.bold.cyan('AgentOS Logs Daemon') + '\n' +
    chalk.gray(`Listening on ${address.address}:${address.port}\n\n`) +
    chalk.italic('Logs will appear here in real-time.'),
    { padding: 1, margin: 1, borderStyle: 'double', borderColor: 'cyan' }
  ));
});

server.on('message', (msg, remote) => {
  try {
    let data;
    try {
      data = JSON.parse(msg.toString());
    } catch (e) {
      // Fallback for raw text logs (e.g. raw DB debug logs)
      const timeStr = chalk.gray(`[${new Date().toLocaleTimeString()}]`);
      const svcStr = chalk.blue(`[raw]`);
      console.log(`${timeStr} ${svcStr} ${chalk.magenta(msg.toString())}`);
      return;
    }

    const { level, message, timestamp, service, ...meta } = data;
    
    // Remove winston color codes if present
    const cleanLevel = level ? level.replace(/\u001b\[[0-9;]*m/g, '') : 'info';
    const style = THEME[cleanLevel] || THEME.info;
    
    const timeStr = chalk.gray(`[${timestamp || new Date().toLocaleTimeString()}]`);
    const svcStr = chalk.blue(`[${service || 'agentos'}]`);
    const levelStr = style.color(`${style.icon} ${cleanLevel.toUpperCase().padEnd(7)}`);
    
    console.log(`${timeStr} ${svcStr} ${levelStr} ${message}`);
    
    // Display metadata if present and not empty
    const metaKeys = Object.keys(meta).filter(k => k !== 'correlationId' && k !== 'stack');
    if (metaKeys.length > 0) {
      console.log(chalk.gray('  ' + JSON.stringify(meta, null, 2).split('\n').join('\n  ')));
    }
    
    if (meta.stack) {
      console.log(chalk.red('  ' + meta.stack.split('\n').slice(1).join('\n  ')));
    }
  } catch (e) {
    console.log(chalk.red(`Failed to parse log message: ${e.message}`));
    console.log(chalk.gray(msg.toString()));
  }
});

server.on('error', (err) => {
  console.error(`Server error:\n${err.stack}`);
  server.close();
});

server.bind(PORT, HOST);
