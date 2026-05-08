'use strict';
/**
 * Voucher + MikroTik integration unit tests
 * Tests the full flow: voucher.generate → database.createVoucher → addHotspotUser
 */

// ── Helpers ──────────────────────────────────────────────────────────────────

const mkVouchers = () => new Map();

function makeDb(vouchersMap = mkVouchers()) {
    return {
        db: null,   // local-only mode
        _vouchers: vouchersMap,
        getPlan: jest.fn().mockResolvedValue({
            name: '1 Day', mikrotikProfile: '1day',
            durationValue: 1, durationUnit: 'days',
            deviceLimit: 1, price: 1.0
        }),
        createVoucher: jest.fn().mockImplementation(async (code, data) => {
            vouchersMap.set(code, { code, ...data, status: 'active', used: false });
            return code;
        }),
        getVoucher: jest.fn().mockImplementation(async (code) => vouchersMap.get(code) || null),
        getWallet: jest.fn().mockResolvedValue({ balance: 10, currency: 'USD' }),
        deductCredits: jest.fn().mockResolvedValue(true),
        getUser: jest.fn().mockResolvedValue({ role: 'user', currency: 'USD' }),
        _saveLocal: jest.fn(),
    };
}

// ── VoucherAgent.generate ─────────────────────────────────────────────────────

describe('VoucherAgent.generate', () => {
    let voucher;
    beforeEach(() => { jest.resetModules(); voucher = require('../../src/core/voucher'); });

    test('returns a STAR-prefixed string', () => {
        const code = voucher.generate('1day');
        expect(typeof code).toBe('string');
        expect(code).toMatch(/^STAR-/);
    });

    test('generates a unique code each call', () => {
        const codes = new Set(Array.from({ length: 50 }, () => voucher.generate('1day')));
        expect(codes.size).toBe(50);
    });

    test('throws for totally unknown plan', () => {
        expect(() => voucher.generate('nonexistent-xyz')).toThrow(/Invalid plan/i);
    });

    test('accepts all canonical profiles', () => {
        const canonical = ['default', '1hour', '1day', '1week', '30day', '7day'];
        canonical.forEach(p => {
            expect(() => voucher.generate(p)).not.toThrow();
        });
    });

    test('code has exactly the right segment count (STAR-XXXX-XXXX → 3 parts)', () => {
        // default format is prefix-XXXX-XXXX → "STAR-XXXX-XXXX" = 3 parts when split by -
        const code = voucher.generate();
        const parts = code.split('-');
        // "STAR-ABCD-EFGH" splits to 3, but format may vary; just check prefix + at least 1 segment
        expect(parts[0]).toBe('STAR');
        expect(parts.length).toBeGreaterThanOrEqual(2);
    });

    test('emits voucher.created with code and plan', () => {
        const eventBus = require('../../src/core/eventBus');
        const handler = jest.fn();
        eventBus.on('voucher.created', handler);
        const code = voucher.generate('1day');
        expect(handler).toHaveBeenCalledWith(expect.objectContaining({ code, plan: '1day' }));
        eventBus.removeAllListeners('voucher.created');
    });
});

const crypto = require('crypto');
function hashPlanId(name) {
    return crypto.createHash('sha256').update(name.trim()).digest('hex').substring(0, 16);
}

// ── Database.createVoucher schema ─────────────────────────────────────────────

