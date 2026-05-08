'use strict';
/**
 * Diagnostics — GatewayDiagnostics + MissionControlSnapshot + readiness checks
 */

const { getManager: getMikroTikManager } = require('./mikrotik');
const { getAgentRuntime }               = require('./agentRuntime');
const { getTaskRegistry, TaskStatus }   = require('./taskRegistry');
const { listSessions }                  = require('./sessionStore');
const { getConfig }                     = require('./config');
const { logger }                        = require('./logger');
const fs   = require('fs');
const path = require('path');
const os   = require('os');

// ── Health enum  ─────────────────────────

const DiagnosticHealth = Object.freeze({
    HEALTHY:  'healthy',
    DEGRADED: 'degraded',
    OFFLINE:  'offline'
});

// ── Readiness checks ────────────────────────

function isRouterReady(routerState) {
    return routerState?.isConnected === true;
}

function isSessionStoreWritable() {
    try {
        const dir = path.join(os.homedir(), '.agentos', 'state', 'sessions');
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        const testFile = path.join(dir, '.write-test');
        fs.writeFileSync(testFile, 'ok');
        fs.unlinkSync(testFile);
        return true;
    } catch {
        return false;
    }
}

function isStateWritable() {
    try {
        const dir = path.join(os.homedir(), '.agentos', 'state');
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        const testFile = path.join(dir, '.write-test');
        fs.writeFileSync(testFile, 'ok');
        fs.unlinkSync(testFile);
        return true;
    } catch {
        return false;
    }
}

/** Whether the gateway can accept and route missions */
function isSystemReady(snapshot) {
    return snapshot.diagnostics.stateWritable &&
           snapshot.diagnostics.sessionStoreWritable &&
           snapshot.diagnostics.rpcOk;
}

/** Whether missions can be dispatched to the router */
function isMissionReady(snapshot) {
    return isSystemReady(snapshot) &&
           snapshot.diagnostics.routerHealth === DiagnosticHealth.HEALTHY;
}

// ── Router diagnostics ────────────────────────────────────────────────────────

async function buildRouterDiagnostics() {
    const mikrotik = getMikroTikManager();
    const state    = mikrotik.getState?.() || {};
    const health   = state.isConnected
        ? DiagnosticHealth.HEALTHY
        : state.reconnectAttempts > 0
            ? DiagnosticHealth.DEGRADED
            : DiagnosticHealth.OFFLINE;

    let routerStats = null;
    if (state.isConnected) {
        try { routerStats = await mikrotik.executeTool('system.stats'); } catch (_) {}
    }

    const issues = [];
    if (!state.isConnected) issues.push('MikroTik router is not connected');
    if (state.reconnectAttempts > 5) issues.push(`High reconnect attempt count: ${state.reconnectAttempts}`);

    return {
        health,
        host:              state.host,
        port:              state.port,
        isConnected:       state.isConnected,
        reconnectAttempts: state.reconnectAttempts,
        lastConnectedAt:   state.lastConnectedAt,
        lastError:         state.lastError,
        availableTools:    state.availableTools,
        routerStats,
        issues
    };
}

// ── Full diagnostics snapshot ─────────

async function buildGatewayDiagnostics() {
    const config    = getConfig();
    const stateOk   = isStateWritable();
    const sessionOk = isSessionStoreWritable();

    const routerDiag = await buildRouterDiagnostics().catch(err => ({
        health: DiagnosticHealth.OFFLINE, isConnected: false, issues: [err.message]
    }));

    const sessionIds = listSessions().catch(() => []);
    const sessions   = await Promise.resolve(sessionIds);

    const issues = [...(routerDiag.issues || [])];
    if (!stateOk)   issues.push('State directory is not writable');
    if (!sessionOk) issues.push('Session store is not writable');

    const securityWarnings = [];
    if (!config.gateway?.token) securityWarnings.push('Gateway token is not set — API is unauthenticated');
    if (!config.telegram?.allowedChats?.length) securityWarnings.push('Telegram allowedChats is empty — bot accepts any sender');

    return {
        installed:            true,
        loaded:               true,
        rpcOk:                routerDiag.isConnected,
        stateWritable:        stateOk,
        sessionStoreWritable: sessionOk,
        routerHealth:         routerDiag.health,
        router:               routerDiag,
        sessionCount:         Array.isArray(sessions) ? sessions.length : 0,
        gatewayPort:          config.gateway?.port || 19876,
        gatewayHost:          config.gateway?.host || '127.0.0.1',
        issues,
        securityWarnings
    };
}

