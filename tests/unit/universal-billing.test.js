'use strict';

// ── Mock logger (guardHotspot uses logger, not console.error) ─────────────────
jest.mock('../../src/core/logger', () => ({
    logger: {
        info:  jest.fn(),
        warn:  jest.fn(),
        error: jest.fn(),
        debug: jest.fn(),
        cyber: jest.fn(),
        audit: jest.fn()
    }
}));

const { logger } = require('../../src/core/logger');
const UniversalBilling = require('../../src/core/universal-billing');

// ── Shared factory helpers ────────────────────────────────────────────────────

/** Build a mockDb whose PHASE 2/3 lists are empty by default */
function makeDb(overrides = {}) {
    return {
        getVoucher:          jest.fn().mockResolvedValue(null),
        resolveUser:         jest.fn().mockResolvedValue(null),
        expireVoucher:       jest.fn().mockResolvedValue(true),
        getVouchersByStatus: jest.fn().mockResolvedValue([]),   // PHASE 2 & 3
        getUsersByStatus:    jest.fn().mockResolvedValue([]),
        ...overrides
    };
}

/** Build a mockMikrotik connected by default */
function makeMikrotik(overrides = {}) {
    return {
        state:             { isConnected: true },
        executeTool:       jest.fn().mockResolvedValue([]),     // users.report & user.kick
        disableHotspotUser: jest.fn().mockResolvedValue({ success: true }),
        enableHotspotUser:  jest.fn().mockResolvedValue({ success: true }),
        ...overrides
    };
}

// ── Suite ─────────────────────────────────────────────────────────────────────

