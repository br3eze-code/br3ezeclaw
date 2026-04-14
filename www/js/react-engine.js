/**
 * ReAct AskEngine - Decision Making Core
 * AgentOS Omni-Agent Component
 * Version: 2026.5.0
 * Purpose: Coordinates all tools and orchestrates complex multi-step workflows
 * Inspired by: ReAct (Reason + Act) pattern, LangChain-style chains
 */

class AskEngine {
    constructor() {
        this.version = '1.0.0';
        this.initialized = false;
        this.memory = new AgentMemory();
        this.tools = new Map();
        this.chains = new Map();
        this.orchestrator = null;
        this.oauthVault = null;
        this.slaveNodes = new Map();
    }

    async initialize(config = {}) {
        if (this.initialized) return;

        console.log('[AskEngine] Initializing ReAct decision engine...');

        this.masterUrl = config.masterUrl || 'ws://localhost:3000';
        this.agentId = config.agentId || 'agent_' + Date.now().toString(36);

        // Register built-in tools
        this.registerBuiltInTools();

        // Initialize memory
        await this.memory.initialize();

        this.initialized = true;
        console.log('[AskEngine] Decision engine initialized');
    }

    // §1 Tool Registry
    registerTool(name, definition) {
        const tool = {
            name,
            description: definition.description || '',
            parameters: definition.parameters || [],
            handler: definition.handler,
            category: definition.category || 'general',
            requiresAuth: definition.requiresAuth || [],
            aliases: definition.aliases || [],
            tags: definition.tags || []
        };

        this.tools.set(name, tool);

        // Register aliases
        tool.aliases.forEach(alias => {
            this.tools.set(alias, tool);
        });

        console.log(`[AskEngine] Tool registered: ${name}`);
        return tool;
    }

    registerBuiltInTools() {
        // System tools
        this.registerTool('system.status', {
            description: 'Get overall system status',
            category: 'system',
            handler: async () => ({
                status: 'operational',
                tools: this.tools.size,
                memory: this.memory.getStatus(),
                nodes: this.slaveNodes.size,
                timestamp: Date.now()
            })
        });

        this.registerTool('system.health', {
            description: 'Check system health',
            category: 'system',
            handler: async () => ({
                healthy: true,
                uptime: process?.uptime?.() || 0,
                timestamp: Date.now()
            })
        });

        // Orchestration tools
        this.registerTool('orchestrate', {
            description: 'Execute a workflow chain',
            category: 'orchestration',
            parameters: [
                { name: 'chain', type: 'string', required: true },
                { name: 'context', type: 'object', required: false }
            ],
            handler: async (params) => {
                return await this.runChain(params.chain, params.context);
            }
        });

        this.registerTool('plan', {
            description: 'Create execution plan from goal',
            category: 'orchestration',
            parameters: [
                { name: 'goal', type: 'string', required: true }
            ],
            handler: async (params) => {
                return await this.createPlan(params.goal);
            }
        });

        // OAuth tools
        this.registerTool('oauth.check', {
            description: 'Check OAuth connection status',
            category: 'oauth',
            handler: async () => {
                if (!this.oauthVault) return { connected: false };
                return this.oauthVault.getStatus();
            }
        });

        this.registerTool('oauth.connect', {
            description: 'Connect OAuth service',
            category: 'oauth',
            parameters: [
                { name: 'service', type: 'string', required: true }
            ],
            handler: async (params) => {
                if (!this.oauthVault) throw new Error('OAuth Vault not configured');
                return await this.oauthVault.initiateOAuthFlow(params.service);
            }
        });

        // Slave node tools
        this.registerTool('nodes.list', {
            description: 'List all connected slave nodes',
            category: 'nodes',
            handler: async () => {
                const nodes = [];
                this.slaveNodes.forEach((node, id) => {
                    nodes.push(node.getStatus());
                });
                return { nodes, count: nodes.length };
            }
        });

        this.registerTool('nodes.command', {
            description: 'Execute command on a slave node',
            category: 'nodes',
            parameters: [
                { name: 'nodeId', type: 'string', required: true },
                { name: 'command', type: 'string', required: true },
                { name: 'params', type: 'object', required: false }
            ],
            handler: async (params) => {
                const node = this.slaveNodes.get(params.nodeId);
                if (!node) throw new Error(`Node not found: ${params.nodeId}`);
                return await node.executeCommand(params.command, params.params);
            }
        });

        this.registerTool('nodes.broadcast', {
            description: 'Broadcast command to all nodes',
            category: 'nodes',
            parameters: [
                { name: 'command', type: 'string', required: true },
                { name: 'params', type: 'object', required: false }
            ],
            handler: async (params) => {
                const results = [];
                for (const [nodeId, node] of this.slaveNodes) {
                    try {
                        const result = await node.executeCommand(params.command, params.params);
                        results.push({ nodeId, success: true, result });
                    } catch (e) {
                        results.push({ nodeId, success: false, error: e.message });
                    }
                }
                return { results, total: results.length };
            }
        });

        // GitHub tools
        this.registerTool('github.repos', {
            description: 'List GitHub repositories',
            category: 'github',
            requiresAuth: ['github'],
            handler: async () => {
                if (!this.oauthVault) throw new Error('OAuth Vault not configured');
                const response = await this.oauthVault.githubRequest('/user/repos', {
                    method: 'GET'
                });
                return response.json();
            }
        });

        this.registerTool('github.push', {
            description: 'Push changes to GitHub',
            category: 'github',
            requiresAuth: ['github'],
            parameters: [
                { name: 'owner', type: 'string', required: true },
                { name: 'repo', type: 'string', required: true },
                { name: 'branch', type: 'string', required: true },
                { name: 'message', type: 'string', required: true }
            ],
            handler: async (params) => {
                // Complex operation requiring multiple steps
                return await this.runChain('github_push', params);
            }
        });

        // Router tools
        this.registerTool('router.status', {
            description: 'Get router connection status',
            category: 'router',
            handler: async () => {
                const result = await this.executeToolRemotely('router.status');
                return result;
            }
        });

        this.registerTool('router.discover', {
            description: 'Discover routers on network',
            category: 'router',
            parameters: [
                { name: 'subnet', type: 'string', required: false }
            ],
            handler: async (params) => {
                const result = await this.executeToolRemotely('router.discover', [params.subnet]);
                return result;
            }
        });

        // Voucher tools
        this.registerTool('voucher.create', {
            description: 'Create WiFi voucher',
            category: 'voucher',
            parameters: [
                { name: 'plan', type: 'string', required: true }
            ],
            handler: async (params) => {
                return await this.executeToolRemotely('voucher.create', [params.plan]);
            }
        });

        this.registerTool('voucher.stats', {
            description: 'Get voucher statistics',
            category: 'voucher',
            handler: async () => {
                return await this.executeToolRemotely('voucher.stats');
            }
        });

        console.log(`[AskEngine] ${this.tools.size} built-in tools registered`);
    }