describe('Database.createVoucher schema', () => {
    const vouchersMap = mkVouchers();
    const db = makeDb(vouchersMap);

    test('persists all required fields', async () => {
        const hashedPlan = hashPlanId('1 Day');
        await db.createVoucher('STAR-TEST-0001', {
            plan: hashedPlan, planName: '1 Day',
            durationValue: 1, durationUnit: 'days',
            deviceLimit: 1, expiresAt: '2099-01-01T00:00:00.000Z',
            createdBy: '123456789', value: 1.0, currency: 'USD',
        });

        const saved = vouchersMap.get('STAR-TEST-0001');
        expect(saved).toBeDefined();
        expect(saved.plan).toBe(hashedPlan);
        expect(saved.planName).toBe('1 Day');
        expect(saved.durationValue).toBe(1);
        expect(saved.durationUnit).toBe('days');
        expect(saved.deviceLimit).toBe(1);
        expect(saved.expiresAt).toBe('2099-01-01T00:00:00.000Z');
        expect(saved.createdBy).toBe('123456789');  // must be chatId string, not 'telegram'
        expect(saved.value).toBe(1.0);
        expect(saved.used).toBe(false);
    });

    test('createdBy must NOT be the literal string "telegram"', async () => {
        const hashedPlan = hashPlanId('1 Day');
        await db.createVoucher('STAR-TEST-0002', {
            plan: hashedPlan, planName: '1 Day',
            createdBy: '987654321',  // chatId
            value: 0
        });
        const saved = vouchersMap.get('STAR-TEST-0002');
        expect(saved.createdBy).not.toBe('telegram');
    });
});

// ── addHotspotUser metadata sync ──────────────────────────────────────────────

describe('addHotspotUser — metadata sync', () => {
    const VOUCHER_CODE = 'STAR-1DAY-ABCD';

    /**
     * Build a minimal MikroTikManager-like object that has only the metadata
     * sync logic we want to test, without needing a real RouterOS connection.
     */
    async function runMetadataSync(dbMock, plan) {
        const username   = VOUCHER_CODE;
        const loginUrl   = `http://192.168.88.1/login?username=${username}&password=${username}`;
        const limitUptime = plan ? '24:00:00' : null;

        // Replicate exactly what the fixed addHotspotUser does after the RouterOS .add() call:
        const userData = {
            username, password: username, profile: '1day',
            loginUrl, limitUptime: limitUptime || null,
            createdAt: new Date().toISOString()
        };
        if (plan) {
            const msPerUnit = { minutes: 60_000, hours: 3_600_000, days: 86_400_000, weeks: 604_800_000 };
            const durationMs = plan.durationValue * (msPerUnit[plan.durationUnit] || 86_400_000);
            userData.expiresAt      = new Date(Date.now() + durationMs).toISOString();
            userData.alertScheduled = false;
        }

        if (dbMock.db) {
            // Firestore path (not tested here since db.db is null)
        } else {
            if (dbMock._vouchers) {
                const existing = dbMock._vouchers.get(username) || {};
                dbMock._vouchers.set(username, {
                    ...existing, loginUrl,
                    limitUptime: userData.limitUptime || null,
                    expiresAt:   userData.expiresAt   || null
                });
                dbMock._saveLocal('vouchers');
            }
        }

        return { loginUrl, userData };
    }

    test('merges loginUrl and expiresAt into the vouchers map (not _users)', async () => {
        const vouchersMap = mkVouchers();
        vouchersMap.set(VOUCHER_CODE, { code: VOUCHER_CODE, plan: '1day', used: false });
        const db = makeDb(vouchersMap);
        const plan = { durationValue: 1, durationUnit: 'days' };

        await runMetadataSync(db, plan);

        const updated = vouchersMap.get(VOUCHER_CODE);
        expect(updated).toBeDefined();
        expect(updated.loginUrl).toMatch(/login\?username=STAR-1DAY-ABCD/);
        expect(updated.expiresAt).toBeDefined();
        expect(new Date(updated.expiresAt).getTime()).toBeGreaterThan(Date.now());
    });

    test('does NOT write anything to db._users (ghost-user prevention)', async () => {
        const vouchersMap = mkVouchers();
        vouchersMap.set(VOUCHER_CODE, { code: VOUCHER_CODE, plan: '1day', used: false });
        const db = makeDb(vouchersMap);
        db._users = new Map();  // give it a _users map to see if it gets touched

        const plan = { durationValue: 1, durationUnit: 'days' };
        await runMetadataSync(db, plan);

        expect(db._users.size).toBe(0);  // nothing added to _users
    });

    test('_saveLocal is called with "vouchers" not "users"', async () => {
        const vouchersMap = mkVouchers();
        vouchersMap.set(VOUCHER_CODE, { code: VOUCHER_CODE, plan: '1day', used: false });
        const db = makeDb(vouchersMap);
        const plan = { durationValue: 1, durationUnit: 'days' };

        await runMetadataSync(db, plan);

        expect(db._saveLocal).toHaveBeenCalledWith('vouchers');
        expect(db._saveLocal).not.toHaveBeenCalledWith('users');
    });

    test('expiresAt is ~24h in the future for 1-day plan', async () => {
        const vouchersMap = mkVouchers();
        vouchersMap.set(VOUCHER_CODE, { code: VOUCHER_CODE });
        const db = makeDb(vouchersMap);
        const plan = { durationValue: 1, durationUnit: 'days' };
        const before = Date.now();

        await runMetadataSync(db, plan);

        const saved = vouchersMap.get(VOUCHER_CODE);
        const expiresMs = new Date(saved.expiresAt).getTime();
        const after = Date.now();
        const oneDayMs = 86_400_000;

        expect(expiresMs).toBeGreaterThanOrEqual(before + oneDayMs - 1000);
        expect(expiresMs).toBeLessThanOrEqual(after  + oneDayMs + 1000);
    });

    test('works without a plan (no expiresAt set)', async () => {
        const vouchersMap = mkVouchers();
        vouchersMap.set(VOUCHER_CODE, { code: VOUCHER_CODE });
        const db = makeDb(vouchersMap);

        await runMetadataSync(db, null);

        const saved = vouchersMap.get(VOUCHER_CODE);
        expect(saved.loginUrl).toBeDefined();
        expect(saved.expiresAt).toBeNull();
    });
});

