// src/middleware/AuthMiddleware.js
class AuthMiddleware {
  constructor(agent) {
    this.agent = agent;
  }

  async authenticate(token) {
    // Verify JWT or API key
    const decoded = this.verifyToken(token);
    
    return {
      userId: decoded.sub,
      permissions: decoded.permissions || ['user:read'],
      sessionId: decoded.jti
    };
  }

  verifyToken(token) {
    const jwt = require('jsonwebtoken');
    return jwt.verify(token, process.env.JWT_SECRET);
  }

  async checkPermission(userId, requiredPermission) {
    const permissions = await this.agent.memory.getPermissions(userId);
    return permissions.includes(requiredPermission) || permissions.includes('admin');
  }
}
module.exports = { AuthMiddleware };