    // §2 Plan Creation (Think Phase)
    async createPlan(goal) {
        console.log(`[AskEngine] Creating plan for: ${goal}`);

        // Analyze the goal
        const analysis = this.analyzeGoal(goal);

        // Generate steps
        const steps = this.generateSteps(analysis);

        // Validate dependencies
        const validatedSteps = this.validateDependencies(steps);

        return {
            goal,
            analysis,
            steps: validatedSteps,
            estimatedSteps: validatedSteps.length,
            createdAt: Date.now()
        };
    }

    analyzeGoal(goal) {
        const goalLower = goal.toLowerCase();

        const intents = [];
        const entities = [];
        const targets = [];
        const requirements = [];

        // Detect intents
        if (goalLower.includes('deploy') || goalLower.includes('update')) {
            intents.push('deploy');
        }
        if (goalLower.includes('check') || goalLower.includes('status')) {
            intents.push('query');
        }
        if (goalLower.includes('create') || goalLower.includes('new')) {
            intents.push('create');
        }
        if (goalLower.includes('push') || goalLower.includes('git')) {
            intents.push('git');
            targets.push('github');
        }
        if (goalLower.includes('router') || goalLower.includes('mikrotik')) {
            intents.push('hardware');
            targets.push('router');
        }
        if (goalLower.includes('voucher') || goalLower.includes('wifi')) {
            intents.push('wifi');
            targets.push('voucher');
        }
        if (goalLower.includes('all') || goalLower.includes('everywhere')) {
            targets.push('broadcast');
        }

        // Detect services
        if (goalLower.includes('github')) entities.push('github');
        if (goalLower.includes('vps')) entities.push('vps');
        if (goalLower.includes('pi')) entities.push('pi');

        return { intents, entities, targets, requirements };
    }

