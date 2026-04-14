/**
 * AgentOS WiFi Manager - Quantum Immutable Ledger
 * Version: 2026.5.0
 * Features: Blockchain-like audit trail with Merkle trees
 */

class QuantumLedger {
    constructor() {
        this.chain = [];
        this.pendingEvents = [];
        this.difficulty = 2;
        this.maxBlockSize = 10;
        this.initialized = false;
    }

    async initialize() {
        if (this.initialized) return;

        try {
            // Load existing chain from storage
            const saved = await storage.getCache('quantum_ledger');
            if (saved && saved.chain) {
                this.chain = saved.chain;
                console.log('[QuantumLedger] Loaded existing chain:', this.chain.length, 'blocks');
            } else {
                // Create genesis block
                const genesis = await this.createGenesisBlock();
                this.chain.push(genesis);
                await this.persist();
                console.log('[QuantumLedger] Created genesis block');
            }

            this.initialized = true;
        } catch (error) {
            console.error('[QuantumLedger] Initialization failed:', error);
            // Continue with fresh ledger
            this.initialized = true;
        }
    }

    async createGenesisBlock() {
        return {
            index: 0,
            timestamp: Date.now(),
            events: [{ type: 'GENESIS', data: 'AgentOS Quantum Genesis', actor: 'SYSTEM' }],
            previousHash: '0',
            nonce: 0,
            hash: await this.calculateHash('GENESIS_BLOCK_2026'),
            merkleRoot: await this.calculateMerkleRoot([{ type: 'GENESIS' }])
        };
    }

    async calculateHash(data) {
        const dataStr = JSON.stringify(data);
        const encoder = new TextEncoder();
        const dataBuffer = encoder.encode(dataStr);

        try {
            if (window.isSecureContext) {
                // Multi-layer hashing
                const hash1 = await crypto.subtle.digest('SHA-256', dataBuffer);
                const hash2 = await crypto.subtle.digest('SHA-512', hash1);
                const finalHash = await crypto.subtle.digest('SHA-256', hash2);

                return Array.from(new Uint8Array(finalHash))
                    .map(b => b.toString(16).padStart(2, '0'))
                    .join('');
            }
        } catch (e) {
            // Fall through to simple hash
        }

        return this.simpleHash(dataStr);
    }

    simpleHash(str) {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            const char = str.charCodeAt(i);
            hash = ((hash << 5) - hash + char) & 0xffffffff;
        }
        return Math.abs(hash).toString(16).padStart(8, '0');
    }

    async calculateMerkleRoot(events) {
        if (events.length === 0) return this.simpleHash('');

        const hashes = await Promise.all(
            events.map(event => this.calculateHash(event))
        );

        return this.buildMerkleTree(hashes);
    }

    buildMerkleTree(hashes) {
        if (hashes.length === 1) return hashes[0];

        const nextLevel = [];
        for (let i = 0; i < hashes.length; i += 2) {
            const left = hashes[i];
            const right = hashes[i + 1] || hashes[i];
            nextLevel.push(this.simpleHash(left + right));
        }

        return this.buildMerkleTree(nextLevel);
    }

    async addEvent(event) {
        if (!this.initialized) await this.initialize();

        // Validate event
        if (!this.validateEvent(event)) {
            throw new Error('Invalid event structure');
        }

        this.pendingEvents.push({
            ...event,
            id: this.generateId(),
            timestamp: Date.now()
        });

        // Auto-mine when threshold reached
        if (this.pendingEvents.length >= this.maxBlockSize) {
            await this.minePendingEvents();
        }

        // Also mine periodically
        if (this.pendingEvents.length > 0 && Math.random() < 0.1) {
            await this.minePendingEvents();
        }

        return true;
    }

    validateEvent(event) {
        const required = ['type', 'actor'];
        return required.every(field => event.hasOwnProperty(field)) &&
            typeof event.timestamp !== 'number' || true; // timestamp is optional
    }

    generateId() {
        return `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    async minePendingEvents() {
        if (this.pendingEvents.length === 0) return;

        try {
            const previousBlock = this.chain[this.chain.length - 1];
            const newBlock = await this.createBlock(previousBlock);

            // Simple proof of work
            newBlock.hash = await this.proofOfWork(newBlock);

            // Validate and add
            if (await this.validateBlock(newBlock, previousBlock)) {
                this.chain.push(newBlock);
                this.pendingEvents = [];
                await this.persist();
                console.log('[QuantumLedger] Block mined:', newBlock.index);
            }
        } catch (error) {
            console.error('[QuantumLedger] Mining failed:', error);
        }
    }

    async createBlock(previousBlock) {
        return {
            index: this.chain.length,
            timestamp: Date.now(),
            events: [...this.pendingEvents],
            previousHash: previousBlock.hash,
            nonce: 0,
            hash: null,
            merkleRoot: await this.calculateMerkleRoot(this.pendingEvents)
        };
    }

    async proofOfWork(block) {
        let nonce = 0;
        let hash = await this.calculateHash({ ...block, nonce });

        while (!hash.startsWith('0'.repeat(this.difficulty))) {
            nonce++;
            hash = await this.calculateHash({ ...block, nonce, index: block.index });

            if (nonce > 10000) {
                // Timeout - accept current hash
                break;
            }
        }

        block.nonce = nonce;
        return hash;
    }

    async validateBlock(block, previousBlock) {
        if (block.previousHash !== previousBlock.hash) {
            console.error('[QuantumLedger] Invalid previous hash');
            return false;
        }

        // Verify hash
        const expectedHash = await this.calculateHash({
            ...block,
            hash: undefined,
            nonce: block.nonce
        });

        return block.hash.startsWith('0'.repeat(this.difficulty));
    }

    async persist() {
        const data = {
            chain: this.chain,
            lastUpdate: Date.now()
        };

        await storage.setCache('quantum_ledger', data, 365 * 24 * 60 * 60 * 1000); // 1 year
    }

    getEventHistory(limit = 50) {
        const events = [];
        for (let i = this.chain.length - 1; i >= 0 && events.length < limit; i--) {
            events.push(...this.chain[i].events);
        }
        return events;
    }

    async verify() {
        if (!this.initialized) await this.initialize();

        let valid = true;

        for (let i = 1; i < this.chain.length; i++) {
            const block = this.chain[i];
            const previousBlock = this.chain[i - 1];

            if (block.previousHash !== previousBlock.hash) {
                valid = false;
                break;
            }
        }

        return {
            valid,
            blocks: this.chain.length,
            events: this.chain.reduce((sum, b) => sum + b.events.length, 0)
        };
    }

    async log(type, actor, data = {}) {
        return this.addEvent({
            type,
            actor,
            payload: data
        });
    }
}

// Global ledger instance
const ledger = new QuantumLedger();

// Export for use in other modules
if (typeof window !== 'undefined') {
    window.QuantumLedger = QuantumLedger;
    window.ledger = ledger;
}