// ── MissionControlSnapshot  ─────────

async function buildMissionControlSnapshot() {
    const generatedAt = new Date().toISOString();
    const diag        = await buildGatewayDiagnostics();
    const registry    = getTaskRegistry();
    const runtime     = getAgentRuntime();

    const tasks    = registry.list();
    const summary  = registry.summary();

    const runtimes = tasks
        .filter(t => t.status === TaskStatus.RUNNING)
        .map(t => ({
            id:        t.taskId,
            key:       t.taskId.slice(0, 8),
            title:     t.description || t.prompt.slice(0, 60),
            subtitle:  t.prompt.slice(0, 80),
            status:    'running',
            updatedAt: t.updatedAt,
            ageMs:     Date.now() - t.createdAt
        }));

    const taskRecords = tasks.map(t => ({
        id:               t.taskId,
        key:              t.taskId.slice(0, 8),
        title:            t.description || t.prompt.slice(0, 60),
        mission:          t.prompt,
        subtitle:         t.prompt.slice(0, 80),
        status:           t.status,
        updatedAt:        t.updatedAt,
        ageMs:            Date.now() - t.createdAt,
        runtimeCount:     1,
        updateCount:      t.messages.length,
        liveRunCount:     t.status === TaskStatus.RUNNING ? 1 : 0,
        artifactCount:    0,
        warningCount:     0,
        tokenUsage:       null,
        metadata:         {}
    }));

    const mode = diag.rpcOk ? 'live' : 'fallback';

    return {
        generatedAt,
        mode,
        diagnostics:  diag,
        runtimes,
        tasks:        taskRecords,
        taskSummary:  summary,
        agentRuntime: {
            permissionMode:  runtime.defaultConfig.permissionMode,
            maxTurns:        runtime.defaultConfig.maxTurns,
            toolCount:       runtime.listTools().length
        },
        systemReady:  isSystemReady({ diagnostics: diag }),
        missionReady: isMissionReady({ diagnostics: diag })
    };
}

// ── HTTP route handler ──────────────────────────────────

async function handleHealthFull(req, res) {
    try {
        const diag = await buildGatewayDiagnostics();
        const overall = diag.issues.length === 0
            ? DiagnosticHealth.HEALTHY
            : diag.rpcOk
                ? DiagnosticHealth.DEGRADED
                : DiagnosticHealth.OFFLINE;

        res.status(overall === DiagnosticHealth.OFFLINE ? 503 : 200).json({
            health:  overall,
            ok:      overall !== DiagnosticHealth.OFFLINE,
            ...diag
        });
    } catch (err) {
        logger.error('Health check failed:', err.message);
        res.status(500).json({ health: DiagnosticHealth.OFFLINE, ok: false, error: err.message });
    }
}

async function handleSnapshot(req, res) {
    try {
        const snapshot = await buildMissionControlSnapshot();
        res.json(snapshot);
    } catch (err) {
        logger.error('Snapshot failed:', err.message);
        res.status(500).json({ error: err.message, mode: 'fallback', generatedAt: new Date().toISOString() });
    }
}

module.exports = {
    DiagnosticHealth,
    buildGatewayDiagnostics,
    buildMissionControlSnapshot,
    isSystemReady,
    isMissionReady,
    isRouterReady,
    handleHealthFull,
    handleSnapshot
};