    generateSteps(analysis) {
        const steps = [];

        // OAuth check for services
        if (analysis.entities.includes('github')) {
            steps.push({
                order: steps.length + 1,
                action: 'oauth.check',
                tool: 'oauth.check',
                description: 'Verify GitHub OAuth status',
                required: true
            });
        }

        // Intent-based steps
        if (analysis.intents.includes('git')) {
            steps.push({
                order: steps.length + 1,
                action: 'github.pull',
                tool: 'github.pull',
                description: 'Pull latest code from GitHub',
                required: false
            });
        }

        if (analysis.intents.includes('deploy')) {
            if (analysis.targets.includes('vps')) {
                steps.push({
                    order: steps.length + 1,
                    action: 'nodes.command',
                    tool: 'nodes.command',
                    params: { target: 'vps' },
                    description: 'Push to VPS',
                    required: false
                });
            }

            if (analysis.targets.includes('pi')) {
                steps.push({
                    order: steps.length + 1,
                    action: 'nodes.command',
                    tool: 'nodes.command',
                    params: { target: 'pi' },
                    description: 'Push to Pi 5',
                    required: false
                });
            }
        }

        if (analysis.intents.includes('hardware')) {
            steps.push({
                order: steps.length + 1,
                action: 'router.discover',
                tool: 'router.discover',
                description: 'Discover MikroTik routers',
                required: true
            });
        }

        if (analysis.intents.includes('wifi')) {
            steps.push({
                order: steps.length + 1,
                action: 'voucher.stats',
                tool: 'voucher.stats',
                description: 'Check voucher status',
                required: true
            });
        }

        // Broadcast if "all" is mentioned
        if (analysis.targets.includes('broadcast')) {
            steps.push({
                order: steps.length + 1,
                action: 'nodes.broadcast',
                tool: 'nodes.broadcast',
                description: 'Execute on all nodes',
                required: true
            });
        }

        return steps;
    }

    validateDependencies(steps) {
        // Check that each step's required tools are available
        return steps.map(step => {
            const tool = this.tools.get(step.tool);
            return {
                ...step,
                available: !!tool,
                hasAuth: tool?.requiresAuth?.length === 0 ||
                    tool?.requiresAuth?.every(s => this.oauthVault?.tokens?.has(s))
            };
        });
    }

    // §3 Chain Execution (Act Phase)
    async runChain(chainName, context = {}) {
        const chain = this.chains.get(chainName);
        if (!chain) {
            throw new Error(`Chain not found: ${chainName}`);
        }

        console.log(`[AskEngine] Executing chain: ${chainName}`);

        const state = {
            ...context,
            results: [],
            errors: [],
            startedAt: Date.now()
        };

        for (const step of chain.steps) {
            try {
                const result = await this.executeStep(step, state);
                state.results.push({
                    step: step.name,
                    result,
                    success: true,
                    timestamp: Date.now()
                });
            } catch (error) {
                state.errors.push({
                    step: step.name,
                    error: error.message,
                    timestamp: Date.now()
                });

                if (step.required) {
                    throw error;
                }
            }
        }

        state.completedAt = Date.now();
        state.duration = state.completedAt - state.startedAt;

        return state;
    }

    async executeStep(step, state) {
        // Resolve tool
        const tool = this.tools.get(step.tool);
        if (!tool) {
            throw new Error(`Tool not found: ${step.tool}`);
        }

        // Check auth requirements
        if (tool.requiresAuth) {
            for (const service of tool.requiresAuth) {
                if (!this.oauthVault?.tokens?.has(service)) {
                    throw new Error(`OAuth required for: ${service}`);
                }
            }
        }

        // Resolve parameters
        const params = this.resolveParams(step.params || {}, state);

        // Execute
        const result = await tool.handler(params);

        // Store in memory
        await this.memory.store(`step_${step.name}`, result);

        return result;
    }

    resolveParams(params, state) {
        const resolved = {};
        for (const [key, value] of Object.entries(params)) {
            if (typeof value === 'string' && value.startsWith('$')) {
                // Reference to previous result
                const ref = value.substring(1);
                resolved[key] = state.results[ref]?.result?.[key] || state[ref];
            } else {
                resolved[key] = value;
            }
        }
        return resolved;
    }

    // §4 Tool Execution
    async execute(toolName, params = {}) {
        const tool = this.tools.get(toolName);
        if (!tool) {
            throw new Error(`Tool not found: ${toolName}`);
        }

        return await tool.handler(params);
    }

