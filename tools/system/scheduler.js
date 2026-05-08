// system/scheduler.js

import { logger } from "./logger.js";
import { checkExpiredSessions } from "../db/sessions.js";
import { syncHotspotStatus } from "../network.agent.js";
import { retryPendingPayments } from "../payments/ecocash.js";

class Scheduler {
    constructor() {
        this.jobs = [];
        this.running = false;
    }
    addJob(name, intervalMs, task) {
        const job = {
            name,
            intervalMs,
            task,
            lastRun: 0,
            timer: null
        };

        this.jobs.push(job);
        logger.info(`Job added: ${name} (${intervalMs}ms)`);

        return job;
    }
    start() {
        this.running = true;
        logger.info("Scheduler started");

        this.jobs.forEach(job => {
            this.runJob(job);

            job.timer = setInterval(() => {
                this.runJob(job);
            }, job.intervalMs);
        });
    }
    stop() {
        this.running = false;
        logger.info("Scheduler stopped");

        this.jobs.forEach(job => {
            clearInterval(job.timer);
        });
    }
    runJob(job) {
        const now = Date.now();

        if (now - job.lastRun < job.intervalMs) {
            return;
        }

        job.lastRun = now;

        try {
            job.task();
        } catch (err) {
            logger.error(`Job ${job.name} failed`, err);
        }
    }
    // Add scheduled jobs
    addScheduledJobs() {
        // Check expired sessions every 30 seconds
        this.addJob("checkExpiredSessions", 30000, async () => {
            await checkExpiredSessions();
        });

        // Sync hotspot status every 10 seconds
        this.addJob("syncHotspotStatus", 10000, async () => {
            await syncHotspotStatus();
        });

        // Retry pending payments every 60 seconds
        this.addJob("retryPendingPayments", 60000, async () => {
            await retryPendingPayments();
        });
    }
    // Start scheduler with scheduled jobs
    startScheduled() {
        this.addScheduledJobs();
        this.start();
    }
    // Stop scheduler
    stopScheduled() {
        this.stop();
    }
    // Get job status
    getJobStatus(name) {
        const job = this.jobs.find(j => j.name === name);
        if (!job) return null;

        return {
            name: job.name,
            intervalMs: job.intervalMs,
            lastRun: job.lastRun,
            running: this.running
        };
    }
    // Get all job statuses
    getAllJobStatuses() {
        return this.jobs.map(job => ({
            name: job.name,
            intervalMs: job.intervalMs,
            lastRun: job.lastRun,
            running: this.running
        }));
    }
    // Add a one-time job
    addOneTimeJob(name, delayMs, task) {
        const job = {
            name,
            intervalMs: delayMs,
            task,
            lastRun: 0,
            timer: null
        };

        this.jobs.push(job);
        logger.info(`One-time job added: ${name} (${delayMs}ms)`);

        return job;
    }
    // Remove a job
    removeJob(name) {
        const job = this.jobs.find(j => j.name === name);
        if (!job) return false;

        clearInterval(job.timer);
        this.jobs = this.jobs.filter(j => j.name !== name);
        logger.info(`Job removed: ${name}`);

        return true;
    }
    // Clear all jobs
    clearJobs() {
        this.stop();
        this.jobs = [];
        logger.info("All jobs cleared");
    }
    // Check if job exists
    hasJob(name) {
        return this.jobs.some(j => j.name === name);
    }
    // Get job by name
    getJob(name) {
        return this.jobs.find(j => j.name === name);
    }
    // Run a job immediately
    runJobNow(name) {
        const job = this.getJob(name);
        if (!job) return false;

        job.task();
        return true;
    }
    // Get job count
    getJobCount() {
        return this.jobs.length;
    }
    // Get running status
    isRunning() {
        return this.running;
    }
}

export const scheduler = new Scheduler();

