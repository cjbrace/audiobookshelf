const { literal, Op } = require('sequelize')

const Database = require('../Database')
const Logger = require('../Logger')

class SeriesReviewManager {
  get SERIES_EDIT_TAG() {
    return '-series-edit'
  }

  async ensureSeriesReviewCatalogSchema() {
    if (this.seriesReviewCatalogSchemaReady) return
    if (!this.seriesReviewCatalogSchemaPromise) {
      this.seriesReviewCatalogSchemaPromise = this.ensureSeriesReviewCatalogSchemaInner()
        .then(() => {
          this.seriesReviewCatalogSchemaReady = true
        })
        .finally(() => {
          this.seriesReviewCatalogSchemaPromise = null
        })
    }
    await this.seriesReviewCatalogSchemaPromise
  }

  async ensureSeriesReviewCatalogSchemaInner() {
    const queryInterface = Database.sequelize.getQueryInterface()
    const tableDescription = await queryInterface.describeTable('seriesReviewCatalogs')
    const DataTypes = queryInterface.sequelize.Sequelize.DataTypes

    if (!tableDescription.visibilityStatus) {
      await queryInterface.addColumn('seriesReviewCatalogs', 'visibilityStatus', {
        type: DataTypes.STRING,
        allowNull: false,
        defaultValue: 'visible'
      })
      await queryInterface.sequelize.query("UPDATE seriesReviewCatalogs SET visibilityStatus = 'visible' WHERE visibilityStatus IS NULL")
    }

    if (!tableDescription.dismissedAt) {
      await queryInterface.addColumn('seriesReviewCatalogs', 'dismissedAt', {
        type: DataTypes.DATE,
        allowNull: true
      })
    }
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

  normalizeDecisionSeriesName(value) {
    return this.normalizeSeriesName(value)
      .replace(/^the\s+/i, '')
      .replace(/\s+series$/i, '')
      .trim()
  }

  normalizeDecisionKey(value) {
    return this.normalizeKeyPart(this.normalizeDecisionSeriesName(value))
  }

  getPreferredSeriesLabelScore(value) {
    const normalized = this.normalizeSeriesName(value)
    return [
      /^the\s+/i.test(normalized) ? 1 : 0,
      /\s+series$/i.test(normalized) ? 1 : 0,
      (normalized.match(/[^a-z0-9\s]/gi) || []).length,
      normalized.length,
      normalized.toLowerCase()
    ]
  }

  choosePreferredSeriesLabel(names) {
    const candidates = [...new Set((Array.isArray(names) ? names : []).map((name) => this.normalizeSeriesName(name)).filter(Boolean))]
    if (!candidates.length) return ''
    return candidates.sort((a, b) => {
      const aScore = this.getPreferredSeriesLabelScore(a)
      const bScore = this.getPreferredSeriesLabelScore(b)
      for (let index = 0; index < aScore.length; index++) {
        if (aScore[index] < bScore[index]) return -1
        if (aScore[index] > bScore[index]) return 1
      }
      return 0
    })[0]
  }

  async getSeriesNameControlsForLibrary(libraryId) {
    return Database.seriesReviewNameControlModel.findAll({
      where: {
        libraryId
      },
      order: [['createdAt', 'ASC']]
    })
  }

  buildSeriesNameControlResolver(controls) {
    const exactMap = new Map()
    const decisionBuckets = new Map()

    ;(Array.isArray(controls) ? controls : []).forEach((control) => {
      if (control?.aliasNameNormalized) exactMap.set(control.aliasNameNormalized, control)
      const decisionKey = control?.canonicalDecisionKey || ''
      if (!decisionKey) return
      if (!decisionBuckets.has(decisionKey)) decisionBuckets.set(decisionKey, new Map())
      decisionBuckets.get(decisionKey).set(control.canonicalNameNormalized, control.canonicalName)
    })

    const decisionMap = new Map()
    decisionBuckets.forEach((bucket, key) => {
      if (bucket.size === 1) {
        decisionMap.set(key, [...bucket.values()][0])
      }
    })

    const resolveCanonicalStep = (value) => {
      const normalized = this.normalizeSeriesName(value)
      if (!normalized) return ''
      const exactKey = this.normalizeKeyPart(normalized)
      if (exactMap.has(exactKey)) return this.normalizeSeriesName(exactMap.get(exactKey).canonicalName)
      const decisionKey = this.normalizeDecisionKey(normalized)
      return this.normalizeSeriesName(decisionMap.get(decisionKey) || normalized)
    }

    const canonicalizeName = (value) => {
      let normalized = this.normalizeSeriesName(value)
      if (!normalized) return ''

      const seen = new Set()
      while (normalized) {
        const key = this.normalizeKeyPart(normalized)
        if (!key || seen.has(key)) break
        seen.add(key)

        const nextValue = resolveCanonicalStep(normalized)
        if (!nextValue || nextValue === normalized) break
        normalized = nextValue
      }

      return normalized
    }

    return {
      canonicalizeName,
      getDecisionKey: (value) => {
        return this.normalizeDecisionKey(canonicalizeName(value) || value)
      },
      chooseDisplayName: (names) => {
        const normalizedNames = [...new Set((Array.isArray(names) ? names : []).map((name) => this.normalizeSeriesName(name)).filter(Boolean))]
        if (!normalizedNames.length) return ''
        const mappedNames = [...new Set(normalizedNames.map((name) => this.normalizeSeriesName(canonicalizeName(name))).filter(Boolean))]
        if (mappedNames.length === 1) {
          return mappedNames[0]
        }
        return this.choosePreferredSeriesLabel(normalizedNames)
      }
    }
  }

  async getSeriesNameControlResolverForLibrary(libraryId) {
    return this.buildSeriesNameControlResolver(await this.getSeriesNameControlsForLibrary(libraryId))
  }

  async upsertSeriesNameControlForLibrary(libraryId, userId, aliasName, canonicalName, controlType = 'alias') {
    const normalizedAliasName = this.normalizeSeriesName(aliasName)
    const normalizedCanonicalName = this.normalizeSeriesName(canonicalName)
    if (!normalizedAliasName || !normalizedCanonicalName) {
      throw new Error('Both alias and canonical names are required')
    }

    const aliasNameNormalized = this.normalizeKeyPart(normalizedAliasName)
    const canonicalNameNormalized = this.normalizeKeyPart(normalizedCanonicalName)
    const payload = {
      controlType,
      aliasName: normalizedAliasName,
      aliasNameNormalized,
      aliasDecisionKey: this.normalizeDecisionKey(normalizedAliasName),
      canonicalName: normalizedCanonicalName,
      canonicalNameNormalized,
      canonicalDecisionKey: this.normalizeDecisionKey(normalizedCanonicalName),
      createdByUserId: userId || null
    }

    const existing = await Database.seriesReviewNameControlModel.findOne({
      where: {
        libraryId,
        aliasNameNormalized
      }
    })

    if (existing) {
      Object.assign(existing, payload)
      await existing.save()
      return existing
    }

    return Database.seriesReviewNameControlModel.create({
      libraryId,
      ...payload
    })
  }

  getCatalogSortKey(seriesName) {
    const normalized = this.normalizeSeriesName(seriesName)
    const decisionName = this.normalizeDecisionSeriesName(normalized)
    return decisionName.toLowerCase() || normalized.toLowerCase()
  }

  buildLocalOnlyCatalogId(decisionKey) {
    return `local-series:${encodeURIComponent(decisionKey || '')}`
  }

  parseLocalOnlyCatalogId(catalogId) {
    const rawId = String(catalogId || '')
    if (!rawId.startsWith('local-series:')) return null
    return decodeURIComponent(rawId.slice('local-series:'.length))
  }

  getCatalogDisplayBucket({ trustStatus, visibilityStatus, localBookCount, isLocalOnly = false }) {
    if (visibilityStatus === 'dismissed') return 'dismissed'
    if (isLocalOnly) return 'local_only'
    if (!localBookCount) return 'potential'
    return trustStatus === 'untrusted' ? 'less_trusted' : 'trusted'
  }

  getCatalogDisplayLabel(bucket) {
    if (bucket === 'local_only') return 'Local series'
    if (bucket === 'potential') return 'Potential series'
    if (bucket === 'less_trusted') return 'Less trusted'
    if (bucket === 'dismissed') return 'Dismissed'
    return 'Trusted'
  }

  buildCatalogAuthorMeta(localBooks = [], entryOrRows = []) {
    const authors = []
    const seen = new Set()
    const addAuthor = (value) => {
      const authorName = this.normalizeSeriesName(value)
      const authorKey = this.normalizeKeyPart(authorName)
      if (!authorName || !authorKey || seen.has(authorKey)) return
      seen.add(authorKey)
      authors.push(authorName)
    }

    ;(Array.isArray(localBooks) ? localBooks : []).forEach((book) => {
      ;(book?.authors || []).forEach((author) => addAuthor(author?.name || author))
    })
    ;(Array.isArray(entryOrRows) ? entryOrRows : []).forEach((entry) => {
      ;(entry?.expectedAuthors || entry?.authors || []).forEach((author) => addAuthor(author?.name || author))
    })

    return {
      authorLine: authors.slice(0, 3).join(', '),
      authorSearchText: authors.join(' ')
    }
  }

  buildCatalogEvidenceLinks(entries = []) {
    const evidenceBySource = new Map()
    this.normalizeCatalogEntries(entries).forEach((entry) => {
      ;(entry.sources || []).forEach((source) => {
        if (!source?.evidenceUrl) return
        const sourceKey = String(source.source || '').toLowerCase()
        if (!sourceKey || evidenceBySource.has(sourceKey)) return
        evidenceBySource.set(sourceKey, {
          source: sourceKey,
          label: source.label || sourceKey.toUpperCase(),
          url: source.evidenceUrl
        })
      })
    })

    return [...evidenceBySource.values()].sort((a, b) => {
      const roleDelta = (this.getSourceRoleMeta(a.source).roleWeight || 0) - (this.getSourceRoleMeta(b.source).roleWeight || 0)
      if (roleDelta !== 0) return roleDelta * -1
      return a.label.localeCompare(b.label)
    })
  }

  buildCatalogViewPayload({
    id,
    seriesName,
    trustStatus,
    visibilityStatus,
    dismissedAt = null,
    entries = [],
    action = null,
    localBooks = [],
    displayBucket = null,
    canDismiss = true
  }) {
    const normalizedEntries = this.normalizeCatalogEntries(entries)
    const bucket =
      displayBucket ||
      this.getCatalogDisplayBucket({
        trustStatus,
        visibilityStatus,
        localBookCount: Array.isArray(localBooks) ? localBooks.length : 0
      })
    const authorMeta = this.buildCatalogAuthorMeta(localBooks, normalizedEntries)

    return {
      id,
      seriesName,
      trustStatus,
      visibilityStatus: visibilityStatus || 'visible',
      dismissedAt: dismissedAt || null,
      entryCount: normalizedEntries.length,
      action,
      displayBucket: bucket,
      displayLabel: this.getCatalogDisplayLabel(bucket),
      authorLine: authorMeta.authorLine,
      authorSearchText: authorMeta.authorSearchText,
      evidenceLinks: this.buildCatalogEvidenceLinks(normalizedEntries),
      canDismiss
    }
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
    if (normalizedSource === 'audible' || normalizedSource === 'audnexus') {
      return { role: 'automated_support', roleLabel: 'Automated support', roleWeight: 2 }
    }
    if (['goodreads', 'fantasticfiction', 'librarything'].includes(normalizedSource)) {
      return { role: 'manual_reference', roleLabel: 'Manual reference', roleWeight: 1 }
    }
    return { role: 'other', roleLabel: 'Other source', roleWeight: 2 }
  }

  buildSuggestionKey(kind, suggestedName, suggestedSequence) {
    if (kind === 'no_series') return 'no_series'
    const normalizedName = this.normalizeDecisionKey(suggestedName)
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
    const sourceRef = typeof input?.sourceRef === 'string' ? input.sourceRef.trim() || null : null
    const providerMeta = input?.providerMeta && typeof input.providerMeta === 'object' && !Array.isArray(input.providerMeta) ? input.providerMeta : null
    const rawEvidence = input?.rawEvidence && typeof input.rawEvidence === 'object' && !Array.isArray(input.rawEvidence) ? input.rawEvidence : null
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
      notes: typeof input?.notes === 'string' ? input.notes.trim() || null : null,
      sourceRef,
      providerMeta,
      rawEvidence
    }
  }

