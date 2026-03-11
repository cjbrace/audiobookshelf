const { Op, fn, col, literal } = require('sequelize')

const Logger = require('../Logger')
const Database = require('../Database')
const SocketAuthority = require('../SocketAuthority')

const QUICK_MATCH_RETENTION_DAYS = 45
const QUICK_MATCH_PRUNE_INTERVAL_MS = 6 * 60 * 60 * 1000
const QUICK_MATCH_DUPLICATE_THRESHOLD_FALLBACK = 0.79
const QUICK_MATCH_DUPLICATE_LIMIT = 900

class QuickMatchSessionManager {
  constructor() {
    this.lastPruneAt = 0
  }

  async getActiveSessionForUser(userId) {
    if (!userId) return null
    return Database.quickMatchSessionModel.findOne({
      where: { startedByUserId: userId, status: 'running' },
      order: [['startedAt', 'DESC']]
    })
  }

  async getActiveSessionIdForUser(userId) {
    const session = await this.getActiveSessionForUser(userId)
    return session?.id || null
  }

  async ensureActiveSessionIdForUser(userId) {
    const session = await this.ensureAutoSessionForUser(userId)
    return session?.id || null
  }

  async ensureAutoSessionForUser(userId) {
    if (!userId) return null

    await this.pruneOldDataIfDue()

    const runningSession = await this.getActiveSessionForUser(userId)
    if (runningSession) return runningSession

    // Always reuse the latest session to maintain a single live audit stream.
    const latestSession = await Database.quickMatchSessionModel.findOne({
      where: { startedByUserId: userId },
      order: [['startedAt', 'DESC']]
    })
    if (latestSession) {
      if (latestSession.status !== 'running') {
        latestSession.status = 'running'
        latestSession.endedAt = null
        await latestSession.save()
      }
      return latestSession
    }

    return Database.quickMatchSessionModel.create({
      startedByUserId: userId,
      status: 'running',
      notes: '[auto] Always-on quick match capture',
      startedAt: new Date()
    })
  }

  async startSession(user, notes = '') {
    const existing = await this.getActiveSessionForUser(user.id)
    if (existing) return existing
    return Database.quickMatchSessionModel.create({
      startedByUserId: user.id,
      status: 'running',
      notes: typeof notes === 'string' ? notes.trim() : '',
      startedAt: new Date()
    })
  }

  async stopSession(user) {
    const session = await this.getActiveSessionForUser(user.id)
    if (!session) return null
    session.status = 'completed'
    session.endedAt = new Date()
    await session.save()
    return session
  }

  async pruneOldDataIfDue() {
    const now = Date.now()
    if (this.lastPruneAt && now - this.lastPruneAt < QUICK_MATCH_PRUNE_INTERVAL_MS) return
    this.lastPruneAt = now
    try {
      await this.pruneOldData(QUICK_MATCH_RETENTION_DAYS)
    } catch (error) {
      Logger.error('[QuickMatchSessionManager] Failed to prune old quick match audit data', error)
    }
  }

  async pruneOldData(retentionDays = QUICK_MATCH_RETENTION_DAYS) {
    const cutoff = new Date(Date.now() - Math.max(1, Number(retentionDays) || QUICK_MATCH_RETENTION_DAYS) * 24 * 60 * 60 * 1000)
    const completedSessionIds = await Database.quickMatchSessionModel.findAll({
      where: {
        status: { [Op.ne]: 'running' },
        startedAt: { [Op.lt]: cutoff }
      },
      attributes: ['id'],
      raw: true
    })
    if (!completedSessionIds.length) return

    const ids = completedSessionIds.map((row) => row.id)
    await Database.quickMatchSessionModel.destroy({
      where: { id: { [Op.in]: ids } }
    })
    Logger.info(`[QuickMatchSessionManager] Pruned ${ids.length} quick match sessions older than ${retentionDays} days`)
  }

