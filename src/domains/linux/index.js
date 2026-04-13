// src/domains/linux/index.js
const { exec } = require('child_process');

const tools = [
  {
    name: 'run_command',
    description: 'Run shell command on Linux server',
    execute: (cmd) => new Promise((resolve, reject) => {
      exec(cmd, (err, stdout) => err ? reject(err) : resolve(stdout));
    })
  }
  // add more: systemctl, apt, etc.
];

module.exports = {
  register(registry) {
    registry.registerDomain('linux', tools);
  }
};
