const BaseDomain = require('../BaseDomain');
const { exec } = require('child_process');
const util = require('util');
const execAsync = util.promisify(exec);

class LinuxDomain extends BaseDomain {
  constructor() {
    super();
    this.name = 'linux';

    this.registerTool({
      name: 'shell',
      description: 'Execute a shell command',
      execute: async (command) => {
        try {
          const { stdout, stderr } = await execAsync(command);
          return stdout || stderr;
        } catch (err) {
          return `Error: ${err.message}`;
        }
      }
    });

    this.registerTool({
      name: 'uptime',
      description: 'Get system uptime',
      execute: async () => {
        const { stdout } = await execAsync('uptime -p');
        return stdout.trim();
      }
    });
  }
}

module.exports = LinuxDomain;
