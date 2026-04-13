// skills/design/index.js
module.exports = {
  name: 'design',
  tools: [
    {
      name: 'design_assist',
      description: 'Help with design, UX flows, architecture, and feature planning',
      execute: async (params) => {
        return {
          message: `Design assistance for: ${params.task || 'general design'}`,
          ideas: [
            'Focus on confirmation for destructive actions',
            'Keep interfaces consistent across Telegram, WhatsApp, and CLI',
            'Make the VS Code extension more intuitive'
          ]
        };
      }
    }
  ]
};