  async listSessions(limit = 20) {
    const sessions = await Database.quickMatchSessionModel.findAll({
      limit: Math.max(1, Math.min(100, Number(limit) || 20)),
      order: [['startedAt', 'DESC']],
      include: [{ model: Database.userModel, as: 'startedByUser', attributes: ['id', 'username'] }]
    })
    if (!sessions.length) return []

    const sessionIds = sessions.map((s) => s.id)
    const statsRows = await Database.quickMatchChangeModel.findAll({
      where: { sessionId: { [Op.in]: sessionIds } },
      attributes: [
        'sessionId',
        [fn('COUNT', col('id')), 'totalChanges'],
        [fn('SUM', literal(`CASE WHEN status = 'updated' THEN 1 ELSE 0 END`)), 'updatedChanges'],
        [fn('SUM', literal(`CASE WHEN status = 'unmatched' THEN 1 ELSE 0 END`)), 'unmatchedChanges'],
        [fn('SUM', literal(`CASE WHEN revertStatus = 'reverted' THEN 1 ELSE 0 END`)), 'revertedChanges']
      ],
      group: ['sessionId'],
      raw: true
    })
    const statsBySession = {}
    statsRows.forEach((row) => {
      statsBySession[row.sessionId] = {
        totalChanges: Number(row.totalChanges || 0),
        updatedChanges: Number(row.updatedChanges || 0),
        unmatchedChanges: Number(row.unmatchedChanges || 0),
        revertedChanges: Number(row.revertedChanges || 0)
      }
    })

    return sessions.map((session) => {
      const json = session.toJSON()
      return {
        ...json,
        stats: statsBySession[session.id] || {
          totalChanges: 0,
          updatedChanges: 0,
          unmatchedChanges: 0,
          revertedChanges: 0
        }
      }
    })
  }

  resolveDuplicateThreshold(requestedThreshold = null) {
    const envThreshold = Number(process.env.QUICK_MATCH_DUPLICATE_THRESHOLD)
    const deterministicDefault = Number.isFinite(envThreshold) ? envThreshold : QUICK_MATCH_DUPLICATE_THRESHOLD_FALLBACK
    const rawThreshold = requestedThreshold !== null && requestedThreshold !== undefined ? Number(requestedThreshold) : deterministicDefault
    const threshold = Number.isFinite(rawThreshold) ? Math.min(0.98, Math.max(0.5, rawThreshold)) : QUICK_MATCH_DUPLICATE_THRESHOLD_FALLBACK
    return Number(threshold.toFixed(3))
  }

  normalizeText(value) {
    return String(value || '')
      .toLowerCase()
      .replace(/&/g, ' and ')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim()
  }

  tokenize(value) {
    const normalized = this.normalizeText(value)
    if (!normalized) return []
    return normalized.split(/\s+/g).filter((token) => !!token)
  }

  jaccard(tokensA, tokensB) {
    if (!tokensA.length && !tokensB.length) return 1
    if (!tokensA.length || !tokensB.length) return 0
    const a = new Set(tokensA)
    const b = new Set(tokensB)
    let shared = 0
    a.forEach((token) => {
      if (b.has(token)) shared++
    })
    const union = a.size + b.size - shared
    if (!union) return 0
    return shared / union
  }

  containment(tokensA, tokensB) {
    if (!tokensA.length || !tokensB.length) return 0
    const a = new Set(tokensA)
    const b = new Set(tokensB)
    let shared = 0
    a.forEach((token) => {
      if (b.has(token)) shared++
    })
    return shared / Math.min(a.size, b.size)
  }

  extractAuthorText(media) {
    return (Array.isArray(media?.authors) ? media.authors : [])
      .map((author) => author?.name)
      .map((name) => String(name || '').trim())
      .filter((name) => !!name)
      .join(', ')
  }

  extractSeriesText(media) {
    return (Array.isArray(media?.series) ? media.series : [])
      .map((seriesEntry) => {
        const name = String(seriesEntry?.name || '').trim()
        if (!name) return ''
        const sequence = seriesEntry?.bookSeries?.sequence || seriesEntry?.sequence || null
        return sequence ? `${name} #${sequence}` : name
      })
      .filter((entry) => !!entry)
      .join(', ')
  }

  buildMaterialKey({ title = '', author = '', series = '' }) {
    return [this.normalizeText(title), this.normalizeText(author), this.normalizeText(series)].join('|')
  }

