// src/services/vouchers.js

const db = require('../storage/db');

class VoucherService {

    generateCode() {
        return "AG-" + Math.random().toString(36).substr(2, 6).toUpperCase();
    }

    async create(plan) {
        const code = this.generateCode();

        const voucher = {
            code,
            plan,
            used: false,
            createdAt: Date.now()
        };

        await db.save(code, voucher);
        return voucher;
    }

    async redeem(code, username) {
        const voucher = await db.get(code);

        if (!voucher) throw new Error("Invalid voucher");
        if (voucher.used) throw new Error("Already used");

        voucher.used = true;
        voucher.user = username;

        await db.save(code, voucher);

        return voucher;
    }
}

module.exports = new VoucherService();