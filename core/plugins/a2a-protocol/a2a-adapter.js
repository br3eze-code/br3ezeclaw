/**
 * AgentOS A2A Protocol Adapter v1.1 - Br3eze Edition
 * Fixed: SPIRE path, error codes, streaming, session cleanup, event emissions
 */

const crypto = require('crypto');
const { EventEmitter } = require('events');
const { AgentIdentity } = require('./agent-identity');
const { ModelArmor } = require('./model-armor');
const { GrpcTransport } = require('./grpc-transport');

class A2AError extends Error {
    constructor(code, message) {
        super(message);
        this.code = code;
        this.name = 'A2AError';
    }
}
class A2AProtocolAdapter extends EventEmitter {
    constructor(config) {
        super();
        this.config = {
            ...config,                                      // spread first — explicit keys below take priority
            protocolVersion: '1.0',
            spiffeID: config.spiffeID,
            trustedAgents: config.trustedAgents || [],
            capabilities: config.capabilities || [],
            mTLS: config.mTLS || { enabled: true, certPath: '/spiffe/certs' },
            rateLimiting: config.rateLimiting || { requestsPerMinute: 120, burstSize: 20 },
            modelArmor: config.modelArmor || { enabled: true },
            sessionTTL: config.sessionTTL || 3600000,
        };

        this.identity = new AgentIdentity(this.config.spiffeID, this.config.mTLS);
        this.modelArmor = new ModelArmor(this.config.modelArmor);
        this.transport = new GrpcTransport(this.config.mTLS);
        this.activeSessions = new Map();
        this.rateLimitBuckets = new Map();
        this.capabilityRegistry = new Map();
        this.agentDirectory = new Map();
        this.streamStates = new Map(); // streamId -> state

        this.config.capabilities.forEach(cap => this.capabilityRegistry.set(cap.name, cap));
        this.config.trustedAgents.forEach(agent => this.agentDirectory.set(agent.spiffeID, agent));
    }

    async initialize() {
        await this.identity.loadCredentials();
        await this.modelArmor.initialize();
        await this.transport.initialize();
        this.startRateLimitCleanup();
        this.startSessionCleanup();
        await this.announceCapabilities();
        this.emit('ready');
        return this;
    }

    stop() {
        if (this.rateLimitInterval) clearInterval(this.rateLimitInterval);
        if (this.sessionInterval) clearInterval(this.sessionInterval);
        this.emit('stopped');
    }

    async sendTask(targetAgentSPIFFE, task) {
        const startTime = Date.now();
        if (!this.isTrustedAgent(targetAgentSPIFFE)) {
            throw new A2AError('PERMISSION_DENIED', `Agent ${targetAgentSPIFFE} not trusted`);
        }
        if (!this.checkRateLimit(targetAgentSPIFFE)) {
            throw new A2AError('RESOURCE_EXHAUSTED', 'Rate limit exceeded');
        }
        const screenedTask = await this.modelArmor.screenInput(task);
        if (screenedTask.blocked) {
            throw new A2AError('INVALID_ARGUMENT', `Content blocked: ${screenedTask.reason}`);
        }

        const messageId = crypto.randomUUID();
        const message = this.buildMessageEnvelope({
            type: 'TASK_REQUEST',
            sender: this.config.spiffeID,
            recipient: targetAgentSPIFFE,
            task: screenedTask.content,
            timestamp: new Date().toISOString(),
            messageId,
            traceId: task.traceId || crypto.randomUUID()
        });

        const signedMessage = await this.identity.signMessage(message);
        this.emit('task:sent', { targetAgentSPIFFE, messageId, capability: task.capability });

        try {
            const response = await this.transport.send(signedMessage, targetAgentSPIFFE);
            const verifiedResponse = await this.identity.verifyMessage(response, targetAgentSPIFFE);
            const screenedResponse = await this.modelArmor.screenOutput(verifiedResponse);
            if (screenedResponse.blocked) {
                throw new A2AError('INVALID_ARGUMENT', `Output blocked: ${screenedResponse.reason}`);
            }
            this.emit('task:complete', { targetAgentSPIFFE, messageId, duration: Date.now() - startTime });
            // screenOutput returns { blocked, content } — extract the actual response result
            const responsePayload = screenedResponse.content;
            return responsePayload?.result ?? responsePayload;
        } catch (error) {
            this.emit('task:error', { targetAgentSPIFFE, messageId, error: error.message });
            throw new A2AError('INTERNAL', `Transport failed: ${error.message}`);
        }
    }