  async getLiveBookStates(libraryItemIds) {
    const uniqueIds = [...new Set((Array.isArray(libraryItemIds) ? libraryItemIds : []).filter((id) => typeof id === 'string' && id))]
    if (!uniqueIds.length) return {}

    const libraryItems = await Database.libraryItemModel.findAll({
      where: {
        id: { [Op.in]: uniqueIds },
        mediaType: 'book',
        isMissing: false,
        isInvalid: false
      },
      attributes: ['id', 'libraryId', 'updatedAt'],
      include: [
        {
          model: Database.bookModel,
          attributes: ['id', 'title', 'coverPath'],
          include: [
            {
              model: Database.authorModel,
              attributes: ['id', 'name'],
              through: { attributes: [] }
            },
            {
              model: Database.seriesModel,
              attributes: ['id', 'name'],
              through: { attributes: ['sequence'] }
            }
          ]
        }
      ],
      order: [
        [Database.bookModel, Database.authorModel, Database.bookAuthorModel, 'createdAt', 'ASC'],
        [Database.bookModel, Database.seriesModel, 'bookSeries', 'createdAt', 'ASC']
      ]
    })

    const stateById = {}
    libraryItems.forEach((libraryItem) => {
      if (!libraryItem?.media) return
      const title = String(libraryItem.media.title || '').trim()
      const author = this.extractAuthorText(libraryItem.media)
      const series = this.extractSeriesText(libraryItem.media)
      const titleTokens = this.tokenize(title)
      const authorTokens = this.tokenize(author)
      const seriesTokens = this.tokenize(series)
      stateById[libraryItem.id] = {
        libraryItemId: libraryItem.id,
        libraryId: libraryItem.libraryId,
        updatedAt: libraryItem.updatedAt,
        title,
        author,
        series,
        coverPath: libraryItem.media.coverPath || null,
        titleNorm: this.normalizeText(title),
        authorNorm: this.normalizeText(author),
        seriesNorm: this.normalizeText(series),
        titleTokens,
        authorTokens,
        seriesTokens,
        materialKey: this.buildMaterialKey({ title, author, series })
      }
    })
    return stateById
  }

  shouldPairAsDuplicate(itemA, itemB, threshold) {
    const isExactDuplicate = !!itemA.titleNorm && !!itemA.authorNorm && itemA.titleNorm === itemB.titleNorm && itemA.authorNorm === itemB.authorNorm
    if (isExactDuplicate) return { isDuplicate: true, exact: true, score: 1 }

    const titleJaccard = this.jaccard(itemA.titleTokens, itemB.titleTokens)
    const authorJaccard = this.jaccard(itemA.authorTokens, itemB.authorTokens)
    const titleContainment = this.containment(itemA.titleTokens, itemB.titleTokens)
    const authorContainment = this.containment(itemA.authorTokens, itemB.authorTokens)

    const titleScore = Math.max(titleJaccard, titleContainment)
    const authorScore = Math.max(authorJaccard, authorContainment)
    const titleSignal = titleScore >= 0.72
    const authorSignal = authorScore >= 0.5

    let seriesAssist = 0
    if (itemA.seriesNorm && itemB.seriesNorm) {
      if (itemA.seriesNorm === itemB.seriesNorm) {
        seriesAssist = 1
      } else if (this.jaccard(itemA.seriesTokens, itemB.seriesTokens) >= 0.75) {
        seriesAssist = 0.5
      }
    }

    const weightedScore = 0.68 * titleScore + 0.32 * authorScore + 0.04 * seriesAssist
    const isDuplicate = weightedScore >= threshold && titleSignal && authorSignal
    return {
      isDuplicate,
      exact: false,
      score: Number(weightedScore.toFixed(4))
    }
  }

  buildDuplicateGroupKey(members) {
    const titleAnchor = members.map((member) => member.titleNorm).filter((value) => !!value).sort()[0] || ''
    const authorAnchor = members.map((member) => member.authorNorm).filter((value) => !!value).sort()[0] || ''
    return `${titleAnchor}|${authorAnchor}`
  }

