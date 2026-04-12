'use strict';
/**
 * OperationProgressTracker — step-by-step progress for long-running ops
 */

const EventEmitter = require('events');

// ── Status enum ───────────────────────────────────────────────────────────────

const StepStatus = Object.freeze({
    PENDING: 'pending',
    ACTIVE:  'active',
    DONE:    'done',
    ERROR:   'error'
});

// ── MikroTik provisioning template ───────────────────────────────────────────

function buildMikrotikProvisionTemplate(opts = {}) {
    return {
        title:       'Provisioning MikroTik Router',
        description: 'Applying AgentOS RouterOS configuration step by step.',
        steps: [
            { id: 'validate',   label: 'Validating connection',    description: 'Verifying RouterOS API connectivity and credentials.' },
            { id: 'interfaces', label: 'Configuring interfaces',   description: 'Setting up WAN, LAN, and bridge interfaces.' },
            { id: 'dhcp',       label: 'Setting up DHCP',          description: 'Provisioning DHCP server and IP pools for hotspot clients.' },
            { id: 'hotspot',    label: 'Enabling hotspot',         description: 'Activating hotspot server with captive portal.' },
            { id: 'profiles',   label: 'Creating billing profiles', description: `Provisioning ${opts.plans ?? 3} bandwidth/time plans.` },
            { id: 'firewall',   label: 'Applying firewall rules',  description: 'Writing NAT masquerade and forward chain rules.' },
            { id: 'dns',        label: 'Configuring DNS',          description: 'Setting upstream DNS servers and local overrides.' },
            { id: 'scheduler',  label: 'Installing scheduler',     description: 'Setting up RouterOS scheduler for voucher expiry checks.' },
            { id: 'telegram',   label: 'Wiring Telegram bot',      description: 'Configuring RouterOS → AgentOS webhook bindings.' },
            { id: 'verify',     label: 'Verifying deployment',     description: 'Running smoke tests on all configured subsystems.' }
        ]
    };
}

function buildVoucherBatchTemplate(count) {
    return {
        title:       `Generating ${count} Vouchers`,
        description: 'Creating and registering voucher codes in batch.',
        steps: [
            { id: 'generate', label: 'Generating codes',    description: `Creating ${count} cryptographically random voucher codes.` },
            { id: 'register', label: 'Registering to DB',   description: 'Persisting voucher records to Firebase / local store.' },
            { id: 'mikrotik', label: 'Adding to RouterOS',  description: 'Provisioning hotspot user accounts on the router.' },
            { id: 'output',   label: 'Preparing output',    description: 'Generating QR codes and formatted voucher list.' }
        ]
    };
}

// ── OperationProgressTracker ──────────────────────────────────────────────────

class OperationProgressTracker extends EventEmitter {
    /**
     * @param {object} template  { title, description, steps[] }
     * @param {Function} [onProgress]  callback(snapshot)
     */
    constructor(template, onProgress = null) {
        super();
        this.onProgress     = onProgress;
        this._activityCount = 0;
        this._snapshot      = {
            title:       template.title,
            description: template.description,
            percent:     0,
            steps:       template.steps.map(s => ({
                id:          s.id,
                label:       s.label,
                description: s.description,
                status:      StepStatus.PENDING,
                percent:     0,
                detail:      null,
                activities:  []
            }))
        };
    }

    // ── Step accessors ────────────────────────────────────────────────────────

    _getStep(stepId) {
        const step = this._snapshot.steps.find(s => s.id === stepId);
        if (!step) throw new Error(`Unknown progress step: ${stepId}`);
        return step;
    }

    _clamp(v) {
        return Math.min(100, Math.max(0, Math.round(Number.isFinite(v) ? v : 0)));
    }

    _recalc() {
        const steps = this._snapshot.steps;
        const total = steps.reduce((sum, s) => sum + this._clamp(s.percent), 0);
        this._snapshot.percent = steps.length ? Math.round(total / steps.length) : 0;
    }

    async _emit() {
        this._recalc();
        const snap = structuredClone(this._snapshot);
        this.emit('progress', snap);
        if (this.onProgress) await this.onProgress(snap);
        return snap;
    }

    // ── Public API ────────────────────────────────

    snapshot() {
        this._recalc();
        return structuredClone(this._snapshot);
    }

    async startStep(stepId, detail = null) {
        const step  = this._getStep(stepId);
        step.status = StepStatus.ACTIVE;
        step.percent = Math.max(step.percent, 2);
        if (detail) step.detail = detail;
        return this._emit();
    }

    async updateStep(stepId, { label, description, detail, percent, status } = {}) {
        const step = this._getStep(stepId);
        if (label       !== undefined) step.label       = label;
        if (description !== undefined) step.description = description;
        if (detail      !== undefined) step.detail      = detail;
        if (percent     !== undefined) step.percent     = this._clamp(percent);
        if (status      !== undefined) step.status      = status;
        return this._emit();
    }

    async addActivity(stepId, message, status = StepStatus.ACTIVE) {
        const step = this._getStep(stepId);
        step.activities.push({ id: `${stepId}-${this._activityCount++}`, message, status });
        if (step.status === StepStatus.PENDING && status === StepStatus.ACTIVE) {
            step.status = StepStatus.ACTIVE;
        }
        return this._emit();
    }

    async completeStep(stepId, detail = null) {
        const step  = this._getStep(stepId);
        step.status  = StepStatus.DONE;
        step.percent = 100;
        if (detail) step.detail = detail;
        // Mark all activities done
        step.activities.forEach(a => { a.status = StepStatus.DONE; });
        return this._emit();
    }

    async failStep(stepId, detail = null) {
        const step  = this._getStep(stepId);
        step.status  = StepStatus.ERROR;
        step.percent = 100;
        if (detail) step.detail = detail;
        return this._emit();
    }

    /** Complete all remaining pending/active steps as done (cleanup) */
    async completeAll(detail = 'Operation completed') {
        for (const step of this._snapshot.steps) {
            if (step.status === StepStatus.PENDING || step.status === StepStatus.ACTIVE) {
                step.status  = StepStatus.DONE;
                step.percent = 100;
            }
        }
        return this._emit();
    }

    /** Check if all steps are in terminal state */
    get isFinished() {
        return this._snapshot.steps.every(s =>
            s.status === StepStatus.DONE || s.status === StepStatus.ERROR
        );
    }

    get hasErrors() {
        return this._snapshot.steps.some(s => s.status === StepStatus.ERROR);
    }
}

// ── Factory ───────────────────────────────────────────────────────────────────

function createProgressTracker(template, onProgress = null) {
    return new OperationProgressTracker(template, onProgress);
}

module.exports = {
    OperationProgressTracker, StepStatus,
    createProgressTracker,
    buildMikrotikProvisionTemplate,
    buildVoucherBatchTemplate
};
