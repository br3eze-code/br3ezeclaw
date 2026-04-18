'use strict';

const jwt = require('jsonwebtoken');
const { ErrorCodes, AgentOSError } = require('../core/errors');

class AuthMiddleware {
  constructor(agent) {
    this.agent = agent;
    if (!process.env.JWT_SECRET) {
      console.warn('WARNING: JWT_SECRET not set. Authentication is insecure.');
    }
  }

  async authenticate(token) {
    if (!token) {
      throw new AgentOSError(ErrorCodes.AUTH_FAILED, 'Authorization token required');
    }

    const secret = process.env.JWT_SECRET || 'insecure-default-change-me';
    
    try {
      const decoded = jwt.verify(token, secret, {
        algorithms: ['HS256'],
        maxAge: '24h'
      });

      return {
        userId: decoded.sub,
        permissions: decoded.permissions || ['user:read'],
        sessionId: decoded.jti || decoded.sub,
        role: decoded.role || 'user'
      };
    } catch (err) {
      throw new AgentOSError(ErrorCodes.AUTH_FAILED, `Invalid token: ${err.message}`);
    }
  }

  async checkPermission(userId, requiredPermission) {
    if (!this.agent?.memory?.getPermissions) {
      console.warn('Agent memory not configured, allowing admin fallback');
      return true;
    }
    
    const permissions = await this.agent.memory.getPermissions(userId);
    return permissions.includes(requiredPermission) 
        || permissions.includes('admin')
        || permissions.includes('*');
  }

  middleware(requiredPermission) {
    return async (req, res, next) => {
      try {
        const token = req.headers.authorization?.replace('Bearer ', '');
        const auth = await this.authenticate(token);
        
        if (requiredPermission) {
          const allowed = await this.checkPermission(auth.userId, requiredPermission);
          if (!allowed) {
            return res.status(403).json({ error: 'Forbidden', code: 403 });
          }
        }
        
        req.auth = auth;
        next();
      } catch (err) {
        res.status(401).json(err.toJSON ? err.toJSON() : { error: err.message, code: 401 });
      }
    };
  }
}

module.exports = { AuthMiddleware };