  buildDuplicateGroupFingerprint(members) {
    return members
      .map((member) => `${member.libraryItemId}:${member.materialKey}`)
      .sort()
      .join('||')
  }

  async listDuplicateSuppressions(sessionId) {
    const rows = await Database.quickMatchDuplicateSuppressionModel.findAll({
      where: { sessionId },
      raw: true
    })
    const suppressionByGroupKey = {}
    rows.forEach((row) => {
      suppressionByGroupKey[row.groupKey] = row.groupFingerprint
    })
    return suppressionByGroupKey
  }

  async suppressDuplicateGroup(sessionId, userId, groupKey, groupFingerprint) {
    if (!sessionId || !userId || !groupKey || !groupFingerprint) {
      throw new Error('Missing suppression parameters')
    }

    const [entry, created] = await Database.quickMatchDuplicateSuppressionModel.findOrCreate({
      where: { sessionId, groupKey },
      defaults: { sessionId, groupKey, groupFingerprint, createdByUserId: userId }
    })
    if (!created) {
      entry.groupFingerprint = groupFingerprint
      entry.createdByUserId = userId
      await entry.save()
    }
    return entry.toJSON()
  }

  async buildDuplicateGroups(sessionId, changes, requestedThreshold = null) {
    const threshold = this.resolveDuplicateThreshold(requestedThreshold)
    const latestChangeByItemId = new Map()
    const orderedChanges = Array.isArray(changes) ? changes : []
    orderedChanges.forEach((change) => {
      if (!change || change.status !== 'updated' || change.revertStatus === 'reverted') return
      if (!change.libraryItemId || latestChangeByItemId.has(change.libraryItemId)) return
      latestChangeByItemId.set(change.libraryItemId, change)
    })

    const scopedChanges = [...latestChangeByItemId.values()].slice(0, QUICK_MATCH_DUPLICATE_LIMIT)
    const liveStatesById = await this.getLiveBookStates(scopedChanges.map((change) => change.libraryItemId))
    const duplicateItems = scopedChanges
      .map((change) => {
        const state = liveStatesById[change.libraryItemId]
        if (!state) return null
        return {
          ...state,
          changeId: change.id,
          changeCreatedAt: change.createdAt
        }
      })
      .filter((item) => !!item)

    if (!duplicateItems.length) {
      return {
        threshold,
        groupedCount: 0,
        suppressedCount: 0,
        sourceItemsCount: 0,
        groups: []
      }
    }

    const parent = {}
    const find = (id) => {
      if (parent[id] === undefined) parent[id] = id
      if (parent[id] !== id) parent[id] = find(parent[id])
      return parent[id]
    }
    const union = (a, b) => {
      const rootA = find(a)
      const rootB = find(b)
      if (rootA !== rootB) parent[rootB] = rootA
    }

    const pairScores = {}
    for (let i = 0; i < duplicateItems.length; i++) {
      const itemA = duplicateItems[i]
      for (let j = i + 1; j < duplicateItems.length; j++) {
        const itemB = duplicateItems[j]
        if (!itemA.titleNorm || !itemB.titleNorm || !itemA.authorNorm || !itemB.authorNorm) continue

        const pair = this.shouldPairAsDuplicate(itemA, itemB, threshold)
        if (!pair.isDuplicate) continue

        const pairId = [itemA.libraryItemId, itemB.libraryItemId].sort().join('|')
        pairScores[pairId] = pair.score
        union(itemA.libraryItemId, itemB.libraryItemId)
      }
    }

    const buckets = {}
    duplicateItems.forEach((item) => {
      const root = find(item.libraryItemId)
      if (!buckets[root]) buckets[root] = []
      buckets[root].push(item)
    })

    const suppressionByGroupKey = await this.listDuplicateSuppressions(sessionId)
    const groups = []
    let suppressedCount = 0

    Object.values(buckets).forEach((membersRaw) => {
      if (membersRaw.length <= 1) return
      const members = membersRaw
        .map((member) => ({
          libraryItemId: member.libraryItemId,
          title: member.title,
          author: member.author,
          series: member.series,
          coverPath: member.coverPath,
          updatedAt: member.updatedAt,
          materialKey: member.materialKey,
          changeId: member.changeId,
          changeCreatedAt: member.changeCreatedAt,
          titleNorm: member.titleNorm,
          authorNorm: member.authorNorm
        }))
        .sort((a, b) => {
          const t = String(a.title || '').localeCompare(String(b.title || ''))
          if (t !== 0) return t
          return String(a.libraryItemId).localeCompare(String(b.libraryItemId))
        })

      const groupKey = this.buildDuplicateGroupKey(members)
      const groupFingerprint = this.buildDuplicateGroupFingerprint(members)
      if (suppressionByGroupKey[groupKey] && suppressionByGroupKey[groupKey] === groupFingerprint) {
        suppressedCount++
        return
      }

      let strongestPairScore = 0
      for (let i = 0; i < members.length; i++) {
        for (let j = i + 1; j < members.length; j++) {
          const pairId = [members[i].libraryItemId, members[j].libraryItemId].sort().join('|')
          if (pairScores[pairId] !== undefined) {
            strongestPairScore = Math.max(strongestPairScore, pairScores[pairId])
          }
        }
      }

      groups.push({
        groupKey,
        groupFingerprint,
        score: Number(strongestPairScore.toFixed(4)),
        size: members.length,
        titleHint: members[0]?.title || '',
        authorHint: members[0]?.author || '',
        members
      })
    })

    groups.sort((a, b) => {
      if (b.size !== a.size) return b.size - a.size
      if (b.score !== a.score) return b.score - a.score
      return String(a.titleHint || '').localeCompare(String(b.titleHint || ''))
    })

    return {
      threshold,
      groupedCount: groups.length,
      suppressedCount,
      sourceItemsCount: duplicateItems.length,
      groups
    }
  }

