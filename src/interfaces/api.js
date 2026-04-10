// src/interfaces/api.js
const express = require('express');
const config = require('../core/config');
const mikrotik = require('../agents/mikrotik.agent');
const router = express.Router();

router.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        service: 'AgentOS',
        version: config.version,
        mikrotik: mikrotik.isConnected ? 'connected' : 'disconnected'
    });
});

router.get('/users/active', async (req, res) => {
    const users = await mikrotik.getActiveUsers();
    res.json(users);
});

router.post('/users/add', async (req, res) => {
    const { username, password, profile } = req.body;
    await mikrotik.addUser(username, password, profile);
    res.json({ success: true });
});

router.post('/users/remove', async (req, res) => {
    const { username } = req.body;
    await mikrotik.removeUser(username);
    res.json({ success: true });
});

router.post('/users/kick', async (req, res) => {
    const { username } = req.body;
    await mikrotik.kickUser(username);
    res.json({ success: true });
});

router.get('/users/all', async (req, res) => {
    const users = await mikrotik.getAllUsers();
    res.json(users);
});

router.get('/users/status', async (req, res) => {
    const { username } = req.query;
    const status = await mikrotik.getUserStatus(username);
    res.json(status);
});

router.get('/system/stats', async (req, res) => {
    const stats = await mikrotik.getSystemStats();
    res.json(stats);
});

router.get('/system/logs', async (req, res) => {
    const logs = await mikrotik.getLogs();
    res.json(logs);
});

router.post('/system/reboot', async (req, res) => {
    await mikrotik.reboot();
    res.json({ success: true });
});

router.post('/ping', async (req, res) => {
    const { host } = req.body;
    const result = await mikrotik.ping(host);
    res.json(result);
});

router.post('/traceroute', async (req, res) => {
    const { host } = req.body;
    const result = await mikrotik.traceroute(host);
    res.json(result);
});

router.get('/firewall/list', async (req, res) => {
    const rules = await mikrotik.getFirewallRules();
    res.json(rules);
});

router.post('/firewall/block', async (req, res) => {
    const { ip } = req.body;
    await mikrotik.addToBlockList(ip);
    res.json({ success: true });
});

router.get('/dhcp/leases', async (req, res) => {
    const leases = await mikrotik.getDhcpLeases();
    res.json(leases);
});

router.get('/sessions', (req, res) => {
    const sessions = sessionManager.getAllSessions();
    res.json(sessions);
});

router.post('/voucher/generate', (req, res) => {
    const { plan } = req.body;
    const code = voucherAgent.generate(plan);
    res.json({ code });
});

router.post('/voucher/redeem', (req, res) => {
    const { code, user } = req.body;
    voucherAgent.redeem(code, user);
    res.json({ success: true });
});

const app = express();
app.use(express.json());

const auth = (req, res, next) => {
    if (req.headers['x-api-key'] !== config.security.apiKey) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    next();
};

app.post('/user', auth, async (req, res) => {
    const { username, password, profile } = req.body;
    await mikrotik.addUser(username, password, profile);
    res.json({ status: 'created' });
});

module.exports = app;

module.exports = (agent) => {

    router.post('/execute', async (req, res) => {
        try {
            const result = await agent.handle(req.body);
            res.json({ success: true, result });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    return router;
};