    async executeToolRemotely(toolName, params = []) {
        // Execute tool via server API
        try {
            const response = await fetch(`${this.masterUrl}/api/tool/execute`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${localStorage.getItem('api_token')}`
                },
                body: JSON.stringify({ tool: toolName, params })
            });

            if (!response.ok) {
                throw new Error(`Tool execution failed: ${response.statusText}`);
            }

            const data = await response.json();
            return data.result;
        } catch (error) {
            console.error(`[AskEngine] Remote execution failed:`, error);
            throw error;
        }
    }

    // §5 Chain Management
    registerChain(name, steps) {
        this.chains.set(name, {
            name,
            steps: steps.map((s, i) => ({
                name: s.name || s.tool,
                tool: s.tool,
                params: s.params || {},
                required: s.required !== false,
                order: i + 1
            })),
            createdAt: Date.now()
        });
        console.log(`[AskEngine] Chain registered: ${name}`);
    }

    // Register built-in chains
    registerBuiltInChains() {
        // GitHub push chain
        this.registerChain('github_push', [
            { name: 'oauth_check', tool: 'oauth.check' },
            { name: 'get_token', tool: 'oauth.get_token', params: { service: 'github' } },
            { name: 'create_commit', tool: 'github.push' }
        ]);

        // Router discovery chain
        this.registerChain('router_discovery', [
            { name: 'scan_network', tool: 'network.scan' },
            { name: 'check_mikrotik', tool: 'router.discover' },
            { name: 'log_results', tool: 'memory.store' }
        ]);

        // Multi-node deployment chain
        this.registerChain('multi_deploy', [
            { name: 'prepare', tool: 'system.status' },
            { name: 'deploy_vps', tool: 'nodes.command', params: { nodeId: 'vps' } },
            { name: 'deploy_pi', tool: 'nodes.command', params: { nodeId: 'pi' } },
            { name: 'verify', tool: 'system.health' }
        ]);

        console.log(`[AskEngine] ${this.chains.size} built-in chains registered`);
    }

    // §6 Memory Management
    async remember(key, value) {
        await this.memory.store(key, value);
    }

    async recall(key) {
        return await this.memory.recall(key);
    }

    async forget(key) {
        await this.memory.delete(key);
    }

    // §7 Integration Methods
    setOAuthVault(vault) {
        this.oauthVault = vault;
    }

    registerSlaveNode(nodeId, node) {
        this.slaveNodes.set(nodeId, node);
        console.log(`[AskEngine] Slave node registered: ${nodeId}`);
    }

    unregisterSlaveNode(nodeId) {
        this.slaveNodes.delete(nodeId);
        console.log(`[AskEngine] Slave node unregistered: ${nodeId}`);
    }

    // §8 Status
    getStatus() {
        return {
            version: this.version,
            initialized: this.initialized,
            tools: this.tools.size,
            chains: this.chains.size,
            nodes: this.slaveNodes.size,
            memory: this.memory.getStatus()
        };
    }
}

// §9 Agent Memory
class AgentMemory {
    constructor() {
        this.store = new Map();
        this.maxItems = 1000;
    }

    async initialize() {
        // Load from IndexedDB in browser
        if (typeof localStorage !== 'undefined') {
            try {
                const saved = localStorage.getItem('agent_memory');
                if (saved) {
                    const parsed = JSON.parse(saved);
                    this.store = new Map(parsed);
                }
            } catch (e) {
                console.warn('[AgentMemory] Failed to load memory:', e);
            }
        }
    }

    async store(key, value) {
        this.store.set(key, {
            value,
            timestamp: Date.now()
        });

        // Cleanup old items
        if (this.store.size > this.maxItems) {
            const oldest = [...this.store.entries()]
                .sort((a, b) => a[1].timestamp - b[1].timestamp)
                .slice(0, 100);

            oldest.forEach(([k]) => this.store.delete(k));
        }

        this.persist();
    }

    async recall(key) {
        const item = this.store.get(key);
        if (!item) return null;
        return item.value;
    }

    async delete(key) {
        this.store.delete(key);
        this.persist();
    }

    async search(pattern) {
        const results = [];
        const regex = new RegExp(pattern, 'i');

        for (const [key, item] of this.store) {
            if (regex.test(key) || regex.test(JSON.stringify(item.value))) {
                results.push({ key, ...item });
            }
        }

        return results;
    }

    getStatus() {
        return {
            items: this.store.size,
            oldest: Math.min(...[...this.store.values()].map(i => i.timestamp)),
            newest: Math.max(...[...this.store.values()].map(i => i.timestamp))
        };
    }

    persist() {
        if (typeof localStorage !== 'undefined') {
            try {
                const data = [...this.store.entries()];
                localStorage.setItem('agent_memory', JSON.stringify(data));
            } catch (e) {
                console.warn('[AgentMemory] Failed to persist:', e);
            }
        }
    }
}

// Global instance
const askEngine = new AskEngine();

// Export
if (typeof window !== 'undefined') {
    window.AskEngine = AskEngine;
    window.AgentMemory = AgentMemory;
    window.askEngine = askEngine;
}

export { AskEngine, AgentMemory, askEngine };
