'use strict';
/**
 * TaskRegistry — in-memory sub-agent task lifecycle management
 */

const { v4: uuidv4 } = require('uuid');
const EventEmitter   = require('events');

// ── Task Status enum ──────────────────────────────────────────────────────────

const TaskStatus = Object.freeze({
    CREATED:   'created',
    RUNNING:   'running',
    COMPLETED: 'completed',
    FAILED:    'failed',
    STOPPED:   'stopped'
});

// ── TaskRegistry ──────────────────────────────────────────────────────────────

class TaskRegistry extends EventEmitter {
    constructor() {
        super();
        /** @type {Map<string, object>} */
        this.tasks   = new Map();
        this.counter = 0;
    }

    // ── CRUD ──────────────────────────────────────────────────────────────────

    create(prompt, { description = null, teamId = null } = {}) {
        const taskId = uuidv4();
        const now    = Date.now();
        const task   = {
            taskId,
            prompt,
            description,
            status:    TaskStatus.CREATED,
            createdAt: now,
            updatedAt: now,
            messages:  [],
            output:    '',
            teamId
        };
        this.tasks.set(taskId, task);
        this.counter++;
        this.emit('task:created', task);
        return task;
    }
    get(taskId) {
        return this.tasks.get(taskId) || null;
    }
    list(statusFilter = null) {
        const all = Array.from(this.tasks.values());
        return statusFilter ? all.filter(t => t.status === statusFilter) : all;
    }
    update(taskId, patch) {
        const task = this.tasks.get(taskId);
        if (!task) return null;
        Object.assign(task, patch, { updatedAt: Date.now() });
        this.emit('task:updated', task);
        return task;
    }
    appendOutput(taskId, role, content) {
        const task = this.tasks.get(taskId);
        if (!task) return;
        task.messages.push({ role, content, timestamp: Date.now() });
        task.output += content + '\n';
        task.updatedAt = Date.now();
    }

    setStatus(taskId, status, reason = null) {
        const task = this.tasks.get(taskId);
        if (!task) return;
        task.status    = status;
        task.updatedAt = Date.now();
        if (reason) task.messages.push({ role: 'system', content: `Status → ${status}: ${reason}`, timestamp: Date.now() });
        this.emit(`task:${status}`, task);
    }

    stop(taskId) {
        this.setStatus(taskId, TaskStatus.STOPPED, 'Stopped by operator');
    }

    assignTeam(taskId, teamId) {
        this.update(taskId, { teamId });
    }
  
    summary() {
        const counts = {};
        for (const s of Object.values(TaskStatus)) counts[s] = 0;
        for (const t of this.tasks.values()) counts[t.status]++;
        return { total: this.tasks.size, ...counts };
    }
}

// ── Singleton ─────────────────────────────────────────────────────────────────

let _instance = null;
function getTaskRegistry() {
    if (!_instance) _instance = new TaskRegistry();
    return _instance;
}

module.exports = { TaskRegistry, TaskStatus, getTaskRegistry };