  async getSessionWithChanges(sessionId, limit = 1000, duplicateThreshold = null) {
    const session = await Database.quickMatchSessionModel.findByPk(sessionId, {
      include: [{ model: Database.userModel, as: 'startedByUser', attributes: ['id', 'username'] }]
    })
    if (!session) return null
    const changes = await Database.quickMatchChangeModel.findAll({
      where: { sessionId: session.id },
      order: [['createdAt', 'DESC']],
      limit: Math.max(1, Math.min(5000, Number(limit) || 1000)),
      include: [{ model: Database.userModel, as: 'revertedByUser', attributes: ['id', 'username'] }]
    })
    const fullMatchQueue = await this.listFullMatchQueue(session.id)
    const duplicateGroups = await this.buildDuplicateGroups(session.id, changes.map((c) => c.toJSON()), duplicateThreshold)
    return {
      ...session.toJSON(),
      changes: changes.map((c) => c.toJSON()),
      fullMatchQueue,
      duplicateGroups
    }
  }

  buildBookSnapshot(libraryItem) {
    if (!libraryItem?.isBook || !libraryItem.media) return null
    const metadata = libraryItem.media.oldMetadataToJSON()
    return {
      mediaType: 'book',
      libraryItemId: libraryItem.id,
      libraryId: libraryItem.libraryId,
      title: libraryItem.media.title || '',
      metadata: {
        title: metadata.title || null,
        subtitle: metadata.subtitle || null,
        publishedYear: metadata.publishedYear || null,
        publishedDate: metadata.publishedDate || null,
        publisher: metadata.publisher || null,
        description: metadata.description || null,
        isbn: metadata.isbn || null,
        asin: metadata.asin || null,
        language: metadata.language || null,
        explicit: !!metadata.explicit,
        abridged: !!metadata.abridged,
        narrators: Array.isArray(metadata.narrators) ? [...metadata.narrators] : [],
        genres: Array.isArray(metadata.genres) ? [...metadata.genres] : [],
        authors: Array.isArray(metadata.authors) ? metadata.authors.map((a) => ({ name: a?.name || '' })).filter((a) => a.name) : [],
        series: Array.isArray(metadata.series)
          ? metadata.series
              .map((s) => ({ name: s?.name || '', sequence: s?.sequence || null }))
              .filter((s) => s.name)
          : []
      },
      tags: Array.isArray(libraryItem.media.tags) ? [...libraryItem.media.tags] : [],
      coverPath: libraryItem.media.coverPath || null
    }
  }

