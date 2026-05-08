const https = require('https');
const http = require('http');

class GrpcTransport {
    constructor(mTLSConfig) {
        this.mTLSConfig = mTLSConfig;
        this.agentEndpoints = new Map();
    }

    async initialize() { }

    registerEndpoint(spiffeID, endpoint) {
        this.agentEndpoints.set(spiffeID, endpoint);
    }

    async send(message, targetSPIFFE) {
        const registered = this.agentEndpoints.get(targetSPIFFE);
        if (!registered) {
            throw new Error(
                `No endpoint registered for agent ${targetSPIFFE}. ` +
                `Call transport.registerEndpoint(spiffeID, 'http://host:port') before sending.`
            );
        }
        const endpoint = registered;
        return new Promise((resolve, reject) => {
            const data = JSON.stringify(message);
            const url = new URL(endpoint);
            const client = url.protocol === 'https:' ? https : http;
            const options = {
                hostname: url.hostname,
                port: url.port || (url.protocol === 'https:' ? 443 : 80),
                path: '/a2a/' + message.recipient.split('/').pop(),
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(data),
                    'A2A-Protocol-Version': '1.0'
                }
            };
            const req = client.request(options, (res) => {
                let body = '';
                res.on('data', chunk => body += chunk);
                res.on('end', () => {
                    try {
                        resolve(JSON.parse(body));
                    } catch (e) {
                        reject(new Error(`Invalid JSON: ${body}`));
                    }
                });
            });
            req.on('error', reject);
            req.write(data);
            req.end();
        });
    }
}

module.exports = { GrpcTransport };