    async *sendStreamingTask(targetAgentSPIFFE, task) {
        if (!this.isTrustedAgent(targetAgentSPIFFE)) {
            throw new A2AError('PERMISSION_DENIED', `Agent ${targetAgentSPIFFE} not trusted`);
        }
        const streamId = crypto.randomUUID();
        const traceId = task.traceId || crypto.randomUUID();
        const message = this.buildMessageEnvelope({
            type: 'TASK_STREAM_REQUEST',
            sender: this.config.spiffeID,
            recipient: targetAgentSPIFFE,
            task,
            streamId,
            traceId,
            timestamp: new Date().toISOString(),
            messageId: crypto.randomUUID()
        });
        const signedMessage = await this.identity.signMessage(message);
        await this.transport.send(signedMessage, targetAgentSPIFFE);

        while (true) {
            const statusMsg = this.buildMessageEnvelope({
                type: 'TASK_STREAM_STATUS',
                sender: this.config.spiffeID,
                recipient: targetAgentSPIFFE,
                streamId,
                traceId,
                messageId: crypto.randomUUID()
            });
            const rawResp = await this.transport.send(await this.identity.signMessage(statusMsg), targetAgentSPIFFE);
            const statusResp = await this.identity.verifyMessage(rawResp, targetAgentSPIFFE);
            
            if (statusResp.type === 'TASK_STREAM_UPDATE') yield statusResp.update;
            if (statusResp.type === 'TASK_STREAM_COMPLETE') {
                yield statusResp.result;
                break;
            }
            if (statusResp.type === 'ERROR') throw new A2AError(statusResp.error.code, statusResp.error.message);
            await new Promise(r => setTimeout(r, 500));
        }
    }

    async handleIncomingMessage(rawMessage) {
        try {
            const senderSPIFFE = rawMessage.sender;
            if (!senderSPIFFE) return await this.buildErrorResponse('Missing sender', 'INVALID_ARGUMENT');
            const verifiedMessage = await this.identity.verifyMessage(rawMessage, senderSPIFFE);
            if (!this.isTrustedAgent(senderSPIFFE)) {
                return await this.buildErrorResponse(`Untrusted agent: ${senderSPIFFE}`, 'PERMISSION_DENIED');
            }
            const screenedMessage = await this.modelArmor.screenInput(verifiedMessage);
            if (screenedMessage.blocked) {
                return await this.buildErrorResponse(screenedMessage.reason, 'INVALID_ARGUMENT');
            }
            this.emit('message:received', { type: verifiedMessage.type, from: senderSPIFFE });

            switch (verifiedMessage.type) {
                case 'TASK_REQUEST': return await this.handleTaskRequest(verifiedMessage);
                case 'TASK_STREAM_REQUEST': return await this.handleStreamingTaskRequest(verifiedMessage);
                case 'TASK_STREAM_STATUS': return await this.handleStreamStatus(verifiedMessage);
                case 'CAPABILITY_QUERY': return await this.handleCapabilityQuery(verifiedMessage);
                case 'CAPABILITY_ANNOUNCE': return await this.handleCapabilityAnnounce(verifiedMessage);
                case 'HEALTH_CHECK': return await this.handleHealthCheck(verifiedMessage);
                default: return await this.buildErrorResponse(`Unknown type: ${verifiedMessage.type}`, 'UNIMPLEMENTED');
            }
        } catch (error) {
            return await this.buildErrorResponse(error.message, error.code || 'INTERNAL');
        }
    }

    async handleTaskRequest(message) {
        const { task, messageId, traceId } = message;
        const { capability, parameters } = task;
        if (!this.capabilityRegistry.has(capability)) {
            return await this.buildErrorResponse(`Capability '${capability}' not found`, 'NOT_FOUND');
        }
        const capDef = this.capabilityRegistry.get(capability);
        const validation = this.validateParameters(parameters, capDef.inputSchema);
        if (!validation.valid) {
            return await this.buildErrorResponse(`Validation failed: ${validation.errors.join(', ')}`, 'INVALID_ARGUMENT');
        }
        try {
            const session = this.getOrCreateSession(messageId, traceId);
            // Pass adapter as 4th arg so handlers can make outbound A2A calls
            const result = await capDef.handler(parameters, session, message.sender, this);
            session.history.push({ capability, parameters, result, timestamp: Date.now(), from: message.sender });
            const response = this.buildMessageEnvelope({
                type: 'TASK_RESPONSE',
                sender: this.config.spiffeID,
                recipient: message.sender,
                inReplyTo: messageId,
                traceId,
                result,
                timestamp: new Date().toISOString(),
                messageId: crypto.randomUUID()
            });
            return await this.identity.signMessage(response);
        } catch (error) {
            return await this.buildErrorResponse(error.message, 'INTERNAL');
        }
    }

