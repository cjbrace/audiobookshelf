const { literal, Op } = require('sequelize')

const Database = require('../Database')
const Logger = require('../Logger')

class SeriesReviewManager {
  get SERIES_EDIT_TAG() {
    return '-series-edit'
  }

  normalizeSeriesName(value) {
    return String(value || '')
      .trim()
      .replace(/\s+/g, ' ')
  }

  normalizeSequence(value) {
    const cleaned = String(value ?? '')
      .trim()
      .replace(/\s+/g, ' ')
    return cleaned || null
  }

  normalizeKeyPart(value) {
    return this.normalizeSeriesName(value)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim()
  }

  normalizeManagementBaseName(value) {
    return this.normalizeSeriesName(value).replace(/[\(\[\{][^\)\]\}]*[\)\]\}]/g, ' ')
  }

  buildSuggestionKey(kind, suggestedName, suggestedSequence) {
    if (kind === 'no_series') return 'no_series'
    const normalizedName = this.normalizeKeyPart(suggestedName)
    const normalizedSequence = this.normalizeSequence(suggestedSequence) || 'none'
    return `${normalizedName || 'unnamed'}::${normalizedSequence}`
  }

  cleanContribution(input) {
    const source = String(input?.source || '')
      .trim()
      .toLowerCase()
    if (!source) return null

    const noSeries = !!input?.noSeries
    const seriesName = noSeries ? null : this.normalizeSeriesName(input?.seriesName || input?.suggestedName || '')
    const sequence = noSeries ? null : this.normalizeSequence(input?.sequence || input?.suggestedSequence || null)
    if (!noSeries && !seriesName) return null

    const confidenceValue = Number(input?.confidence)
    return {
      source,
      label: String(input?.label || source).trim() || source,
      noSeries,
      seriesName,
      sequence,
      confidence: Number.isFinite(confidenceValue) ? Number(confidenceValue.toFixed(3)) : null,
      evidenceUrl: typeof input?.evidenceUrl === 'string' ? input.evidenceUrl.trim() || null : null,
      notes: typeof input?.notes === 'string' ? input.notes.trim() || null : null
    }
  }

  groupContributions(sourceSuggestions) {
    const groups = {}
    for (const rawContribution of Array.isArray(sourceSuggestions) ? sourceSuggestions : []) {
      const contribution = this.cleanContribution(rawContribution)
      if (!contribution) continue
      const kind = contribution.noSeries ? 'no_series' : 'series'
      const suggestionKey = this.buildSuggestionKey(kind, contribution.seriesName, contribution.sequence)
      if (!groups[suggestionKey]) {
        groups[suggestionKey] = {
          kind,
          suggestionKey,
          suggestedName: contribution.seriesName,
          suggestedNameNormalized: contribution.seriesName ? this.normalizeKeyPart(contribution.seriesName) : null,
          suggestedSequence: contribution.sequence,
          contributions: []
        }
      }
      groups[suggestionKey].contributions.push(contribution)
    }
    return Object.values(groups).map((group) => ({
      ...group,
      contributions: group.contributions.sort((a, b) => a.source.localeCompare(b.source))
    }))
  }

  buildSuggestionFingerprint(groupedSuggestion) {
    const contributions = Array.isArray(groupedSuggestion?.contributions) ? groupedSuggestion.contributions : []
    return JSON.stringify({
      kind: groupedSuggestion?.kind || 'series',
      suggestedNameNormalized: groupedSuggestion?.suggestedNameNormalized || null,
      suggestedSequence: groupedSuggestion?.suggestedSequence || null,
      contributions: contributions.map((contribution) => ({
        source: contribution.source || null,
        label: contribution.label || null,
        noSeries: !!contribution.noSeries,
        seriesName: contribution.seriesName || null,
        sequence: contribution.sequence || null,
        confidence: contribution.confidence ?? null,
        evidenceUrl: contribution.evidenceUrl || null,
        notes: contribution.notes || null
      }))
    })
  }

  hasMeaningfulSuggestionChange(existingSuggestion, groupedSuggestion) {
    return this.buildSuggestionFingerprint(existingSuggestion) !== this.buildSuggestionFingerprint(groupedSuggestion)
  }

  buildPreviousDecisionPayload(suggestion) {
    if (!suggestion?.decisionAction || !suggestion?.decidedAt) return null
    return {
      action: suggestion.decisionAction,
      decisionSeriesId: suggestion.decisionSeriesId || null,
      decidedAt: suggestion.decidedAt,
      decidedByUserId: suggestion.decidedByUserId || null,
      reopened: suggestion.state === 'pending'
    }
  }

  buildSuggestionEvidenceSummary(suggestion) {
    const contributions = Array.isArray(suggestion?.contributions) ? suggestion.contributions : []
    const positiveSources = contributions.filter((contribution) => !contribution.noSeries)
    const negativeSources = contributions.filter((contribution) => contribution.noSeries)
    return {
      supportCount: positiveSources.length,
      conflictCount: negativeSources.length,
      disagreement: positiveSources.length > 0 && negativeSources.length > 0,
      hasSourceNotes: contributions.some((contribution) => !!contribution.notes),
      hasEvidenceLinks: contributions.some((contribution) => !!contribution.evidenceUrl)
    }
  }

  buildSeriesListSnapshot(seriesList) {
    return [...(seriesList || [])]
      .map((series) => ({
        name: this.normalizeSeriesName(series.name),
        sequence: this.normalizeSequence(series.sequence)
      }))
      .filter((series) => !!series.name)
      .sort((a, b) => {
        const byName = a.name.localeCompare(b.name)
        if (byName !== 0) return byName
        return String(a.sequence || '').localeCompare(String(b.sequence || ''))
      })
  }

  seriesListsEqual(a, b) {
    return JSON.stringify(this.buildSeriesListSnapshot(a)) === JSON.stringify(this.buildSeriesListSnapshot(b))
  }

  getQueuePath(libraryItem) {
    const relPath = String(libraryItem?.relPath || '')
      .replace(/\\/g, '/')
      .replace(/^\/+/, '')
    if (!relPath) return ''
    if (!libraryItem?.isFile && !relPath.endsWith('/')) return `${relPath}/`
    return relPath
  }

  getCurrentSeriesPayload(libraryItem) {
    return Array.isArray(libraryItem?.media?.series)
      ? libraryItem.media.series.map((series) => ({
          id: series.id,
          name: series.name,
          sequence: series.bookSeries?.sequence || null
        }))
      : []
  }

  buildLibraryItemSeriesSnapshot(libraryItem) {
    const currentTags = Array.isArray(libraryItem?.media?.tags) ? libraryItem.media.tags : []
    return {
      libraryItemId: libraryItem.id,
      title: libraryItem.media?.title || libraryItem.title || '',
      relPath: this.getQueuePath(libraryItem),
      series: this.buildSeriesListSnapshot(this.getCurrentSeriesPayload(libraryItem)),
      hadSeriesEditTag: currentTags.includes(this.SERIES_EDIT_TAG)
    }
  }

  getManagementNameMeta(series) {
    const name = this.normalizeSeriesName(series?.name || '')
    return {
      id: series.id,
      name,
      exactKey: this.normalizeKeyPart(name),
      baseKey: this.normalizeKeyPart(this.normalizeManagementBaseName(name)),
      hasBracketVariant: /[\(\[\{][^\)\]\}]*[\)\]\}]/.test(name),
      punctuationCount: (name.match(/[^a-z0-9\s]/gi) || []).length,
      bookCount: Array.isArray(series.bookSeries) ? series.bookSeries.length : 0
    }
  }

  choosePreferredManagementTarget(entries) {
    return [...entries]
      .sort((a, b) => {
        if (a.hasBracketVariant !== b.hasBracketVariant) return a.hasBracketVariant ? 1 : -1
        if (a.punctuationCount !== b.punctuationCount) return a.punctuationCount - b.punctuationCount
        if (a.name.length !== b.name.length) return a.name.length - b.name.length
        return a.name.localeCompare(b.name)
      })[0]
  }

  buildManagementCandidatePayload(groupKey, entries) {
    const suggestedTarget = this.choosePreferredManagementTarget(entries)
    const uniqueBookIds = new Set()
    entries.forEach((entry) => {
      ;(entry.bookSeries || []).forEach((bookSeries) => {
        if (bookSeries.bookId) uniqueBookIds.add(bookSeries.bookId)
      })
    })
    return {
      groupKey,
      suggestedTargetLabel: suggestedTarget?.name || '',
      labels: entries
        .map((entry) => ({
          id: entry.id,
          name: entry.name,
          bookCount: entry.bookCount
        }))
        .sort((a, b) => a.name.localeCompare(b.name)),
      seriesCount: entries.length,
      affectedBookCount: uniqueBookIds.size
    }
  }

  buildSeriesReviewActionPayload(action) {
    const beforeMap = new Map()
    ;(Array.isArray(action?.beforeData) ? action.beforeData : []).forEach((entry) => {
      beforeMap.set(entry.libraryItemId, entry)
    })

    const changedBooks = (Array.isArray(action?.afterData) ? action.afterData : []).map((entry) => {
      const beforeEntry = beforeMap.get(entry.libraryItemId) || {}
      return {
        libraryItemId: entry.libraryItemId,
        title: entry.title || beforeEntry.title || '',
        relPath: entry.relPath || beforeEntry.relPath || '',
        beforeSeries: beforeEntry.series || [],
        afterSeries: entry.series || [],
        reverted: action?.revertStatus === 'reverted'
      }
    })

    return {
      id: action.id,
      actionType: action.actionType,
      sourceSeriesIds: Array.isArray(action.sourceSeriesIds) ? action.sourceSeriesIds : [],
      sourceSeriesNames: Array.isArray(action.sourceSeriesNames) ? action.sourceSeriesNames : [],
      targetLabel: action.targetLabel,
      revertStatus: action.revertStatus,
      createdAt: action.createdAt,
      revertedAt: action.revertedAt,
      changedCount: changedBooks.length,
      changedBooks
    }
  }

  async getSeriesManagementCandidatesForLibrary(libraryId) {
    const seriesRows = await Database.seriesModel.findAll({
      where: {
        libraryId
      },
      include: [
        {
          model: Database.bookSeriesModel,
          attributes: ['id', 'bookId'],
          required: false
        }
      ],
      order: [['name', 'ASC']]
    })

    const seriesMeta = seriesRows.map((series) => {
      const meta = this.getManagementNameMeta(series)
      return {
        ...meta,
        bookSeries: series.bookSeries || []
      }
    })

    const exactGroups = {}
    seriesMeta.forEach((meta) => {
      if (!meta.exactKey) return
      if (!exactGroups[meta.exactKey]) exactGroups[meta.exactKey] = []
      exactGroups[meta.exactKey].push(meta)
    })

    const candidateGroups = new Map()

    Object.entries(exactGroups).forEach(([key, entries]) => {
      if (entries.length < 2) return
      candidateGroups.set(`exact:${key}`, new Map(entries.map((entry) => [entry.id, entry])))
    })

    seriesMeta.forEach((meta) => {
      if (!meta.hasBracketVariant || !meta.baseKey || meta.baseKey === meta.exactKey) return
      const baseEntries = exactGroups[meta.baseKey] || []
      if (!baseEntries.length) return
      const groupKey = `base:${meta.baseKey}`
      const group = candidateGroups.get(groupKey) || new Map()
      baseEntries.forEach((entry) => group.set(entry.id, entry))
      group.set(meta.id, meta)
      candidateGroups.set(groupKey, group)
    })

    return [...candidateGroups.entries()]
      .map(([groupKey, seriesMap]) => this.buildManagementCandidatePayload(groupKey, [...seriesMap.values()]))
      .filter((candidate) => candidate.labels.length > 1)
      .sort((a, b) => {
        if (b.labels.length !== a.labels.length) return b.labels.length - a.labels.length
        if (b.affectedBookCount !== a.affectedBookCount) return b.affectedBookCount - a.affectedBookCount
        return a.suggestedTargetLabel.localeCompare(b.suggestedTargetLabel)
      })
  }

  async getSeriesManagementSources(libraryId, sourceSeriesIds) {
    const ids = [...new Set((Array.isArray(sourceSeriesIds) ? sourceSeriesIds : []).filter((value) => typeof value === 'string' && value.trim()))]
    if (!ids.length) {
      throw new Error('Missing sourceSeriesIds')
    }

    const sourceSeries = await Database.seriesModel.findAll({
      where: {
        libraryId,
        id: {
          [Op.in]: ids
        }
      },
      order: [['name', 'ASC']]
    })
    if (!sourceSeries.length) {
      throw new Error('No source series found for this library')
    }

    return sourceSeries
  }

  async previewSeriesManagementAction(libraryId, sourceSeriesIds, targetLabel) {
    const sourceSeries = await this.getSeriesManagementSources(libraryId, sourceSeriesIds)
    const normalizedTargetLabel = this.normalizeSeriesName(targetLabel)
    if (!normalizedTargetLabel) {
      throw new Error('Missing targetLabel')
    }

    const sourceIds = sourceSeries.map((series) => series.id)
    const sourceIdSet = new Set(sourceIds)
    const targetLabelLower = normalizedTargetLabel.toLowerCase()

    const bookSeriesRows = await Database.bookSeriesModel.findAll({
      where: {
        seriesId: {
          [Op.in]: sourceIds
        }
      },
      include: [
        {
          model: Database.bookModel,
          include: [
            {
              model: Database.libraryItemModel
            }
          ]
        }
      ]
    })

    const libraryItemIds = [
      ...new Set(
        bookSeriesRows
          .map((bookSeries) => bookSeries.book?.libraryItem?.id)
          .filter((libraryItemId) => !!libraryItemId)
      )
    ]

    if (!libraryItemIds.length) {
      return {
        sourceSeries: sourceSeries.map((series) => ({ id: series.id, name: series.name })),
        targetLabel: normalizedTargetLabel,
        books: [],
        changedCount: 0,
        conflictCount: 0
      }
    }

    const libraryItems = await Database.libraryItemModel.findAllExpandedWhere({
      id: {
        [Op.in]: libraryItemIds
      }
    })

    const books = []
    libraryItems.forEach((libraryItem) => {
      const currentSeries = this.getCurrentSeriesPayload(libraryItem)
      const sourceMemberships = currentSeries.filter((series) => sourceIdSet.has(series.id))
      if (!sourceMemberships.length) return

      const targetMatches = currentSeries.filter((series) => this.normalizeSeriesName(series.name).toLowerCase() === targetLabelLower)
      const targetMatchesOutsideSource = targetMatches.filter((series) => !sourceIdSet.has(series.id))
      const uniqueSequences = [
        ...new Set(
          [...sourceMemberships, ...targetMatchesOutsideSource]
            .map((series) => this.normalizeSequence(series.sequence))
            .filter((sequence) => !!sequence)
        )
      ]

      const conflictReasons = []
      if (sourceMemberships.length > 1) {
        conflictReasons.push('Book already has multiple duplicate labels in this group')
      }
      if (targetMatchesOutsideSource.length) {
        conflictReasons.push('Book already has the chosen target label')
      }
      if (uniqueSequences.length > 1) {
        conflictReasons.push('Book has conflicting sequence values between source and target labels')
      }

      const primarySource = sourceMemberships[0] || null
      const wouldChange =
        !!primarySource &&
        (this.normalizeSeriesName(primarySource.name).toLowerCase() !== targetLabelLower ||
          targetMatchesOutsideSource.length > 0 ||
          sourceMemberships.length > 1)

      if (!wouldChange && !conflictReasons.length) return

      let nextSeriesPreview = null
      if (!conflictReasons.length && primarySource) {
        nextSeriesPreview = currentSeries
          .filter((series) => !sourceIdSet.has(series.id))
          .map((series) => ({
            name: series.name,
            sequence: series.sequence || null
          }))
        const targetIndex = nextSeriesPreview.findIndex((series) => this.normalizeSeriesName(series.name).toLowerCase() === targetLabelLower)
        const targetEntry = {
          name: normalizedTargetLabel,
          sequence: primarySource.sequence || null
        }
        if (targetIndex === -1) nextSeriesPreview.push(targetEntry)
        else nextSeriesPreview.splice(targetIndex, 1, targetEntry)
        nextSeriesPreview = this.buildSeriesListSnapshot(nextSeriesPreview)
      }

      books.push({
        libraryItemId: libraryItem.id,
        title: libraryItem.media?.title || libraryItem.title || '',
        relPath: this.getQueuePath(libraryItem),
        authors: Array.isArray(libraryItem.media?.authors) ? libraryItem.media.authors.map((author) => ({ id: author.id, name: author.name })) : [],
        currentSeries,
        sourceSeries: sourceMemberships,
        conflictReasons,
        includedByDefault: wouldChange && !conflictReasons.length,
        nextSeriesPreview
      })
    })

    return {
      sourceSeries: sourceSeries.map((series) => ({ id: series.id, name: series.name })),
      targetLabel: normalizedTargetLabel,
      books,
      changedCount: books.filter((book) => book.includedByDefault).length,
      conflictCount: books.filter((book) => book.conflictReasons.length).length
    }
  }

  async getRecentSeriesManagementActionsForLibrary(libraryId, limit = 5) {
    const actions = await Database.seriesReviewActionModel.findAll({
      where: {
        libraryId
      },
      order: [['createdAt', 'DESC']],
      limit
    })

    return actions.map((action) => this.buildSeriesReviewActionPayload(action))
  }

  async setSeriesEditTagPresence(libraryItem, shouldHaveTag) {
    const currentTags = Array.isArray(libraryItem?.media?.tags) ? libraryItem.media.tags : []
    const hasTag = currentTags.includes(this.SERIES_EDIT_TAG)
    if (hasTag === shouldHaveTag) return false

    const nextTags = shouldHaveTag ? [...currentTags, this.SERIES_EDIT_TAG] : currentTags.filter((tag) => tag !== this.SERIES_EDIT_TAG)
    const hasTagUpdates = await libraryItem.media.updateFromRequest({ tags: nextTags })
    if (hasTagUpdates && shouldHaveTag) {
      Database.addTagsToFilterData(libraryItem.libraryId, [this.SERIES_EDIT_TAG])
    }
    return hasTagUpdates
  }

  async importSuggestionsForLibrary(libraryId, rows) {
    const now = new Date()
    const results = []

    for (const row of Array.isArray(rows) ? rows : []) {
      const libraryItemId = typeof row?.libraryItemId === 'string' ? row.libraryItemId : null
      if (!libraryItemId) continue

      const libraryItem = await Database.libraryItemModel.findOne({
        where: {
          id: libraryItemId,
          libraryId,
          mediaType: 'book'
        }
      })
      if (!libraryItem) {
        Logger.warn(`[SeriesReviewManager] Skipping suggestion import for missing/non-book item ${libraryItemId}`)
        continue
      }

      const groupedSuggestions = this.groupContributions(row.sourceSuggestions)
      const incomingKeys = groupedSuggestions.map((group) => group.suggestionKey)
      const existingSuggestions = await Database.seriesReviewSuggestionModel.findAll({
        where: {
          libraryId,
          libraryItemId
        }
      })

      for (const existing of existingSuggestions) {
        if (!incomingKeys.includes(existing.suggestionKey) && existing.isActive) {
          existing.isActive = false
          await existing.save()
        }
      }

      for (const groupedSuggestion of groupedSuggestions) {
        let suggestion = existingSuggestions.find((existing) => existing.suggestionKey === groupedSuggestion.suggestionKey)
        if (!suggestion) {
          suggestion = await Database.seriesReviewSuggestionModel.create({
            libraryId,
            libraryItemId,
            ...groupedSuggestion,
            firstSeenAt: now,
            lastSeenAt: now,
            isActive: true
          })
        } else {
          const shouldReopen = suggestion.state !== 'pending' && this.hasMeaningfulSuggestionChange(suggestion, groupedSuggestion)
          suggestion.kind = groupedSuggestion.kind
          suggestion.suggestedName = groupedSuggestion.suggestedName
          suggestion.suggestedNameNormalized = groupedSuggestion.suggestedNameNormalized
          suggestion.suggestedSequence = groupedSuggestion.suggestedSequence
          suggestion.contributions = groupedSuggestion.contributions
          suggestion.lastSeenAt = now
          suggestion.isActive = true
          if (shouldReopen) {
            suggestion.state = 'pending'
          }
          await suggestion.save()
        }
        results.push(suggestion)
      }
    }

    return {
      importedCount: results.length
    }
  }

  async resetSuggestionsForLibrary(libraryId, libraryItemIds) {
    const ids = [...new Set((Array.isArray(libraryItemIds) ? libraryItemIds : []).filter((value) => typeof value === 'string' && value.trim()))]
    if (!ids.length) return { deletedCount: 0 }

    const deletedCount = await Database.seriesReviewSuggestionModel.destroy({
      where: {
        libraryId,
        libraryItemId: {
          [Op.in]: ids
        }
      }
    })

    return {
      deletedCount
    }
  }

  buildSuggestionPayload(suggestion) {
    const contributions = Array.isArray(suggestion.contributions) ? suggestion.contributions : []
    return {
      id: suggestion.id,
      kind: suggestion.kind,
      suggestionKey: suggestion.suggestionKey,
      suggestedName: suggestion.suggestedName,
      suggestedSequence: suggestion.suggestedSequence,
      state: suggestion.state,
      decisionAction: suggestion.decisionAction,
      decisionSeriesId: suggestion.decisionSeriesId,
      contributions,
      sourceCount: contributions.length,
      firstSeenAt: suggestion.firstSeenAt,
      lastSeenAt: suggestion.lastSeenAt,
      decidedAt: suggestion.decidedAt,
      previousDecision: this.buildPreviousDecisionPayload(suggestion),
      hasMeaningfulUpdateSinceDecision: suggestion.state === 'pending' && !!suggestion.decisionAction && !!suggestion.decidedAt,
      evidenceSummary: this.buildSuggestionEvidenceSummary(suggestion)
    }
  }

  sortSuggestionsForDisplay(suggestions) {
    return [...(suggestions || [])].sort((a, b) => {
      const aPriority = a.kind === 'series' ? 0 : 1
      const bPriority = b.kind === 'series' ? 0 : 1
      if (aPriority !== bPriority) return aPriority - bPriority
      if ((b.sourceCount || 0) !== (a.sourceCount || 0)) return (b.sourceCount || 0) - (a.sourceCount || 0)
      return String(a.suggestedName || '').localeCompare(String(b.suggestedName || ''))
    })
  }

  buildQueueRow(libraryItem, suggestions) {
    const media = libraryItem.media
    const suggestionPayloads = suggestions.map((suggestion) => this.buildSuggestionPayload(suggestion))
    const currentTags = Array.isArray(media?.tags) ? media.tags : []
    return {
      libraryItemId: libraryItem.id,
      title: media?.title || libraryItem.title || '',
      relPath: this.getQueuePath(libraryItem),
      authors: Array.isArray(media?.authors) ? media.authors.map((author) => ({ id: author.id, name: author.name })) : [],
      hasPreviousSeriesEdit: currentTags.includes(this.SERIES_EDIT_TAG),
      seriesEditTag: currentTags.includes(this.SERIES_EDIT_TAG) ? this.SERIES_EDIT_TAG : null,
      currentSeries: this.getCurrentSeriesPayload(libraryItem),
      suggestions: this.sortSuggestionsForDisplay(suggestionPayloads)
    }
  }

  async getQueueForLibrary(libraryId, includeDecided = false) {
    const where = {
      libraryId,
      isActive: true
    }
    if (!includeDecided) where.state = 'pending'

    const suggestions = await Database.seriesReviewSuggestionModel.findAll({
      where,
      order: [
        ['libraryItemId', 'ASC'],
        ['kind', 'ASC'],
        ['lastSeenAt', 'DESC']
      ]
    })
    if (!suggestions.length) return []

    const libraryItemIds = [...new Set(suggestions.map((suggestion) => suggestion.libraryItemId))]
    const libraryItems = await Database.libraryItemModel.findAllExpandedWhere({
      id: {
        [Op.in]: libraryItemIds
      }
    })
    const libraryItemMap = {}
    libraryItems.forEach((libraryItem) => {
      libraryItemMap[libraryItem.id] = libraryItem
    })

    const suggestionsByItemId = {}
    suggestions.forEach((suggestion) => {
      if (!suggestionsByItemId[suggestion.libraryItemId]) suggestionsByItemId[suggestion.libraryItemId] = []
      suggestionsByItemId[suggestion.libraryItemId].push(suggestion)
    })

    return libraryItemIds
      .map((libraryItemId) => {
        const libraryItem = libraryItemMap[libraryItemId]
        if (!libraryItem) return null
        return this.buildQueueRow(libraryItem, suggestionsByItemId[libraryItemId] || [])
      })
      .filter(Boolean)
      .sort((a, b) => {
        const aPriority = a.currentSeries.length ? 1 : 0
        const bPriority = b.currentSeries.length ? 1 : 0
        if (aPriority !== bPriority) return aPriority - bPriority
        return a.title.localeCompare(b.title)
      })
  }

  async getSuggestionById(suggestionId) {
    if (!suggestionId) return null
    return Database.seriesReviewSuggestionModel.findByPk(suggestionId)
  }

  async checkRemoveEmptySeries(seriesIds) {
    if (!seriesIds?.length) return
    const ids = [...new Set(seriesIds)]
    const seriesToRemove = await Database.seriesModel.findAll({
      where: {
        id: ids
      },
      include: [
        {
          model: Database.bookSeriesModel,
          attributes: [],
          required: false
        }
      ],
      group: ['series.id'],
      having: literal('COUNT(`bookSeries`.`id`) = 0')
    })
    if (!seriesToRemove.length) return
    await Database.seriesModel.destroy({
      where: {
        id: seriesToRemove.map((series) => series.id)
      }
    })
  }

  async ensureSeriesEditTag(libraryItem) {
    return this.setSeriesEditTagPresence(libraryItem, true)
  }

  async persistLibraryItemSeriesChange(libraryItem, seriesUpdateData, { addSeriesEditTag = false, setSeriesEditTag = null } = {}) {
    if (seriesUpdateData?.seriesRemoved?.length) {
      await this.checkRemoveEmptySeries(seriesUpdateData.seriesRemoved.map((series) => series.id))
    }
    if (seriesUpdateData?.seriesAdded?.length) {
      seriesUpdateData.seriesAdded.forEach((series) => {
        Database.addSeriesToFilterData(libraryItem.libraryId, series.name, series.id)
      })
    }
    if (typeof setSeriesEditTag === 'boolean') {
      await this.setSeriesEditTagPresence(libraryItem, setSeriesEditTag)
    } else if (addSeriesEditTag) {
      await this.ensureSeriesEditTag(libraryItem)
    }

    libraryItem.changed('updatedAt', true)
    await libraryItem.save()
    await libraryItem.saveMetadataFile()
  }

  async applySeriesManagementAction(libraryId, userId, sourceSeriesIds, targetLabel, includedLibraryItemIds) {
    const preview = await this.previewSeriesManagementAction(libraryId, sourceSeriesIds, targetLabel)
    const includedSet = new Set((Array.isArray(includedLibraryItemIds) ? includedLibraryItemIds : []).filter((value) => typeof value === 'string' && value.trim()))
    const selectedBooks = preview.books.filter((book) => includedSet.has(book.libraryItemId))

    if (!selectedBooks.length) {
      throw new Error('No books selected for apply')
    }
    if (selectedBooks.some((book) => book.conflictReasons.length)) {
      throw new Error('Conflicting books must be excluded before apply')
    }

    const beforeData = []
    const afterData = []

    for (const book of selectedBooks) {
      const libraryItem = await Database.libraryItemModel.getExpandedById(book.libraryItemId)
      if (!libraryItem || !libraryItem.isBook) {
        throw new Error(`Book ${book.libraryItemId} was not found`)
      }

      beforeData.push(this.buildLibraryItemSeriesSnapshot(libraryItem))
      const seriesUpdateData = await libraryItem.media.updateSeriesFromRequest(book.nextSeriesPreview || [], libraryItem.libraryId)
      await this.persistLibraryItemSeriesChange(libraryItem, seriesUpdateData, { addSeriesEditTag: true })
      const updatedLibraryItem = await Database.libraryItemModel.getExpandedById(book.libraryItemId)
      afterData.push(this.buildLibraryItemSeriesSnapshot(updatedLibraryItem))
    }

    const action = await Database.seriesReviewActionModel.create({
      libraryId,
      userId: userId || null,
      sourceSeriesIds: preview.sourceSeries.map((series) => series.id),
      sourceSeriesNames: preview.sourceSeries.map((series) => series.name),
      targetLabel: preview.targetLabel,
      beforeData,
      afterData
    })

    return {
      action: this.buildSeriesReviewActionPayload(action),
      changedCount: selectedBooks.length,
      conflictCount: preview.conflictCount
    }
  }

  async revertSeriesManagementAction(actionId, userId) {
    if (!actionId) return null
    const action = await Database.seriesReviewActionModel.findByPk(actionId)
    if (!action) return null
    if (action.revertStatus === 'reverted') {
      return {
        action: this.buildSeriesReviewActionPayload(action),
        reverted: 0,
        failed: 0,
        failures: []
      }
    }

    const beforeMap = new Map()
    ;(Array.isArray(action.beforeData) ? action.beforeData : []).forEach((entry) => {
      beforeMap.set(entry.libraryItemId, entry)
    })

    let reverted = 0
    let failed = 0
    const failures = []

    for (const afterEntry of Array.isArray(action.afterData) ? action.afterData : []) {
      const beforeEntry = beforeMap.get(afterEntry.libraryItemId)
      if (!beforeEntry) continue

      try {
        const libraryItem = await Database.libraryItemModel.getExpandedById(afterEntry.libraryItemId)
        if (!libraryItem || !libraryItem.isBook) {
          throw new Error('Book not found')
        }

        const currentSeries = this.buildSeriesListSnapshot(this.getCurrentSeriesPayload(libraryItem))
        if (!this.seriesListsEqual(currentSeries, afterEntry.series || [])) {
          throw new Error('Book series changed after the action; refusing unsafe revert')
        }

        const seriesUpdateData = await libraryItem.media.updateSeriesFromRequest(beforeEntry.series || [], libraryItem.libraryId)
        await this.persistLibraryItemSeriesChange(libraryItem, seriesUpdateData, {
          setSeriesEditTag: !!beforeEntry.hadSeriesEditTag
        })
        reverted++
      } catch (error) {
        failed++
        failures.push({
          libraryItemId: afterEntry.libraryItemId,
          title: afterEntry.title || beforeEntry.title || '',
          error: String(error?.message || error)
        })
        Logger.error(`[SeriesReviewManager] Failed to revert series management action ${action.id} for item ${afterEntry.libraryItemId}`, error)
      }
    }

    if (failed === 0) {
      action.revertStatus = 'reverted'
      action.revertedAt = new Date()
      action.revertedByUserId = userId || null
      await action.save()
    }

    return {
      action: this.buildSeriesReviewActionPayload(action),
      reverted,
      failed,
      failures
    }
  }

  async applySuggestion(suggestionId, userId, mode, replaceSeriesId = null) {
    const suggestion = await this.getSuggestionById(suggestionId)
    if (!suggestion || !suggestion.isActive) return null
    if (suggestion.kind === 'no_series') throw new Error('No-series evidence cannot be applied')

    const libraryItem = await Database.libraryItemModel.getExpandedById(suggestion.libraryItemId)
    if (!libraryItem || !libraryItem.isBook) return null

    const currentSeries = Array.isArray(libraryItem.media.series) ? libraryItem.media.series : []
    let nextSeries = currentSeries.map((series) => ({
      name: series.name,
      sequence: series.bookSeries?.sequence || null
    }))

    if (mode === 'replace') {
      const seriesToReplace = currentSeries.find((series) => series.id === replaceSeriesId)
      if (!seriesToReplace) throw new Error('Selected series entry was not found on the book')
      nextSeries = nextSeries.filter((series) => series.name.toLowerCase() !== seriesToReplace.name.toLowerCase())
    } else if (mode !== 'add') {
      throw new Error(`Unsupported apply mode "${mode}"`)
    }

    const suggestedSeriesObject = {
      name: suggestion.suggestedName,
      sequence: suggestion.suggestedSequence || null
    }
    const existingSuggestedIndex = nextSeries.findIndex((series) => series.name.toLowerCase() === suggestion.suggestedName.toLowerCase())
    if (existingSuggestedIndex === -1) nextSeries.push(suggestedSeriesObject)
    else nextSeries[existingSuggestedIndex] = suggestedSeriesObject

    const seriesUpdateData = await libraryItem.media.updateSeriesFromRequest(nextSeries, libraryItem.libraryId)
    await this.persistLibraryItemSeriesChange(libraryItem, seriesUpdateData, { addSeriesEditTag: true })

    suggestion.state = mode === 'replace' ? 'manual_override' : 'applied'
    suggestion.decisionAction = mode
    suggestion.decisionSeriesId = replaceSeriesId || null
    suggestion.decidedByUserId = userId || null
    suggestion.decidedAt = new Date()
    await suggestion.save()

    return {
      suggestion,
      libraryItem: await Database.libraryItemModel.getExpandedById(libraryItem.id)
    }
  }

  async removeSeriesEntry(libraryItemId, seriesId) {
    if (!libraryItemId) return null
    const libraryItem = await Database.libraryItemModel.getExpandedById(libraryItemId)
    if (!libraryItem || !libraryItem.isBook) return null

    const currentSeries = Array.isArray(libraryItem.media.series) ? libraryItem.media.series : []
    const seriesToRemove = currentSeries.find((series) => series.id === seriesId)
    if (!seriesToRemove) throw new Error('Selected series entry was not found on the book')

    const nextSeries = currentSeries
      .filter((series) => series.id !== seriesId)
      .map((series) => ({
        name: series.name,
        sequence: series.bookSeries?.sequence || null
      }))

    const seriesUpdateData = await libraryItem.media.updateSeriesFromRequest(nextSeries, libraryItem.libraryId)
    await this.persistLibraryItemSeriesChange(libraryItem, seriesUpdateData, { addSeriesEditTag: true })

    return {
      libraryItem: await Database.libraryItemModel.getExpandedById(libraryItem.id)
    }
  }

  async dismissSuggestion(suggestionId, userId) {
    const suggestion = await this.getSuggestionById(suggestionId)
    if (!suggestion) return null
    suggestion.state = 'dismissed'
    suggestion.decisionAction = 'dismiss'
    suggestion.decisionSeriesId = null
    suggestion.decidedByUserId = userId || null
    suggestion.decidedAt = new Date()
    await suggestion.save()
    return suggestion
  }
}

module.exports = new SeriesReviewManager()
