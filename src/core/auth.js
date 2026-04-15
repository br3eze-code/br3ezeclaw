import { roles, users } from '../policies/roles.json'
import { approvals } from './approvals.js'
import { audit } from './audit.js'

export class AuthError extends Error {}

export async function authorize({ userId, tool, args, routerId }) {
  const user = users[userId]?? { role: 'readonly' }
  const role = roles[user.role]

  // 1. Tool allowlist check
  if (!role.tools.includes(tool.name) &&!role.tools.includes('*')) {
    await audit.log({ userId, tool, status: 'DENIED', reason: 'RBAC: tool not allowed' })
    throw new AuthError(`Your role '${user.role}' cannot run ${tool.name}`)
  }

  // 2. Router scope check
  if (!user.routers.includes(routerId) &&!user.routers.includes('*')) {
    await audit.log({ userId, tool, status: 'DENIED', reason: 'RBAC: router scope' })
    throw new AuthError(`No access to router ${routerId}`)
  }

  // 3. Param limits - e.g. helpdesk can't make 30Day vouchers
  const limits = role.limits?.[tool.name]
  if (limits) {
    for (const [key, max] of Object.entries(limits)) {
      if (args[key] > max) throw new AuthError(`${key} exceeds limit: ${max}`)
    }
  }

  // 4. Approval check for high-risk tools
  if (role.requireApproval?.includes(tool.name)) {
    const id = await approvals.create({ userId, tool, args, routerId })
    await audit.log({ userId, tool, status: 'PENDING_APPROVAL', approvalId: id })
    return { status: 'needs_approval', approvalId: id }
  }

  // 5. Rate limiting
  await checkRateLimit(userId, tool.name) // throws if exceeded

  return { status: 'ok' }
}
