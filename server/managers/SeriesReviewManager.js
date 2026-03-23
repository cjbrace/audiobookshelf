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
          suggestion.kind = groupedSuggestion.kind
          suggestion.suggestedName = groupedSuggestion.suggestedName
          suggestion.suggestedNameNormalized = groupedSuggestion.suggestedNameNormalized
          suggestion.suggestedSequence = groupedSuggestion.suggestedSequence
          suggestion.contributions = groupedSuggestion.contributions
          suggestion.lastSeenAt = now
          suggestion.isActive = true
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
      lastSeenAt: suggestion.lastSeenAt,
      decidedAt: suggestion.decidedAt
    }
  }

  getQueuePath(libraryItem) {
    const relPath = String(libraryItem?.relPath || '')
      .replace(/\\/g, '/')
      .replace(/^\/+/, '')
    if (!relPath) return ''
    if (!libraryItem?.isFile && !relPath.endsWith('/')) return `${relPath}/`
    return relPath
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

  getCurrentSeriesPayload(libraryItem) {
    return Array.isArray(libraryItem?.media?.series)
      ? libraryItem.media.series.map((series) => ({
          id: series.id,
          name: series.name,
          sequence: series.bookSeries?.sequence || null
        }))
      : []
  }

  buildQueueRow(libraryItem, suggestions) {
    const media = libraryItem.media
    const suggestionPayloads = suggestions.map((suggestion) => this.buildSuggestionPayload(suggestion))
    return {
      libraryItemId: libraryItem.id,
      title: media?.title || libraryItem.title || '',
      relPath: this.getQueuePath(libraryItem),
      authors: Array.isArray(media?.authors) ? media.authors.map((author) => ({ id: author.id, name: author.name })) : [],
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
    const currentTags = Array.isArray(libraryItem?.media?.tags) ? libraryItem.media.tags : []
    if (currentTags.includes(this.SERIES_EDIT_TAG)) return false
    const nextTags = [...currentTags, this.SERIES_EDIT_TAG]
    const hasTagUpdates = await libraryItem.media.updateFromRequest({ tags: nextTags })
    if (hasTagUpdates) Database.addTagsToFilterData(libraryItem.libraryId, [this.SERIES_EDIT_TAG])
    return hasTagUpdates
  }

  async persistLibraryItemSeriesChange(libraryItem, seriesUpdateData, { addSeriesEditTag = false } = {}) {
    if (seriesUpdateData?.seriesRemoved?.length) {
      await this.checkRemoveEmptySeries(seriesUpdateData.seriesRemoved.map((series) => series.id))
    }
    if (seriesUpdateData?.seriesAdded?.length) {
      seriesUpdateData.seriesAdded.forEach((series) => {
        Database.addSeriesToFilterData(libraryItem.libraryId, series.name, series.id)
      })
    }
    if (addSeriesEditTag) {
      await this.ensureSeriesEditTag(libraryItem)
    }

    libraryItem.changed('updatedAt', true)
    await libraryItem.save()
    await libraryItem.saveMetadataFile()
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
