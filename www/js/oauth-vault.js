/**
 * OAuth Vault - Secure Token Storage & Management
 * AgentOS Omni-Agent Component
 * Version: 2026.5.0
 * Purpose: Centralized secure storage for OAuth tokens (GitHub, etc.)
 */

class OAuthVault {
    constructor() {
        this.version = '1.0.0';
        this.initialized = false;
        this.services = new Map();
        this.tokens = new Map();
        this.refreshQueue = new Map();
        this.auditLog = [];
    }

    async initialize() {
        if (this.initialized) return;

        console.log('[OAuthVault] Initializing secure vault...');

        // Load persisted tokens from storage
        await this.loadTokens();

        this.initialized = true;
        console.log('[OAuthVault] Vault initialized');
    }

    // §1 Service Registration
    registerService(serviceId, config) {
        const service = {
            id: serviceId,
            name: config.name || serviceId,
            authUrl: config.authUrl,
            tokenUrl: config.tokenUrl,
            scopes: config.scopes || [],
            clientId: config.clientId,
            redirectUri: config.redirectUri,
            refreshBefore: config.refreshBefore || 3600000, // 1 hour before expiry
            createdAt: Date.now(),
            lastUsed: null
        };

        this.services.set(serviceId, service);
        console.log(`[OAuthVault] Service registered: ${serviceId}`);

        return service;
    }

    // §2 Token Storage
    storeToken(serviceId, tokenData) {
        const token = {
            accessToken: tokenData.accessToken,
            refreshToken: tokenData.refreshToken,
            tokenType: tokenData.tokenType || 'Bearer',
            expiresAt: tokenData.expiresAt || Date.now() + 3600000,
            scope: tokenData.scope,
            createdAt: Date.now(),
            usedAt: null
        };

        this.tokens.set(serviceId, token);

        // Update service last used
        const service = this.services.get(serviceId);
        if (service) {
            service.lastUsed = Date.now();
        }

        // Log to audit
        this.auditLog.push({
            action: 'token.store',
            service: serviceId,
            timestamp: Date.now()
        });

        console.log(`[OAuthVault] Token stored for ${serviceId}`);
        return token;
    }

    // §3 Token Retrieval with Auto-Refresh
    async getToken(serviceId, forceRefresh = false) {
        const token = this.tokens.get(serviceId);
        const service = this.services.get(serviceId);

        if (!token) {
            throw new Error(`No token found for service: ${serviceId}`);
        }

        // Check if token needs refresh
        const timeUntilExpiry = token.expiresAt - Date.now();
        const shouldRefresh = forceRefresh ||
            timeUntilExpiry < service.refreshBefore ||
            timeUntilExpiry <= 0;

        if (shouldRefresh && token.refreshToken) {
            console.log(`[OAuthVault] Refreshing token for ${serviceId}...`);
            return await this.refreshToken(serviceId);
        }

        token.usedAt = Date.now();
        return token;
    }

    // §4 Token Refresh
    async refreshToken(serviceId) {
        const token = this.tokens.get(serviceId);
        const service = this.services.get(serviceId);

        if (!token || !token.refreshToken || !service) {
            throw new Error(`Cannot refresh: missing token or service for ${serviceId}`);
        }

        try {
            // Queue refresh to prevent race conditions
            if (this.refreshQueue.has(serviceId)) {
                console.log(`[OAuthVault] Refresh already queued for ${serviceId}`);
                return this.refreshQueue.get(serviceId);
            }

            const refreshPromise = this.doRefresh(serviceId, token.refreshToken, service);
            this.refreshQueue.set(serviceId, refreshPromise);

            const newToken = await refreshPromise;
            this.refreshQueue.delete(serviceId);

            return newToken;

        } catch (error) {
            this.refreshQueue.delete(serviceId);
            console.error(`[OAuthVault] Token refresh failed for ${serviceId}:`, error.message);
            throw error;
        }
    }

    async doRefresh(serviceId, refreshToken, service) {
        const params = new URLSearchParams({
            grant_type: 'refresh_token',
            refresh_token: refreshToken,
            client_id: service.clientId
        });

        const response = await fetch(service.tokenUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Accept': 'application/json'
            },
            body: params.toString()
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(`Token refresh failed: ${error.error_description || error.error}`);
        }

        const tokenData = await response.json();
        const newToken = {
            accessToken: tokenData.access_token,
            refreshToken: tokenData.refresh_token || refreshToken, // Keep old if not provided
            tokenType: tokenData.token_type || 'Bearer',
            expiresAt: Date.now() + (tokenData.expires_in * 1000),
            scope: tokenData.scope || token.scope,
            createdAt: Date.now(),
            usedAt: null
        };

        this.tokens.set(serviceId, newToken);

        // Log refresh
        this.auditLog.push({
            action: 'token.refresh',
            service: serviceId,
            timestamp: Date.now()
        });