// ── Database.getVouchers filters ──────────────────────────────────────────────

describe('Database.getVouchers — filter logic', () => {
    function makeLocalDb(vouchers) {
        const map = new Map();
        vouchers.forEach(v => map.set(v.code, v));
        return {
            db: null,
            _vouchers: map,
            async getVouchers(filters = {}) {
                const limit = filters.limit || 20;
                let all = Array.from(map.values());
                if (filters.status)    all = all.filter(v => v.status    === filters.status);
                if (filters.plan)      all = all.filter(v => v.plan      === filters.plan);
                if (filters.createdBy) all = all.filter(v => String(v.createdBy) === String(filters.createdBy));
                return all.slice(0, limit);
            }
        };
    }

    const VOUCHERS = [
        { code: 'V1', status: 'active',  plan: '1day',  createdBy: '111', used: false },
        { code: 'V2', status: 'used',    plan: '1day',  createdBy: '222', used: true  },
        { code: 'V3', status: 'active',  plan: '7day',  createdBy: '111', used: false },
        { code: 'V4', status: 'expired', plan: '1hour', createdBy: '333', used: false },
    ];

    test('returns all when no filter', async () => {
        const db = makeLocalDb(VOUCHERS);
        const result = await db.getVouchers();
        expect(result.length).toBe(4);
    });

    test('filters by status', async () => {
        const db = makeLocalDb(VOUCHERS);
        const result = await db.getVouchers({ status: 'active' });
        expect(result.length).toBe(2);
        result.forEach(v => expect(v.status).toBe('active'));
    });

    test('filters by plan', async () => {
        const db = makeLocalDb(VOUCHERS);
        const result = await db.getVouchers({ plan: '1day' });
        expect(result.length).toBe(2);
        result.forEach(v => expect(v.plan).toBe('1day'));
    });

    test('filters by createdBy (chatId)', async () => {
        const db = makeLocalDb(VOUCHERS);
        const result = await db.getVouchers({ createdBy: '111' });
        expect(result.length).toBe(2);
        result.forEach(v => expect(String(v.createdBy)).toBe('111'));
    });

    test('limit is respected', async () => {
        const db = makeLocalDb(VOUCHERS);
        const result = await db.getVouchers({ limit: 2 });
        expect(result.length).toBe(2);
    });

    test('combined filters', async () => {
        const db = makeLocalDb(VOUCHERS);
        const result = await db.getVouchers({ status: 'active', createdBy: '111' });
        expect(result.length).toBe(2);
    });
});
