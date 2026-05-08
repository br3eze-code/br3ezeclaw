'use strict';
/**
 * GitHub Integration — handles Octokit interactions, OAuth callbacks, and file syncing.
 * Ported from 36.js §3.8
 */

const { logger } = require('./logger');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

let Octokit;
try {
    Octokit = require('@octokit/rest').Octokit;
} catch (e) {
    logger.warn('Octokit not installed — npm install @octokit/rest for GitHub features');
}

class GitHubIntegration {
    constructor(deps = {}) {
        this.vault = deps.vault; // OAuthVault instance
        this.webhookHandlers = new Map();
        this.enabled = !!Octokit;
    }

    async getClient(userId = 'default') {
        if (!Octokit) throw new Error('Octokit not installed');
        if (!this.vault) throw new Error('OAuthVault dependency missing');

        const token = await this.vault.getAccessToken('github', userId);
        return new Octokit({ 
            auth: token, 
            userAgent: 'AgentOS/3.0.0'
        });
    }

    getOAuthURL(state) {
        const config = require('./config').OAUTH?.GITHUB;
        if (!config) throw new Error('GitHub OAuth config missing');

        const params = new URLSearchParams({
            client_id: config.CLIENT_ID,
            redirect_uri: config.REDIRECT_URI,
            scope: config.SCOPE,
            state: state || crypto.randomBytes(16).toString('hex'),
        });
        return `https://github.com/login/oauth/authorize?${params}`;
    }

    async handleCallback(code) {
        const config = require('./config').OAUTH?.GITHUB;
        if (!config) throw new Error('GitHub OAuth config missing');

        const response = await fetch('https://github.com/login/oauth/access_token', {
            method: 'POST',
            headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
            body: JSON.stringify({
                client_id: config.CLIENT_ID,
                client_secret: config.CLIENT_SECRET,
                code,
                redirect_uri: config.REDIRECT_URI,
            }),
        });

        const data = await response.json();
        if (!response.ok || data.error) throw new Error(`OAuth failed: ${data.error_description || data.error}`);

        const tempClient = new Octokit({ auth: data.access_token });
        const { data: user } = await tempClient.rest.users.getAuthenticated();

        await this.vault.storeTokens('github', user.login, {
            accessToken: data.access_token,
            refreshToken: data.refresh_token,
            expiresAt: data.expires_in ? Date.now() + data.expires_in * 1000 : null,
            scope: data.scope,
        });

        return { userId: user.login, avatar: user.avatar_url, name: user.name || user.login };
    }

    async pushFile(userId, owner, repo, filePath, content, message, branch = 'main') {
        const octokit = await this.getClient(userId);
        const { data: ref } = await octokit.rest.git.getRef({ owner, repo, ref: `heads/${branch}` });
        const { data: commit } = await octokit.rest.git.getCommit({ owner, repo, commit_sha: ref.object.sha });
        const { data: blob } = await octokit.rest.git.createBlob({ owner, repo, content: Buffer.from(content).toString('base64'), encoding: 'base64' });
        const { data: tree } = await octokit.rest.git.createTree({ owner, repo, base_tree: commit.tree.sha, tree: [{ path: filePath, mode: '100644', type: 'blob', sha: blob.sha }] });
        const { data: newCommit } = await octokit.rest.git.createCommit({ owner, repo, message: `[AgentOS] ${message}`, tree: tree.sha, parents: [commit.sha] });
        await octokit.rest.git.updateRef({ owner, repo, ref: `heads/${branch}`, sha: newCommit.sha });
        
        return { commit: newCommit.sha, url: `https://github.com/${owner}/${repo}/commit/${newCommit.sha}` };
    }

    async createPR(userId, owner, repo, title, body, head, base = 'main') {
        const octokit = await this.getClient(userId);
        const { data: pr } = await octokit.rest.pulls.create({ owner, repo, title: `[AgentOS] ${title}`, body, head, base });
        return { number: pr.number, url: pr.html_url, state: pr.state };
    }

    async listRepos(userId) {
        const octokit = await this.getClient(userId);
        const { data: repos } = await octokit.rest.repos.listForAuthenticatedUser({ sort: 'updated', per_page: 100 });
        return repos.map(r => ({ name: r.name, fullName: r.full_name, url: r.html_url, defaultBranch: r.default_branch, isPrivate: r.private, updatedAt: r.updated_at }));
    }

    handleWebhook(payload, signature) {
        const config = require('./config').OAUTH?.GITHUB;
        if (config?.WEBHOOK_SECRET && signature) {
            const hmac = crypto.createHmac('sha256', config.WEBHOOK_SECRET);
            hmac.update(typeof payload === 'string' ? payload : JSON.stringify(payload));
            const digest = `sha256=${hmac.digest('hex')}`;
            if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(digest))) {
                throw new Error('Invalid webhook signature');
            }
        }
        const event = payload.event || payload.headers?.['x-github-event'];
        const handlers = this.webhookHandlers.get(event) || [];
        handlers.forEach(h => h(payload).catch(err => logger.error(`Webhook handler error: ${err.message}`)));
        return { received: true, event };
    }

    onWebhookEvent(event, handler) {
        if (!this.webhookHandlers.has(event)) this.webhookHandlers.set(event, []);
        this.webhookHandlers.get(event).push(handler);
    }
}

module.exports = GitHubIntegration;
