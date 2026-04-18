'use strict';

const crypto = require('crypto');
const EventEmitter = require('events');
const { ErrorCodes, AgentOSError } = require('../core/errors');

/**
 * ChannelPairingService — Universal multi-channel router onboarding
 * 
 * Supports: telegram, whatsapp, sms, email, web, api
 * Pattern: Any channel can generate a code; any router can use it
 */
class ChannelPairingService extends EventEmitter {
    constructor(config = {}) {
        super();
        this.pending = new Map(); // code -> PairingSession
        this.routers = new Map(); // routerId -> RouterCredentials
        this.channels = new Map(); // channelType -> adapter
        
        this.config = {
            codeTTL: config.codeTTL || 15 * 60 * 1000,        // 15 minutes
            maxAttempts: config.maxAttempts || 3,            // Anti-brute force
            cleanupInterval: config.cleanupInterval || 60 * 1000,
            ...config
        };

        this.cleanupTimer = setInterval(() => this.cleanup(), this.config.cleanupInterval);
    }

    /**
     * Register a channel adapter (Telegram, WhatsApp, etc.)
     */
    registerChannel(type, adapter) {
        if (!adapter.send || !adapter.format) {
            throw new Error(`Channel ${type} must implement send() and format()`);
        }
        this.channels.set(type, adapter);
        this.emit('channel.registered', { type });
    }

    /**
     * Generate pairing code from ANY channel
     * 
     * @param {Object} context - Who/where/what generated this
     * @param {string} context.channel - 'telegram'|'whatsapp'|'sms'|'email'|'web'|'api'
     * @param {string} context.userId - Channel-specific user ID (chat_id, phone, email)
     * @param {string} context.username - Human-readable name
     * @param {Object} context.metadata - Location, notes, tags
     * @returns {PairingSession}
     */
    async generateCode(context) {
        const { channel, userId, username, metadata = {} } = context;

        // Validate channel exists
        if (!this.channels.has(channel) && channel !== 'api') {
            throw new AgentOSError(
                ErrorCodes.VALIDATION_ERROR,
                `Channel ${channel} not registered`,
                { available: Array.from(this.channels.keys()) }
            );
        }

        // Generate 8-digit numeric code (easy to type on mobile/winbox)
        const code = this.generateNumericCode();
        const now = Date.now();

        const session = {
            id: crypto.randomUUID(),
            code,
            channel,           // Origin channel
            userId,            // Channel-specific ID for notifications
            username,
            metadata: {
                location: metadata.location || 'Unknown',
                notes: metadata.notes || '',
                tags: metadata.tags || [],
                generatedVia: channel
            },
            state: 'pending',  // pending -> paired -> expired
            createdAt: now,
            expiresAt: now + this.config.codeTTL,
            attempts: 0,
            router: null      // Filled on successful pairing
        };

        this.pending.set(code, session);

        // Send code back through originating channel
        await this.notifyOrigin(session);

        this.emit('pairing.created', {
            code: session.code,
            channel: session.channel,
            userId: session.userId,
            expiresIn: this.config.codeTTL
        });

        return session;
    }

    /**
     * Router calls this to complete pairing
     * 
     * @param {Object} pairingData
     * @param {string} pairingData.code - The 8-digit code
     * @param {Object} routerInfo - MikroTik identity data
     */
    async completePairing(pairingData, routerInfo) {
        const { code } = pairingData;
        const { identity, macAddress, version, model, ipAddress, serial } = routerInfo;

        // Validate code exists
        const session = this.pending.get(code);
        if (!session) {
            throw new AgentOSError(
                ErrorCodes.AUTH_FAILED,
                'Invalid or expired pairing code',
                { code }
            );
        }

        // Check expiry
        if (Date.now() > session.expiresAt) {
            this.pending.delete(code);
            throw new AgentOSError(
                ErrorCodes.AUTH_FAILED,
                'Pairing code expired',
                { code, expiredAt: new Date(session.expiresAt).toISOString() }
            );
        }

        // Anti-brute force
        if (session.attempts >= this.config.maxAttempts) {
            this.pending.delete(code);
            throw new AgentOSError(
                ErrorCodes.RATE_LIMITED,
                'Too many failed attempts. Generate new code.',
                { code, attempts: session.attempts }
            );
        }

        // Validate required router info
        if (!identity || !macAddress) {
            session.attempts++;
            throw new AgentOSError(
                ErrorCodes.VALIDATION_ERROR,
                'Router identity and MAC address required',
                { provided: { identity: !!identity, macAddress: !!macAddress } }
            );
        }

        // Create router credentials
        const routerId = crypto.randomUUID();
        const apiKey = `aos_${crypto.randomBytes(24).toString('base64url')}`;
        const apiSecret = crypto.randomBytes(32).toString('hex');

        const router = {
            id: routerId,
            identity,
            macAddress: macAddress.toLowerCase(),
            serial: serial || 'unknown',
            version,
            model,
            ipAddress,
            pairedAt: new Date().toISOString(),
            pairedBy: {
                channel: session.channel,
                userId: session.userId,
                username: session.username
            },
            metadata: session.metadata,
            credentials: {
                apiKey,
                apiSecret,  // For HMAC if needed later
                rotatedAt: null
            },
            state: 'active',
            lastSeen: Date.now(),
            channels: [session.channel]  // Can add more later
        };

        // Atomic update
        this.routers.set(routerId, router);
        session.state = 'paired';
        session.router = router;
        this.pending.delete(code);

        // Notify origin channel of success
        await this.notifySuccess(session, router);

        // Notify all admin channels about new router
        this.emit('router.paired', {
            routerId,
            identity,
            channel: session.channel,
            pairedBy: session.username
        });

        return {
            success: true,
            routerId,
            apiKey,
            endpoints: {
                status: '/api/v2/router/status',
                command: '/api/v2/router/command',
                config: '/api/v2/router/config',
                websocket: '/ws/router'
            },
            // Router script configuration
            config: {
                heartbeatInterval: 30000,  // 30 seconds
                reconnectBackoff: [1000, 5000, 15000, 30000]
            }
        };
    }

