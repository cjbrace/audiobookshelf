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

  normalizeSearchText(value) {
    return String(value || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim()
  }

  tokenizeSearchText(value) {
    const normalized = this.normalizeSearchText(value)
    return normalized ? normalized.split(/\s+/).filter(Boolean) : []
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

  getSourceRoleMeta(source) {
    const normalizedSource = String(source || '')
      .trim()
      .toLowerCase()
    if (normalizedSource === 'fictiondb') {
      return { role: 'automated_primary', roleLabel: 'Primary automated', roleWeight: 6 }
    }
    if (normalizedSource === 'wikidata') {
      return { role: 'automated_secondary', roleLabel: 'Secondary automated', roleWeight: 4 }
    }
    if (['goodreads', 'fantasticfiction', 'librarything'].includes(normalizedSource)) {
      return { role: 'manual_reference', roleLabel: 'Manual reference', roleWeight: 1 }
    }
    return { role: 'other', roleLabel: 'Other source', roleWeight: 2 }
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
    const sourceRole = this.getSourceRoleMeta(source)
    return {
      source,
      label: String(input?.label || source).trim() || source,
      role: sourceRole.role,
      roleLabel: sourceRole.roleLabel,
      roleWeight: sourceRole.roleWeight,
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
    const automatedSources = positiveSources.filter((contribution) => contribution.role === 'automated_primary' || contribution.role === 'automated_secondary')
    const manualReferenceSources = positiveSources.filter((contribution) => contribution.role === 'manual_reference')
    const sourceCodes = new Set(positiveSources.map((contribution) => contribution.source))
    return {
      supportCount: positiveSources.length,
      conflictCount: negativeSources.length,
      disagreement: positiveSources.length > 0 && negativeSources.length > 0,
      automatedSupportCount: automatedSources.length,
      manualReferenceCount: manualReferenceSources.length,
      sourceStrength: positiveSources.reduce((total, contribution) => total + (contribution.roleWeight || 0), 0),
      automatedAgreement: sourceCodes.has('fictiondb') && sourceCodes.has('wikidata'),
      hasPrimaryAutomatedSource: sourceCodes.has('fictiondb'),
      hasSecondaryAutomatedSource: sourceCodes.has('wikidata'),
      hasSourceNotes: contributions.some((contribution) => !!contribution.notes),
      hasEvidenceLinks: contributions.some((contribution) => !!contribution.evidenceUrl)
    }
  }

  getSuggestionPriorityScore(suggestionPayload) {
    const evidenceSummary = suggestionPayload?.evidenceSummary || {}
    let score = 0
    if (suggestionPayload?.kind === 'series') score += 1000
    if (evidenceSummary.automatedAgreement) score += 200
    score += Number(evidenceSummary.sourceStrength || 0) * 10
    score += Number(suggestionPayload?.sourceCount || 0)
    return score
  }

  analyzeSuggestionSet(suggestionPayloads) {
    const positiveSuggestions = suggestionPayloads.filter((suggestion) => suggestion.kind === 'series')
    const noSeriesSuggestions = suggestionPayloads.filter((suggestion) => suggestion.kind === 'no_series')
    const positiveNames = [...new Set(positiveSuggestions.map((suggestion) => suggestion.suggestedName).filter(Boolean))]
    const sequenceByName = new Map()

    positiveSuggestions.forEach((suggestion) => {
      const nameKey = suggestion.suggestedName || ''
      if (!sequenceByName.has(nameKey)) sequenceByName.set(nameKey, new Set())
      sequenceByName.get(nameKey).add(suggestion.suggestedSequence || '')
    })

    const hasNoSeriesConflict = positiveSuggestions.length > 0 && noSeriesSuggestions.length > 0
    const hasOrdinalConflict = [...sequenceByName.values()].some((sequences) => [...sequences].filter(Boolean).length > 1)
    const hasSeriesNameConflict = positiveNames.length > 1

    let conflictType = null
    let conflictSummary = ''
    let queuePriority = 3
    if (hasNoSeriesConflict) {
      conflictType = 'no_series_conflict'
      conflictSummary = 'Series vs no-series conflict'
      queuePriority = 0
    } else if (hasOrdinalConflict) {
      conflictType = 'ordinal_conflict'
      conflictSummary = 'Ordinal conflict between sources'
      queuePriority = 1
    } else if (hasSeriesNameConflict) {
      conflictType = 'series_name_conflict'
      conflictSummary = 'Series-name conflict between sources'
      queuePriority = 2
    }

    return {
      conflictType,
      conflictSummary,
      queuePriority
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

  cleanCatalogSource(input) {
    const source = String(input?.source || '')
      .trim()
      .toLowerCase()
    if (!source) return null

    const confidenceValue = Number(input?.confidence)
    return {
      source,
      label: String(input?.label || source).trim() || source,
      confidence: Number.isFinite(confidenceValue) ? Number(confidenceValue.toFixed(3)) : null,
      evidenceUrl: typeof input?.evidenceUrl === 'string' ? input.evidenceUrl.trim() || null : null,
      notes: typeof input?.notes === 'string' ? input.notes.trim() || null : null
    }
  }

  normalizeCatalogSlotToken(value) {
    const cleaned = String(value || '')
      .trim()
      .replace(/\s+/g, '')
    return cleaned || null
  }

  expandCatalogSequenceCoverage(sequenceLabel) {
    const normalizedLabel = String(sequenceLabel || '')
      .trim()
      .replace(/\s+/g, ' ')
    if (!normalizedLabel) return []

    const slots = new Set()
    normalizedLabel.split(',').forEach((rawPart) => {
      const part = this.normalizeCatalogSlotToken(rawPart)
      if (!part) return

      const rangeMatch = part.match(/^(\d+)-(\d+)$/)
      if (rangeMatch) {
        const start = Number(rangeMatch[1])
        const end = Number(rangeMatch[2])
        if (Number.isInteger(start) && Number.isInteger(end) && end >= start) {
          for (let value = start; value <= end; value++) {
            slots.add(String(value))
          }
          return
        }
      }

      slots.add(part)
    })

    return [...slots]
  }

  isIntegerCatalogSlot(slot) {
    return /^\d+$/.test(String(slot || ''))
  }

  isDecimalCatalogSlot(slot) {
    return /^\d+\.\d+$/.test(String(slot || ''))
  }

  buildCatalogEntryKey(entry) {
    const titleKey = this.normalizeKeyPart(entry?.title || 'untitled')
    const sequenceKey = this.normalizeCatalogSlotToken(entry?.sequenceLabel || '') || 'unsequenced'
    return `${titleKey || 'untitled'}::${sequenceKey}`
  }

  normalizeCatalogEntries(entries) {
    return (Array.isArray(entries) ? entries : [])
      .map((entry) => {
        const title = this.normalizeSeriesName(entry?.title || '')
        const authors = (Array.isArray(entry?.authors) ? entry.authors : [entry?.author])
          .map((author) => this.normalizeSeriesName(author || ''))
          .filter(Boolean)
        const sequenceLabel = String(entry?.sequenceLabel || entry?.sequence || '')
          .trim()
          .replace(/\s+/g, ' ')
        const explicitCoveredSlots = Array.isArray(entry?.coveredSlots)
          ? entry.coveredSlots
              .map((slot) => this.normalizeCatalogSlotToken(slot))
              .filter(Boolean)
          : []
        const coveredSlots = explicitCoveredSlots.length ? explicitCoveredSlots : this.expandCatalogSequenceCoverage(sequenceLabel)
        const sources = (Array.isArray(entry?.sources) ? entry.sources : [])
          .map((source) => this.cleanCatalogSource(source))
          .filter(Boolean)

        if (!title) return null

        return {
          entryKey: this.buildCatalogEntryKey({ title, sequenceLabel }),
          title,
          authors,
          sequenceLabel: sequenceLabel || null,
          coveredSlots,
          sources
        }
      })
      .filter(Boolean)
  }

  buildSeriesReviewCatalogPayload(catalog) {
    return {
      id: catalog.id,
      seriesName: catalog.seriesName,
      trustStatus: catalog.trustStatus,
      entryCount: Array.isArray(catalog.entries) ? catalog.entries.length : 0
    }
  }

  async importCatalogForLibrary(libraryId, rows) {
    const results = []

    for (const row of Array.isArray(rows) ? rows : []) {
      const seriesName = this.normalizeSeriesName(row?.seriesName || '')
      if (!seriesName) continue

      const seriesNameNormalized = this.normalizeKeyPart(seriesName)
      const trustStatus = row?.trustStatus === 'untrusted' ? 'untrusted' : 'trusted'
      const entries = this.normalizeCatalogEntries(row?.entries)
      const selectionBySlot =
        row?.selectionBySlot && typeof row.selectionBySlot === 'object' && !Array.isArray(row.selectionBySlot)
          ? row.selectionBySlot
          : {}

      let catalog = await Database.seriesReviewCatalogModel.findOne({
        where: {
          libraryId,
          seriesNameNormalized
        }
      })

      if (!catalog) {
        catalog = await Database.seriesReviewCatalogModel.create({
          libraryId,
          seriesName,
          seriesNameNormalized,
          trustStatus,
          entries,
          selectionBySlot
        })
      } else {
        catalog.seriesName = seriesName
        catalog.trustStatus = trustStatus
        catalog.entries = entries
        catalog.selectionBySlot = selectionBySlot
        await catalog.save()
      }

      results.push(this.buildSeriesReviewCatalogPayload(catalog))
    }

    return {
      importedCount: results.length,
      catalogs: results
    }
  }

  async getCatalogsForLibrary(libraryId, includeUntrusted = false) {
    const where = { libraryId }
    if (!includeUntrusted) where.trustStatus = 'trusted'

    const catalogs = await Database.seriesReviewCatalogModel.findAll({
      where,
      order: [['seriesName', 'ASC']]
    })

    const detailSummaries = []
    for (const catalog of catalogs) {
      const detail = await this.getCatalogDetailForLibrary(libraryId, catalog.id)
      detailSummaries.push({
        ...this.buildSeriesReviewCatalogPayload(catalog),
        missingCount: detail.slots.filter((slot) => slot.status === 'missing').length,
        disputedCount: detail.slots.filter((slot) => slot.status === 'disputed').length,
        localBookCount: detail.localBooks.length,
        unsequencedCount: detail.unsequencedBooks.length
      })
    }

    return detailSummaries
  }

  async getMatchingSeriesRowsForCatalog(libraryId, seriesNameNormalized) {
    const seriesRows = await Database.seriesModel.findAll({
      where: {
        libraryId
      },
      order: [['name', 'ASC']]
    })
    return seriesRows.filter((series) => this.normalizeKeyPart(series.name) === seriesNameNormalized)
  }

  async getLocalCatalogBooks(libraryId, seriesNameNormalized) {
    const matchingSeries = await this.getMatchingSeriesRowsForCatalog(libraryId, seriesNameNormalized)
    const localBooks = []
    const seen = new Set()

    for (const series of matchingSeries) {
      const expandedSeries = await Database.seriesModel.getExpandedById(series.id)
      for (const book of expandedSeries?.books || []) {
        const libraryItem = book.libraryItem
        if (!libraryItem?.id || seen.has(libraryItem.id)) continue
        seen.add(libraryItem.id)

        const sequence = this.normalizeSequence(book.bookSeries?.sequence || null)
        localBooks.push({
          libraryItemId: libraryItem.id,
          title: book.title || libraryItem.title || '',
          relPath: this.getQueuePath(libraryItem),
          authors: Array.isArray(book.authors) ? book.authors.map((author) => ({ id: author.id, name: author.name })) : [],
          sequence,
          seriesName: series.name
        })
      }
    }

    return localBooks.sort((a, b) => {
      const aSeq = a.sequence || 'zzzz'
      const bSeq = b.sequence || 'zzzz'
      if (aSeq !== bSeq) return aSeq.localeCompare(bSeq, undefined, { numeric: true })
      return a.title.localeCompare(b.title)
    })
  }

  ensureCatalogSlot(map, slot) {
    const normalizedSlot = this.normalizeCatalogSlotToken(slot)
    if (!normalizedSlot) return null
    if (!map.has(normalizedSlot)) {
      map.set(normalizedSlot, {
        slot: normalizedSlot,
        isDecimal: this.isDecimalCatalogSlot(normalizedSlot),
        locallyCovered: false,
        localBooks: [],
        sourceCovered: false,
        choices: [],
        selectedEntryKey: null,
        expectedTitle: null,
        sourceSupport: [],
        status: 'covered'
      })
    }
    return map.get(normalizedSlot)
  }

  buildCatalogSourceSupport(sources) {
    return (sources || []).map((source) => ({
      source: source.source,
      label: source.label,
      confidence: source.confidence,
      evidenceUrl: source.evidenceUrl,
      notes: source.notes
    }))
  }

  buildCatalogCandidateReason(key, text) {
    return {
      key,
      text
    }
  }

  computeCatalogCandidateMatch(context, libraryItem) {
    const media = libraryItem?.media || {}
    const title = this.normalizeSeriesName(media.title || libraryItem.title || '')
    const relPath = this.getQueuePath(libraryItem)
    const authors = Array.isArray(media.authors) ? media.authors.map((author) => this.normalizeSeriesName(author.name || '')) : []
    const seriesNames = Array.isArray(media.series) ? media.series.map((series) => this.normalizeSeriesName(series.name || '')) : []

    const titleNormalized = this.normalizeSearchText(title)
    const relPathNormalized = this.normalizeSearchText(relPath)
    const expectedTitleNormalized = context.expectedTitleNormalized
    const expectedAuthorNormalized = context.expectedAuthorNormalized
    const expectedSeriesNormalized = context.seriesNameNormalized

    const titleTokens = this.tokenizeSearchText(title)
    const expectedTitleTokens = context.expectedTitleTokens
    const expectedAuthorTokens = context.expectedAuthorTokens
    const expectedSeriesTokens = context.expectedSeriesTokens

    const reasons = []
    let score = 0

    if (expectedTitleNormalized && titleNormalized === expectedTitleNormalized) {
      score += 12
      reasons.push(this.buildCatalogCandidateReason('title-exact', 'Title matches expected title'))
    } else {
      const titleOverlap = expectedTitleTokens.filter((token) => titleTokens.includes(token))
      if (expectedTitleTokens.length && titleOverlap.length) {
        score += titleOverlap.length * 3
        reasons.push(this.buildCatalogCandidateReason('title-token', `Title shares ${titleOverlap.length} expected token${titleOverlap.length === 1 ? '' : 's'}`))
      }
    }

    const authorMatches = authors.filter((author) => expectedAuthorNormalized.some((expected) => expected && this.normalizeSearchText(author) === expected))
    if (authorMatches.length) {
      score += authorMatches.length * 4
      reasons.push(this.buildCatalogCandidateReason('author-exact', `Author match: ${authorMatches[0]}`))
    } else if (expectedAuthorTokens.length) {
      const authorTokenHit = expectedAuthorTokens.some((token) => this.tokenizeSearchText(authors.join(' ')).includes(token))
      if (authorTokenHit) {
        score += 2
        reasons.push(this.buildCatalogCandidateReason('author-token', 'Author tokens overlap'))
      }
    }

    if (expectedSeriesNormalized && seriesNames.some((seriesName) => this.normalizeKeyPart(seriesName) === expectedSeriesNormalized)) {
      score += 4
      reasons.push(this.buildCatalogCandidateReason('series-match', `Current series includes ${context.seriesName}`))
    }

    if (expectedTitleNormalized && relPathNormalized.includes(expectedTitleNormalized)) {
      score += 8
      reasons.push(this.buildCatalogCandidateReason('path-title', 'Folder/path mentions expected title'))
    } else {
      const pathTitleHit = expectedTitleTokens.filter((token) => relPathNormalized.includes(token))
      if (pathTitleHit.length >= Math.min(2, expectedTitleTokens.length || 0) && pathTitleHit.length) {
        score += pathTitleHit.length * 2
        reasons.push(this.buildCatalogCandidateReason('path-title-token', 'Folder/path overlaps expected title'))
      }
    }

    const pathAuthorHit = expectedAuthorTokens.some((token) => relPathNormalized.includes(token))
    if (pathAuthorHit) {
      score += 3
      reasons.push(this.buildCatalogCandidateReason('path-author', 'Folder/path mentions author'))
    }

    const pathSeriesHit = expectedSeriesTokens.some((token) => relPathNormalized.includes(token))
    if (pathSeriesHit) {
      score += 2
      reasons.push(this.buildCatalogCandidateReason('path-series', 'Folder/path mentions series'))
    }

    return {
      libraryItemId: libraryItem.id,
      title,
      relPath,
      authors: authors.map((name) => ({ name })),
      currentSeries: this.getCurrentSeriesPayload(libraryItem),
      score,
      reasons
    }
  }

  buildCatalogCandidateContext(catalog, slotDetail) {
    const selectedChoice = slotDetail.selectedEntryKey ? slotDetail.choices.find((choice) => choice.entryKey === slotDetail.selectedEntryKey) || null : null
    const primaryChoice = selectedChoice || (slotDetail.choices.length === 1 ? slotDetail.choices[0] : null)
    if (!primaryChoice?.title) return null

    const authors = Array.isArray(primaryChoice.authors) ? primaryChoice.authors : []
    return {
      seriesName: catalog.seriesName,
      seriesNameNormalized: this.normalizeKeyPart(catalog.seriesName),
      expectedTitle: primaryChoice.title,
      expectedTitleNormalized: this.normalizeSearchText(primaryChoice.title),
      expectedTitleTokens: this.tokenizeSearchText(primaryChoice.title),
      expectedAuthorNormalized: authors.map((author) => this.normalizeSearchText(author)).filter(Boolean),
      expectedAuthorTokens: this.tokenizeSearchText(authors.join(' ')),
      expectedSeriesTokens: this.tokenizeSearchText(catalog.seriesName),
      slot: slotDetail.slot,
      choice: primaryChoice
    }
  }

  finalizeCatalogSlots(slotMap, selectionBySlot, localBooks) {
    const integerSlots = []
    for (const slot of slotMap.keys()) {
      if (this.isIntegerCatalogSlot(slot)) integerSlots.push(Number(slot))
    }

    if (integerSlots.length) {
      const minSlot = Math.min(...integerSlots)
      const maxSlot = Math.max(...integerSlots)
      for (let value = minSlot; value <= maxSlot; value++) {
        this.ensureCatalogSlot(slotMap, String(value))
      }
    }

    const slots = [...slotMap.values()].sort((a, b) => {
      const aNumber = Number(a.slot)
      const bNumber = Number(b.slot)
      if (!Number.isNaN(aNumber) && !Number.isNaN(bNumber) && aNumber !== bNumber) return aNumber - bNumber
      return a.slot.localeCompare(b.slot, undefined, { numeric: true })
    })

    slots.forEach((slot) => {
      const selectedEntryKey = selectionBySlot?.[slot.slot] || null
      const selectedChoice = slot.choices.find((choice) => choice.entryKey === selectedEntryKey) || null
      slot.selectedEntryKey = selectedChoice?.entryKey || null

      if (selectedChoice) {
        slot.expectedTitle = selectedChoice.title
        slot.expectedAuthors = selectedChoice.authors || []
        slot.sourceSupport = selectedChoice.sources
      } else if (slot.choices.length === 1) {
        slot.expectedTitle = slot.choices[0].title
        slot.expectedAuthors = slot.choices[0].authors || []
        slot.sourceSupport = slot.choices[0].sources
      }

      if (slot.choices.length > 1 && !selectedChoice) {
        slot.status = 'disputed'
      } else if (slot.isDecimal) {
        slot.status = slot.locallyCovered ? 'covered' : 'decimal'
      } else if (!slot.locallyCovered) {
        slot.status = 'missing'
      } else {
        slot.status = 'covered'
      }
    })

    const unsequencedBooks = localBooks.filter((book) => !book.sequence)
    return {
      slots,
      unsequencedBooks
    }
  }

  async getCatalogDetailForLibrary(libraryId, catalogId) {
    const catalog = await Database.seriesReviewCatalogModel.findOne({
      where: {
        id: catalogId,
        libraryId
      }
    })
    if (!catalog) return null

    const localBooks = await this.getLocalCatalogBooks(libraryId, catalog.seriesNameNormalized)
    const slotMap = new Map()

    localBooks.forEach((book) => {
      const coveredSlots = this.expandCatalogSequenceCoverage(book.sequence || '')
      if (!coveredSlots.length) return
      coveredSlots.forEach((coveredSlot) => {
        const slot = this.ensureCatalogSlot(slotMap, coveredSlot)
        if (!slot) return
        slot.locallyCovered = true
        slot.localBooks.push({
          libraryItemId: book.libraryItemId,
          title: book.title,
          relPath: book.relPath,
          sequence: book.sequence
        })
      })
    })

    const entries = this.normalizeCatalogEntries(catalog.entries)
    entries.forEach((entry) => {
      const coveredSlots = entry.coveredSlots.length ? entry.coveredSlots : [entry.sequenceLabel].filter(Boolean)
      coveredSlots.forEach((coveredSlot) => {
        const slot = this.ensureCatalogSlot(slotMap, coveredSlot)
        if (!slot) return
        slot.sourceCovered = true
        slot.choices.push({
          entryKey: entry.entryKey,
          title: entry.title,
          authors: entry.authors,
          sequenceLabel: entry.sequenceLabel,
          sources: this.buildCatalogSourceSupport(entry.sources)
        })
      })
    })

    const finalized = this.finalizeCatalogSlots(slotMap, catalog.selectionBySlot, localBooks)

    return {
      catalog: {
        ...this.buildSeriesReviewCatalogPayload(catalog),
        selectionBySlot: catalog.selectionBySlot || {}
      },
      localBooks,
      unsequencedBooks: finalized.unsequencedBooks,
      slots: finalized.slots
    }
  }

  async chooseCatalogSlotEntry(libraryId, catalogId, slot, entryKey) {
    const catalog = await Database.seriesReviewCatalogModel.findOne({
      where: {
        id: catalogId,
        libraryId
      }
    })
    if (!catalog) return null

    const normalizedSlot = this.normalizeCatalogSlotToken(slot)
    if (!normalizedSlot) {
      throw new Error('Missing slot')
    }

    const detail = await this.getCatalogDetailForLibrary(libraryId, catalogId)
    const slotDetail = detail?.slots?.find((candidate) => candidate.slot === normalizedSlot)
    if (!slotDetail) {
      throw new Error('Slot was not found')
    }
    if (!slotDetail.choices.some((choice) => choice.entryKey === entryKey)) {
      throw new Error('Selected interpretation was not found for that slot')
    }

    catalog.selectionBySlot = {
      ...(catalog.selectionBySlot || {}),
      [normalizedSlot]: entryKey
    }
    await catalog.save()

    return this.getCatalogDetailForLibrary(libraryId, catalogId)
  }

  async findCatalogSlotCandidates(libraryId, catalogId, slot) {
    const detail = await this.getCatalogDetailForLibrary(libraryId, catalogId)
    if (!detail) return null

    const normalizedSlot = this.normalizeCatalogSlotToken(slot)
    if (!normalizedSlot) throw new Error('Missing slot')

    const slotDetail = detail.slots.find((candidate) => candidate.slot === normalizedSlot)
    if (!slotDetail) throw new Error('Slot was not found')

    const context = this.buildCatalogCandidateContext(detail.catalog, slotDetail)
    if (!context) {
      throw new Error('Choose a preferred interpretation before searching for candidates')
    }

    const libraryItems = await Database.libraryItemModel.findAllExpandedWhere({
      libraryId,
      mediaType: 'book'
    })

    const localCoveredIds = new Set(slotDetail.localBooks.map((book) => book.libraryItemId))
    const results = libraryItems
      .filter((libraryItem) => !localCoveredIds.has(libraryItem.id))
      .map((libraryItem) => this.computeCatalogCandidateMatch(context, libraryItem))
      .filter((candidate) => candidate.score > 0)
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score
        return a.title.localeCompare(b.title)
      })

    return {
      catalog: detail.catalog,
      slot: normalizedSlot,
      expectedTitle: context.expectedTitle,
      expectedAuthors: context.choice.authors || [],
      expectedSeriesName: detail.catalog.seriesName,
      results
    }
  }

  async queueCatalogCandidateForReview(libraryId, catalogId, slot, libraryItemId) {
    const searchResult = await this.findCatalogSlotCandidates(libraryId, catalogId, slot)
    if (!searchResult) return null

    const candidate = searchResult.results.find((result) => result.libraryItemId === libraryItemId)
    if (!candidate) {
      throw new Error('Selected candidate was not found for that slot')
    }

    const strongestReason = candidate.reasons[0]?.text || 'Catalog candidate search'
    const importResult = await this.importSuggestionsForLibrary(libraryId, [
      {
        libraryItemId,
        sourceSuggestions: [
          {
            source: 'catalog',
            label: 'CAT',
            seriesName: searchResult.expectedSeriesName,
            sequence: searchResult.slot,
            confidence: Number(Math.min(candidate.score / 20, 0.99).toFixed(2)),
            notes: `Task 5 candidate for slot ${searchResult.slot}: ${searchResult.expectedTitle} (${strongestReason})`
          }
        ]
      }
    ])

    return {
      queued: true,
      importedCount: importResult.importedCount,
      libraryItemId: candidate.libraryItemId,
      title: candidate.title,
      slot: searchResult.slot,
      expectedTitle: searchResult.expectedTitle,
      targetSeriesName: searchResult.expectedSeriesName
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
    const evidenceSummary = this.buildSuggestionEvidenceSummary(suggestion)
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
      evidenceSummary,
      priorityScore: this.getSuggestionPriorityScore({
        kind: suggestion.kind,
        sourceCount: contributions.length,
        evidenceSummary
      })
    }
  }

  sortSuggestionsForDisplay(suggestions) {
    return [...(suggestions || [])].sort((a, b) => {
      const aPriority = a.kind === 'series' ? 0 : 1
      const bPriority = b.kind === 'series' ? 0 : 1
      if (aPriority !== bPriority) return aPriority - bPriority
      if ((b.priorityScore || 0) !== (a.priorityScore || 0)) return (b.priorityScore || 0) - (a.priorityScore || 0)
      if ((b.sourceCount || 0) !== (a.sourceCount || 0)) return (b.sourceCount || 0) - (a.sourceCount || 0)
      return String(a.suggestedName || '').localeCompare(String(b.suggestedName || ''))
    })
  }

  buildQueueRow(libraryItem, suggestions) {
    const media = libraryItem.media
    const suggestionPayloads = suggestions.map((suggestion) => this.buildSuggestionPayload(suggestion))
    const suggestionAnalysis = this.analyzeSuggestionSet(suggestionPayloads)
    const currentTags = Array.isArray(media?.tags) ? media.tags : []
    return {
      libraryItemId: libraryItem.id,
      title: media?.title || libraryItem.title || '',
      relPath: this.getQueuePath(libraryItem),
      authors: Array.isArray(media?.authors) ? media.authors.map((author) => ({ id: author.id, name: author.name })) : [],
      hasPreviousSeriesEdit: currentTags.includes(this.SERIES_EDIT_TAG),
      seriesEditTag: currentTags.includes(this.SERIES_EDIT_TAG) ? this.SERIES_EDIT_TAG : null,
      currentSeries: this.getCurrentSeriesPayload(libraryItem),
      queuePriority: suggestionAnalysis.queuePriority,
      conflictType: suggestionAnalysis.conflictType,
      conflictSummary: suggestionAnalysis.conflictSummary,
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
        if ((a.queuePriority || 0) !== (b.queuePriority || 0)) return (a.queuePriority || 0) - (b.queuePriority || 0)
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
