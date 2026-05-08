'use strict';

const { logger } = require('../src/core/logger');

class LegacyDeviceManager {
    constructor() {
        // In a real scenario, this might use src/core/device-controller.js
    }

    async sendCommand(args) {
        const { deviceType, endpoint, command, params } = args;
        logger.info(`Sending command to legacy device ${deviceType} at ${endpoint}: ${command}`);
        
        // Mock response for now, should integrate with physical adapters later
        return {
            success: true,
            device: deviceType,
            command,
            result: 'Command acknowledged',
            timestamp: new Date().toISOString()
        };
    }
}

module.exports = LegacyDeviceManager;
