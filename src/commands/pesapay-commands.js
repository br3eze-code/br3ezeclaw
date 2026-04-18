// src/commands/pesapay-commands.js
// Telegram bot commands for PesaPay integration

module.exports = function setupPesaPayCommands(bot, paymentSvc) {
  
  // /pay command - Quick payment via PesaPay
  bot.command('pay', async (ctx) => {
    const userId = ctx.from.id;
    
    await ctx.reply(
      '💳 *PesaPay Payment*\n\n' +
      'Select your voucher package:',
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [
              { text: '1 Hour - $1.00', callback_data: 'pesapay_1Hour_1' },
              { text: '1 Day - $3.00', callback_data: 'pesapay_1Day_3' }
            ],
            [
              { text: '1 Week - $10.00', callback_data: 'pesapay_1Week_10' },
              { text: '1 Month - $25.00', callback_data: 'pesapay_1Month_25' }
            ]
          ]
        }
      }
    );
  });

  // Handle PesaPay voucher selection
  bot.action(/pesapay_(.+)_(.+)/, async (ctx) => {
    const [, voucherType, amount] = ctx.match;
    const userId = ctx.from.id;
    
    // Get user info
    const user = ctx.from;
    
    try {
      // First, ensure IPN is registered (do this once in production)
      const pesapay = paymentSvc.gateway.providers.get('pesapay');
      
      // Create payment order
      const result = await paymentSvc.gateway.createPayment('pesapay', {
        amount: parseFloat(amount),
        currency: 'USD',
        description: `AgentOS WiFi Voucher - ${voucherType}`,
        reference: `AGENTOS-${userId}-${Date.now()}`,
        customerEmail: user.username ? `${user.username}@telegram.agentos` : `user${userId}@telegram.agentos`,
        customerPhone: '', // Will be collected on PesaPay page
        customerName: `${user.first_name || ''} ${user.last_name || ''}`.trim(),
        callbackUrl: `${process.env.WEBHOOK_BASE_URL}/webhooks/pesapay/ipn`
      });

      // Store pending transaction
      await paymentSvc.db.collection('pending_transactions').doc(result.transactionId).set({
        userId: userId.toString(),
        voucherType,
        amount: parseFloat(amount),
        transactionId: result.transactionId,
        status: 'pending',
        createdAt: new Date()
      });

      // Send payment link to user
      await ctx.editMessageText(
        `💳 *Complete Your Payment*\n\n` +
        `Package: ${voucherType}\n` +
        `Amount: $${amount}.00 USD\n\n` +
        `Click the button below to complete payment via PesaPay.\n` +
        `You can pay with:\n` +
        `• EcoCash\n` +
        `• OneMoney (NetOne)\n` +
        `• Telecash\n` +
        `• Visa/Mastercard\n` +
        `• Bank Transfer\n\n` +
        `⏳ Your voucher will be automatically sent after payment.`,
        {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [{ text: '💳 Pay Now via PesaPay', url: result.redirectUrl }],
              [{ text: '🔍 Check Status', callback_data: `check_pesapay_${result.transactionId}` }]
            ]
          }
        }
      );

    } catch (error) {
      console.error('PesaPay payment error:', error);
      await ctx.reply(`❌ Error creating payment: ${error.message}`);
    }
  });

  // Check PesaPay payment status
  bot.action(/check_pesapay_(.+)/, async (ctx) => {
    const [, orderTrackingId] = ctx.match;
    
    try {
      await ctx.answerCbQuery('⏳ Checking payment status...');
      
      const status = await paymentSvc.gateway.verifyPayment('pesapay', orderTrackingId);
      
      if (status.success) {
        // Generate voucher
        const voucher = await paymentSvc.processSuccessfulPayment(orderTrackingId, 'pesapay');
        
        await ctx.editMessageText(
          `✅ *Payment Successful!*\n\n` +
          `🎫 *Your WiFi Voucher Code:*\n` +
          `\`${voucher.voucher.code}\`\n\n` +
          `📊 Details:\n` +
          `• Type: ${voucher.voucher.type}\n` +
          `• Amount: $${voucher.voucher.amount}\n` +
          `• Valid until: ${voucher.voucher.expiresAt.toLocaleString()}\n\n` +
          `💳 Paid via: ${status.paymentMethod || 'PesaPay'}\n` +
          `🆔 Confirmation: ${status.confirmationCode || 'N/A'}\n\n` +
          `Connect to WiFi and enter this code to get online!`,
          { parse_mode: 'Markdown' }
        );
      } else if (status.status === 'pending') {
        await ctx.answerCbQuery('⏳ Payment still pending. Please complete payment on PesaPay.');
      } else {
        await ctx.answerCbQuery(`❌ Payment ${status.status}. Please try again.`);
      }
    } catch (error) {
      console.error('Status check error:', error);
      await ctx.answerCbQuery('❌ Error checking status. Please try again.');
    }
  });

  // /status command - Check all pending payments
  bot.command('status', async (ctx) => {
    const userId = ctx.from.id;
    
    try {
      const pending = await paymentSvc.db.collection('pending_transactions')
        .where('userId', '==', userId.toString())
        .where('status', '==', 'pending')
        .get();

      if (pending.empty) {
        return ctx.reply('✅ No pending payments found.');
      }

      let message = '⏳ *Your Pending Payments:*\n\n';
      const buttons = [];

      pending.forEach(doc => {
        const tx = doc.data();
        message += `• ${tx.voucherType} - $${tx.amount} (Ref: ${tx.transactionId.substr(-8)})\n`;
        buttons.push([{
          text: `Check ${tx.voucherType}`,
          callback_data: `check_pesapay_${tx.transactionId}`
        }]);
      });

      await ctx.reply(message, {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: buttons }
      });
    } catch (error) {
      await ctx.reply('❌ Error fetching pending payments.');
    }
  });
};