describe('UniversalBilling — guardHotspot / reaper', () => {
    let billing, mockDb, mockMikrotik;

    beforeEach(() => {
        mockDb       = makeDb();
        mockMikrotik = makeMikrotik();
        global.mikrotik = mockMikrotik;
        billing = new UniversalBilling({ database: mockDb, mikrotik: mockMikrotik });
    });

    afterEach(() => {
        delete global.mikrotik;
        jest.clearAllMocks();
    });

    // ── Smoke ─────────────────────────────────────────────────────────────────

    test('smoke: guardHotspot resolves without throwing when nothing to do', async () => {
        mockMikrotik.executeTool.mockResolvedValue([]);
        await expect(billing.guardHotspot()).resolves.toBeUndefined();
    });

    // ── Expiry enforcement ────────────────────────────────────────────────────

    test('kicks and disables active users whose voucher is expired', async () => {
        mockMikrotik.executeTool.mockImplementation(async (tool) => {
            if (tool === 'users.report') return [
                { username: 'user1', isActive: true,  disabled: false },
                { username: 'user2', isActive: true,  disabled: false }
            ];
            return { kicked: true }; // user.kick
        });

        mockDb.getVoucher.mockImplementation(async (u) => ({
            code: u, status: 'active',
            expiresAt: new Date(Date.now() - 1000).toISOString()
        }));

        // Force both to show as expired
        billing.checkVoucherStatus = jest.fn().mockResolvedValue({ expired: true, reason: 'time_expired' });

        await billing.guardHotspot();

        // Both kicked via executeTool
        expect(mockMikrotik.executeTool).toHaveBeenCalledWith('user.kick', { username: 'user1' });
        expect(mockMikrotik.executeTool).toHaveBeenCalledWith('user.kick', { username: 'user2' });
        // Both disabled on router
        expect(mockMikrotik.executeTool).toHaveBeenCalledWith('user.disable', { username: 'user1' });
        expect(mockMikrotik.executeTool).toHaveBeenCalledWith('user.disable', { username: 'user2' });
        // Both marked expired in DB
        expect(mockDb.expireVoucher).toHaveBeenCalledWith('user1');
        expect(mockDb.expireVoucher).toHaveBeenCalledWith('user2');
    });

    test('does NOT kick an inactive user, but still disables and expires them', async () => {
        mockMikrotik.executeTool.mockImplementation(async (tool) => {
            if (tool === 'users.report') return [
                { username: 'idle', isActive: false, disabled: false }
            ];
            return {};
        });

        mockDb.getVoucher.mockResolvedValue({ code: 'idle', status: 'active' });
        billing.checkVoucherStatus = jest.fn().mockResolvedValue({ expired: true, reason: 'time_expired' });

        await billing.guardHotspot();

        // No kick (not active)
        expect(mockMikrotik.executeTool).not.toHaveBeenCalledWith('user.kick', expect.anything());
        // Still disabled
        expect(mockMikrotik.executeTool).toHaveBeenCalledWith('user.disable', { username: 'idle' });
        expect(mockDb.expireVoucher).toHaveBeenCalledWith('idle');
    });

    // ── Resilience ────────────────────────────────────────────────────────────

    test('continues processing remaining users if disableHotspotUser throws for one', async () => {
        mockMikrotik.executeTool.mockImplementation(async (tool) => {
            if (tool === 'users.report') return [
                { username: 'user1', isActive: true, disabled: false },
                { username: 'user2', isActive: true, disabled: false }
            ];
            return { kicked: true };
        });

        mockDb.getVoucher.mockImplementation(async (u) => ({ code: u, status: 'active' }));
        billing.checkVoucherStatus = jest.fn().mockResolvedValue({ expired: true, reason: 'test' });

        // user1 disable explodes — user2 must still be processed
        mockMikrotik.executeTool.mockImplementation(async (tool, args) => {
            if (tool === 'users.report') return [
                { username: 'user1', isActive: true, disabled: false },
                { username: 'user2', isActive: true, disabled: false }
            ];
            if (tool === 'user.disable' && args.username === 'user1') throw new Error('Router ID missing');
            return { kicked: true };
        });

        await billing.guardHotspot();

        // user2 still fully processed
        expect(mockMikrotik.executeTool).toHaveBeenCalledWith('user.disable', { username: 'user2' });
        expect(mockDb.expireVoucher).toHaveBeenCalledWith('user2');

        // user1 error was logged via logger (not console)
        expect(logger.error).toHaveBeenCalledWith(
            expect.stringContaining('Failed to process user user1'),
            expect.objectContaining({ error: 'Router ID missing' })
        );

        // user1 expireVoucher NOT called (throw aborted that user's try block)
        expect(mockDb.expireVoucher).not.toHaveBeenCalledWith('user1');
    });

    // ── Recovery (re-enable) ──────────────────────────────────────────────────

    test('re-enables a user that is disabled on router but has a valid voucher', async () => {
        mockMikrotik.executeTool.mockImplementation(async (tool) => {
            if (tool === 'users.report') return [
                { username: 'valid', isActive: false, disabled: true }
            ];
            return {};
        });

        mockDb.getVoucher.mockResolvedValue({
            code: 'valid', status: 'active',
            expiresAt: new Date(Date.now() + 86_400_000).toISOString()
        });
        // Not expired
        billing.checkVoucherStatus = jest.fn().mockResolvedValue({ expired: false, reason: null });

        await billing.guardHotspot();

        expect(mockMikrotik.executeTool).toHaveBeenCalledWith('user.enable', { username: 'valid' });
        expect(mockMikrotik.executeTool).not.toHaveBeenCalledWith('user.disable', expect.anything());
        expect(mockDb.expireVoucher).not.toHaveBeenCalled();
    });

    // ── System user guard ─────────────────────────────────────────────────────

    test('never touches system users (admin, default, root)', async () => {
        mockMikrotik.executeTool.mockImplementation(async (tool) => {
            if (tool === 'users.report') return [
                { username: 'admin',   isActive: true, disabled: false },
                { username: 'default', isActive: true, disabled: false },
                { username: 'root',    isActive: true, disabled: false }
            ];
            return {};
        });

        billing.checkVoucherStatus = jest.fn().mockResolvedValue({ expired: true, reason: 'time_expired' });

        await billing.guardHotspot();

        expect(mockMikrotik.executeTool).not.toHaveBeenCalledWith('user.disable', expect.anything());
        expect(mockMikrotik.executeTool).not.toHaveBeenCalledWith('user.kick', expect.anything());
        expect(billing.checkVoucherStatus).not.toHaveBeenCalled();
    });

    // ── PHASE 2 — Expired sweep ───────────────────────────────────────────────

    test('PHASE 2: disables users whose voucher is already marked expired in DB', async () => {
        mockMikrotik.executeTool.mockResolvedValue([]); // no live router users

        mockDb.getVouchersByStatus.mockImplementation(async (status) => {
            if (status === 'expired') return [{ code: 'old1' }, { code: 'old2' }];
            return [];
        });

        await billing.guardHotspot();

        expect(mockMikrotik.executeTool).toHaveBeenCalledWith('user.disable', { username: 'old1' });
        expect(mockMikrotik.executeTool).toHaveBeenCalledWith('user.disable', { username: 'old2' });
    });

    // ── PHASE 3 — Active parity audit ────────────────────────────────────────

    test('PHASE 3: expires DB-active vouchers that have passed their expiry date', async () => {
        mockMikrotik.executeTool.mockResolvedValue([]); // no live router users

        mockDb.getVouchersByStatus.mockImplementation(async (status) => {
            if (status === 'active') return [
                { code: 'stale', expiresAt: new Date(Date.now() - 5000).toISOString() }
            ];
            return [];
        });

        // Real checkVoucherStatus (not mocked) should detect time_expired
        await billing.guardHotspot();

        expect(mockDb.expireVoucher).toHaveBeenCalledWith('stale');
        expect(mockMikrotik.executeTool).toHaveBeenCalledWith('user.disable', { username: 'stale' });
    });

    // ── Guard: MikroTik disconnected ──────────────────────────────────────────

    test('skips run gracefully when MikroTik is not connected', async () => {
        mockMikrotik.state.isConnected = false;

        await billing.guardHotspot();

        expect(mockMikrotik.executeTool).not.toHaveBeenCalled();
        expect(mockMikrotik.executeTool).not.toHaveBeenCalledWith('user.disable', expect.anything());
    });
});
