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

  async evaluateLibraryDuplicates(req, res) {
    if (!req.user.isAdminOrUp) return res.sendStatus(403)
    if (!req.library || !req.library.isBook) return res.status(400).send('Duplicates evaluation is only available for book libraries')

    const duplicateThreshold = req.query?.duplicateThreshold !== undefined ? Number(req.query.duplicateThreshold) : Number(req.body?.duplicateThreshold)
    const sessionId = await QuickMatchSessionManager.ensureActiveSessionIdForUser(req.user.id)
    if (!sessionId) return res.status(500).send('Unable to resolve active quick match session')

    const duplicateGroups = await QuickMatchSessionManager.buildDuplicateGroupsForLibrary(sessionId, req.library.id, duplicateThreshold)
    const reason =
      duplicateGroups.sourceItemsCount === 0 ? 'no_books_in_scope' : duplicateGroups.groupedCount === 0 ? 'no_groups_above_threshold' : 'groups_found'

    res.json({
      sessionId,
      duplicateGroups,
      evaluation: {
        evaluatedAt: new Date().toISOString(),
        reason,
        scopeType: 'library',
        scopeLibraryId: req.library.id,
        sourceItemsCount: duplicateGroups.sourceItemsCount
      }
    })
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

  async processDuplicateGroup(req, res) {
    if (!req.user.isAdminOrUp) return res.sendStatus(403)

    const token = typeof req.body?.token === 'string' ? req.body.token.trim() : ''
    const libraryItemIds = Array.isArray(req.body?.libraryItemIds) ? req.body.libraryItemIds.filter((id) => typeof id === 'string' && id) : []
    if (!libraryItemIds.length) return res.status(400).send('Missing libraryItemIds')

    const duplicateThreshold = req.query?.duplicateThreshold !== undefined ? Number(req.query.duplicateThreshold) : Number(req.body?.duplicateThreshold)
    const processed = await QuickMatchSessionManager.processDuplicateTargets(
      req.params.id,
      [{ token: token || 'group', libraryItemIds }],
      duplicateThreshold
    )
    const processedTarget = processed.processedTargets?.[0] || null
    if (!processedTarget) return res.status(400).send('Unable to process duplicate group')

    res.json({
      sessionId: req.params.id,
      processedTarget,
      summary: {
        requestedTargetCount: processed.requestedTargetCount,
        processedTargetCount: processed.processedTargetCount
      }
    })
  }

  async processDoneDuplicateGroups(req, res) {
    if (!req.user.isAdminOrUp) return res.sendStatus(403)

    const targets = Array.isArray(req.body?.targets)
      ? req.body.targets.map((target) => ({
          token: typeof target?.token === 'string' ? target.token : '',
          libraryItemIds: Array.isArray(target?.libraryItemIds) ? target.libraryItemIds : []
        }))
      : []
    if (!targets.length) return res.status(400).send('Missing targets')

    const duplicateThreshold = req.query?.duplicateThreshold !== undefined ? Number(req.query.duplicateThreshold) : Number(req.body?.duplicateThreshold)
    const processed = await QuickMatchSessionManager.processDuplicateTargets(req.params.id, targets, duplicateThreshold)

    res.json({
      sessionId: req.params.id,
      processedTargets: processed.processedTargets,
      summary: {
        requestedTargetCount: processed.requestedTargetCount,
        processedTargetCount: processed.processedTargetCount
      }
    })
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
