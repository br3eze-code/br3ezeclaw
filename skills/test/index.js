// skills/test/index.js
module.exports = {
  execute: async (toolName, params, context) => {
    // If called via executeTool(skill.tool), toolName is the first arg
    if (typeof toolName === 'string') {
        return { message: params.message };
    }
    // If called directly via executeSkill(skillName), params is the first arg
    return { message: toolName.message };
  }
};
