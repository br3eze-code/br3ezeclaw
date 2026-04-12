// config/domains.js
module.exports = {
  networking: {
    skills: ['mikrotik', 'ping', 'traceroute'],
    prompts: './prompts/networking.txt',
    defaultChannel: 'telegram'
  },
  productivity: {
    skills: ['calendar', 'tasks', 'email'],
    prompts: './prompts/productivity.txt',
    defaultChannel: 'slack'
  }
};
