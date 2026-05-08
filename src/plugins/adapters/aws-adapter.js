// src/plugins/adapters/aws-adapter.js
const BaseAdapter = require('../base-adapter');
const { Resource } = require('../../core/resource-model');
const AWS = require('aws-sdk');

class AWSAdapter extends BaseAdapter {
  constructor(config) {
    super({ ...config, name: 'aws', type: 'compute' });
    this.actionMap = {
      'vm.start': this.startInstance.bind(this),
      'vm.stop': this.stopInstance.bind(this),
      'vm.reboot': this.rebootInstance.bind(this),
      'vm.status': this.getInstanceStatus.bind(this),
      'vm.create': this.createInstance.bind(this),
      'vm.terminate': this.terminateInstance.bind(this)
    };
  }

  async connect() {
    AWS.config.update({
      accessKeyId: this.config.accessKeyId,
      secretAccessKey: this.config.secretAccessKey,
      region: this.config.region
    });

    this.ec2 = new AWS.EC2();
    this.connected = true;
    return this;
  }

  async discover() {
    const result = await this.ec2.describeInstances().promise();
    const instances = [];

    result.Reservations.forEach(reservation => {
      reservation.Instances.forEach(instance => {
        const resource = new Resource({
          type: 'vm',
          provider: 'aws',
          name: instance.Tags?.find(t => t.Key === 'Name')?.Value || instance.InstanceId,
          id: instance.InstanceId,
          capabilities: Object.keys(this.actionMap),
          properties: {
            instanceType: instance.InstanceType,
            state: instance.State.Name,
            publicIp: instance.PublicIpAddress,
            privateIp: instance.PrivateIpAddress,
            region: this.config.region
          }
        });
        instances.push(resource);
        this.resources.set(instance.InstanceId, resource);
      });
    });

    return instances;
  }

  async execute(resourceId, action, params) {
    if (!this.actionMap[action]) {
      throw new Error(`Action ${action} not supported by AWS adapter`);
    }
    return await this.actionMap[action](resourceId, params);
  }

  async startInstance(instanceId) {
    await this.ec2.startInstances({ InstanceIds: [instanceId] }).promise();
    return { status: 'starting', instanceId };
  }

  async stopInstance(instanceId) {
    await this.ec2.stopInstances({ InstanceIds: [instanceId] }).promise();
    return { status: 'stopping', instanceId };
  }

  // ... other AWS methods
}

module.exports = AWSAdapter;