    async handleStreamingTaskRequest(message) {
        const { task, streamId, traceId } = message;
        const { capability, parameters } = task;
        if (!this.capabilityRegistry.has(capability)) {
            return await this.buildErrorResponse(`Capability '${capability}' not found`, 'NOT_FOUND');
        }
        const capDef = this.capabilityRegistry.get(capability);
        if (!capDef.streamingHandler) {
            return await this.buildErrorResponse(`Capability '${capability}' does not support streaming`, 'UNIMPLEMENTED');
        }
        this.runStreamingCapability(capDef, parameters, message, streamId, traceId);
        const response = this.buildMessageEnvelope({
            type: 'TASK_STREAM_ACK',
            sender: this.config.spiffeID,
            recipient: message.sender,
            inReplyTo: message.messageId,
            streamId,
            traceId,
            timestamp: new Date().toISOString(),
            messageId: crypto.randomUUID()
        });
        return await this.identity.signMessage(response);
    }

    async handleStreamStatus(message) {
        const { streamId } = message;
        const state = this.streamStates.get(streamId);
        if (!state) return await this.buildErrorResponse('Stream not found', 'NOT_FOUND');
        if (state.error) return await this.buildErrorResponse(state.error.message, 'INTERNAL');
        if (state.complete) {
            const completeMsg = this.buildMessageEnvelope({
                type: 'TASK_STREAM_COMPLETE',
                sender: this.config.spiffeID,
                recipient: message.sender,
                streamId,
                result: state.result,
                timestamp: new Date().toISOString(),
                messageId: crypto.randomUUID()
            });
            return await this.identity.signMessage(completeMsg);
        }
        const update = state.queue.shift();
        if (update) {
            const updateMsg = this.buildMessageEnvelope({
                type: 'TASK_STREAM_UPDATE',
                sender: this.config.spiffeID,
                recipient: message.sender,
                streamId,
                update,
                timestamp: new Date().toISOString(),
                messageId: crypto.randomUUID()
            });
            return await this.identity.signMessage(updateMsg);
        }
        const pendingMsg = this.buildMessageEnvelope({
            type: 'TASK_STREAM_PENDING',
            sender: this.config.spiffeID,
            recipient: message.sender,
            streamId,
            timestamp: new Date().toISOString(),
            messageId: crypto.randomUUID()
        });
        return await this.identity.signMessage(pendingMsg);
    }

    async runStreamingCapability(capDef, parameters, originalMessage, streamId, traceId) {
        const session = this.getOrCreateSession(streamId, traceId);
        const state = { queue: [], complete: false, error: null, result: null, totalUpdates: 0 };
        this.streamStates.set(streamId, state);
        try {
            for await (const update of capDef.streamingHandler(parameters, session, originalMessage.sender)) {
                state.queue.push(update);
                state.totalUpdates++;      // count before queue is drained by consumers
            }
            state.result = { totalUpdates: state.totalUpdates };
            state.complete = true;
        } catch (error) {
            state.error = error;
        }
    }

    async handleCapabilityQuery(message) {
        const capabilities = Array.from(this.capabilityRegistry.values()).map(cap => ({
            name: cap.name,
            description: cap.description,
            inputSchema: cap.inputSchema,
            version: cap.version || '1.0',
            streaming: !!cap.streamingHandler
        }));
        const response = this.buildMessageEnvelope({
            type: 'CAPABILITY_RESPONSE',
            sender: this.config.spiffeID,
            recipient: message.sender,
            inReplyTo: message.messageId,
            capabilities,
            timestamp: new Date().toISOString(),
            messageId: crypto.randomUUID()
        });
        return await this.identity.signMessage(response);
    }

    async handleCapabilityAnnounce(message) {
        const { capabilities, sender } = message;
        this.agentDirectory.set(sender, {
            spiffeID: sender,
            capabilities: capabilities.map(c => c.name),
            lastSeen: Date.now()
        });
        this.emit('capability:announced', { agent: sender, capabilities });
        
        const response = this.buildMessageEnvelope({
            type: 'ACK',
            sender: this.config.spiffeID,
            recipient: sender,
            inReplyTo: message.messageId,
            timestamp: new Date().toISOString(),
            messageId: crypto.randomUUID()
        });
        return await this.identity.signMessage(response);
    }