  async recordChange({
    sessionId,
    userId,
    libraryItemId,
    libraryItemTitle,
    provider,
    status,
    warningText = null,
    errorText = null,
    beforeData = null,
    afterData = null
  }) {
    if (!sessionId || !userId || !libraryItemId || !status) return
    await Database.quickMatchChangeModel.create({
      sessionId,
      userId,
      libraryItemId,
      libraryItemTitle: libraryItemTitle || null,
      provider: provider || null,
      status,
      warningText: warningText || null,
      errorText: errorText || null,
      beforeData: beforeData || null,
      afterData: afterData || null
    })
  }

  async applyBookSnapshot(apiRouterCtx, libraryItem, snapshot) {
    if (!snapshot || snapshot.mediaType !== 'book' || !libraryItem?.isBook) {
      throw new Error('Invalid snapshot for revert')
    }
    const md = snapshot.metadata || {}

    const payload = {
      metadata: {
        title: md.title ?? null,
        subtitle: md.subtitle ?? null,
        publishedYear: md.publishedYear ?? null,
        publishedDate: md.publishedDate ?? null,
        publisher: md.publisher ?? null,
        description: md.description ?? null,
        isbn: md.isbn ?? null,
        asin: md.asin ?? null,
        language: md.language ?? null,
        explicit: !!md.explicit,
        abridged: !!md.abridged,
        narrators: Array.isArray(md.narrators) ? md.narrators : [],
        genres: Array.isArray(md.genres) ? md.genres : []
      },
      tags: Array.isArray(snapshot.tags) ? snapshot.tags : []
    }

    let hasUpdates = await libraryItem.media.updateFromRequest(payload)

    const authorNames = (Array.isArray(md.authors) ? md.authors : [])
      .map((a) => (typeof a === 'string' ? a : a?.name))
      .map((a) => String(a || '').trim())
      .filter((a) => !!a)
    const authorUpdateData = await libraryItem.media.updateAuthorsFromRequest(authorNames, libraryItem.libraryId)
    if (authorUpdateData?.authorsRemoved?.length) {
      await apiRouterCtx.checkRemoveAuthorsWithNoBooks(authorUpdateData.authorsRemoved.map((a) => a.id))
    }
    if (authorUpdateData?.authorsAdded?.length) {
      authorUpdateData.authorsAdded.forEach((au) => {
        Database.addAuthorToFilterData(libraryItem.libraryId, au.name, au.id)
      })
    }
    if (authorUpdateData?.hasUpdates) hasUpdates = true

    const seriesData = (Array.isArray(md.series) ? md.series : [])
      .map((s) => {
        if (typeof s === 'string') return { name: s.trim(), sequence: null }
        const name = String(s?.name || '').trim()
        if (!name) return null
        return { name, sequence: s?.sequence ?? null }
      })
      .filter((s) => !!s)
    const seriesUpdateData = await libraryItem.media.updateSeriesFromRequest(seriesData, libraryItem.libraryId)
    if (seriesUpdateData?.seriesRemoved?.length) {
      await apiRouterCtx.checkRemoveEmptySeries(seriesUpdateData.seriesRemoved.map((s) => s.id))
    }
    if (seriesUpdateData?.seriesAdded?.length) {
      seriesUpdateData.seriesAdded.forEach((se) => {
        Database.addSeriesToFilterData(libraryItem.libraryId, se.name, se.id)
      })
    }
    if (seriesUpdateData?.hasUpdates) hasUpdates = true

    const snapCoverPath = snapshot.coverPath || null
    if ((libraryItem.media.coverPath || null) !== snapCoverPath) {
      libraryItem.media.coverPath = snapCoverPath
      libraryItem.media.changed('coverPath', true)
      hasUpdates = true
    }

    if (!hasUpdates) return false

    await libraryItem.media.save()
    libraryItem.changed('updatedAt', true)
    await libraryItem.save()
    await libraryItem.saveMetadataFile()
    SocketAuthority.libraryItemEmitter('item_updated', libraryItem)
    return true
  }

