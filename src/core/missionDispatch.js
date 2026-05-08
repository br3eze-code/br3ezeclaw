'use strict';
/**
 * MissionDispatch — structured mission submission and dispatch runner
 *
 * The dispatch runner pattern (from the script) is adapted for Node.js/AgentRuntime
 * rather than spawning a CLI subprocess.
 */

const { v4: uuidv4 }          = require('uuid');
const { getAgentRuntime }     = require('./agentRuntime');
const { getTaskRegistry, TaskStatus } = require('./taskRegistry');
const { PermissionMode }      = require('./permissions');
const { isMissionReady }      = require('./diagnostics');
const { logger }              = require('./logger');

// ── Thinking levels  ────────────

const ThinkingLevel = Object.freeze({
    OFF:     'off',
    MINIMAL: 'minimal',
    LOW:     'low',
    MEDIUM:  'medium',
    HIGH:    'high'
});

// Map thinking → maxTurns (higher thinking = more turns allowed)
const THINKING_TURNS = {
    off:     1,
    minimal: 2,
    low:     4,
    medium:  8,
    high:    12
};

// ── Validation ────────────────────────────────────────────────────────────────

function validateMissionSubmission(input) {
    if (!input || typeof input.mission !== 'string' || !input.mission.trim()) {
        throw Object.assign(new Error('mission is required'), { status: 400 });
    }
    const thinking = input.thinking ?? ThinkingLevel.MEDIUM;
    if (!Object.values(ThinkingLevel).includes(thinking)) {
        throw Object.assign(new Error(`invalid thinking level: ${thinking}`), { status: 400 });
    }
    return {
        mission:     input.mission.trim(),
        agentId:     input.agentId || null,
        workspaceId: input.workspaceId || null,
        thinking:    thinking
    };
}

// ── Mission dispatch ──────────────────────────────────────────────────────────

/**
 * Submit a mission through the AgentRuntime.
 * Returns a structured MissionResponse.
 *
 * @param {object} input  MissionSubmission
 * @returns {Promise<object>} MissionResponse
 */
async function submitMission(input) {
    const submission = validateMissionSubmission(input);
    const dispatchId = uuidv4();
    const registry   = getTaskRegistry();
    const runtime    = getAgentRuntime();

    // Pre-flight readiness check 
    // We run a quick diagnostic — but don't hard-block; just warn
    const readyCheck = await isMissionReady({ diagnostics: { rpcOk: true, stateWritable: true, sessionStoreWritable: true, routerHealth: 'healthy' } });

    // Create task record
    const task = registry.create(submission.mission, {
        description: `Mission: ${submission.mission.slice(0, 60)}`,
        teamId:      submission.agentId || null
    });

    // Map thinking level → runtime config
    const maxTurns = THINKING_TURNS[submission.thinking] || 8;

    // Dispatch asynchronously
    registry.setStatus(task.taskId, TaskStatus.RUNNING);
    logger.info(`Mission dispatched [${dispatchId}] task=${task.taskId.slice(0, 8)} thinking=${submission.thinking} turns=${maxTurns}`);

    _runMissionAsync(task.taskId, dispatchId, submission.mission, {
        maxTurns,
        permissionMode: submission.thinking === ThinkingLevel.HIGH ? PermissionMode.AUTO : PermissionMode.PROMPT
    }).catch(err => {
        registry.setStatus(task.taskId, TaskStatus.FAILED, err.message);
        logger.error(`Mission [${dispatchId}] failed:`, err.message);
    });

    // Return immediately with MissionResponse 
    return {
        dispatchId,
        runId:   task.taskId,
        agentId: submission.agentId || 'primary',
        status:  'queued',
        summary: `Mission queued: ${submission.mission.slice(0, 80)}`,
        payloads: []
    };
}

/** Internal async runner — mirrors the dispatch-runner script's main() */
async function _runMissionAsync(taskId, dispatchId, mission, opts) {
    const registry = getTaskRegistry();
    const runtime  = getAgentRuntime();

    try {
        registry.appendOutput(taskId, 'system', `Dispatch runner started [${dispatchId}]`);

        const { results } = await runtime.runTurnLoop(mission, {
            maxTurns:      opts.maxTurns || 8,
            permissionMode: opts.permissionMode || PermissionMode.PROMPT
        });

        for (const r of results) {
            registry.appendOutput(taskId, 'assistant', r.output);
        }

        const last = results[results.length - 1];
        const finalStatus = !last || last.stopReason === 'completed'
            ? TaskStatus.COMPLETED
            : TaskStatus.FAILED;

        registry.setStatus(taskId, finalStatus,
            last ? `Stop reason: ${last.stopReason}` : 'No turns completed'
        );

        logger.info(`Mission [${dispatchId}] ${finalStatus} (${results.length} turns)`);
    } catch (err) {
        registry.appendOutput(taskId, 'system', `Error: ${err.message}`);
        registry.setStatus(taskId, TaskStatus.FAILED, err.message);
        throw err;
    }
}

