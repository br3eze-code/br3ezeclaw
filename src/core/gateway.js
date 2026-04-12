'use strict';
/**
 * AgentOS Gateway
 * @module core/gateway
 * @version 2026.04 
 */

const http = require('http');
const fs   = require('fs');
const path = require('path');

const { createApp }             = require('./server');
const { WebSocketGateway }      = require('./websocket');
const { AgentOSBot }            = require('./telegram');
const { getMikroTikClient }     = require('./mikrotik');
const { getAgentRuntime }       = require('./agentRuntime');
const { getConfig, STATE_PATH } = require('./config');
const { logger }                = require('./logger');
const { PermissionMode }        = require('./permissions');

class Gateway {
    constructor(options = {}) {
        this.config        = getConfig();
        this.options       = options;
        this.server        = null;
        this.wss           = null;
        this.bot           = null;
        this.runtime       = null;
        this.pidFile       = path.join(STATE_PATH, 'gateway.pid');
        this._shuttingDown = false;
    }

    async start() {
        const port = this.options.port || this.config.gateway?.port || 19876;
        const host = this.config.gateway?.host || '127.0.0.1';

        logger.info(`Starting AgentOS Gateway v${this.config.version}...`);

        // ── Bootstrap AgentRuntime ──
        this.runtime = getAgentRuntime({
            permissionMode:    this.config.agent?.permissionMode || PermissionMode.PROMPT,
            maxTurns:          this.config.agent?.maxTurns       || 8,
            maxBudgetTokens:   this.config.agent?.maxBudgetTokens || 4000,
            compactAfterTurns: this.config.agent?.compactAfterTurns || 12
        });
        logger.info(`AgentRuntime ready — mode: ${this.runtime.defaultConfig.permissionMode}, maxTurns: ${this.runtime.defaultConfig.maxTurns}`);

        // ── Connect MikroTik ──
        logger.info('Connecting to MikroTik...');
        try {
            await getMikroTikClient().connect();
        } catch (err) {
            logger.warn(`MikroTik offline at startup: ${err.message} — gateway still starting`);
        }

        // ── HTTP server ──
        const app   = createApp();
        this.server = http.createServer(app);

        // ── WebSocket ──
        this.wss = new WebSocketGateway(this.server);

        // ── Telegram bot ──
        if (this.config.telegram?.token) {
            logger.info('Starting Telegram bot...');
            this.bot = new AgentOSBot();
        }

        await new Promise((resolve, reject) => {
            this.server.listen(port, host, (err) => { if (err) reject(err); else resolve(); });
        });

        fs.writeFileSync(this.pidFile, String(process.pid));

        logger.info(`✅ Gateway running on ${host}:${port}`);
        logger.info(`   WebSocket    : ws://${host}:${port}/ws`);
        logger.info(`   HTTP API     : http://${host}:${port}/health`);
        logger.info(`   Permission   : ${this.runtime.defaultConfig.permissionMode}`);

        this._registerSignalHandlers();
        return this;
    }

    async stop() {
        if (this.bot)    this.bot.stop();
        if (this.wss)    this.wss.close();
        if (this.server) await new Promise(resolve => this.server.close(resolve));
        if (fs.existsSync(this.pidFile)) fs.unlinkSync(this.pidFile);
    }

    async shutdown(signal) {
        if (this._shuttingDown) return;
        this._shuttingDown = true;
        logger.info(`${signal} received — shutting down...`);
        const forceTimer = setTimeout(() => { logger.error('Forced shutdown'); process.exit(1); }, 10_000);
        forceTimer.unref();
        try { await this.stop(); logger.info('Gateway stopped cleanly'); }
        catch (err) { logger.error('Shutdown error:', err.message); }
        finally { clearTimeout(forceTimer); process.exit(signal === 'ERROR' ? 1 : 0); }
    }

    _registerSignalHandlers() {
        process.once('SIGTERM',          () => this.shutdown('SIGTERM'));
        process.once('SIGINT',           () => this.shutdown('SIGINT'));
        process.on('uncaughtException',  (err) => { logger.error('Uncaught Exception:', err); this.shutdown('ERROR'); });
        process.on('unhandledRejection', (r)   => { logger.error('Unhandled Rejection:', r);  this.shutdown('ERROR'); });
    }
}

async function startGateway(options = {}) {
    const gateway = new Gateway(options);
    await gateway.start();
    return gateway;
}

module.exports = { Gateway, startGateway };
