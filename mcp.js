// ============================================================
// AGENT OS - MCP SERVER FOR GEMINI ENTERPRISE
// Bridges Gemini Enterprise Agent SDK with device control
// ============================================================

const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const {
    CallToolRequestSchema,
    ListToolsRequestSchema,
} = require('@modelcontextprotocol/sdk/types.js');

// Device Control Modules
const WiFiManager = require('./devices/wifi-manager');
const MikroTikManager = require('./devices/mikrotik-manager');
const LegacyDeviceManager = require('./devices/legacy-device-manager');
const DeviceRegistry = require('./core/device-registry');

class AgentOSMCPServer {
    constructor() {
        this.deviceRegistry = new DeviceRegistry();
        this.wifiManager = new WiFiManager();
        this.mikrotikManager = new MikroTikManager();
        this.legacyManager = new LegacyDeviceManager();

        this.server = new Server(
            {
                name: 'agent-os-mcp-server',
                version: '1.0.0',
            },
            {
                capabilities: {
                    tools: {},
                },
            }
        );

        this.setupToolHandlers();
        this.setupErrorHandling();
    }

    setupToolHandlers() {
        // List available tools
        this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
            tools: [
                {
                    name: 'scan_wifi_networks',
                    description: 'Scan for available WiFi networks on the device',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            duration: {
                                type: 'number',
                                description: 'Scan duration in milliseconds (default: 10000)',
                                default: 10000
                            }
                        }
                    }
                },
                {
                    name: 'connect_wifi',
                    description: 'Connect to a WiFi network using platform-native APIs',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            ssid: { type: 'string', description: 'Network SSID' },
                            password: { type: 'string', description: 'Network password' },
                            security: {
                                type: 'string',
                                enum: ['WPA2', 'WPA3', 'WEP', 'OPEN'],
                                description: 'Security type'
                            },
                            platform: {
                                type: 'string',
                                enum: ['android', 'ios', 'electron', 'legacy'],
                                description: 'Target platform'
                            }
                        },
                        required: ['ssid', 'platform']
                    }
                },
                {
                    name: 'disconnect_wifi',
                    description: 'Disconnect from current WiFi network',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            platform: {
                                type: 'string',
                                enum: ['android', 'ios', 'electron', 'legacy']
                            }
                        },
                        required: ['platform']
                    }
                },
                {
                    name: 'get_wifi_status',
                    description: 'Get current WiFi connection status and details',
                    inputSchema: {
                        type: 'object',
                        properties: {}
                    }
                },
                {
                    name: 'mikrotik_command',
                    description: 'Execute command on MikroTik RouterOS device',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            host: { type: 'string', description: 'Router IP/hostname' },
                            username: { type: 'string' },
                            password: { type: 'string' },
                            command: { type: 'string', description: 'RouterOS command' },
                            params: { type: 'object', description: 'Command parameters' }
                        },
                        required: ['host', 'username', 'password', 'command']
                    }
                },
                {
                    name: 'mikrotik_hotspot_login',
                    description: 'Perform CHAP-MD5 authentication on MikroTik Hotspot',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            host: { type: 'string' },
                            username: { type: 'string' },
                            password: { type: 'string' },
                            challenge: { type: 'string', description: 'CHAP challenge from router' }
                        },
                        required: ['host', 'username', 'password', 'challenge']
                    }
                },
                {
                    name: 'control_legacy_device',
                    description: 'Send command to legacy IoT device (IM10, RediF15, etc.)',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            deviceType: {
                                type: 'string',
                                enum: ['IM10', 'RediF15', 'custom'],
                                description: 'Device model'
                            },
                            endpoint: { type: 'string', description: 'Device IP or serial port' },
                            command: { type: 'string', description: 'Command to execute' },
                            params: { type: 'object' },
                            protocol: {
                                type: 'string',
                                enum: ['http', 'serial', 'modbus', 'custom'],
                                default: 'http'
                            }
                        },
                        required: ['deviceType', 'endpoint', 'command']
                    }
                },
                {
                    name: 'get_device_telemetry',
                    description: 'Get real-time telemetry from connected device',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            deviceId: { type: 'string' },
                            metrics: {
                                type: 'array',
                                items: { type: 'string' },
                                description: 'Specific metrics to fetch (default: all)'
                            }
                        },
                        required: ['deviceId']
                    }
                },
                {
                    name: 'register_device',
                    description: 'Register a new device in the Agent OS registry',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            deviceType: {
                                type: 'string',
                                enum: ['mikrotik', 'wifi_ap', 'legacy_im10', 'legacy_redif15', 'custom']
                            },
                            identifier: { type: 'string', description: 'MAC, serial, or IP' },
                            credentials: { type: 'object' },
                            metadata: { type: 'object' }
                        },
                        required: ['deviceType', 'identifier']
                    }
                },
                {
                    name: 'federated_sync',
                    description: 'Synchronize device state across federated network nodes',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            nodeId: { type: 'string' },
                            data: { type: 'object' },
                            priority: { type: 'string', enum: ['low', 'normal', 'high', 'critical'] }
                        },
                        required: ['nodeId', 'data']
                    }
                }
            ]
        }));

        // Handle tool execution
        this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
            const { name, arguments: args } = request.params;

            try {
                const result = await this.executeTool(name, args);
                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify(result, null, 2)
                        }
                    ]
                };
            } catch (error) {
                return {
                    content: [
                        {
                            type: 'text',
                            text: `Error executing ${name}: ${error.message}`
                        }
                    ],
                    isError: true
                };
            }
        });
    }

    async executeTool(name, args) {
        switch (name) {
            case 'scan_wifi_networks':
                return await this.wifiManager.scan(args.duration);

            case 'connect_wifi':
                return await this.wifiManager.connect(args);

            case 'disconnect_wifi':
                return await this.wifiManager.disconnect(args.platform);

            case 'get_wifi_status':
                return await this.wifiManager.getStatus();

            case 'mikrotik_command':
                return await this.mikrotikManager.execute(args);

            case 'mikrotik_hotspot_login':
                return await this.mikrotikManager.hotspotLogin(args);

            case 'control_legacy_device':
                return await this.legacyManager.sendCommand(args);

            case 'get_device_telemetry':
                return await this.deviceRegistry.getTelemetry(args.deviceId, args.metrics);

            case 'register_device':
                return await this.deviceRegistry.register(args);

            case 'federated_sync':
                return await this.deviceRegistry.federatedSync(args);

            default:
                throw new Error(`Unknown tool: ${name}`);
        }
    }

    setupErrorHandling() {
        this.server.onerror = (error) => {
            console.error('[MCP Server Error]', error);
        };

        process.on('SIGINT', async () => {
            await this.server.close();
            process.exit(0);
        });
    }

    async run() {
        const transport = new StdioServerTransport();
        await this.server.connect(transport);
        console.error('Agent OS MCP Server running on stdio');
    }
}

// Start server
const server = new AgentOSMCPServer();
server.run().catch(console.error);