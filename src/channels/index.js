// src/channels/index.js
class ChannelManager {
  constructor(runtime) {
    this.runtime = runtime;
    this.channels = new Map();
  }
  
  registerChannel(channel) {
    channel.setRuntime(this.runtime);
    this.channels.set(channel.name, channel);
  }
  
  async broadcast(message) {
    for (const channel of this.channels.values()) {
      if (channel.supports(message.type)) {
        await channel.send(message);
      }
    }
  }
}

// Telegram Channel 
class TelegramChannel extends BaseChannel {
  constructor(config) {
    super();
    this.name = 'telegram';
    this.bot = new Telegraf(config.token);
    this.setupHandlers();
  }
  
  setupHandlers() {
    this.bot.command('start', (ctx) => this.handleStart(ctx));
    this.bot.command('status', (ctx) => this.handleStatus(ctx));
    this.bot.on('text', (ctx) => this.handleIntent(ctx));
    
  
    this.bot.action('deploy_staging', (ctx) => this.triggerWorkflow(ctx, 'deploy', { env: 'staging' }));
    this.bot.action('deploy_prod', (ctx) => this.triggerWorkflow(ctx, 'secure-deploy', { env: 'production' }));
  }
  
  async handleIntent(ctx) {
    const userId = ctx.from.id;
    const intent = ctx.message.text;
    
    // Check permissions
    const allowed = await this.checkPermissions(userId, intent);
    if (!allowed) {
      return ctx.reply('⛔ You do not have permission for this action.');
    }
    
    // Show typing indicator
    await ctx.sendChatAction('typing');
    
    // Execute
    try {
      const result = await this.runtime.execute({
        raw: intent,
        user: userId,
        channel: 'telegram'
      });
      
      // Format response
      const formatted = this.formatResult(result);
      await ctx.reply(formatted.text, { 
        parse_mode: 'Markdown',
        reply_markup: formatted.actions 
      });
      
    } catch (error) {
      await ctx.reply(`❌ Error: ${error.message}`);
    }
  }
  
  formatResult(result) {
    // Format different result types
    if (result.domain === 'network' && result.tool === 'voucher') {
      return {
        text: `🎫 Voucher Created\n\`\`\`\n${result.codes.join('\n')}\n\`\`\``,
        actions: Markup.inlineKeyboard([
          [Markup.button.callback('📊 Stats', 'voucher_stats')],
          [Markup.button.callback('🔄 Generate More', 'voucher_more')]
        ])
      };
    }
    
    if (result.domain === 'developer' && result.tool === 'codegen') {
      return {
        text: `💻 Code Generated\n\`\`\`${result.language}\n${result.code.substring(0, 3000)}\n\`\`\``,
        actions: Markup.inlineKeyboard([
          [Markup.button.callback('📝 Copy', 'copy_code')],
          [Markup.button.callback('🧪 Generate Tests', 'gen_tests')],
          [Markup.button.callback('📋 Create PR', 'create_pr')]
        ])
      };
    }
    
    return { text: JSON.stringify(result, null, 2) };
  }
}

// VS Code Channel (New)
class VSCodeChannel extends BaseChannel {
  constructor(runtime) {
    super();
    this.name = 'vscode';
    this.runtime = runtime;
    this.server = null;
  }
  
  async start(port = 9876) {
    this.server = new WebSocketServer({ port });
    
    this.server.on('connection', (ws) => {
      ws.on('message', async (data) => {
        const message = JSON.parse(data);
        const result = await this.runtime.execute(message);
        ws.send(JSON.stringify(result));
      });
    });
  }
  
  supports(type) {
    return ['codegen', 'lint', 'test', 'git'].includes(type);
  }
}

// GitHub Channel (New)
class GitHubChannel extends BaseChannel {
  constructor(config) {
    super();
    this.name = 'github';
    this.app = new App({ appId: config.appId, privateKey: config.privateKey });
  }
  
  async handlePullRequest(context) {
    const pr = context.payload.pull_request;
    
    // Auto-review with agent
    const review = await this.runtime.execute({
      domain: 'developer',
      tool: 'review',
      params: {
        diff: pr.diff_url,
        rules: ['security', 'performance', 'style']
      }
    });
    
    if (review.issues.length > 0) {
      await context.octokit.pulls.createReview({
        owner: pr.base.repo.owner.login,
        repo: pr.base.repo.name,
        pull_number: pr.number,
        body: this.formatReview(review),
        event: review.blocking ? 'REQUEST_CHANGES' : 'COMMENT'
      });
    }
  }
}
