// src/plugins/adapters/docker-adapter.js
const BaseAdapter = require('../base-adapter');
const Docker = require('dockerode');
const { Resource } = require('../../core/resource-model');

class DockerAdapter extends BaseAdapter {
  constructor(config) {
    super({ ...config, name: 'docker', type: 'container' });
    this.actionMap = {
      'container.start': this.startContainer.bind(this),
      'container.stop': this.stopContainer.bind(this),
      'container.restart': this.restartContainer.bind(this),
      'container.logs': this.getLogs.bind(this),
      'container.exec': this.execCommand.bind(this),
      'container.stats': this.getStats.bind(this),
      'compose.up': this.composeUp.bind(this),
      'compose.down': this.composeDown.bind(this)
    };
  }

  async connect() {
    this.docker = new Docker({
      host: this.config.host,
      port: this.config.port || 2375,
      protocol: this.config.protocol || 'http'
    });
    
    await this.docker.ping();
    this.connected = true;
    return this;
  }

  async discover() {
    const containers = await this.docker.listContainers({ all: true });
    const resources = containers.map(c => new Resource({
      type: 'container',
      provider: 'docker',
      name: c.Names[0].replace('/', ''),
      id: c.Id,
      capabilities: Object.keys(this.actionMap),
      properties: {
        image: c.Image,
        status: c.Status,
        state: c.State,
        ports: c.Ports
      }
    }));

    resources.forEach(r => this.resources.set(r.id, r));
    return resources;
  }

  async execute(resourceId, action, params) {
    return await this.actionMap[action](resourceId, params);
  }

  async startContainer(containerId) {
    const container = this.docker.getContainer(containerId);
    await container.start();
    return { status: 'started', containerId };
  }

  async composeUp(projectName, params) {
    // Integration with docker-compose
    const { exec } = require('child_process');
    const util = require('util');
    const execAsync = util.promisify(exec);
    
    const { stdout } = await execAsync(
      `docker-compose -f ${params.file} -p ${projectName} up -d`,
      { cwd: params.workingDir }
    );
    
    return { status: 'deployed', output: stdout };
  }

  // ... other Docker methods
}

module.exports = DockerAdapter;