    async handleHealthCheck(message) {
        const response = this.buildMessageEnvelope({
            type: 'HEALTH_RESPONSE',
            sender: this.config.spiffeID,
            recipient: message.sender,
            inReplyTo: message.messageId,
            status: 'healthy',
            capabilities: this.capabilityRegistry.size,
            activeSessions: this.activeSessions.size,
            timestamp: new Date().toISOString(),
            messageId: crypto.randomUUID()
        });
        return await this.identity.signMessage(response);
    }

    async announceCapabilities() {
        const capabilities = Array.from(this.capabilityRegistry.values()).map(cap => ({
            name: cap.name,
            description: cap.description,
            inputSchema: cap.inputSchema,
            version: cap.version || '1.0',
            streaming: !!cap.streamingHandler
        }));
        for (const agent of this.config.trustedAgents) {
            try {
                const announce = this.buildMessageEnvelope({
                    type: 'CAPABILITY_ANNOUNCE',
                    sender: this.config.spiffeID,
                    recipient: agent.spiffeID,
                    capabilities,
                    timestamp: new Date().toISOString(),
                    messageId: crypto.randomUUID()
                });
                await this.transport.send(await this.identity.signMessage(announce), agent.spiffeID);
            } catch (error) {
                if (!error.message.includes('not found in harness')) {
                    console.warn(` Announce failed for ${agent.spiffeID}:`, error.message);
                }
            }
        }
    }

    registerCapability(name, definition, handler, streamingHandler) {
        this.capabilityRegistry.set(name, { ...definition, handler, streamingHandler });
        this.emit('capability:registered', { name });
    }

    getOrCreateSession(sessionId, traceId) {
        if (!this.activeSessions.has(sessionId)) {
            this.activeSessions.set(sessionId, {
                id: sessionId,
                traceId,
                createdAt: Date.now(),
                lastActivity: Date.now(),
                context: {},
                history: []
            });
        }
        const session = this.activeSessions.get(sessionId);
        session.lastActivity = Date.now();
        return session;
    }

    isTrustedAgent(spiffeID) {
        return this.agentDirectory.has(spiffeID);
    }

    checkRateLimit(targetSPIFFE) {
        const now = Date.now();
        const maxRequests = this.config.rateLimiting.requestsPerMinute;
        if (!this.rateLimitBuckets.has(targetSPIFFE)) this.rateLimitBuckets.set(targetSPIFFE, []);
        const bucket = this.rateLimitBuckets.get(targetSPIFFE);
        const validWindow = bucket.filter(time => now - time < 60000);
        if (validWindow.length >= maxRequests) return false;
        validWindow.push(now);
        this.rateLimitBuckets.set(targetSPIFFE, validWindow);
        return true;
    }

    startRateLimitCleanup() {
        this.rateLimitInterval = setInterval(() => {
            const now = Date.now();
            for (const [spiffeID, bucket] of this.rateLimitBuckets) {
                const valid = bucket.filter(time => now - time < 60000);
                valid.length === 0 ? this.rateLimitBuckets.delete(spiffeID) : this.rateLimitBuckets.set(spiffeID, valid);
            }
        }, 30000);
        if (this.rateLimitInterval.unref) this.rateLimitInterval.unref();
    }

    startSessionCleanup() {
        this.sessionInterval = setInterval(() => {
            const now = Date.now();
            for (const [sessionId, session] of this.activeSessions) {
                if (now - session.lastActivity > this.config.sessionTTL) {
                    this.activeSessions.delete(sessionId);
                    this.emit('session:expired', { sessionId });
                }
            }
            for (const [streamId, state] of this.streamStates) {
                if (state.complete && state.queue.length === 0) this.streamStates.delete(streamId);
            }
        }, 60000);
        if (this.sessionInterval.unref) this.sessionInterval.unref();
    }

    validateParameters(params, schema) {
        const errors = [];
        if (schema?.required) {
            for (const req of schema.required) {
                if (!(req in params)) errors.push(`Missing: ${req}`);
            }
        }
        return { valid: errors.length === 0, errors };
    }

    buildMessageEnvelope(payload) {
        return { protocol: 'A2A', protocolVersion: this.config.protocolVersion, ...payload, _signature: null };
    }

    async buildErrorResponse(message, code) {
        const payload = {
            type: 'ERROR',
            sender: this.config.spiffeID,
            error: { code, message, timestamp: new Date().toISOString() }
        };
        return await this.identity.signMessage(payload);
    }
}


module.exports = { A2AProtocolAdapter, A2AError };
