// src/core/approvals.js
const { uid } = require('../utils')
const { logger } = require('../utils/logger')

class ApprovalEngine {
  constructor({ db, gateway }) {
    this._db = db
    this._gateway = gateway // your UnifiedMessaging
    this._pending = new Map() // approvalId -> { resolve, reject, timer }
  }

  async create({ userId, toolName, args, routerId }) {
    const id = uid()
    const expiresAt = Date.now() + 5 * 60_000 // 5 min

    await this._db.saveApproval({ id, userId, toolName, args, routerId, expiresAt, status: 'pending' })

    // Find netadmins to notify
    const admins = await this._db.getUsersByRole('netadmin')
    for (const admin of admins) {
      await this._gateway.sendToUser(admin.telegramId, {
        text: `⚠️ APPROVAL NEEDED\nFrom: @${userId}\nTool: ${toolName}\nRouter: ${routerId}\nArgs: ${JSON.stringify(args)}\nID: #${id}`,
        reply_markup: {
          inline_keyboard: [[
            { text: '✅ Approve', callback_data: `approve:${id}` },
            { text: '❌ Deny', callback_data: `deny:${id}` }
          ]]
        }
      })
    }

    // Auto-expire
    const timer = setTimeout(() => this._expire(id), 5 * 60_000)

    return new Promise((resolve, reject) => {
      this._pending.set(id, { resolve, reject, timer })
    })
  }

  async handleCallback(callbackData, adminId) {
    const [action, id] = callbackData.split(':')
    const pending = this._pending.get(id)
    if (!pending) return

    clearTimeout(pending.timer)
    this._pending.delete(id)

    if (action === 'approve') {
      await this._db.updateApproval(id, { status: 'approved', approvedBy: adminId })
      await this._db.logAudit({ approvalId: id, status: 'APPROVED', approvedBy: adminId })
      pending.resolve({ status: 'approved', approvedBy: adminId })
      await this._gateway.sendToUser(adminId, { text: `✅ Approved #${id}` })
    } else {
      await this._db.updateApproval(id, { status: 'denied', deniedBy: adminId })
      await this._db.logAudit({ approvalId: id, status: 'DENIED', deniedBy: adminId })
      pending.reject(new Error(`Denied by ${adminId}`))
      await this._gateway.sendToUser(adminId, { text: `❌ Denied #${id}` })
    }
  }

  async _expire(id) {
    const pending = this._pending.get(id)
    if (!pending) return
    this._pending.delete(id)
    await this._db.updateApproval(id, { status: 'expired' })
    pending.reject(new Error('Approval expired'))
  }
}

module.exports = { ApprovalEngine }
