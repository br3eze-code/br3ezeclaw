'use strict';
/**
 * DeviceController — manages IoT device mesh via WebSocket.
 * Ported from 36.js §7.6
 */

const { logger } = require('./logger');
const crypto = require('crypto');

class DeviceController {
    constructor(deps = {}) {
        this.database = deps.database;
        this.devices = new Map(); // deviceId -> { ws, info, lastSeen }
    }

    registerDevice(deviceId, ws, info) {
        this.devices.set(deviceId, { 
            ws, 
            info, 
            lastSeen: Date.now() 
        });
        
        if (this.database?.registerDevice) {
            this.database.registerDevice(deviceId, info);
        }
        
        logger.info(`Device registered: ${deviceId} (${info.type})`);
    }

    updateHeartbeat(deviceId) {
        const device = this.devices.get(deviceId);
        if (device) {
            device.lastSeen = Date.now();
            if (this.database?.updateDeviceHeartbeat) {
                this.database.updateDeviceHeartbeat(deviceId, { status: 'online' });
            }
        }
    }

    async executeOnDevice(deviceId, command) {
        const device = this.devices.get(deviceId);
        if (!device) throw new Error(`Device ${deviceId} not connected`);
        
        return new Promise((resolve, reject) => {
            const requestId = crypto.randomBytes(4).toString('hex');
            const timeout = setTimeout(() => reject(new Error('Device command timeout')), 30000);
            
            const handler = (rawData) => {
                try {
                    const data = JSON.parse(rawData.toString());
                    if (data.requestId === requestId) {
                        clearTimeout(timeout);
                        device.ws.off('message', handler);
                        if (data.error) reject(new Error(data.error));
                        else resolve(data.result);
                    }
                } catch (e) {
                    // Ignore non-JSON or unrelated messages
                }
            };
            
            device.ws.on('message', handler);
            device.ws.send(JSON.stringify({ 
                type: 'device.command', 
                requestId, 
                command 
            }));
        });
    }

    broadcastToDevices(type, payload) {
        const message = JSON.stringify({ 
            type, 
            payload, 
            from: 'master',
            timestamp: new Date().toISOString()
        });

        for (const [id, { ws }] of this.devices) {
            if (ws.readyState === 1) { // WebSocket.OPEN
                ws.send(message);
            } else {
                logger.debug(`Skipping device ${id} — connection state: ${ws.readyState}`);
            }
        }
    }

    getConnectedDevices() {
        const now = Date.now();
        const timeout = 60000; // 1 minute inactivity threshold
        
        return [...this.devices.entries()]
            .filter(([, d]) => now - d.lastSeen < timeout)
            .map(([id, d]) => ({
                id,
                ...d.info,
                lastSeen: d.lastSeen,
                online: true
            }));
    }

    removeDevice(deviceId) {
        this.devices.delete(deviceId);
        logger.info(`Device removed: ${deviceId}`);
    }
}

module.exports = DeviceController;
