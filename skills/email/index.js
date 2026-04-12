// skills/email/index.js
const nodemailer = require('nodemailer');

class EmailSkill {
  constructor() {
    this.transporters = new Map();
  }

  async execute(params, context) {
    const { action, provider = 'smtp', ...config } = params;
    
    switch (action) {
      case 'send':
        return this.sendEmail(provider, config, context);
      case 'read':
        return this.readEmails(provider, config, context);
      case 'search':
        return this.searchEmails(provider, config, context);
      default:
        throw new Error(`Unknown action: ${action}`);
    }
  }

  async sendEmail(provider, config, context) {
    const transporter = await this.getTransporter(provider, context);
    
    const mailOptions = {
      from: config.from || context.config?.email?.defaultFrom,
      to: config.to,
      subject: config.subject,
      text: config.body,
      html: config.html,
      attachments: config.attachments?.map(a => ({
        filename: a.name,
        content: a.content,
        path: a.path
      }))
    };

    const result = await transporter.sendMail(mailOptions);
    
    return {
      success: true,
      messageId: result.messageId,
      accepted: result.accepted,
      rejected: result.rejected
    };
  }

  async getTransporter(provider, context) {
    if (this.transporters.has(provider)) {
      return this.transporters.get(provider);
    }

    let transporter;
    const config = await context.memory.get(`config:email:${provider}`);

    switch (provider) {
      case 'smtp':
        transporter = nodemailer.createTransport({
          host: config.host,
          port: config.port,
          secure: config.secure,
          auth: {
            user: config.user,
            pass: config.pass
          },
          pool: true,
          maxConnections: 5
        });
        break;
        
      case 'sendgrid':
        transporter = nodemailer.createTransport({
          service: 'SendGrid',
          auth: {
            api_key: config.apiKey
          }
        });
        break;
        
      case 'aws-ses':
        const aws = require('@aws-sdk/client-ses');
        const ses = new aws.SES({
          region: config.region,
          credentials: {
            accessKeyId: config.accessKeyId,
            secretAccessKey: config.secretAccessKey
          }
        });
        transporter = nodemailer.createTransport({
          SES: { ses, aws }
        });
        break;
    }

    this.transporters.set(provider, transporter);
    return transporter;
  }

  validate(params) {
    if (params.action === 'send') {
      return params.to && params.subject && params.body;
    }
    return true;
  }

  async destroy() {
    for (const transporter of this.transporters.values()) {
      transporter.close();
    }
    this.transporters.clear();
  }
}

module.exports = new EmailSkill();