async function abortMission(taskId) {
    const registry = getTaskRegistry();
    const task     = registry.get(taskId);

    if (!task) throw Object.assign(new Error(`Task not found: ${taskId}`), { status: 404 });
    if (task.status !== TaskStatus.RUNNING) {
        throw Object.assign(new Error(`Task ${taskId} is not running (status: ${task.status})`), { status: 409 });
    }

    registry.stop(taskId);
    logger.info(`Mission aborted: ${taskId}`);

    return {
        taskId,
        dispatchId: null,
        status:     'cancelled',
        summary:    'Mission aborted by operator',
        reason:     'Operator requested abort',
        runnerPid:  process.pid,
        childPid:   null,
        abortedAt:  new Date().toISOString()
    };
}

// ── SSE task feed  ─────────

/**
 * Stream task progress events via Server-Sent Events.
 * Wire to Express: router.get('/tasks/:taskId/stream', streamTaskFeed)
 */
function streamTaskFeed(req, res) {
    const { taskId } = req.params;
    const registry   = getTaskRegistry();

    res.setHeader('Content-Type',  'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection',    'keep-alive');
    res.flushHeaders?.();

    const send = (event, data) => {
        res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    // Send initial snapshot
    const task = registry.get(taskId);
    if (!task) {
        send('task-error', { error: `Task not found: ${taskId}` });
        res.end();
        return;
    }

    send('task', {
        type:   'task',
        detail: _buildTaskDetail(task)
    });

    // Subscribe to live updates
    const onUpdate = (updatedTask) => {
        if (updatedTask.taskId !== taskId) return;
        send('task', { type: 'task', detail: _buildTaskDetail(updatedTask) });
    };
    const onDone = (updatedTask) => {
        if (updatedTask.taskId !== taskId) return;
        send('task', { type: 'task', detail: _buildTaskDetail(updatedTask) });
        send('ready', { type: 'ready', ok: true });
        cleanup();
        res.end();
    };

    registry.on('task:updated',   onUpdate);
    registry.on('task:completed', onDone);
    registry.on('task:failed',    onDone);
    registry.on('task:stopped',   onDone);

    const cleanup = () => {
        registry.off('task:updated',   onUpdate);
        registry.off('task:completed', onDone);
        registry.off('task:failed',    onDone);
        registry.off('task:stopped',   onDone);
    };

    req.on('close', cleanup);

    // Heartbeat to keep connection alive (mirrors dispatch runner heartbeat)
    const heartbeat = setInterval(() => {
        res.write(': heartbeat\n\n');
    }, 15_000);
    heartbeat.unref();

    req.on('close', () => {
        clearInterval(heartbeat);
        cleanup();
    });
}

function _buildTaskDetail(task) {
    return {
        task: {
            id:        task.taskId,
            key:       task.taskId.slice(0, 8),
            title:     task.description || task.prompt.slice(0, 60),
            mission:   task.prompt,
            subtitle:  task.prompt.slice(0, 80),
            status:    task.status,
            updatedAt: task.updatedAt,
            ageMs:     Date.now() - task.createdAt
        },
        liveFeed: task.messages.map((m, i) => ({
            id:        `${task.taskId}-${i}`,
            kind:      m.role === 'assistant' ? 'assistant' : m.role === 'system' ? 'status' : 'user',
            timestamp: new Date(m.timestamp).toISOString(),
            title:     m.role,
            detail:    m.content
        }))
    };
}

// ── HTTP route handlers ───────────────────────────────────────────────────────

async function handleSubmitMission(req, res) {
    try {
        const response = await submitMission(req.body);
        res.status(202).json(response);
    } catch (err) {
        res.status(err.status || 500).json({ error: err.message });
    }
}

async function handleAbortMission(req, res) {
    try {
        const response = await abortMission(req.params.taskId);
        res.json(response);
    } catch (err) {
        res.status(err.status || 500).json({ error: err.message });
    }
}

module.exports = {
    ThinkingLevel,
    submitMission,
    abortMission,
    streamTaskFeed,
    handleSubmitMission,
    handleAbortMission,
    validateMissionSubmission
};