  groupContributions(sourceSuggestions, resolver = this.buildSeriesNameControlResolver([])) {
    const groups = {}
    for (const rawContribution of Array.isArray(sourceSuggestions) ? sourceSuggestions : []) {
      const contribution = this.cleanContribution(rawContribution)
      if (!contribution) continue
      const kind = contribution.noSeries ? 'no_series' : 'series'
      const canonicalSeriesName = contribution.noSeries ? null : resolver.canonicalizeName(contribution.seriesName)
      const suggestionKey = this.buildSuggestionKey(kind, canonicalSeriesName || contribution.seriesName, contribution.sequence)
      if (!groups[suggestionKey]) {
        groups[suggestionKey] = {
          kind,
          suggestionKey,
          suggestedName: canonicalSeriesName || contribution.seriesName,
          suggestedNameNormalized: canonicalSeriesName ? this.normalizeKeyPart(canonicalSeriesName) : contribution.seriesName ? this.normalizeKeyPart(contribution.seriesName) : null,
          seriesDecisionKey: canonicalSeriesName ? resolver.getDecisionKey(canonicalSeriesName) : contribution.seriesName ? resolver.getDecisionKey(contribution.seriesName) : null,
          suggestedSequence: contribution.sequence,
          contributions: []
        }
      }
      groups[suggestionKey].contributions.push(contribution)
    }
    return Object.values(groups).map((group) => {
      const names = group.contributions.filter((contribution) => !contribution.noSeries).map((contribution) => contribution.seriesName)
      const suggestedName = group.kind === 'series' ? resolver.chooseDisplayName([group.suggestedName, ...names].filter(Boolean)) : group.suggestedName
      return {
        ...group,
        suggestedName,
        suggestedNameNormalized: suggestedName ? this.normalizeKeyPart(suggestedName) : null,
        seriesDecisionKey: suggestedName ? resolver.getDecisionKey(suggestedName) : null,
        contributions: group.contributions.sort((a, b) => a.source.localeCompare(b.source))
      }
    })
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
        notes: contribution.notes || null,
        sourceRef: contribution.sourceRef || null,
        providerMeta: contribution.providerMeta || null
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
    const automatedSupportSources = positiveSources.filter((contribution) => contribution.role === 'automated_support')
    const manualReferenceSources = positiveSources.filter((contribution) => contribution.role === 'manual_reference')
    const sourceCodes = new Set(positiveSources.map((contribution) => contribution.source))
    return {
      supportCount: positiveSources.length,
      conflictCount: negativeSources.length,
      disagreement: positiveSources.length > 0 && negativeSources.length > 0,
      automatedSupportCount: automatedSources.length,
      automatedSecondarySupportCount: automatedSupportSources.length,
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
    const positiveNames = [...new Set(positiveSuggestions.map((suggestion) => suggestion.seriesDecisionKey || suggestion.suggestedName).filter(Boolean))]
    const sequenceByName = new Map()

    positiveSuggestions.forEach((suggestion) => {
      const nameKey = suggestion.seriesDecisionKey || suggestion.suggestedName || ''
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
    const exactKey = this.normalizeKeyPart(name)
    const baseKey = this.normalizeKeyPart(this.normalizeManagementBaseName(name))
    const articleFreeKey = this.normalizeManagementArticleKey(name)
    const articleFreeBaseKey = this.normalizeManagementArticleKey(this.normalizeManagementBaseName(name))
    return {
      id: series.id,
      name,
      exactKey,
      baseKey,
      articleFreeKey,
      articleFreeBaseKey,
      hasBracketVariant: /[\(\[\{][^\)\]\}]*[\)\]\}]/.test(name),
      punctuationCount: (name.match(/[^a-z0-9\s]/gi) || []).length,
      tokenCount: exactKey ? exactKey.split(/\s+/).filter(Boolean).length : 0,
      bookCount: Array.isArray(series.bookSeries) ? series.bookSeries.length : 0
    }
  }

