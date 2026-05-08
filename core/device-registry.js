'use strict';

const DeviceController = require('../src/core/device-controller');

class DeviceRegistry {
    constructor() {
        this.controller = new DeviceController();
    }

    async getTelemetry(deviceId, metrics) {
        return await this.controller.getMetrics(deviceId);
    }

    async register(args) {
        const { deviceType, identifier, credentials, metadata } = args;
        return await this.controller.registerNode({
            id: identifier,
            type: deviceType,
            status: 'online',
            lastSeen: new Date().toISOString(),
            config: { credentials, metadata }
        });
    }

    async federatedSync(args) {
        const { nodeId, data, priority } = args;
        // Logic for synchronizing state across nodes
        return { success: true, syncId: Math.random().toString(36).substring(7) };
    }
}

module.exports = DeviceRegistry;
