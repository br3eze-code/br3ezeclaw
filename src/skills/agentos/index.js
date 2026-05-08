const { BaseDriver } = require('../base.js');
const { logger } = require('../../core/logger');

class AgentOSCoreDriver extends BaseDriver {
  static id = 'agentos';
  static name = 'AgentOS Core';
  static description = 'Core management tools for printers, messaging, and system-wide operations';

  constructor(config, logger) {
    super(config, logger);
  }

  static getTools() {
    return {
      'agentos.broadcast': {
        risk: 'medium',
        description: 'Send a message to all enabled communication channels (Telegram, Slack, Discord, WhatsApp)',
        parameters: {
          type: 'object',
          properties: {
            message: { type: 'string', description: 'The message to broadcast' },
            urgent: { type: 'boolean', description: 'If true, prefixes with alert emoji', default: false }
          },
          required: ['message']
        }
      },
      'agentos.printer.test': {
        risk: 'low',
        description: 'Print a diagnostic test page to the connected thermal printer',
        parameters: {
          type: 'object',
          properties: {
            text: { type: 'string', description: 'Optional text to include in the test print' }
          }
        }
      },
      'agentos.channels.status': {
        risk: 'low',
        description: 'Get connection status and metadata for all messaging channels',
        parameters: { type: 'object', properties: {} }
      },
      'agentos.voucher.create': {
        risk: 'medium',
        description: 'Create a new MikroTik hotspot voucher and optionally print it',
        parameters: {
          type: 'object',
          properties: {
            profile: { type: 'string', description: 'The profile to use (e.g. 1Hour, 1Day)' },
            print: { type: 'boolean', description: 'If true, sends to thermal printer', default: true }
          },
          required: ['profile']
        }
      }
    };
  }

  async execute(toolName, args, ctx) {
    const agent = ctx.agent || ctx.registry?.agent;
    if (!agent) throw new Error('AgentOS instance not found in context');

    switch (toolName) {
      case 'agentos.broadcast':
        const prefix = args.urgent ? '🚨 *URGENT BROADCAST* 🚨\n\n' : '📢 *AgentOS Broadcast*\n\n';
        await agent.sendToAll(prefix + args.message);
        return { success: true, message: 'Broadcast sent to all active channels' };

      case 'agentos.printer.test':
        const printer = require('../../core/printer');
        const testData = args.text || 'AgentOS Thermal Printer Test Page\n' + new Date().toLocaleString();
        try {
          await printer.printVoucher({
            username: 'TEST-USER',
            password: 'TEST-PASSWORD',
            profile: 'DIAGNOSTIC',
            loginUrl: 'http://hotspot.local/login'
          });
          return { success: true, message: 'Test page sent to printer' };
        } catch (err) {
          return { success: false, error: err.message };
        }

      case 'agentos.voucher.create':
        const voucherManager = require('../../core/voucher');
        const printerService = require('../../core/printer');

        try {
          // 1. Generate the voucher (handles DB and MikroTik sync)
          const voucher = await voucherManager.createVoucher(args.profile);

          let printStatus = 'skipped';
          if (args.print !== false) {
            const printResult = await printerService.printVoucher({
              username: voucher.username,
              password: voucher.password,
              profile: voucher.profile,
              loginUrl: voucher.loginUrl
            });
            printStatus = printResult.success ? 'printed' : `failed: ${printResult.error}`;
          }

          return {
            success: true,
            message: `Voucher created for profile ${args.profile}. Print status: ${printStatus}`,
            voucher: {
              username: voucher.username,
              password: voucher.password,
              expires: voucher.expires
            }
          };
        } catch (err) {
          return { success: false, error: err.message };
        }

      case 'agentos.channels.status':
        return agent.channels.getStatus();

      default:
        throw new Error(`Tool ${toolName} not implemented in AgentOS core driver`);
    }
  }
}

module.exports = AgentOSCoreDriver;
