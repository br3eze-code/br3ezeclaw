const eventBus = require('../core/eventBus');

class VoucherAgent {
    generate(plan) {
        const code = `V-${plan}-${Math.random().toString(36).substr(2, 5)}`;

        eventBus.emit('voucher.created', { code, plan });

        return code;
    }

    redeem(code, user) {
        eventBus.emit('voucher.redeemed', { code, user });
    }
}

module.exports = new VoucherAgent();