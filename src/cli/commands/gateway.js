const fs = require('fs');
const path = require('path');
const net = require('net');
const { spawn, exec } = require('child_process');

const _chalk = require('chalk');
const chalk = _chalk.default || _chalk;

const { STATE_PATH, getConfig } = require('../../core/config');
const { logger } = require('../../core/logger');

// Proxy for @clack/prompts to avoid ERR_REQUIRE_ESM during command registration
const clackProxy = {
    intro: () => { },
    outro: () => { },
    log: { info: () => { }, warn: () => { }, error: () => { }, step: () => { }, message: () => { } },
    spinner: () => ({ start: () => { }, stop: () => { } }),
    cancel: () => { },
    confirm: async () => true,
    isCancel: () => false,
    text: async () => '',
    password: async () => '',
    select: async () => ''
};

module.exports = (program) => {
    program
        .command('gateway')
        .description('Run, inspect, and query the WebSocket Gateway')
        .option('--daemon, -d', 'Run as background service')
        .option('--port <port>', 'Override gateway port')
        .option('--force', 'Kill existing process on port')
        .option('--verbose, -v', 'Verbose logging')
        .action(async (options) => {
            // Dynamic import for @clack/prompts
            const { intro, outro, log, spinner: clackSpinner, cancel, confirm, isCancel } = await import('@clack/prompts');

            const { BRAND, CONFIG_PATH, STATE_PATH } = global.AGENTOS;

            // Check config exists
            if (!fs.existsSync(CONFIG_PATH)) {
                cancel('No configuration found. Run: agentos onboard');
                process.exit(1);
            }

            const config = getConfig();
            const Port = options.port || config.gateway?.port || 19876;

            // ── PID file / single-instance guard ────────────────────────────
            const pidFile = path.join(STATE_PATH, 'gateway.pid');

            // Handle graceful shutdown - register EARLY so Ctrl+C works even during init
            const shutdown = async (signal) => {
                log.warn(`\nReceived ${signal}. Shutting down gateway...`);
                
                // Set a safety timeout for shutdown
                const forceExit = setTimeout(() => {
                    log.error('Graceful shutdown timed out, force exiting.');
                    try { if (fs.existsSync(pidFile)) fs.unlinkSync(pidFile); } catch (_) { }
                    process.exit(1);
                }, 10000); // 10s for full cleanup
                forceExit.unref();

                if (global.gateway) {
                    try {
                        await global.gateway.stop();
                    } catch (e) {
                        logger.error('Error during gateway stop:', e);
                    }
                }
                
                try { if (fs.existsSync(pidFile)) fs.unlinkSync(pidFile); } catch (_) { }
                
                clearTimeout(forceExit);
                outro(chalk.green('✓ Gateway stopped.'));
                process.exit(0);
            };

            process.on('SIGINT', () => shutdown('SIGINT'));
            process.on('SIGTERM', () => shutdown('SIGTERM'));

            // When launched by PM2, PM2 itself enforces single-instance.
            // The pid-file check is redundant AND harmful: a stale file from
            // the previous PM2 restart would cause an immediate exit(1) which
            // PM2 counts as a crash and restarts → infinite loop.
            const underPM2 = !!(process.env.PM2_HOME || process.env.pm_id !== undefined);

            if (fs.existsSync(pidFile) && !options.force && !underPM2) {
                const storedPidString = fs.readFileSync(pidFile, 'utf8').trim();
                const storedPid = parseInt(storedPidString, 10);
                let processAlive = false;
                if (!isNaN(storedPid)) {
                    try { process.kill(storedPid, 0); processAlive = true; } catch (_) {}
                }

                // Only block if the process is alive AND actually holds the port
                let portBound = false;
                if (processAlive) {
                    await new Promise((resolve) => {
                        const tester = net.createServer();
                        tester.once('error', (e) => {
                            if (e.code === 'EADDRINUSE') portBound = true;
                            resolve();
                        });
                        tester.once('listening', () => { tester.close(); resolve(); });
                        tester.listen(Port, '0.0.0.0');
                    });
                }

                if (processAlive && portBound) {
                    log.warn(`Gateway already running (PID: ${storedPid}, port: ${Port})`);
                    const killExisting = await confirm({
                        message: 'Kill the existing process and restart?',
                        initialValue: false
                    });

                    if (killExisting && !isCancel(killExisting)) {
                        try {
                            process.kill(storedPid, 'SIGKILL');
                            log.info(`Killed PID ${storedPid}`);
                            if (fs.existsSync(pidFile)) fs.unlinkSync(pidFile);
                        } catch (e) {
                            log.error(`Failed to kill: ${e.message}`);
                            process.exit(1);
                        }
                    } else {
                        log.info('Exiting. Use: agentos gateway:stop');
                        process.exit(1);
                    }
                } else {
                    // Stale pidfile — process is dead or port is free
                    logger.info(`Cleaning stale gateway.pid (PID ${storedPid} no longer active)`);
                    try { fs.unlinkSync(pidFile); } catch (_) { }
                }
            } else if (fs.existsSync(pidFile)) {
                // Under PM2 or --force: always remove stale pid to start fresh
                try { fs.unlinkSync(pidFile); } catch (_) { }
            }

            // Kill existing if --force (legacy fallback)
            if (options.force && fs.existsSync(pidFile)) {
                try {
                    const pid = fs.readFileSync(pidFile, 'utf8').trim();
                    process.kill(parseInt(pid), 'SIGKILL');
                    log.warn('Forced kill of existing gateway (PID: ' + pid + ')');
                    fs.unlinkSync(pidFile);
                } catch (e) {
                    try { fs.unlinkSync(pidFile); } catch (_) { }
                }
            }

            console.clear();
            intro(chalk.bgCyan.black(` 🚀 Starting ${BRAND.name} Gateway `));
            log.step(`Port:    ${Port}\nConfig:  ${CONFIG_PATH}\nProfile: ${global.AGENTOS.PROFILE_DIR}`);

            const spinner = clackSpinner();
            spinner.start('Initializing AgentOS Modular Services...');
            global.startupSpinner = spinner;

            // ── Silence console logs during spinner-heavy initialization ──────
            const consoleTransports = logger.transports.filter(t => t instanceof require('winston').transports.Console);
            consoleTransports.forEach(t => t.silent = true);

            try {
                // 1. Core Services Initialization
                const { getManager: getMikroTik } = require('../../core/mikrotik');
                const { getDatabase } = require('../../core/database');
                const { getConfig } = require('../../core/config');
                const config = getConfig();
                const FinancialService = require('../../core/financial');
                const UniversalBilling = require('../../core/universal-billing');
                const DiscoveryService = require('../../core/discovery');
                const MemoryManager = require('../../core/memory/MemoryManager');
                const nodeRegistry = require('../../core/node-registry');
                const AskEngine = require('../../core/ask-engine');
                const { Gateway: AgentOSGateway } = require('../../core/gateway-engine');

                const mikrotik = getMikroTik();
                const database = await getDatabase();
                const financial = new FinancialService({ database });
                const billing = new UniversalBilling({ database });
                const discovery = new DiscoveryService({ mikrotik });
                const memoryManager = new MemoryManager(config.memory?.adapter || 'memory');
                await memoryManager.initialize();

                // Set Globals
                global.mikrotik = mikrotik;
                global.database = database;
                global.financial = financial;
                global.billing = billing;
                global.discovery = discovery;
                global.memoryManager = memoryManager;
                global.nodeRegistry = nodeRegistry;

                // 2. AI Engine
                const aiInstance = process.env.GEMINI_API_KEY
                    ? new (require('@google/generative-ai').GoogleGenerativeAI)(process.env.GEMINI_API_KEY)
                    : null;

                const askEngine = new AskEngine({
                    mikrotik,
                    database,
                    financial,
                    billing,
                    discovery,
                    memory: memoryManager,
                    ai: aiInstance
                });
                global.askEngine = askEngine;

                // 3. Connect to MikroTik (non-fatal)
                try {
                    await mikrotik.connect();
                } catch (err) {
                    logger.warn(`MikroTik connection failed: ${err.message}`);
                }

                // 4. Pre-flight: check port availability before binding
                await new Promise((resolve, reject) => {
                    const tester = net.createServer();
                    tester.once('error', (err) => {
                        tester.close();
                        if (err.code === 'EADDRINUSE') {
                            reject(err);
                        } else {
                            reject(err);
                        }
                    });
                    tester.once('listening', () => { tester.close(); resolve(); });
                    tester.listen(Port, '0.0.0.0');
                });

                // 5. Start Gateway
                const gateway = new AgentOSGateway({
                    ...config,
                    port: Port,
                    verbose: options.verbose
                });
                gateway.askEngine = askEngine;
                global.gateway = gateway;

                await gateway.start();

                // Save PID
                fs.writeFileSync(pidFile, process.pid.toString());

                // ── Restore console logs ──────────────────────────────────────
                consoleTransports.forEach(t => t.silent = false);
                spinner.stop(chalk.green('✓ AgentOS Services & Gateway running'));

                log.message(chalk.cyan('📡 Connection Info:'));
                log.message(chalk.gray(`  WebSocket: ws://127.0.0.1:${Port}/index.html`));
                log.message(chalk.gray(`  HTTP API:  http://127.0.0.1:${Port}/index.html`));
                const tokenPreview = config.gateway?.token
                    ? config.gateway.token.substring(0, 16) + '...'
                    : '(not set)';
                log.message(chalk.gray(`  Token:     ${tokenPreview}`));

                log.message(chalk.cyan('\nCommands:'));
                log.message('  ' + chalk.yellow('Ctrl+C') + '          - Stop gateway');
                log.message('  ' + chalk.yellow('agentos status') + '    - Check health');
                log.message('  ' + chalk.yellow('agentos logs') + '      - View logs');
                
                outro(chalk.green('Gateway is active and listening.'));

            } catch (error) {
                // Restore console so errors are visible
                try { consoleTransports.forEach(t => t.silent = false); } catch (_) {}
                try { spinner.stop(chalk.red('Failed to start: ' + error.message)); } catch (_) {}
                logger.error('Gateway start error:', { message: error.message, code: error.code });

                if (error.code === 'EADDRINUSE' || error.message?.includes('already in use')) {
                    log.error(chalk.red(`Port ${Port} is occupied by another process.`));
                    
                    const tryKill = await confirm({
                        message: 'Find and kill the process occupying this port?',
                        initialValue: true
                    });

                    if (tryKill && !isCancel(tryKill)) {
                        const s = clackSpinner();
                        s.start('Attempting to free port...');
                        try {
                            // Windows specific taskkill logic for port - more robust version
                            const findCmd = `netstat -aon | findstr :${Port}`;
                            const pids = await new Promise((res) => {
                                exec(findCmd, (err, stdout) => {
                                    if (err || !stdout) return res([]);
                                    const lines = stdout.trim().split('\r\n');
                                    const extractedPids = lines.map(line => {
                                        const parts = line.trim().split(/\s+/);
                                        return parts[parts.length - 1];
                                    }).filter(p => p && p !== '0');
                                    res([...new Set(extractedPids)]);
                                });
                            });

                            if (pids.length > 0) {
                                for (const pid of pids) {
                                    try {
                                        await new Promise((res) => exec(`taskkill /F /PID ${pid}`, res));
                                        log.info(`Killed process ${pid} on port ${Port}`);
                                    } catch (e) {}
                                }
                                s.stop(chalk.green('Port freed.'));
                            } else {
                                s.stop(chalk.yellow('No processes found on port, but port is blocked. Check firewall?'));
                            }
                        } catch (killErr) {
                            s.stop(chalk.red('Failed to automatically free port.'));
                            log.message('  Manual Fix: ' + chalk.yellow('netstat -ano | findstr :' + Port));
                            log.message('  Then kill it: ' + chalk.yellow('taskkill /F /PID <PID>'));
                        }
                    }
                    process.exit(0);
                }

                log.warn('Troubleshooting:');
                log.message('  1. Run setup:        agentos onboard');
                log.message('  2. Check port free:  netstat -ano | findstr :' + Port);
                log.message('  3. Review logs:      type logs\\error.log');
                log.message('  4. Run diagnostics:  agentos doctor');
                outro(chalk.red('Gateway failed to start.'));
                process.exit(1);
            }
        });

    // ── gateway:status ────────────────────────────────────────────────────────
    program
        .command('gateway:status')
        .alias('gs')
        .description('Check gateway status')
        .action(async () => {
            const { intro, outro, cancel } = await import('@clack/prompts');
            const { STATE_PATH } = global.AGENTOS;
            const pidFile = path.join(STATE_PATH, 'gateway.pid');

            if (!fs.existsSync(pidFile)) {
                cancel('Gateway not running');
                return;
            }

            try {
                const pid = fs.readFileSync(pidFile, 'utf8').trim();
                process.kill(parseInt(pid), 0); // signal 0 = existence check only
                outro(chalk.green('✓ Gateway running (PID: ' + pid + ')'));
            } catch (e) {
                cancel('Gateway not running (stale PID file)');
                try { fs.unlinkSync(pidFile); } catch (_) { }
            }
        });

    // ── gateway:stop ──────────────────────────────────────────────────────────
    program
        .command('gateway:stop')
        .description('Stop running gateway')
        .action(async () => {
            const { intro, outro, spinner: clackSpinner, cancel } = await import('@clack/prompts');
            const { STATE_PATH } = global.AGENTOS;
            const pidFile = path.join(STATE_PATH, 'gateway.pid');

            if (!fs.existsSync(pidFile)) {
                cancel('Gateway not running (no PID file found)');
                return;
            }

            const pid = parseInt(fs.readFileSync(pidFile, 'utf8').trim());
            const config = getConfig();
            const Port = config.gateway?.port || 19876;

            try {
                // Check if process is actually running
                process.kill(pid, 0);

                const spinner = clackSpinner();
                spinner.start(`Stopping gateway (PID: ${pid})...`);
                process.kill(pid, 'SIGTERM');

                // Wait a bit for graceful shutdown
                let attempts = 0;
                const maxAttempts = 10;
                while (attempts < maxAttempts) {
                    try {
                        process.kill(pid, 0);
                        await new Promise(r => setTimeout(r, 500));
                        attempts++;
                    } catch (e) {
                        // Process is gone
                        break;
                    }
                }

                if (attempts === maxAttempts) {
                    spinner.stop(chalk.red('Process did not stop gracefully, forcing...'));
                    try { process.kill(pid, 'SIGKILL'); } catch (_) {}
                } else {
                    spinner.stop(chalk.green('Gateway stopped'));
                }

                // Double check port is free
                await new Promise((resolve) => {
                    const tester = net.createServer();
                    tester.once('error', () => {
                        log.warn(`Warning: Port ${Port} still appears to be in use.`);
                        resolve();
                    });
                    tester.once('listening', () => { tester.close(); resolve(); });
                    tester.listen(Port, '0.0.0.0');
                });

                if (fs.existsSync(pidFile)) {
                    try { fs.unlinkSync(pidFile); } catch (_) {}
                }
                outro(chalk.green('✓ Successfully stopped gateway.'));
            } catch (e) {
                if (e.code === 'ESRCH') {
                    cancel('Gateway was not running (stale PID file cleaned up)');
                } else {
                    cancel('Error stopping gateway: ' + e.message);
                }
                // Clean up stale PID file anyway
                if (fs.existsSync(pidFile)) {
                    fs.unlinkSync(pidFile);
                }
            }
        });

    // ── gateway:logs ──────────────────────────────────────────────────────────
    program
        .command('gateway:logs')
        .description('Tail gateway logs')
        .option('-n, --lines <n>', 'Number of lines', '50')
        .action(async (options) => {
            const { intro, outro, cancel } = await import('@clack/prompts');
            const logFile = path.join(process.cwd(), 'logs', 'combined.log');
            if (!fs.existsSync(logFile)) {
                cancel('No log file found at ' + logFile);
                return;
            }
            const lines = parseInt(options.lines) || 50;
            const content = fs.readFileSync(logFile, 'utf8').split('\n').slice(-lines).join('\n');
            intro(chalk.bgCyan.black(` Logs: Last ${lines} lines `));
            console.log(content);
            outro(chalk.cyan('End of logs'));
        });
};