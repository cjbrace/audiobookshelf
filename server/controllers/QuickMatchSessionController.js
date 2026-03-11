const Logger = require('../Logger')
const QuickMatchSessionManager = require('../managers/QuickMatchSessionManager')

class QuickMatchSessionController {
  constructor() {}

  async start(req, res) {
    if (!req.user.isAdminOrUp) return res.sendStatus(403)
    const notes = typeof req.body?.notes === 'string' ? req.body.notes : ''
    const session = await QuickMatchSessionManager.startSession(req.user, notes)
    res.json({ session: session.toJSON() })
  }

  async stop(req, res) {
    if (!req.user.isAdminOrUp) return res.sendStatus(403)
    const session = await QuickMatchSessionManager.stopSession(req.user)
    if (!session) return res.status(404).send('No active quick match session')
    res.json({ session: session.toJSON() })
  }

  async getAll(req, res) {
    if (!req.user.isAdminOrUp) return res.sendStatus(403)
    const activeSessionId = await QuickMatchSessionManager.ensureActiveSessionIdForUser(req.user.id)
    const sessions = await QuickMatchSessionManager.listSessions(Number(req.query.limit || 20))
    res.json({ sessions, activeSessionId })
  }

  async getOne(req, res) {
    if (!req.user.isAdminOrUp) return res.sendStatus(403)
    const duplicateThreshold = req.query?.duplicateThreshold !== undefined ? Number(req.query.duplicateThreshold) : null
    const session = await QuickMatchSessionManager.getSessionWithChanges(req.params.id, Number(req.query.limit || 2000), duplicateThreshold)
    if (!session) return res.sendStatus(404)
    res.json({ session })
  }

  async suppressDuplicateGroup(req, res) {
    if (!req.user.isAdminOrUp) return res.sendStatus(403)
    const groupKey = typeof req.body?.groupKey === 'string' ? req.body.groupKey.trim() : ''
    const groupFingerprint = typeof req.body?.groupFingerprint === 'string' ? req.body.groupFingerprint.trim() : ''
    if (!groupKey || !groupFingerprint) return res.status(400).send('Missing groupKey or groupFingerprint')

    const suppression = await QuickMatchSessionManager.suppressDuplicateGroup(req.params.id, req.user.id, groupKey, groupFingerprint)
    const duplicateThreshold = req.query?.duplicateThreshold !== undefined ? Number(req.query.duplicateThreshold) : null
    const session = await QuickMatchSessionManager.getSessionWithChanges(req.params.id, Number(req.query.limit || 2000), duplicateThreshold)
    if (!session) return res.sendStatus(404)
    res.json({ suppression, session })
  }

  async revert(req, res) {
    if (!req.user.isAdminOrUp) return res.sendStatus(403)
    const libraryItemIds = Array.isArray(req.body?.libraryItemIds) ? req.body.libraryItemIds.filter((id) => typeof id === 'string' && id) : null
    const result = await QuickMatchSessionManager.revertSessionChanges(this, req.params.id, req.user, libraryItemIds)
    Logger.info(`[QuickMatchSessionController] Revert complete for session ${req.params.id} | reverted=${result.reverted} failed=${result.failed}`)
    res.json(result)
  }

  async queueFullMatch(req, res) {
    if (!req.user.isAdminOrUp) return res.sendStatus(403)
    const libraryItemIds = Array.isArray(req.body?.libraryItemIds) ? req.body.libraryItemIds.filter((id) => typeof id === 'string' && id) : null
    const result = await QuickMatchSessionManager.queueFullMatchForReverted(req.params.id, req.user, libraryItemIds)
    const queue = await QuickMatchSessionManager.listFullMatchQueue(req.params.id)
    res.json({ ...result, queue })
  }

  async completeFullMatchQueue(req, res) {
    if (!req.user.isAdminOrUp) return res.sendStatus(403)
    const queueIds = Array.isArray(req.body?.queueIds) ? req.body.queueIds.filter((id) => typeof id === 'string' && id) : null
    const libraryItemIds = Array.isArray(req.body?.libraryItemIds) ? req.body.libraryItemIds.filter((id) => typeof id === 'string' && id) : null
    const result = await QuickMatchSessionManager.markFullMatchQueueDone(req.params.id, req.user, queueIds, libraryItemIds)
    const queue = await QuickMatchSessionManager.listFullMatchQueue(req.params.id)
    res.json({ ...result, queue })
  }
}

module.exports = new QuickMatchSessionController()
