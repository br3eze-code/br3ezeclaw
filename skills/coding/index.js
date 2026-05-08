// skills/coding/index.js
module.exports = {
  name: 'coding',
  tools: [
    {
      name: 'coding_assist',
      description: 'Help with coding tasks: generate, review, refactor, debug',
      execute: async (params) => {
        // For now, return structured help. Later connect to AskEngine recursively
        return {
          message: `Coding assistance for: ${params.task || 'general coding help'}`,
          suggestion: 'Provide the code or specific requirement for better help.',
          tip: 'I can help improve AgentOS itself!'
        };
      }
    }
  ]
};