        console.log(`[OAuthVault] Token refreshed for ${serviceId}`);
        return newToken;
    }

    // §5 OAuth Flow Handlers
    async initiateOAuthFlow(serviceId) {
        const service = this.services.get(serviceId);
        if (!service) {
            throw new Error(`Service not registered: ${serviceId}`);
        }

        const params = new URLSearchParams({
            client_id: service.clientId,
            redirect_uri: service.redirectUri,
            scope: service.scopes.join(' '),
            response_type: 'code'
        });

        const authUrl = `${service.authUrl}?${params.toString()}`;

        // Log initiation
        this.auditLog.push({
            action: 'oauth.initiate',
            service: serviceId,
            authUrl: authUrl.split('?')[0], // Don't log full URL with params
            timestamp: Date.now()
        });

        return {
            authUrl,
            state: this.generateState(serviceId)
        };
    }

    async handleOAuthCallback(serviceId, code, state) {
        const service = this.services.get(serviceId);
        if (!service) {
            throw new Error(`Service not registered: ${serviceId}`);
        }

        // Validate state
        if (!this.validateState(state, serviceId)) {
            throw new Error('Invalid OAuth state - possible CSRF attack');
        }

        // Exchange code for token
        const params = new URLSearchParams({
            grant_type: 'authorization_code',
            code: code,
            redirect_uri: service.redirectUri,
            client_id: service.clientId
        });

        const response = await fetch(service.tokenUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Accept': 'application/json'
            },
            body: params.toString()
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(`Token exchange failed: ${error.error_description || error.error}`);
        }

        const tokenData = await response.json();
        const token = this.storeToken(serviceId, {
            accessToken: tokenData.access_token,
            refreshToken: tokenData.refresh_token,
            tokenType: tokenData.token_type || 'Bearer',
            expiresAt: Date.now() + (tokenData.expires_in * 1000),
            scope: tokenData.scope
        });

        return token;
    }

    // §6 State Management (CSRF Protection)
    generateState(serviceId) {
        const state = {
            service: serviceId,
            nonce: this.generateNonce(),
            timestamp: Date.now()
        };

        const stateStr = JSON.stringify(state);
        const stateBase64 = btoa(stateStr);

        // Store state for validation
        sessionStorage.setItem(`oauth_state_${stateBase64}`, stateStr);

        return stateBase64;
    }

    validateState(stateBase64, serviceId) {
        try {
            const stateStr = atob(stateBase64);
            const state = JSON.parse(stateStr);

            // Check service matches
            if (state.service !== serviceId) {
                return false;
            }

            // Check timestamp is not too old (10 minutes)
            if (Date.now() - state.timestamp > 600000) {
                return false;
            }

            // Clear used state
            sessionStorage.removeItem(`oauth_state_${stateBase64}`);

            return true;
        } catch {
            return false;
        }
    }

    generateNonce() {
        const array = new Uint8Array(16);
        crypto.getRandomValues(array);
        return Array.from(array, b => b.toString(16).padStart(2, '0')).join('');
    }

    // §7 Service-Specific Methods
    async githubRequest(serviceId, endpoint, options = {}) {
        const token = await this.getToken(serviceId);

        const response = await fetch(`https://api.github.com${endpoint}`, {
            ...options,
            headers: {
                ...options.headers,
                'Authorization': `${token.tokenType} ${token.accessToken}`,
                'Accept': 'application/vnd.github.v3+json'
            }
        });

        if (response.status === 401) {
            // Token expired, try refresh and retry
            const newToken = await this.getToken(serviceId, true);
            return fetch(`https://api.github.com${endpoint}`, {
                ...options,
                headers: {
                    ...options.headers,
                    'Authorization': `${newToken.tokenType} ${newToken.accessToken}`,
                    'Accept': 'application/vnd.github.v3+json'
                }
            });
        }

        return response;
    }

    // §8 Token Revocation
    async revokeToken(serviceId) {
        const token = this.tokens.get(serviceId);
        const service = this.services.get(serviceId);

        if (token && service) {
            try {
                const params = new URLSearchParams({
                    token: token.accessToken
                });

                await fetch(`${service.tokenUrl}/revoke`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                    body: params.toString()
                });
            } catch (error) {
                console.warn(`[OAuthVault] Token revocation warning for ${serviceId}:`, error.message);
            }
        }

        this.tokens.delete(serviceId);

        this.auditLog.push({
            action: 'token.revoke',
            service: serviceId,
            timestamp: Date.now()
        });

        console.log(`[OAuthVault] Token revoked for ${serviceId}`);
    }

    // §9 Persistence
    async saveTokens() {
        const data = {
            services: Array.from(this.services.entries()),
            savedAt: Date.now()
        };

        // Don't persist access tokens - only refresh tokens
        const safeData = {
            ...data,
            tokens: Array.from(this.tokens.entries()).map(([key, token]) => [
                key,
                {
                    refreshToken: token.refreshToken,
                    expiresAt: token.expiresAt,
                    scope: token.scope
                }
            ])
        };

        await storage.setSecure('oauth_vault', JSON.stringify(safeData));
        console.log('[OAuthVault] Tokens saved');
    }

    async loadTokens() {
        try {
            const data = await storage.getSecure('oauth_vault');
            if (data) {
                const parsed = JSON.parse(data);
                this.services = new Map(parsed.services);

                for (const [serviceId, tokenData] of parsed.tokens) {
                    this.tokens.set(serviceId, {
                        ...tokenData,
                        accessToken: null, // Never persist access tokens
                        createdAt: Date.now(),
                        usedAt: null
                    });
                }

                console.log('[OAuthVault] Tokens loaded');
            }
        } catch (error) {
            console.error('[OAuthVault] Failed to load tokens:', error.message);
        }
    }

    // §10 Vault Status
    getStatus() {
        const serviceList = [];
        this.services.forEach((service, id) => {
            const token = this.tokens.get(id);
            serviceList.push({
                id,
                name: service.name,
                connected: !!token,
                expiresAt: token?.expiresAt,
                lastUsed: service.lastUsed
            });
        });

        return {
            version: this.version,
            services: serviceList.length,
            connected: Array.from(this.tokens.keys()),
            auditEntries: this.auditLog.length
        };
    }
}

// Global vault instance
const oauthVault = new OAuthVault();

// Export
if (typeof window !== 'undefined') {
    window.OAuthVault = OAuthVault;
    window.oauthVault = oauthVault;
}

export { OAuthVault, oauthVault };