  normalizeManagementArticleKey(value) {
    return this.normalizeKeyPart(String(value || '').replace(/^(the|a|an)\s+/i, ' '))
  }

  scoreManagementCandidateMatch(entries) {
    if (!Array.isArray(entries) || entries.length < 2) return 0

    const exactKeys = [...new Set(entries.map((entry) => entry.exactKey).filter(Boolean))]
    if (exactKeys.length === 1) return 100

    const baseKeys = [...new Set(entries.map((entry) => entry.baseKey).filter(Boolean))]
    if (baseKeys.length === 1) return 88

    const articleBaseKeys = [...new Set(entries.map((entry) => entry.articleFreeBaseKey).filter(Boolean))]
    const minTokenCount = Math.min(...entries.map((entry) => entry.tokenCount || 0))
    if (articleBaseKeys.length === 1 && minTokenCount >= 2) return 72

    return 0
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
    const score = this.scoreManagementCandidateMatch(entries)
    const uniqueBookIds = new Set()
    entries.forEach((entry) => {
      ;(entry.bookSeries || []).forEach((bookSeries) => {
        if (bookSeries.bookId) uniqueBookIds.add(bookSeries.bookId)
      })
    })
    return {
      groupKey,
      score,
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
    const sourceRef = typeof input?.sourceRef === 'string' ? input.sourceRef.trim() || null : null
    const providerMeta = input?.providerMeta && typeof input.providerMeta === 'object' && !Array.isArray(input.providerMeta) ? input.providerMeta : null
    const rawEvidence = input?.rawEvidence && typeof input.rawEvidence === 'object' && !Array.isArray(input.rawEvidence) ? input.rawEvidence : null
    return {
      source,
      label: String(input?.label || source).trim() || source,
      confidence: Number.isFinite(confidenceValue) ? Number(confidenceValue.toFixed(3)) : null,
      evidenceUrl: typeof input?.evidenceUrl === 'string' ? input.evidenceUrl.trim() || null : null,
      notes: typeof input?.notes === 'string' ? input.notes.trim() || null : null,
      sourceRef,
      providerMeta,
      rawEvidence
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
        const publishedDate = this.normalizeSeriesName(entry?.publishedDate || entry?.releaseDate || '')
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
          publishedDate: publishedDate || null,
          sequenceLabel: sequenceLabel || null,
          coveredSlots,
          sources
        }
      })
      .filter(Boolean)
  }

  getCatalogEntryTitleKey(value) {
    return this.normalizeKeyPart(value || '')
  }

  buildSeriesReviewCatalogPayload(catalog, action = null) {
    return {
      id: catalog.id,
      seriesName: catalog.seriesName,
      trustStatus: catalog.trustStatus,
      visibilityStatus: catalog.visibilityStatus || 'visible',
      dismissedAt: catalog.dismissedAt || null,
      entryCount: Array.isArray(catalog.entries) ? catalog.entries.length : 0,
      action
    }
  }

  mergeCatalogEntryPayloads(entries) {
    const mergedEntries = new Map()
    this.normalizeCatalogEntries(entries).forEach((entry) => {
      const existing = mergedEntries.get(entry.entryKey)
      if (!existing) {
        mergedEntries.set(entry.entryKey, {
          ...entry,
          authors: [...(entry.authors || [])],
          sources: [...(entry.sources || [])]
        })
        return
      }
      existing.authors = [...new Set([...(existing.authors || []), ...(entry.authors || [])])]
      existing.sources = [...new Map([...(existing.sources || []), ...(entry.sources || [])].map((source) => [`${source.source}:${source.evidenceUrl || ''}:${source.sourceRef || ''}:${source.label || ''}`, source])).values()]
      if (!existing.publishedDate && entry.publishedDate) existing.publishedDate = entry.publishedDate
    })
    return [...mergedEntries.values()]
  }

  async importCatalogForLibrary(libraryId, rows, options = {}) {
    await this.ensureSeriesReviewCatalogSchema()
    const results = []
    let createdCount = 0
    let updatedCount = 0
    const resolver = options?.resolver || (await this.getSeriesNameControlResolverForLibrary(libraryId))

    for (const row of Array.isArray(rows) ? rows : []) {
      const seriesName = resolver.canonicalizeName(row?.seriesName || '')
      if (!seriesName) continue

      const seriesNameNormalized = this.normalizeKeyPart(seriesName)
      const trustStatus = row?.trustStatus === 'untrusted' ? 'untrusted' : 'trusted'
      const entries = this.mergeCatalogEntryPayloads(row?.entries)
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

      let action = 'updated'
      if (!catalog) {
        catalog = await Database.seriesReviewCatalogModel.create({
          libraryId,
          seriesName,
          seriesNameNormalized,
          trustStatus,
          visibilityStatus: 'visible',
          dismissedAt: null,
          entries,
          selectionBySlot
        })
        createdCount += 1
        action = 'created'
      } else {
        catalog.seriesName = seriesName
        catalog.trustStatus = trustStatus
        catalog.entries = entries
        catalog.selectionBySlot = selectionBySlot
        await catalog.save()
        updatedCount += 1
      }

      results.push(this.buildSeriesReviewCatalogPayload(catalog, action))
    }

    return {
      importedCount: results.length,
      createdCount,
      updatedCount,
      catalogs: results
    }
  }

  async getLocalSeriesGroupsForLibrary(libraryId, resolver = null) {
    const effectiveResolver = resolver || (await this.getSeriesNameControlResolverForLibrary(libraryId))
    const seriesRows = await Database.seriesModel.findAll({
      where: {
        libraryId
      },
      order: [['name', 'ASC']]
    })

    const groups = new Map()
    seriesRows.forEach((series) => {
      const decisionKey = effectiveResolver.getDecisionKey(series.name)
      if (!decisionKey) return
      if (!groups.has(decisionKey)) {
        groups.set(decisionKey, {
          decisionKey,
          seriesRows: [],
          names: []
        })
      }
      groups.get(decisionKey).seriesRows.push(series)
      groups.get(decisionKey).names.push(series.name)
    })

    groups.forEach((group) => {
      group.seriesName = effectiveResolver.chooseDisplayName(group.names) || this.choosePreferredSeriesLabel(group.names)
      group.catalogId = this.buildLocalOnlyCatalogId(group.decisionKey)
    })

    return groups
  }

  async getCatalogsForLibrary(libraryId, includeUntrusted = false, includeDismissed = false) {
    await this.ensureSeriesReviewCatalogSchema()
    const resolver = await this.getSeriesNameControlResolverForLibrary(libraryId)
    const where = { libraryId }
    if (!includeDismissed) where.visibilityStatus = 'visible'

    const catalogs = await Database.seriesReviewCatalogModel.findAll({
      where,
      order: [['seriesName', 'ASC']]
    })
    const allCatalogs = includeDismissed
      ? catalogs
      : await Database.seriesReviewCatalogModel.findAll({
          where: { libraryId },
          order: [['seriesName', 'ASC']]
        })

    const detailSummaries = []
    const catalogDecisionKeys = new Set(
      allCatalogs
        .map((catalog) => resolver.getDecisionKey(catalog.seriesName))
        .filter(Boolean)
    )
    for (const catalog of catalogs) {
      const detail = await this.getCatalogDetailForLibrary(libraryId, catalog.id, { resolver })
      if (!detail) continue
      const displayBucket = detail.catalog.displayBucket
      if (!includeDismissed && displayBucket === 'dismissed') continue
      if (!includeUntrusted && displayBucket !== 'trusted' && displayBucket !== 'local_only' && displayBucket !== 'dismissed') continue
      detailSummaries.push({
        ...detail.catalog,
        missingCount: detail.slots.filter((slot) => slot.status === 'missing').length,
        disputedCount: detail.slots.filter((slot) => slot.status === 'disputed').length,
        localBookCount: detail.localBooks.length,
        unsequencedCount: detail.unsequencedBooks.length
      })
    }

    const localSeriesGroups = await this.getLocalSeriesGroupsForLibrary(libraryId, resolver)
    for (const group of localSeriesGroups.values()) {
      if (!group?.seriesName || catalogDecisionKeys.has(group.decisionKey)) continue
      const detail = await this.getCatalogDetailForLibrary(libraryId, group.catalogId, { resolver, localSeriesGroups })
      if (!detail?.localBooks?.length) continue
      detailSummaries.push({
        ...detail.catalog,
        missingCount: 0,
        disputedCount: 0,
        localBookCount: detail.localBooks.length,
        unsequencedCount: detail.unsequencedBooks.length
      })
    }

    return detailSummaries.sort((a, b) => {
      const sortDelta = this.getCatalogSortKey(a.seriesName).localeCompare(this.getCatalogSortKey(b.seriesName))
      if (sortDelta !== 0) return sortDelta
      const authorDelta = String(a.authorLine || '').localeCompare(String(b.authorLine || ''))
      if (authorDelta !== 0) return authorDelta
      return a.seriesName.localeCompare(b.seriesName)
    })
  }

  async getMatchingSeriesRowsForCatalog(libraryId, seriesName, { resolver = null, seriesRows = null } = {}) {
    const effectiveResolver = resolver || (await this.getSeriesNameControlResolverForLibrary(libraryId))
    const rows =
      seriesRows ||
      (await Database.seriesModel.findAll({
        where: {
          libraryId
        },
        order: [['name', 'ASC']]
      }))
    const targetDecisionKey = effectiveResolver.getDecisionKey(seriesName)
    return rows.filter((series) => effectiveResolver.getDecisionKey(series.name) === targetDecisionKey)
  }

  async getLocalCatalogBooks(libraryId, seriesName, options = {}) {
    const matchingSeries =
      options?.matchingSeries ||
      (await this.getMatchingSeriesRowsForCatalog(libraryId, seriesName, {
        resolver: options?.resolver || null,
        seriesRows: options?.seriesRows || null
      }))
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
      notes: source.notes,
      sourceRef: source.sourceRef || null,
      providerMeta: source.providerMeta || null,
      rawEvidence: source.rawEvidence || null
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

    if (expectedSeriesNormalized && seriesNames.some((seriesName) => this.normalizeDecisionKey(seriesName) === expectedSeriesNormalized)) {
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
    const choices = Array.isArray(slotDetail?.choices) ? slotDetail.choices : []
    const selectedChoice = slotDetail?.selectedEntryKey ? choices.find((choice) => choice.entryKey === slotDetail.selectedEntryKey) || null : null
    const primaryChoice = selectedChoice || (choices.length === 1 ? choices[0] : null)
    const expectedTitle = String(slotDetail?.expectedTitle || primaryChoice?.title || slotDetail?.title || '').trim()
    if (!expectedTitle) return null

    const authors = Array.isArray(slotDetail?.expectedAuthors) && slotDetail.expectedAuthors.length
      ? slotDetail.expectedAuthors
      : Array.isArray(primaryChoice?.authors)
        ? primaryChoice.authors
        : []
    const rowKey = String(slotDetail?.rowKey || slotDetail?.slot || '').trim()
    return {
      seriesName: catalog.seriesName,
      seriesNameNormalized: this.normalizeDecisionKey(catalog.seriesName),
      expectedTitle,
      expectedTitleNormalized: this.normalizeSearchText(expectedTitle),
      expectedTitleTokens: this.tokenizeSearchText(expectedTitle),
      expectedAuthorNormalized: authors.map((author) => this.normalizeSearchText(author)).filter(Boolean),
      expectedAuthorTokens: this.tokenizeSearchText(authors.join(' ')),
      expectedSeriesTokens: this.tokenizeSearchText(catalog.seriesName),
      slot: rowKey,
      rowType: slotDetail?.rowType || 'slot',
      choice: primaryChoice || {
        title: expectedTitle,
        authors,
        publishedDate: slotDetail?.expectedPublishedDate || null,
        sources: Array.isArray(slotDetail?.sourceSupport) ? slotDetail.sourceSupport : []
      }
    }
  }

  finalizeCatalogSlots(slotMap, selectionBySlot, localBooks, entries = [], options = {}) {
    const integerSlots = []
    for (const slot of slotMap.keys()) {
      if (this.isIntegerCatalogSlot(slot)) integerSlots.push(Number(slot))
    }

    if (integerSlots.length && options.fillIntegerGaps !== false) {
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
        slot.expectedPublishedDate = selectedChoice.publishedDate || null
        slot.sourceSupport = selectedChoice.sources
      } else if (slot.choices.length === 1) {
        slot.expectedTitle = slot.choices[0].title
        slot.expectedAuthors = slot.choices[0].authors || []
        slot.expectedPublishedDate = slot.choices[0].publishedDate || null
        slot.sourceSupport = slot.choices[0].sources
      } else if (slot.localBooks.length === 1) {
        slot.expectedTitle = slot.localBooks[0].title
        slot.expectedAuthors = (slot.localBooks[0].authors || []).map((author) => author?.name || author).filter(Boolean)
        slot.expectedPublishedDate = null
        slot.sourceSupport = []
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
    const unsequencedLocalBooksByTitle = new Map()
    unsequencedBooks.forEach((book) => {
      const key = this.getCatalogEntryTitleKey(book.title)
      if (!key) return
      if (!unsequencedLocalBooksByTitle.has(key)) unsequencedLocalBooksByTitle.set(key, [])
      unsequencedLocalBooksByTitle.get(key).push({
        libraryItemId: book.libraryItemId,
        title: book.title,
        relPath: book.relPath,
        sequence: book.sequence
      })
    })
    const coveredTitleKeys = new Set()
    localBooks
      .filter((book) => !!book.sequence)
      .forEach((book) => {
        const key = this.getCatalogEntryTitleKey(book.title)
        if (key) coveredTitleKeys.add(key)
      })
    slots.forEach((slot) => {
      ;(slot.choices || []).forEach((choice) => {
        const key = this.getCatalogEntryTitleKey(choice.title)
        if (key) coveredTitleKeys.add(key)
      })
    })

    const unsequencedSourceEntries = entries
      .filter((entry) => !entry.coveredSlots.length)
      .filter((entry) => {
        const key = this.getCatalogEntryTitleKey(entry.title)
        return key && !coveredTitleKeys.has(key)
      })
      .map((entry) => ({
        rowKey: `unsequenced:${this.normalizeKeyPart(entry.entryKey).replace(/\s+/g, '')}`,
        rowType: 'unsequenced',
        slot: `unsequenced:${this.normalizeKeyPart(entry.entryKey).replace(/\s+/g, '')}`,
        entryKey: entry.entryKey,
        title: entry.title,
        expectedTitle: entry.title,
        expectedAuthors: entry.authors || [],
        expectedPublishedDate: entry.publishedDate || null,
        authors: entry.authors || [],
        publishedDate: entry.publishedDate || null,
        sequenceLabel: entry.sequenceLabel || null,
        sourceSupport: this.buildCatalogSourceSupport(entry.sources),
        localBooks: unsequencedLocalBooksByTitle.get(this.getCatalogEntryTitleKey(entry.title)) || [],
        choices: [],
        selectedEntryKey: null,
        status: 'unsequenced'
      }))
      .sort((a, b) => a.title.localeCompare(b.title))
    return {
      slots,
      unsequencedBooks,
      unsequencedSourceEntries,
      rows: [...slots, ...unsequencedSourceEntries]
    }
  }

  async getCatalogDetailForLibrary(libraryId, catalogId, options = {}) {
    await this.ensureSeriesReviewCatalogSchema()
    const localOnlyDecisionKey = this.parseLocalOnlyCatalogId(catalogId)
    if (localOnlyDecisionKey) {
      return this.getLocalOnlyCatalogDetailForLibrary(libraryId, localOnlyDecisionKey, options)
    }

    const resolver = options?.resolver || null
    const catalog = await Database.seriesReviewCatalogModel.findOne({
      where: {
        id: catalogId,
        libraryId
      }
    })
    if (!catalog) return null

    const localBooks = await this.getLocalCatalogBooks(libraryId, catalog.seriesName, { resolver })
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
          sequence: book.sequence,
          authors: book.authors || []
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
          publishedDate: entry.publishedDate || null,
          sequenceLabel: entry.sequenceLabel,
          sources: this.buildCatalogSourceSupport(entry.sources)
        })
      })
    })

    const finalized = this.finalizeCatalogSlots(slotMap, catalog.selectionBySlot, localBooks, entries)

    return {
      catalog: {
        ...this.buildCatalogViewPayload({
          id: catalog.id,
          seriesName: catalog.seriesName,
          trustStatus: catalog.trustStatus,
          visibilityStatus: catalog.visibilityStatus,
          dismissedAt: catalog.dismissedAt || null,
          entries,
          localBooks,
          canDismiss: true
        }),
        selectionBySlot: catalog.selectionBySlot || {},
        canDismiss: true
      },
      localBooks,
      unsequencedBooks: finalized.unsequencedBooks,
      unsequencedSourceEntries: finalized.unsequencedSourceEntries,
      slots: finalized.slots,
      rows: finalized.rows
    }
  }

  async getLocalOnlyCatalogDetailForLibrary(libraryId, decisionKey, options = {}) {
    const resolver = options?.resolver || (await this.getSeriesNameControlResolverForLibrary(libraryId))
    const localSeriesGroups = options?.localSeriesGroups || (await this.getLocalSeriesGroupsForLibrary(libraryId, resolver))
    const group = localSeriesGroups.get(decisionKey)
    if (!group?.seriesName) return null

    const localBooks = await this.getLocalCatalogBooks(libraryId, group.seriesName, {
      resolver,
      matchingSeries: group.seriesRows
    })
    if (!localBooks.length) return null

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
          sequence: book.sequence,
          authors: book.authors || []
        })
      })
    })

    const finalized = this.finalizeCatalogSlots(slotMap, {}, localBooks, [], { fillIntegerGaps: false })
    return {
      catalog: {
        ...this.buildCatalogViewPayload({
          id: group.catalogId,
          seriesName: group.seriesName,
          trustStatus: 'local_only',
          visibilityStatus: 'visible',
          entries: [],
          localBooks,
          displayBucket: 'local_only',
          canDismiss: false
        }),
        selectionBySlot: {},
        canDismiss: false
      },
      localBooks,
      unsequencedBooks: finalized.unsequencedBooks,
      unsequencedSourceEntries: [],
      slots: finalized.slots,
      rows: finalized.rows
    }
  }

  async setCatalogVisibilityForLibrary(libraryId, catalogId, visibilityStatus) {
    await this.ensureSeriesReviewCatalogSchema()
    const catalog = await Database.seriesReviewCatalogModel.findOne({
      where: {
        id: catalogId,
        libraryId
      }
    })
    if (!catalog) return null

    const nextVisibility = visibilityStatus === 'dismissed' ? 'dismissed' : 'visible'
    catalog.visibilityStatus = nextVisibility
    catalog.dismissedAt = nextVisibility === 'dismissed' ? new Date() : null
    await catalog.save()

    return this.getCatalogDetailForLibrary(libraryId, catalogId)
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
    const rowDetail = (detail?.rows || detail?.slots || []).find((candidate) => candidate.slot === normalizedSlot || candidate.rowKey === normalizedSlot)
    if (!rowDetail) {
      throw new Error('Slot was not found')
    }
    if ((rowDetail.rowType || 'slot') === 'unsequenced') {
      throw new Error('Selected interpretation was not found for that slot')
    }
    if (!rowDetail.choices.some((choice) => choice.entryKey === entryKey)) {
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

    const slotDetail = (detail.rows || detail.slots).find((candidate) => candidate.slot === normalizedSlot || candidate.rowKey === normalizedSlot)
    if (!slotDetail) throw new Error('Slot was not found')

    const context = this.buildCatalogCandidateContext(detail.catalog, slotDetail)
    if (!context) {
      throw new Error('Choose a preferred interpretation before searching for candidates')
    }

    const libraryItems = await Database.libraryItemModel.findAllExpandedWhere({
      libraryId,
      mediaType: 'book'
    })

    const localCoveredIds = new Set((slotDetail.localBooks || []).map((book) => book.libraryItemId))
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
      rowType: slotDetail.rowType || 'slot',
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
            sequence: searchResult.rowType === 'unsequenced' ? null : searchResult.slot,
            confidence: Number(Math.min(candidate.score / 20, 0.99).toFixed(2)),
            notes: `Task 5 candidate for ${searchResult.rowType === 'unsequenced' ? 'unsequenced entry' : `slot ${searchResult.slot}`}: ${searchResult.expectedTitle} (${strongestReason})`
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
      rowType: searchResult.rowType || 'slot',
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

    const articleGroups = {}
    seriesMeta.forEach((meta) => {
      const key = meta.articleFreeBaseKey
      if (!key || meta.tokenCount < 2) return
      if (!articleGroups[key]) articleGroups[key] = []
      articleGroups[key].push(meta)
    })

    Object.entries(articleGroups).forEach(([key, entries]) => {
      if (entries.length < 2) return
      if (!entries.some((entry) => entry.articleFreeBaseKey !== entry.baseKey)) return
      const groupKey = `article:${key}`
      const group = candidateGroups.get(groupKey) || new Map()
      entries.forEach((entry) => group.set(entry.id, entry))
      candidateGroups.set(groupKey, group)
    })

    return [...candidateGroups.entries()]
      .map(([groupKey, seriesMap]) => this.buildManagementCandidatePayload(groupKey, [...seriesMap.values()]))
      .filter((candidate) => candidate.labels.length > 1 && candidate.score > 0)
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score
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

  sequencesCompatible(left, right) {
    const leftSequence = this.normalizeSequence(left)
    const rightSequence = this.normalizeSequence(right)
    if (rightSequence) return leftSequence === rightSequence
    return true
  }

  findMatchingCurrentSeriesEntry(currentSeries, suggestedName, suggestedSequence, resolver = this.buildSeriesNameControlResolver([])) {
    const decisionKey = resolver.getDecisionKey(suggestedName)
    if (!decisionKey) return null
    return (Array.isArray(currentSeries) ? currentSeries : []).find((series) => {
      return resolver.getDecisionKey(series.name) === decisionKey && this.sequencesCompatible(series.sequence, suggestedSequence)
    }) || null
  }

  applyAutoLinkedSuggestionState(suggestion, groupedSuggestion, currentSeries, resolver, now) {
    const linkedSeries = groupedSuggestion.kind === 'series' ? this.findMatchingCurrentSeriesEntry(currentSeries, groupedSuggestion.suggestedName, groupedSuggestion.suggestedSequence, resolver) : null
    if (linkedSeries) {
      suggestion.state = 'linked'
      suggestion.decisionAction = 'assumed_link'
      suggestion.decisionSeriesId = linkedSeries.id || null
      suggestion.decidedAt = suggestion.decidedAt || now
      return
    }

    if (suggestion.state === 'linked') {
      suggestion.state = 'pending'
      suggestion.decisionAction = null
      suggestion.decisionSeriesId = null
      suggestion.decidedAt = null
    }
  }

  async importSuggestionsForLibrary(libraryId, rows, options = {}) {
    const now = new Date()
    const results = []
    const resolver = options?.resolver || (await this.getSeriesNameControlResolverForLibrary(libraryId))

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

      const expandedLibraryItem = await Database.libraryItemModel.getExpandedById(libraryItemId)
      const currentSeries = this.getCurrentSeriesPayload(expandedLibraryItem)
      const groupedSuggestions = this.groupContributions(row.sourceSuggestions, resolver)
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
          const wasLinked = suggestion.state === 'linked'
          const shouldReopen = suggestion.state !== 'pending' && suggestion.state !== 'linked' && this.hasMeaningfulSuggestionChange(suggestion, groupedSuggestion)
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
          if (wasLinked && suggestion.state === 'pending') {
            suggestion.decisionAction = null
            suggestion.decisionSeriesId = null
            suggestion.decidedAt = null
          }
          this.applyAutoLinkedSuggestionState(suggestion, groupedSuggestion, currentSeries, resolver, now)
          await suggestion.save()
          results.push(suggestion)
          continue
        }
        this.applyAutoLinkedSuggestionState(suggestion, groupedSuggestion, currentSeries, resolver, now)
        await suggestion.save()
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
      seriesDecisionKey: suggestion.suggestedName ? this.normalizeDecisionKey(suggestion.suggestedName) : null,
      suggestedSequence: suggestion.suggestedSequence,
      state: suggestion.state,
      decisionAction: suggestion.decisionAction,
      decisionSeriesId: suggestion.decisionSeriesId,
      canUnlink: suggestion.kind === 'series' && ['linked', 'applied', 'manual_override'].includes(suggestion.state),
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

  getQueueGroupingName(currentSeries, suggestions, resolver = this.buildSeriesNameControlResolver([])) {
    if (Array.isArray(currentSeries) && currentSeries.length) {
      return resolver.canonicalizeName(currentSeries[0].name) || this.normalizeSeriesName(currentSeries[0].name)
    }
    const positiveSuggestion = (Array.isArray(suggestions) ? suggestions : []).find((suggestion) => suggestion.kind === 'series' && suggestion.suggestedName)
    return positiveSuggestion ? resolver.canonicalizeName(positiveSuggestion.suggestedName) || positiveSuggestion.suggestedName : ''
  }

  buildQueueRow(libraryItem, suggestions, resolver = this.buildSeriesNameControlResolver([])) {
    const media = libraryItem.media
    const suggestionPayloads = suggestions.map((suggestion) => this.buildSuggestionPayload(suggestion))
    const currentSeries = this.getCurrentSeriesPayload(libraryItem)
    const suggestionAnalysis = this.analyzeSuggestionSet(suggestionPayloads)
    const currentTags = Array.isArray(media?.tags) ? media.tags : []
    const queueGroupName = this.getQueueGroupingName(currentSeries, suggestionPayloads, resolver)
    return {
      libraryItemId: libraryItem.id,
      title: media?.title || libraryItem.title || '',
      relPath: this.getQueuePath(libraryItem),
      authors: Array.isArray(media?.authors) ? media.authors.map((author) => ({ id: author.id, name: author.name })) : [],
      hasPreviousSeriesEdit: currentTags.includes(this.SERIES_EDIT_TAG),
      seriesEditTag: currentTags.includes(this.SERIES_EDIT_TAG) ? this.SERIES_EDIT_TAG : null,
      currentSeries,
      queueGroupName,
      queueGroupSortKey: this.getCatalogSortKey(queueGroupName || media?.title || libraryItem.title || ''),
      queuePriority: suggestionAnalysis.queuePriority,
      conflictType: suggestionAnalysis.conflictType,
      conflictSummary: suggestionAnalysis.conflictSummary,
      suggestions: this.sortSuggestionsForDisplay(suggestionPayloads)
    }
  }

  async getQueueForLibrary(libraryId, includeDecided = false) {
    const resolver = await this.getSeriesNameControlResolverForLibrary(libraryId)
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
        return this.buildQueueRow(libraryItem, suggestionsByItemId[libraryItemId] || [], resolver)
      })
      .filter(Boolean)
      .filter((row) => row.currentSeries.length || row.suggestions.some((suggestion) => suggestion.kind === 'series'))
      .sort((a, b) => {
        const groupDelta = String(a.queueGroupSortKey || '').localeCompare(String(b.queueGroupSortKey || ''))
        if (groupDelta !== 0) return groupDelta
        if ((a.queuePriority || 0) !== (b.queuePriority || 0)) return (a.queuePriority || 0) - (b.queuePriority || 0)
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

  async rebuildSuggestionsForLibrary(libraryId, resolver = null) {
    const activeSuggestions = await Database.seriesReviewSuggestionModel.findAll({
      where: {
        libraryId,
        isActive: true
      }
    })
    if (!activeSuggestions.length) return

    const rowsByLibraryItem = new Map()
    activeSuggestions.forEach((suggestion) => {
      if (!rowsByLibraryItem.has(suggestion.libraryItemId)) {
        rowsByLibraryItem.set(suggestion.libraryItemId, [])
      }
      rowsByLibraryItem.get(suggestion.libraryItemId).push(...(Array.isArray(suggestion.contributions) ? suggestion.contributions : []))
    })

    await this.importSuggestionsForLibrary(
      libraryId,
      [...rowsByLibraryItem.entries()].map(([libraryItemId, sourceSuggestions]) => ({
        libraryItemId,
        sourceSuggestions
      })),
      { resolver: resolver || (await this.getSeriesNameControlResolverForLibrary(libraryId)) }
    )
  }

  mergeCatalogSelectionBySlot(target, source) {
    const nextSelection = { ...(target || {}) }
    Object.entries(source || {}).forEach(([slot, entryKey]) => {
      if (!nextSelection[slot]) nextSelection[slot] = entryKey
    })
    return nextSelection
  }

  async rebuildCatalogsForLibrary(libraryId, resolver = null) {
    const effectiveResolver = resolver || (await this.getSeriesNameControlResolverForLibrary(libraryId))
    const catalogs = await Database.seriesReviewCatalogModel.findAll({
      where: {
        libraryId
      },
      order: [['createdAt', 'ASC']]
    })
    if (!catalogs.length) return

    const groupedCatalogs = new Map()
    catalogs.forEach((catalog) => {
      const canonicalName = effectiveResolver.canonicalizeName(catalog.seriesName) || this.normalizeSeriesName(catalog.seriesName)
      const groupKey = this.normalizeKeyPart(canonicalName)
      if (!groupedCatalogs.has(groupKey)) {
        groupedCatalogs.set(groupKey, {
          canonicalName,
          rows: []
        })
      }
      groupedCatalogs.get(groupKey).rows.push(catalog)
    })

    const retainedIds = new Set()
    for (const group of groupedCatalogs.values()) {
      const primaryCatalog = group.rows[0]
      const mergedEntries = this.mergeCatalogEntryPayloads(group.rows.flatMap((row) => row.entries || []))
      const mergedSelection = group.rows.reduce((selectionBySlot, row) => this.mergeCatalogSelectionBySlot(selectionBySlot, row.selectionBySlot), {})
      const anyVisible = group.rows.some((row) => (row.visibilityStatus || 'visible') !== 'dismissed')
      primaryCatalog.seriesName = group.canonicalName
      primaryCatalog.seriesNameNormalized = this.normalizeKeyPart(group.canonicalName)
      primaryCatalog.trustStatus = group.rows.some((row) => row.trustStatus === 'trusted') ? 'trusted' : 'untrusted'
      primaryCatalog.visibilityStatus = anyVisible ? 'visible' : 'dismissed'
      primaryCatalog.dismissedAt = anyVisible ? null : group.rows.map((row) => row.dismissedAt).find(Boolean) || new Date()
      primaryCatalog.entries = mergedEntries
      primaryCatalog.selectionBySlot = mergedSelection
      await primaryCatalog.save()
      retainedIds.add(primaryCatalog.id)
    }

    const staleCatalogIds = catalogs.map((catalog) => catalog.id).filter((catalogId) => !retainedIds.has(catalogId))
    if (staleCatalogIds.length) {
      await Database.seriesReviewCatalogModel.destroy({
        where: {
          id: {
            [Op.in]: staleCatalogIds
          }
        }
      })
    }
  }

  async renameLocalSeriesSafely(libraryId, userId, sourceName, targetName) {
    const sourceDecisionKey = this.normalizeDecisionKey(sourceName)
    const normalizedTargetLabel = this.normalizeSeriesName(targetName)
    const seriesRows = await Database.seriesModel.findAll({
      where: {
        libraryId
      },
      order: [['name', 'ASC']]
    })

    const sourceSeriesIds = seriesRows
      .filter((series) => this.normalizeDecisionKey(series.name) === sourceDecisionKey)
      .filter((series) => this.normalizeSeriesName(series.name).toLowerCase() !== normalizedTargetLabel.toLowerCase())
      .map((series) => series.id)

    if (!sourceSeriesIds.length) {
      return {
        changedCount: 0,
        conflictCount: 0
      }
    }

    const preview = await this.previewSeriesManagementAction(libraryId, sourceSeriesIds, normalizedTargetLabel)
    if (preview.conflictCount) {
      throw new Error('Rename would create conflicting local coverage; resolve it manually in Series Management first')
    }
    const includedLibraryItemIds = (preview.books || []).filter((book) => book.includedByDefault).map((book) => book.libraryItemId)
    if (!includedLibraryItemIds.length) {
      return {
        changedCount: 0,
        conflictCount: 0
      }
    }

    return this.applySeriesManagementAction(libraryId, userId, sourceSeriesIds, normalizedTargetLabel, includedLibraryItemIds)
  }

  async applySeriesNameControlForLibrary(libraryId, userId, sourceName, targetName, controlType = 'alias', { applyLocalRename = false } = {}) {
    const currentResolver = await this.getSeriesNameControlResolverForLibrary(libraryId)
    const canonicalTargetName = currentResolver.canonicalizeName(targetName) || this.normalizeSeriesName(targetName)

    let renameResult = null
    if (applyLocalRename) {
      renameResult = await this.renameLocalSeriesSafely(libraryId, userId, sourceName, canonicalTargetName)
    }

    const control = await this.upsertSeriesNameControlForLibrary(libraryId, userId, sourceName, canonicalTargetName, controlType)

    const nextResolver = await this.getSeriesNameControlResolverForLibrary(libraryId)
    await this.rebuildCatalogsForLibrary(libraryId, nextResolver)
    await this.rebuildSuggestionsForLibrary(libraryId, nextResolver)

    return {
      control,
      renameResult,
      canonicalName: canonicalTargetName
    }
  }

  async aliasSuggestion(suggestionId, primarySuggestionId, userId) {
    const aliasSuggestion = await this.getSuggestionById(suggestionId)
    const primarySuggestion = await this.getSuggestionById(primarySuggestionId)
    if (!aliasSuggestion || !primarySuggestion) return null
    if (aliasSuggestion.libraryId !== primarySuggestion.libraryId || aliasSuggestion.libraryItemId !== primarySuggestion.libraryItemId) {
      throw new Error('Alias controls must target suggestions from the same review row')
    }
    if (aliasSuggestion.kind !== 'series' || primarySuggestion.kind !== 'series') {
      throw new Error('Alias controls require two series suggestions')
    }
    if (aliasSuggestion.id === primarySuggestion.id) {
      throw new Error('Choose a different suggestion to mark as the alias')
    }

    const result = await this.applySeriesNameControlForLibrary(
      aliasSuggestion.libraryId,
      userId,
      aliasSuggestion.suggestedName,
      primarySuggestion.suggestedName,
      'alias'
    )
    return {
      canonicalName: result.canonicalName
    }
  }

  async renameSuggestion(suggestionId, targetLabel, userId) {
    const suggestion = await this.getSuggestionById(suggestionId)
    if (!suggestion) return null
    if (suggestion.kind !== 'series') throw new Error('Only series suggestions can be renamed')

    const result = await this.applySeriesNameControlForLibrary(
      suggestion.libraryId,
      userId,
      suggestion.suggestedName,
      targetLabel,
      'rename',
      { applyLocalRename: true }
    )
    return {
      canonicalName: result.canonicalName,
      renameResult: result.renameResult || { changedCount: 0, conflictCount: 0 }
    }
  }

  async applySuggestion(suggestionId, userId, mode, replaceSeriesId = null) {
    const suggestion = await this.getSuggestionById(suggestionId)
    if (!suggestion || !suggestion.isActive) return null
    if (suggestion.kind === 'no_series') throw new Error('No-series evidence cannot be applied')

    const libraryItem = await Database.libraryItemModel.getExpandedById(suggestion.libraryItemId)
    if (!libraryItem || !libraryItem.isBook) return null
    const resolver = await this.getSeriesNameControlResolverForLibrary(suggestion.libraryId)
    const suggestedName = resolver.canonicalizeName(suggestion.suggestedName) || suggestion.suggestedName

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
      name: suggestedName,
      sequence: suggestion.suggestedSequence || null
    }
    const existingSuggestedIndex = nextSeries.findIndex((series) => resolver.getDecisionKey(series.name) === resolver.getDecisionKey(suggestedName))
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

  async unlinkSuggestion(suggestionId, userId) {
    const suggestion = await this.getSuggestionById(suggestionId)
    if (!suggestion || !suggestion.isActive) return null
    if (suggestion.kind !== 'series') throw new Error('Only series suggestions can be unlinked')

    const libraryItem = await Database.libraryItemModel.getExpandedById(suggestion.libraryItemId)
    if (!libraryItem || !libraryItem.isBook) return null

    const resolver = await this.getSeriesNameControlResolverForLibrary(suggestion.libraryId)
    const currentSeries = Array.isArray(libraryItem.media.series) ? libraryItem.media.series : []
    const matchingSeriesIds = currentSeries
      .filter((series) => resolver.getDecisionKey(series.name) === resolver.getDecisionKey(suggestion.suggestedName))
      .filter((series) => this.sequencesCompatible(series.bookSeries?.sequence || null, suggestion.suggestedSequence))
      .map((series) => series.id)

    if (!matchingSeriesIds.length) {
      throw new Error('No linked series entry was found on the book')
    }

    const nextSeries = currentSeries
      .filter((series) => !matchingSeriesIds.includes(series.id))
      .map((series) => ({
        name: series.name,
        sequence: series.bookSeries?.sequence || null
      }))

    const seriesUpdateData = await libraryItem.media.updateSeriesFromRequest(nextSeries, libraryItem.libraryId)
    await this.persistLibraryItemSeriesChange(libraryItem, seriesUpdateData, { addSeriesEditTag: true })

    suggestion.state = 'pending'
    suggestion.decisionAction = null
    suggestion.decisionSeriesId = null
    suggestion.decidedByUserId = userId || null
    suggestion.decidedAt = null
    await suggestion.save()

    return {
      suggestion,
      libraryItem: await Database.libraryItemModel.getExpandedById(libraryItem.id)
    }
  }
}

module.exports = new SeriesReviewManager()
