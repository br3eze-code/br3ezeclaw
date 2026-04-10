const http = require('http');
const fs = require('fs');
const path = require('path');

const { createApp } = require('./server');
const { WebSocketGateway } = require('./websocket');
const { AgentOSBot } = require('./telegram');
const { getMikroTikClient } = require('./mikrotik');
const { getConfig, STATE_PATH } = require('./config');
const { logger } = require('./logger');

class Gateway {
    constructor(options = {}) {
        this.config = getConfig();
        this.options = options;
        this.server = null;
        this.wss = null;
        this.bot = null;
        this.pidFile = path.join(STATE_PATH, 'gateway.pid');
    }

    async start() {
        const port = this.options.port || this.config.gateway.port || 18789;
        const host = this.config.gateway.host || '127.0.0.1';

        logger.info(`Starting AgentOS Gateway v${this.config.version}...`);

        // Connect to MikroTik
        logger.info('Connecting to MikroTik...');
        await getMikroTikClient();

        // Create HTTP server
        const app = createApp();
        this.server = http.createServer(app);

        // Initialize WebSocket
        this.wss = new WebSocketGateway(this.server);

        // Initialize Telegram bot if configured
        if (this.config.telegram.token) {
            logger.info('Starting Telegram bot...');
            this.bot = new AgentOSBot();
        }

        // Start listening
        await new Promise((resolve, reject) => {
            this.server.listen(port, host, (err) => {
                if (err) reject(err);
                else resolve();
            });
        });

        // Save PID
        fs.writeFileSync(this.pidFile, process.pid.toString());

        logger.info(`Gateway running on ${host}:${port}`);
        logger.info(`WebSocket: ws://${host}:${port}/ws`);
        logger.info(`HTTP API: http://${host}:${port}/health`);

        // Setup graceful shutdown
        this.setupShutdownHandlers();

        return this;
    }

    setupShutdownHandlers() {
        const shutdown = async (signal) => {
            logger.info(`${signal} received, shutting down...`);

            if (this.bot) this.bot.stop();
            if (this.wss) this.wss.close();

            await new Promise((resolve) => {
                this.server.close(resolve);
            });

            // Remove PID file
            if (fs.existsSync(this.pidFile)) {
                fs.unlinkSync(this.pidFile);
            }

            logger.info('Gateway stopped');
            process.exit(0);
        };

        process.on('SIGTERM', () => shutdown('SIGTERM'));
        process.on('SIGINT', () => shutdown('SIGINT'));
        process.on('uncaughtException', (err) => {
            logger.error('Uncaught Exception:', err);
            shutdown('ERROR');
        });
    }

    async stop() {
        if (this.bot) this.bot.stop();
        if (this.wss) this.wss.close();
        if (this.server) {
            await new Promise((resolve) => this.server.close(resolve));
        }
        if (fs.existsSync(this.pidFile)) {
            fs.unlinkSync(this.pidFile);
        }
    }
}

// Factory function for CLI
async function startGateway(options = {}) {
    const gateway = new Gateway(options);
    await gateway.start();
    return gateway;
}

module.exports = { Gateway, startGateway };