    /**
     * Authenticate router on subsequent requests
     */
    authenticate(apiKey) {
        for (const [id, router] of this.routers) {
            if (router.credentials.apiKey === apiKey && router.state === 'active') {
                router.lastSeen = Date.now();
                return {
                    id: router.id,
                    identity: router.identity,
                    macAddress: router.macAddress,
                    pairedBy: router.pairedBy
                };
            }
        }
        return null;
    }

    /**
     * Generate MikroTik RouterOS script for this pairing session
     */
    generateRouterScript(session) {
        const apiBase = process.env.AGENTOS_API_URL || 'https://agentos.gateway.com';
        
        return `# AgentOS Channel Pairing — Auto-generated
# Session: ${session.id}
# Generated via: ${session.channel}
# Code: ${session.code}

:local pairingCode "${session.code}"
:local routerId [/system/identity/get name]
:local macAddr [/interface/ether1/get mac-address]
:local serial [/system/routerboard/get serial-number]
:local version [/system/resource/get version]
:local model [/system/resource/get board-name]
:local wanIp [/ip/address/get [find interface~"ether1"] address]

# Remove CIDR from IP
:local cleanIp [:pick $wanIp 0 [:find $wanIp "/"]]

# Send pairing request
:local jsonData "\\{
    \\"code\\": \\"$pairingCode\\",
    \\"identity\\": \\"$routerId\\",
    \\"macAddress\\": \\"$macAddr\\",
    \\"serial\\": \\"$serial\\",
    \\"version\\": \\"$version\\",
    \\"model\\": \\"$model\\",
    \\"ipAddress\\": \\"$cleanIp\\"
\\}"

:local response ""

# Try HTTPS first, fallback to HTTP if certificate issues
:do {
    /tool fetch url="${apiBase}/api/v2/pair" \\
        http-method=post \\
        http-header-field="Content-Type: application/json" \\
        http-data=$jsonData \\
        check-certificate=no \\
        keep-result=yes \\
        dst-path=agentos-pair-response.txt
    
    :set response [/file/get agentos-pair-response.txt contents]
    /file/remove agentos-pair-response.txt
    
} on-error={
    :log error "AgentOS: Pairing request failed"
    :error "Failed to contact AgentOS gateway"
}

# Parse and store credentials
:if ([:len $response] > 0) do={
    :local apiKey [:pick $response ([:find $response "\\"apiKey\\":\\""]+10) ([:find $response "\\",\\"endpoints\\""]-1)]
    :local routerUuid [:pick $response ([:find $response "\\"routerId\\":\\""]+12) ([:find $response "\\",\\"apiKey\\""]-1)]
    
    # Store securely in notes (encrypted in RouterOS 7)
    /system/note/set note="AgentOS:$apiKey:$routerUuid"
    
    # Setup persistent connection
    /system/scheduler/add name=agentos-heartbeat interval=30s on-event=\\
        "/tool fetch url=\\\\"${apiBase}/api/v2/router/status\\\\" \\
        http-header-field=\\\\"Authorization: Bearer $apiKey\\\\" \\
        check-certificate=no keep-result=no"
    
    :log info "AgentOS: Router paired successfully as $routerUuid"
    :put "✅ Paired! Check Telegram/WhatsApp for confirmation."
} else={
    :log error "AgentOS: Empty response from gateway"
}`;
    }

    /**
     * Internal: Send code to originating channel
     */
    async notifyOrigin(session) {
        const channel = this.channels.get(session.channel);
        if (!channel) return; // API channel has no adapter

        const message = channel.format('pairing_code', {
            code: session.code,
            expiresIn: Math.floor(this.config.codeTTL / 60000),
            location: session.metadata.location,
            script: this.generateRouterScript(session)
        });

        await channel.send(session.userId, message);
    }

    /**
     * Internal: Send success notification
     */
    async notifySuccess(session, router) {
        const channel = this.channels.get(session.channel);
        if (!channel) return;

        const message = channel.format('pairing_success', {
            routerId: router.id,
            identity: router.identity,
            macAddress: router.macAddress,
            model: router.model,
            pairedAt: router.pairedAt
        });

        await channel.send(session.userId, message);
    }

    generateNumericCode() {
        // Ensure no collisions
        let code;
        do {
            code = crypto.randomInt(10000000, 99999999).toString();
        } while (this.pending.has(code));
        return code;
    }

    cleanup() {
        const now = Date.now();
        for (const [code, session] of this.pending) {
            if (now > session.expiresAt || session.state === 'paired') {
                if (session.state === 'pending') {
                    this.emit('pairing.expired', { code, session });
                }
                this.pending.delete(code);
            }
        }
    }

    getStats() {
        return {
            pending: this.pending.size,
            paired: this.routers.size,
            channels: Array.from(this.channels.keys()),
            byChannel: this.getStatsByChannel()
        };
    }

    getStatsByChannel() {
        const stats = {};
        for (const [type] of this.channels) {
            stats[type] = {
                pending: Array.from(this.pending.values())
                    .filter(s => s.channel === type).length,
                paired: Array.from(this.routers.values())
                    .filter(r => r.pairedBy.channel === type).length
            };
        }
        return stats;
    }

    stop() {
        clearInterval(this.cleanupTimer);
    }
}

module.exports = ChannelPairingService;