  async revertSessionChanges(apiRouterCtx, sessionId, user, libraryItemIds = null) {
    const where = {
      sessionId,
      status: 'updated',
      revertStatus: 'not_reverted'
    }
    if (Array.isArray(libraryItemIds) && libraryItemIds.length) {
      where.libraryItemId = { [Op.in]: libraryItemIds }
    }
    const changes = await Database.quickMatchChangeModel.findAll({
      where,
      order: [['createdAt', 'DESC']]
    })
    if (!changes.length) return { reverted: 0, failed: 0, failures: [] }

    let reverted = 0
    let failed = 0
    const failures = []

    for (const change of changes) {
      try {
        const libraryItem = await Database.libraryItemModel.getExpandedById(change.libraryItemId)
        if (!libraryItem || !libraryItem.isBook) {
          throw new Error('Book not found')
        }
        await this.applyBookSnapshot(apiRouterCtx, libraryItem, change.beforeData)
        change.revertStatus = 'reverted'
        change.revertedAt = new Date()
        change.revertedByUserId = user.id
        change.errorText = null
        await change.save()
        reverted++
      } catch (error) {
        failed++
        const msg = String(error?.message || error)
        failures.push({ libraryItemId: change.libraryItemId, error: msg })
        change.errorText = msg
        await change.save()
        Logger.error(`[QuickMatchSessionManager] Failed to revert quick match change ${change.id}`, error)
      }
    }

    return { reverted, failed, failures }
  }

  async queueFullMatchForReverted(sessionId, user, libraryItemIds = null) {
    const where = {
      sessionId,
      status: 'updated',
      revertStatus: 'reverted'
    }
    if (Array.isArray(libraryItemIds) && libraryItemIds.length) {
      where.libraryItemId = { [Op.in]: libraryItemIds }
    }
    const changes = await Database.quickMatchChangeModel.findAll({
      where,
      order: [['createdAt', 'DESC']]
    })
    if (!changes.length) return { queued: 0, skipped: 0 }

    let queued = 0
    let skipped = 0
    for (const change of changes) {
      const [entry, created] = await Database.quickMatchFullMatchQueueModel.findOrCreate({
        where: { changeId: change.id },
        defaults: {
          sessionId,
          changeId: change.id,
          libraryItemId: change.libraryItemId,
          queuedByUserId: user.id,
          status: 'queued'
        }
      })
      if (!created && entry.status === 'queued') {
        skipped++
      } else if (!created && entry.status !== 'queued') {
        entry.status = 'queued'
        entry.completedAt = null
        entry.completedByUserId = null
        entry.queuedByUserId = user.id
        await entry.save()
        queued++
      } else {
        queued++
      }
    }
    return { queued, skipped }
  }

  async listFullMatchQueue(sessionId) {
    const rows = await Database.quickMatchFullMatchQueueModel.findAll({
      where: { sessionId },
      order: [
        ['status', 'ASC'],
        ['createdAt', 'DESC']
      ],
      include: [
        { model: Database.quickMatchChangeModel, as: 'change' },
        { model: Database.userModel, as: 'queuedByUser', attributes: ['id', 'username'] },
        { model: Database.userModel, as: 'completedByUser', attributes: ['id', 'username'] }
      ]
    })
    return rows.map((row) => row.toJSON())
  }

  async markFullMatchQueueDone(sessionId, user, queueIds = null, libraryItemIds = null) {
    const where = { sessionId, status: 'queued' }
    if (Array.isArray(queueIds) && queueIds.length) where.id = { [Op.in]: queueIds }
    if (Array.isArray(libraryItemIds) && libraryItemIds.length) where.libraryItemId = { [Op.in]: libraryItemIds }

    const rows = await Database.quickMatchFullMatchQueueModel.findAll({ where })
    if (!rows.length) return { completed: 0 }
    const now = new Date()
    for (const row of rows) {
      row.status = 'completed'
      row.completedAt = now
      row.completedByUserId = user.id
      await row.save()
    }
    return { completed: rows.length }
  }
}

module.exports = new QuickMatchSessionManager()
