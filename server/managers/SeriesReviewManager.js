const { literal, Op } = require('sequelize')

const Database = require('../Database')
const Logger = require('../Logger')

class SeriesReviewManager {
  get SERIES_EDIT_TAG() {
    return '-series-edit'
  }

  resetSeriesReviewSchemaCacheIfNeeded() {
    if (this.seriesReviewSchemaSequelize === Database.sequelize) return
    this.seriesReviewSchemaSequelize = Database.sequelize
    this.seriesReviewCatalogSchemaReady = false
    this.seriesReviewCatalogSchemaPromise = null
    this.seriesReviewSeriesSourceLinkSchemaReady = false
    this.seriesReviewSeriesSourceLinkSchemaPromise = null
  }

  async ensureSeriesReviewCatalogSchema() {
    this.resetSeriesReviewSchemaCacheIfNeeded()
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

    await this.ensureSeriesReviewLocalSeriesMatchSchemaInner()
    await this.ensureSeriesReviewSeriesSourceLinkSchemaInner()
  }

  async ensureSeriesReviewLocalSeriesMatchSchemaInner() {
    const queryInterface = Database.sequelize.getQueryInterface()
    const tableName = 'seriesReviewLocalSeriesMatches'
    const desiredIndexName = 'seriesReviewLocalSeriesMatch_library_local_decision_key_source_series_url'
    const legacyIndexName = 'seriesReviewLocalSeriesMatch_library_local_decision_key'
    const indexes = await queryInterface.showIndex(tableName)
    if (indexes.some((index) => index.name === desiredIndexName)) return

    try {
      await queryInterface.removeIndex(tableName, legacyIndexName)
    } catch (error) {
      if (!String(error?.message || '').includes('no such index')) {
        Logger.debug?.('[SeriesReviewManager] Failed to remove legacy local series match index', error)
      }
    }

    await queryInterface.addIndex(tableName, ['libraryId', 'localDecisionKey', 'sourceSeriesUrl'], {
      unique: true,
      name: desiredIndexName
    })
  }

  async ensureSeriesReviewSeriesSourceLinkSchemaInner() {
    this.resetSeriesReviewSchemaCacheIfNeeded()
    if (this.seriesReviewSeriesSourceLinkSchemaReady) return
    if (!this.seriesReviewSeriesSourceLinkSchemaPromise) {
      this.seriesReviewSeriesSourceLinkSchemaPromise = this.ensureSeriesReviewSeriesSourceLinkSchemaInnerImpl()
        .then(() => {
          this.seriesReviewSeriesSourceLinkSchemaReady = true
        })
        .finally(() => {
          this.seriesReviewSeriesSourceLinkSchemaPromise = null
        })
    }
    await this.seriesReviewSeriesSourceLinkSchemaPromise
  }

  async ensureSeriesReviewSeriesSourceLinkSchemaInnerImpl() {
    const queryInterface = Database.sequelize.getQueryInterface()
    const tableName = 'seriesReviewSeriesSourceLinks'
    let tableDescription = null
    try {
      tableDescription = await queryInterface.describeTable(tableName)
    } catch {
      return
    }
    if (!tableDescription) return

    const DataTypes = queryInterface.sequelize.Sequelize.DataTypes
    if (!tableDescription.importStatus) {
      await queryInterface.addColumn(tableName, 'importStatus', {
        type: DataTypes.STRING,
        allowNull: false,
        defaultValue: 'imported'
      })
      await queryInterface.sequelize.query("UPDATE seriesReviewSeriesSourceLinks SET importStatus = 'imported' WHERE importStatus IS NULL OR TRIM(importStatus) = ''")
    }

    if (!tableDescription.lastImportedAt) {
      await queryInterface.addColumn(tableName, 'lastImportedAt', {
        type: DataTypes.DATE,
        allowNull: true
      })
      await queryInterface.sequelize.query('UPDATE seriesReviewSeriesSourceLinks SET lastImportedAt = COALESCE(updatedAt, createdAt) WHERE isActive = 1 AND lastImportedAt IS NULL')
    }

    const existingCount = await Database.seriesReviewSeriesSourceLinkModel.count()
    const legacyRows = await Database.seriesReviewLocalSeriesMatchModel.findAll({
      order: [['updatedAt', 'DESC']],
      raw: true
    })
    if (!legacyRows.length) return
    if (existingCount >= legacyRows.length) return

    const now = new Date().toISOString()
    for (const row of legacyRows) {
      const evidenceSnapshot = this.normalizeEvidenceSnapshot(row.evidenceSnapshot)
      const linkedBookCount = this.getSeriesSourceLinkBookCount(evidenceSnapshot)
      const coverageStatus = linkedBookCount > 0 ? 'linked' : 'partial'
      await Database.sequelize.query(
        `INSERT OR IGNORE INTO seriesReviewSeriesSourceLinks
          (id, libraryId, localDecisionKey, localSeriesName, source, sourceSeriesName, sourceAuthor, sourceSeriesUrl, coverageStatus, linkedBookCount, totalBookCount, importStatus, lastImportedAt, evidenceSnapshot, isActive, unlinkedAt, unlinkedByUserId, createdAt, updatedAt)
         VALUES
          (:id, :libraryId, :localDecisionKey, :localSeriesName, :source, :sourceSeriesName, :sourceAuthor, :sourceSeriesUrl, :coverageStatus, :linkedBookCount, :totalBookCount, 'imported', :lastImportedAt, :evidenceSnapshot, 1, NULL, NULL, :createdAt, :updatedAt)`,
        {
          replacements: {
            id: row.id,
            libraryId: row.libraryId,
            localDecisionKey: row.localDecisionKey,
            localSeriesName: row.localSeriesName,
            source: row.source,
            sourceSeriesName: row.sourceSeriesName,
            sourceAuthor: row.sourceAuthor,
            sourceSeriesUrl: row.sourceSeriesUrl,
            coverageStatus,
            linkedBookCount,
            totalBookCount: linkedBookCount,
            lastImportedAt: row.updatedAt || row.createdAt || now,
            evidenceSnapshot: JSON.stringify(evidenceSnapshot || {}),
            createdAt: row.createdAt || now,
            updatedAt: row.updatedAt || now
          }
        }
      )
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

  normalizeEvidenceSnapshot(snapshot) {
    if (snapshot && typeof snapshot === 'object' && !Array.isArray(snapshot)) return snapshot
    if (typeof snapshot !== 'string') return {}
    try {
      const parsed = JSON.parse(snapshot)
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
    } catch {
      return {}
    }
  }

  getEffectiveEvidenceSnapshot(snapshot, fallbackSnapshot = null) {
    const normalized = this.normalizeEvidenceSnapshot(snapshot)
    if (Object.keys(normalized).length) return normalized
    return this.normalizeEvidenceSnapshot(fallbackSnapshot)
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

  getCatalogDisplayBucket({ trustStatus, visibilityStatus, localBookCount, isLocalOnly = false, isLocallyLinked = false }) {
    if (visibilityStatus === 'dismissed') return 'dismissed'
    if (isLocalOnly) return 'local_only'
    if (isLocallyLinked) return 'locally_linked'
    if (!localBookCount) return 'potential'
    return trustStatus === 'untrusted' ? 'less_trusted' : 'trusted'
  }

  getCatalogDisplayLabel(bucket) {
    if (bucket === 'local_only') return 'Local series'
    if (bucket === 'locally_linked') return 'Linked'
    if (bucket === 'potential') return 'Potential series'
    if (bucket === 'less_trusted') return 'Less trusted'
    if (bucket === 'dismissed') return 'Dismissed'
    return 'Trusted'
  }

  normalizeSeriesUrlSlug(value) {
    return this.normalizeSeriesName(value)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
  }

  formatAudibleSeriesUrlSlug(value) {
    return this.normalizeSeriesName(value)
      .replace(/[^A-Za-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
  }

  normalizeExternalUrl(value) {
    const urlText = String(value || '').trim()
    if (!urlText) return ''
    try {
      const parsed = new URL(urlText)
      parsed.search = ''
      parsed.hash = ''
      return parsed.toString()
    } catch {
      return urlText
    }
  }

  getAudibleRegionTld(region) {
    switch (this.normalizeSeriesName(region).toLowerCase()) {
      case 'us':
        return 'com'
      case 'uk':
        return 'co.uk'
      case 'ca':
        return 'ca'
      case 'au':
        return 'com.au'
      case 'de':
        return 'de'
      case 'fr':
        return 'fr'
      case 'it':
        return 'it'
      case 'es':
        return 'es'
      case 'jp':
        return 'co.jp'
      case 'in':
        return 'in'
      default:
        return ''
    }
  }

  getAudibleRegionFromUrl(url) {
    try {
      const host = new URL(String(url || '').trim()).host.toLowerCase()
      if (host.endsWith('audible.com')) return 'us'
      if (host.endsWith('audible.co.uk')) return 'uk'
      if (host.endsWith('audible.ca')) return 'ca'
      if (host.endsWith('audible.com.au')) return 'au'
      if (host.endsWith('audible.de')) return 'de'
      if (host.endsWith('audible.fr')) return 'fr'
      if (host.endsWith('audible.it')) return 'it'
      if (host.endsWith('audible.es')) return 'es'
      if (host.endsWith('audible.co.jp')) return 'jp'
      if (host.endsWith('audible.in')) return 'in'
    } catch {}
    return ''
  }

  buildAudibleSeriesUrl(region, seriesAsin, seriesName) {
    const normalizedRegion = this.normalizeSeriesName(region).toLowerCase()
    const normalizedAsin = this.normalizeSeriesName(seriesAsin).toUpperCase()
    const normalizedSeriesName = this.normalizeSeriesName(seriesName)
    const tld = this.getAudibleRegionTld(normalizedRegion)
    const slug = this.formatAudibleSeriesUrlSlug(normalizedSeriesName)
    if (!tld || !normalizedAsin || !slug) return ''
    return `https://www.audible.${tld}/series/${slug}-Audiobooks/${normalizedAsin}`
  }

  getCatalogSourceCanonicalEvidenceUrl(source, fallbackSeriesName = '') {
    const sourceKey = this.normalizeSeriesName(source?.source || '').toLowerCase()
    const existingUrl = this.normalizeExternalUrl(source?.evidenceUrl || '')
    if (!existingUrl) return ''
    if (sourceKey !== 'audible') return existingUrl
    if (existingUrl.includes('/series/')) return existingUrl

    const rawEvidence = source?.rawEvidence && typeof source.rawEvidence === 'object' && !Array.isArray(source.rawEvidence) ? source.rawEvidence : null
    const providerMeta = source?.providerMeta && typeof source.providerMeta === 'object' && !Array.isArray(source.providerMeta) ? source.providerMeta : null
    const localSeriesImport =
      rawEvidence?.localSeriesImport && typeof rawEvidence.localSeriesImport === 'object' && !Array.isArray(rawEvidence.localSeriesImport)
        ? rawEvidence.localSeriesImport
        : null
    const localImportSnapshot =
      localSeriesImport?.evidenceSnapshot && typeof localSeriesImport.evidenceSnapshot === 'object' && !Array.isArray(localSeriesImport.evidenceSnapshot)
        ? localSeriesImport.evidenceSnapshot
        : null
    const directSeriesUrlCandidates = [
      localSeriesImport?.sourceSeriesUrl,
      localImportSnapshot?.sourceSeriesUrl,
      localImportSnapshot?.sourceUrl,
      rawEvidence?.sourceSeriesUrl,
      providerMeta?.sourceSeriesUrl
    ]
      .map((value) => this.normalizeExternalUrl(value))
      .filter(Boolean)
    const directSeriesUrl = directSeriesUrlCandidates.find((value) => value.includes('/series/'))
    if (directSeriesUrl) return directSeriesUrl

    const audibleSeriesBucket = Array.isArray(rawEvidence?.audible?.series) ? rawEvidence.audible.series : []
    const audibleSeries = audibleSeriesBucket.find((entry) => entry && typeof entry === 'object' && !Array.isArray(entry) && (entry.asin || entry.title || entry.name)) || null
    const seriesAsin = this.normalizeSeriesName(audibleSeries?.asin || '')
    const seriesName = this.normalizeSeriesName(
      audibleSeries?.title ||
        audibleSeries?.name ||
        rawEvidence?.sourceSeriesName ||
        localSeriesImport?.sourceSeriesName ||
        localImportSnapshot?.sourceSeriesName ||
        providerMeta?.sourceSeriesName ||
        providerMeta?.seriesName ||
        fallbackSeriesName
    )
    const region = this.normalizeSeriesName(
      rawEvidence?.region ||
        localImportSnapshot?.sourceRegion ||
        localSeriesImport?.sourceRegion ||
        providerMeta?.region_used ||
        providerMeta?.region ||
        this.getAudibleRegionFromUrl(existingUrl)
    ).toLowerCase()
    const derivedUrl = this.buildAudibleSeriesUrl(region, seriesAsin, seriesName)
    return derivedUrl || existingUrl
  }

  canonicalizeCatalogSource(input, options = {}) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) return input
    const fallbackSeriesName = this.normalizeSeriesName(options?.fallbackSeriesName || '')
    const canonicalUrl = this.getCatalogSourceCanonicalEvidenceUrl(input, fallbackSeriesName)
    if (!canonicalUrl) return input
    if (canonicalUrl === input.evidenceUrl) return input

    const previousUrl = input.evidenceUrl
    input.evidenceUrl = canonicalUrl

    if (input.source === 'audible' && input.rawEvidence && typeof input.rawEvidence === 'object' && !Array.isArray(input.rawEvidence)) {
      const localSeriesImport =
        input.rawEvidence.localSeriesImport && typeof input.rawEvidence.localSeriesImport === 'object' && !Array.isArray(input.rawEvidence.localSeriesImport)
          ? input.rawEvidence.localSeriesImport
          : null
      if (localSeriesImport) {
        if (localSeriesImport.sourceSeriesUrl) localSeriesImport.sourceSeriesUrl = canonicalUrl
        if (
          localSeriesImport.evidenceSnapshot &&
          typeof localSeriesImport.evidenceSnapshot === 'object' &&
          !Array.isArray(localSeriesImport.evidenceSnapshot)
        ) {
          if (localSeriesImport.evidenceSnapshot.sourceSeriesUrl) localSeriesImport.evidenceSnapshot.sourceSeriesUrl = canonicalUrl
          if (localSeriesImport.evidenceSnapshot.sourceUrl) localSeriesImport.evidenceSnapshot.sourceUrl = canonicalUrl
          if (localSeriesImport.evidenceSnapshot.sourceLinkUrl) localSeriesImport.evidenceSnapshot.sourceLinkUrl = canonicalUrl
          if (localSeriesImport.evidenceSnapshot.sourceIdentifier === previousUrl) {
            localSeriesImport.evidenceSnapshot.sourceIdentifier = canonicalUrl
          }
        }
      }
      const audibleSeriesBucket = Array.isArray(input.rawEvidence.audible?.series) ? input.rawEvidence.audible.series : []
      audibleSeriesBucket.forEach((entry) => {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return
        if (entry.url) entry.url = canonicalUrl
      })
    }

    return input
  }

  formatSlugDisplayName(value) {
    return String(value || '')
      .split('-')
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ')
  }

  extractCatalogAuthorFromEvidenceUrl(seriesName, evidenceUrl) {
    if (!seriesName || !evidenceUrl) return ''
    let url
    try {
      url = new URL(evidenceUrl)
    } catch {
      return ''
    }

    const pathParts = String(url.pathname || '').split('/').filter(Boolean)
    if (!pathParts.length || pathParts[0] !== 'series') return ''
    const slugWithId = pathParts[pathParts.length - 1].replace(/\.html?$/i, '')
    const slug = slugWithId.replace(/~.*$/, '')
    const seriesSlug = this.normalizeSeriesUrlSlug(seriesName)
    if (!slug || !seriesSlug || !slug.startsWith(`${seriesSlug}-`)) return ''
    return this.normalizeSeriesName(this.formatSlugDisplayName(slug.slice(seriesSlug.length + 1)))
  }

  buildCatalogSourceAuthorMeta(seriesName, entryOrRows = []) {
    const authors = []
    const seen = new Set()
    const addAuthor = (value) => {
      const authorName = this.normalizeSeriesName(value)
      const authorKey = this.normalizeKeyPart(authorName)
      if (!authorName || !authorKey || seen.has(authorKey)) return
      seen.add(authorKey)
      authors.push(authorName)
    }

    ;(Array.isArray(entryOrRows) ? entryOrRows : []).forEach((entry) => {
      ;(entry?.sources || []).forEach((source) => addAuthor(this.extractCatalogAuthorFromEvidenceUrl(seriesName, source?.evidenceUrl)))
    })

    return {
      authorLine: authors.slice(0, 3).join(', '),
      authorSearchText: authors.join(' ')
    }
  }

  buildCatalogAuthorMeta(seriesName, localBooks = [], entryOrRows = []) {
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

    if (!(Array.isArray(localBooks) ? localBooks : []).length) {
      const sourceAuthorMeta = this.buildCatalogSourceAuthorMeta(seriesName, entryOrRows)
      if (sourceAuthorMeta.authorLine) return sourceAuthorMeta
    }

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

  getCatalogSourceUrls(entries = [], preferredSource = '') {
    const urls = new Set()
    this.normalizeCatalogEntries(entries).forEach((entry) => {
      ;(entry.sources || []).forEach((source) => {
        const sourceKey = String(source?.source || '').trim().toLowerCase()
        const evidenceUrl = String(source?.evidenceUrl || '').trim()
        if (!sourceKey || !evidenceUrl) return
        if (preferredSource && sourceKey !== preferredSource) return
        urls.add(evidenceUrl)
      })
    })
    return [...urls]
  }

  doesCatalogSourceMatchSeriesSourceUrl(source, sourceSeriesUrl, preferredSource = '') {
    const targetUrl = this.normalizeExternalUrl(sourceSeriesUrl || '')
    if (!targetUrl) return false

    const sourceKey = String(source?.source || '').trim().toLowerCase()
    if (preferredSource && sourceKey !== String(preferredSource || '').trim().toLowerCase()) return false

    const evidenceUrl = this.normalizeExternalUrl(source?.evidenceUrl || '')
    return !!evidenceUrl && evidenceUrl === targetUrl
  }

  stripCatalogSourceEvidence(entries = [], sourceSeriesUrl, options = {}) {
    const preferredSource = String(options?.source || '').trim().toLowerCase()
    let changed = false
    let removedCount = 0

    const nextEntries = (Array.isArray(entries) ? entries : []).map((entry) => {
      const currentSources = Array.isArray(entry?.sources) ? entry.sources : []
      if (!currentSources.length) return entry

      const nextSources = currentSources.filter((source) => {
        const shouldRemove = this.doesCatalogSourceMatchSeriesSourceUrl(source, sourceSeriesUrl, preferredSource)
        if (shouldRemove) {
          changed = true
          removedCount += 1
        }
        return !shouldRemove
      })

      if (nextSources.length === currentSources.length) return entry
      return {
        ...entry,
        sources: nextSources
      }
    })

    return {
      changed,
      removedCount,
      entries: changed ? nextEntries : Array.isArray(entries) ? entries : []
    }
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
    isLocallyLinked = false,
    canDismiss = true
  }) {
    const normalizedEntries = this.normalizeCatalogEntries(entries)
    const bucket =
      displayBucket ||
      this.getCatalogDisplayBucket({
        trustStatus,
        visibilityStatus,
        localBookCount: Array.isArray(localBooks) ? localBooks.length : 0,
        isLocallyLinked
      })
    const authorMeta = this.buildCatalogAuthorMeta(seriesName, localBooks, normalizedEntries)

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

  buildLocalSeriesMatchPayload(matchRow, { localBooks = [], resolvedCatalogId = null } = {}) {
    return this.buildSeriesSourceLinkPayload(matchRow, { localBooks, resolvedCatalogId })
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

  cleanCatalogSource(input, options = {}) {
    const source = String(input?.source || '')
      .trim()
      .toLowerCase()
    if (!source) return null

    const confidenceValue = Number(input?.confidence)
    const sourceRef = typeof input?.sourceRef === 'string' ? input.sourceRef.trim() || null : null
    const providerMeta =
      input?.providerMeta && typeof input.providerMeta === 'object' && !Array.isArray(input.providerMeta)
        ? JSON.parse(JSON.stringify(input.providerMeta))
        : null
    const rawEvidence =
      input?.rawEvidence && typeof input.rawEvidence === 'object' && !Array.isArray(input.rawEvidence)
        ? JSON.parse(JSON.stringify(input.rawEvidence))
        : null
    const cleaned = {
      source,
      label: String(input?.label || source).trim() || source,
      confidence: Number.isFinite(confidenceValue) ? Number(confidenceValue.toFixed(3)) : null,
      evidenceUrl: this.normalizeExternalUrl(input?.evidenceUrl || '') || null,
      notes: typeof input?.notes === 'string' ? input.notes.trim() || null : null,
      sourceRef,
      providerMeta,
      rawEvidence
    }
    return this.canonicalizeCatalogSource(cleaned, options)
  }

  normalizeCatalogSlotToken(value) {
    const cleaned = String(value || '')
      .trim()
      .replace(/\s+/g, '')
    return cleaned || null
  }

  isRangedCatalogSlot(slot) {
    return /^\d+(?:\.\d+)?-\d+(?:\.\d+)?$/.test(String(slot || '').trim())
  }

  isOmnibusCatalogSequenceLabel(value) {
    const normalized = this.normalizeCatalogSlotToken(value)
    return !!normalized && this.isRangedCatalogSlot(normalized)
  }

  getCoverageEligibleLocalBooks(localBooks = []) {
    return (Array.isArray(localBooks) ? localBooks : []).filter((book) => !this.isOmnibusCatalogSequenceLabel(book?.sequence || ''))
  }

  getCoverageEligibleLocalBookCount(localBooks = []) {
    return this.getCoverageEligibleLocalBooks(localBooks).length
  }

  isMonthYearCatalogDate(value) {
    return /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)-\d{4}$/i.test(String(value || '').trim())
  }

  looksLikeLegacyFictionDbCatalogSwap({ title, authors, sequenceLabel, publishedDate, sources }) {
    if (publishedDate || !title || !sequenceLabel || !Array.isArray(authors) || !authors.length) return false
    const hasFictionDbSource = (Array.isArray(sources) ? sources : []).some((source) => String(source?.source || '').trim().toLowerCase() === 'fictiondb')
    if (!hasFictionDbSource || !this.isMonthYearCatalogDate(title)) return false
    if (/\d/.test(sequenceLabel)) return false
    return true
  }

  repairLegacyFictionDbCatalogEntry({ title, authors, sequenceLabel, publishedDate, sources }) {
    if (!this.looksLikeLegacyFictionDbCatalogSwap({ title, authors, sequenceLabel, publishedDate, sources })) {
      return { title, authors, sequenceLabel, publishedDate }
    }

    const repairedTitle = this.normalizeSeriesName(authors[0] || '')
    const repairedAuthor = this.normalizeSeriesName(sequenceLabel)
    if (!repairedTitle || !repairedAuthor) {
      return { title, authors, sequenceLabel, publishedDate }
    }

    return {
      title: repairedTitle,
      authors: [repairedAuthor],
      sequenceLabel: '',
      publishedDate: title
    }
  }

  expandCatalogSequenceCoverage(sequenceLabel) {
    const normalizedLabel = String(sequenceLabel || '')
      .trim()
      .replace(/\s+/g, ' ')
    if (!normalizedLabel) return []
    if (this.isOmnibusCatalogSequenceLabel(normalizedLabel)) return []

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
        let title = this.normalizeSeriesName(entry?.title || '')
        let authors = (Array.isArray(entry?.authors) ? entry.authors : [entry?.author])
          .map((author) => this.normalizeSeriesName(author || ''))
          .filter(Boolean)
        let sequenceLabel = String(entry?.sequenceLabel || entry?.sequence || '')
          .trim()
          .replace(/\s+/g, ' ')
        let publishedDate = this.normalizeSeriesName(entry?.publishedDate || entry?.releaseDate || '')
        const sources = (Array.isArray(entry?.sources) ? entry.sources : [])
          .map((source) => this.cleanCatalogSource(source))
          .filter(Boolean)
        ;({ title, authors, sequenceLabel, publishedDate } = this.repairLegacyFictionDbCatalogEntry({
          title,
          authors,
          sequenceLabel,
          publishedDate,
          sources
        }))
        const explicitCoveredSlots = Array.isArray(entry?.coveredSlots)
          ? entry.coveredSlots
              .map((slot) => this.normalizeCatalogSlotToken(slot))
              .filter(Boolean)
          : []
        const isOmnibus = this.isOmnibusCatalogSequenceLabel(sequenceLabel)
        const coveredSlots = explicitCoveredSlots.length ? explicitCoveredSlots : isOmnibus ? [] : this.expandCatalogSequenceCoverage(sequenceLabel)

        if (!title) return null

        return {
          entryKey: this.buildCatalogEntryKey({ title, sequenceLabel }),
          title,
          authors,
          publishedDate: publishedDate || null,
          sequenceLabel: sequenceLabel || null,
          isOmnibus,
          coveredSlots,
          sources
        }
      })
      .filter(Boolean)
  }

  getCatalogEntryTitleKey(value) {
    return this.normalizeKeyPart(value || '')
  }

  getCatalogEntryTitleKeys(value, seriesName = '') {
    const keys = new Set()
    const original = String(value || '').trim()
    if (!original) return []

    const addKey = (candidate) => {
      const key = this.getCatalogEntryTitleKey(candidate)
      if (key) keys.add(key)
    }

    addKey(original)

    const normalizedSeriesName = String(seriesName || '').trim()
    if (normalizedSeriesName) {
      const escapedSeriesName = normalizedSeriesName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const stripped = original.replace(new RegExp(`^${escapedSeriesName}(?:\\s*[:\\-]\\s*|\\s+)`, 'i'), '').trim()
      if (stripped && stripped !== original) addKey(stripped)
    }

    return [...keys]
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

  async getSeriesBooksBySeriesIds(libraryId, seriesIds = []) {
    const uniqueSeriesIds = [...new Set((Array.isArray(seriesIds) ? seriesIds : []).map((id) => String(id || '').trim()).filter(Boolean))]
    const booksBySeriesId = new Map()
    if (!uniqueSeriesIds.length) return booksBySeriesId

    const rows = await Database.sequelize.query(
      `SELECT
          bs.seriesId AS seriesId,
          bs.sequence AS sequence,
          b.id AS bookId,
          b.title AS title,
          li.id AS libraryItemId,
          li.relPath AS relPath,
          a.id AS authorId,
          a.name AS authorName
        FROM bookSeries bs
        INNER JOIN books b
          ON b.id = bs.bookId
        LEFT JOIN libraryItems li
          ON li.mediaId = b.id
          AND li.libraryId = :libraryId
          AND li.mediaType = 'book'
        LEFT JOIN bookAuthors ba
          ON ba.bookId = b.id
        LEFT JOIN authors a
          ON a.id = ba.authorId
        WHERE bs.seriesId IN (:seriesIds)
        ORDER BY bs.seriesId ASC, bs.sequence ASC, b.title ASC`,
      {
        replacements: {
          libraryId,
          seriesIds: uniqueSeriesIds
        },
        type: Database.sequelize.QueryTypes.SELECT
      }
    )

    rows.forEach((row) => {
      const seriesId = String(row.seriesId || '')
      const bookId = String(row.bookId || '')
      if (!seriesId || !bookId) return
      if (!booksBySeriesId.has(seriesId)) booksBySeriesId.set(seriesId, new Map())

      const bucket = booksBySeriesId.get(seriesId)
      if (!bucket.has(bookId)) {
        bucket.set(bookId, {
          libraryItemId: row.libraryItemId || null,
          title: row.title || '',
          relPath: row.relPath || '',
          sequence: this.normalizeSequence(row.sequence || null),
          authors: []
        })
      }

      const authorName = String(row.authorName || '').trim()
      if (!authorName) return
      const book = bucket.get(bookId)
      if (!book.authors.some((author) => author.name === authorName)) {
        book.authors.push({ id: row.authorId || null, name: authorName })
      }
    })

    booksBySeriesId.forEach((bucket, seriesId) => {
      booksBySeriesId.set(seriesId, [...bucket.values()])
    })

    return booksBySeriesId
  }

  async getSeriesSourceLinkRowsForLibrary(libraryId, options = {}) {
    const where = { libraryId }
    if (options?.localDecisionKey) where.localDecisionKey = options.localDecisionKey
    if (options?.sourceSeriesUrl) where.sourceSeriesUrl = options.sourceSeriesUrl
    if (Array.isArray(options?.sourceSeriesUrls) && options.sourceSeriesUrls.length) {
      where.sourceSeriesUrl = { [Op.in]: options.sourceSeriesUrls }
    }
    if (options?.activeOnly === true) where.isActive = true
    if (options?.activeOnly === false) where.isActive = false
    return Database.seriesReviewSeriesSourceLinkModel.findAll({
      where,
      order: [['updatedAt', 'DESC']]
    })
  }

  async getLocalSeriesMatchRowsForLibrary(libraryId, options = {}) {
    return this.getSeriesSourceLinkRowsForLibrary(libraryId, options)
  }

  buildCatalogSourceUrlMap(catalogs = []) {
    const sourceUrlMap = new Map()
    ;(Array.isArray(catalogs) ? catalogs : []).forEach((catalog) => {
      this.getCatalogSourceUrls(catalog?.entries || []).forEach((sourceUrl) => {
        if (!sourceUrlMap.has(sourceUrl)) sourceUrlMap.set(sourceUrl, catalog.id)
      })
    })
    return sourceUrlMap
  }

  async getResolvedCatalogIdForLocalDecisionKey(libraryId, decisionKey, catalogs = null) {
    if (!decisionKey) return null
    const matchRows = await this.getSeriesSourceLinkRowsForLibrary(libraryId, { localDecisionKey: decisionKey, activeOnly: true })
    if (!matchRows.length) return null

    const allCatalogs = Array.isArray(catalogs) ? catalogs : await Database.seriesReviewCatalogModel.findAll({ where: { libraryId } })
    const sourceUrlMap = this.buildCatalogSourceUrlMap(allCatalogs)
    for (const matchRow of matchRows) {
      const resolvedCatalogId = sourceUrlMap.get(matchRow.sourceSeriesUrl)
      if (resolvedCatalogId) return resolvedCatalogId
    }
    return null
  }

  getSeriesSourceLinkBookCount(evidenceSnapshot) {
    const snapshot = this.normalizeEvidenceSnapshot(evidenceSnapshot)
    const matchingBooks = Array.isArray(snapshot?.matchingBooks) ? snapshot.matchingBooks : []
    const seen = new Set()
    let count = 0
    matchingBooks.forEach((book) => {
      const key = String(book?.libraryItemId || book?.localTitle || book?.sourceTitle || '').trim()
      if (!key || seen.has(key)) return
      seen.add(key)
      count += 1
    })
    return count
  }

  normalizeSeriesSourceBookEntry(book = {}) {
    const title = this.normalizeSeriesName(book?.title || book?.sourceTitle || '')
    if (!title) return null
    return {
      title,
      sequence: this.normalizeSequence(book?.sequence || book?.sourceSequence || null),
      publishedDate: String(book?.publishedDate || book?.sourcePublishedDate || '').trim() || null,
      authors: Array.isArray(book?.authors)
        ? book.authors.filter(Boolean)
        : Array.isArray(book?.sourceAuthors)
          ? book.sourceAuthors.filter(Boolean)
          : [],
      sourceUrl: String(book?.sourceUrl || '').trim(),
      sourceAsin: String(book?.sourceAsin || '').trim(),
      sourceRegion: String(book?.sourceRegion || '').trim()
    }
  }

  sortSeriesSourceBooks(books = []) {
    return [...(Array.isArray(books) ? books : [])].sort((left, right) => {
      const leftSequence = String(left?.sequence || '')
      const rightSequence = String(right?.sequence || '')
      if (leftSequence && rightSequence && leftSequence !== rightSequence) {
        return leftSequence.localeCompare(rightSequence, undefined, { numeric: true })
      }
      if (leftSequence && !rightSequence) return -1
      if (!leftSequence && rightSequence) return 1
      return String(left?.title || '').localeCompare(String(right?.title || ''))
    })
  }

  getSeriesSourceLinkSeriesBooks(evidenceSnapshot) {
    const snapshot = this.normalizeEvidenceSnapshot(evidenceSnapshot)
    const explicitSeriesBooks = Array.isArray(snapshot?.seriesBooks) ? snapshot.seriesBooks : []
    const rawBooks = explicitSeriesBooks.length
      ? explicitSeriesBooks
      : [
          ...(Array.isArray(snapshot?.matchingBooks) ? snapshot.matchingBooks : []),
          ...(Array.isArray(snapshot?.sampleBooks) ? snapshot.sampleBooks : [])
        ]

    const seen = new Set()
    const seriesBooks = []
    rawBooks.forEach((book) => {
      const normalizedBook = this.normalizeSeriesSourceBookEntry(book)
      if (!normalizedBook) return
      const dedupeKey = `${this.normalizeKeyPart(normalizedBook.title)}::${normalizedBook.sequence || ''}`
      if (!dedupeKey || seen.has(dedupeKey)) return
      seen.add(dedupeKey)
      seriesBooks.push(normalizedBook)
    })

    return this.sortSeriesSourceBooks(seriesBooks)
  }

  getSeriesSourceLinkSequenceStatusNote(snapshot, coverageStatus = '') {
    const normalizedSnapshot = this.normalizeEvidenceSnapshot(snapshot)
    const note = typeof normalizedSnapshot?.sequenceStatusNote === 'string' ? normalizedSnapshot.sequenceStatusNote.trim() : ''
    if (!note) return ''
    if (String(coverageStatus || '').trim().toLowerCase() === 'linked' && note === 'Partial source coverage from current catalog entries') {
      return ''
    }
    return note
  }

  getSeriesSourceLinkCoverageStatus(linkRow, localBooks = [], evidenceSnapshot = null) {
    if (!linkRow?.isActive) return 'previously_linked'
    const snapshot = this.getEffectiveEvidenceSnapshot(evidenceSnapshot, linkRow?.evidenceSnapshot)
    const snapshotLinkedBookCount = this.getSeriesSourceLinkBookCount(snapshot)
    const storedLinkedBookCount = Number.isFinite(Number(linkRow?.linkedBookCount)) ? Number(linkRow.linkedBookCount) : 0
    const linkedBookCount = snapshotLinkedBookCount || storedLinkedBookCount
    const totalBookCount = Array.isArray(localBooks) ? this.getCoverageEligibleLocalBookCount(localBooks) : Number.isFinite(Number(linkRow?.totalBookCount)) ? Number(linkRow.totalBookCount) : 0
    if (totalBookCount > 0 && linkedBookCount >= totalBookCount) return 'linked'
    return 'partial'
  }

  buildCatalogSourceCoverageBySourceUrl(rows = [], localBooks = []) {
    const totalBookCount = this.getCoverageEligibleLocalBookCount(localBooks)
    const matchedLocalBookIdsByUrl = new Map()

    ;(Array.isArray(rows) ? rows : []).forEach((row) => {
      if (row?.rowType === 'omnibus') return
      const supports = Array.isArray(row?.sourceSupport) ? row.sourceSupport : []
      const localRowBooks = Array.isArray(row?.localBooks) ? row.localBooks : []
      if (!supports.length || !localRowBooks.length) return

      supports.forEach((support) => {
        const evidenceUrl = this.normalizeExternalUrl(support?.evidenceUrl || '')
        if (!evidenceUrl) return
        if (!matchedLocalBookIdsByUrl.has(evidenceUrl)) matchedLocalBookIdsByUrl.set(evidenceUrl, new Set())
        const matchedIds = matchedLocalBookIdsByUrl.get(evidenceUrl)
        localRowBooks.forEach((book) => {
          const libraryItemId = String(book?.libraryItemId || '').trim()
          if (libraryItemId) matchedIds.add(libraryItemId)
        })
      })
    })

    const coverageBySourceUrl = new Map()
    matchedLocalBookIdsByUrl.forEach((matchedIds, evidenceUrl) => {
      const linkedBookCount = matchedIds.size
      coverageBySourceUrl.set(evidenceUrl, {
        linkedBookCount,
        totalBookCount,
        coverageStatus: totalBookCount > 0 && linkedBookCount >= totalBookCount ? 'linked' : 'partial'
      })
    })
    return coverageBySourceUrl
  }

  buildSeriesSourceLinkPayload(linkRow, { localBooks = [], resolvedCatalogId = null, evidenceSnapshot = null, coverageOverride = null } = {}) {
    const snapshot = this.getEffectiveEvidenceSnapshot(evidenceSnapshot, linkRow?.evidenceSnapshot)
    const overrideLinkedBookCount = Number.isFinite(Number(coverageOverride?.linkedBookCount)) ? Number(coverageOverride.linkedBookCount) : null
    const overrideTotalBookCount = Number.isFinite(Number(coverageOverride?.totalBookCount)) ? Number(coverageOverride.totalBookCount) : null
    const linkedBookCount =
      overrideLinkedBookCount !== null
        ? overrideLinkedBookCount
        : this.getSeriesSourceLinkBookCount(snapshot) || Number(linkRow?.linkedBookCount || 0)
    const totalBookCount =
      overrideTotalBookCount !== null
        ? overrideTotalBookCount
        : Array.isArray(localBooks)
          ? this.getCoverageEligibleLocalBookCount(localBooks)
          : Number(linkRow?.totalBookCount || 0)
    const coverageStatus =
      typeof coverageOverride?.coverageStatus === 'string' && coverageOverride.coverageStatus
        ? coverageOverride.coverageStatus
        : this.getSeriesSourceLinkCoverageStatus(linkRow, localBooks, snapshot)
    const importStatus = String(linkRow?.importStatus || 'imported').trim().toLowerCase() === 'pending' ? 'pending' : 'imported'
    return {
      id: linkRow.id,
      localDecisionKey: linkRow.localDecisionKey,
      localSeriesName: linkRow.localSeriesName,
      source: linkRow.source,
      sourceSeriesName: linkRow.sourceSeriesName,
      sourceAuthor: linkRow.sourceAuthor || snapshot.sourceAuthor || '',
      sourceUrl: linkRow.sourceSeriesUrl,
      sourceLinkUrl: snapshot.sourceLinkUrl || linkRow.sourceSeriesUrl,
      sourceIdentifier: snapshot.sourceIdentifier || linkRow.sourceSeriesUrl,
      sourceAsin: snapshot.sourceAsin || '',
      sourceRegion: snapshot.sourceRegion || '',
      matchingBooks: Array.isArray(snapshot.matchingBooks) ? snapshot.matchingBooks : [],
      sampleBooks: Array.isArray(snapshot.sampleBooks) ? snapshot.sampleBooks : [],
      seriesBooks: this.getSeriesSourceLinkSeriesBooks(snapshot),
      sequenceIncomplete: !!snapshot.sequenceIncomplete,
      sequenceStatusNote: this.getSeriesSourceLinkSequenceStatusNote(snapshot, coverageStatus),
      evidenceSnapshot: snapshot,
      localBooks,
      linkedBookCount,
      totalBookCount,
      coverageStatus,
      importStatus,
      pendingImport: importStatus === 'pending',
      lastImportedAt: linkRow?.lastImportedAt || null,
      isActive: linkRow.isActive !== false,
      unlinkedAt: linkRow.unlinkedAt || null,
      unlinkedByUserId: linkRow.unlinkedByUserId || null,
      resolvedCatalogId: resolvedCatalogId || null,
      canRemove: linkRow.isActive !== false,
      createdAt: linkRow.createdAt,
      updatedAt: linkRow.updatedAt
    }
  }

  buildManualLookupResultWithSeriesSourceLinkState(result, { activeLink = null, inactiveLink = null, localBooks = [] } = {}) {
    const payload = {
      ...result,
      linkState: 'candidate',
      linkStateLabel: 'Link',
      canLink: true,
      savedLinkId: null,
      savedLinkCoverageStatus: null,
      savedLinkIsActive: false,
      savedLinkPreviouslyLinked: false
    }

    const sourceSeriesUrl = String(result?.sourceSeriesUrl || result?.sourceUrl || result?.sourceIdentifier || '').trim()
    if (!sourceSeriesUrl) return payload

    if (activeLink) {
      const activeLinkedBookCount = Number(activeLink.linkedBookCount || 0)
      const activeTotalBookCount = Number(activeLink.totalBookCount || (Array.isArray(localBooks) ? this.getCoverageEligibleLocalBookCount(localBooks) : 0) || 0)
      const coverageStatus =
        activeLinkedBookCount > 0 && activeTotalBookCount > 0 && activeLinkedBookCount >= activeTotalBookCount
          ? 'linked'
          : activeLink.coverageStatus || this.getSeriesSourceLinkCoverageStatus(activeLink, localBooks, activeLink.evidenceSnapshot || result?.evidenceSnapshot || {})
      payload.savedLinkId = activeLink.id
      payload.savedLinkCoverageStatus = coverageStatus
      payload.savedLinkIsActive = true
      payload.linkState = coverageStatus === 'linked' ? 'linked' : 'partial'
      payload.linkStateLabel = coverageStatus === 'linked' ? 'Linked' : 'Partial'
      payload.canLink = coverageStatus !== 'linked'
      payload.savedLinkPreviouslyLinked = false
      return payload
    }

    if (inactiveLink) {
      payload.savedLinkId = inactiveLink.id
      payload.savedLinkCoverageStatus = 'previously_linked'
      payload.savedLinkIsActive = false
      payload.savedLinkPreviouslyLinked = true
      payload.linkState = 'previously_linked'
      payload.linkStateLabel = 'Previously Linked'
      payload.canLink = true
    }

    return payload
  }

  async getLocalSeriesMatchesForLibrary(libraryId, options = {}) {
    const resolver = options?.resolver || (await this.getSeriesNameControlResolverForLibrary(libraryId))
    const localSeriesGroups = options?.localSeriesGroups || (await this.getLocalSeriesGroupsForLibrary(libraryId, resolver))
    const catalogs = options?.catalogs || (await Database.seriesReviewCatalogModel.findAll({ where: { libraryId } }))
    const sourceUrlMap = options?.sourceUrlMap || this.buildCatalogSourceUrlMap(catalogs)
    const matchRows = await this.getSeriesSourceLinkRowsForLibrary(libraryId, {
      activeOnly: true,
      localDecisionKey: options?.localDecisionKey || null
    })
    const results = []

    for (const matchRow of matchRows) {
      const group = localSeriesGroups.get(matchRow.localDecisionKey)
      const localBooks = group?.seriesName
        ? await this.getLocalCatalogBooks(libraryId, group.seriesName, { resolver, matchingSeries: group.seriesRows })
        : []
      const resolvedCatalogId = sourceUrlMap.get(matchRow.sourceSeriesUrl) || null
      const coverageOverride = options?.coverageBySourceUrl instanceof Map ? options.coverageBySourceUrl.get(this.normalizeExternalUrl(matchRow.sourceSeriesUrl || '')) || null : null
      if (options?.pendingOnly && String(matchRow.importStatus || 'imported').trim().toLowerCase() !== 'pending') continue
      if (!options?.includeResolved && resolvedCatalogId) continue
      results.push(this.buildSeriesSourceLinkPayload(matchRow, { localBooks, resolvedCatalogId, coverageOverride }))
    }

    return results.sort((a, b) => {
      const localDelta = String(a.localSeriesName || '').localeCompare(String(b.localSeriesName || ''))
      if (localDelta !== 0) return localDelta
      return String(a.sourceSeriesName || '').localeCompare(String(b.sourceSeriesName || ''))
    })
  }

  buildManualLinkedSeriesRowsBySourceUrl(localSeriesGroups, matchRows = []) {
    const linkedSeriesRowsBySourceUrl = new Map()

    ;(Array.isArray(matchRows) ? matchRows : []).forEach((matchRow) => {
      const sourceSeriesUrl = String(matchRow?.sourceSeriesUrl || '').trim()
      if (!sourceSeriesUrl) return
      if (matchRow?.isActive === false) return
      const group = localSeriesGroups.get(matchRow.localDecisionKey)
      if (!group?.seriesRows?.length) return
      if (!linkedSeriesRowsBySourceUrl.has(sourceSeriesUrl)) linkedSeriesRowsBySourceUrl.set(sourceSeriesUrl, [])

      const bucket = linkedSeriesRowsBySourceUrl.get(sourceSeriesUrl)
      const seen = new Set(bucket.map((seriesRow) => seriesRow.id))
      group.seriesRows.forEach((seriesRow) => {
        if (!seriesRow?.id || seen.has(seriesRow.id)) return
        seen.add(seriesRow.id)
        bucket.push(seriesRow)
      })
    })

    return linkedSeriesRowsBySourceUrl
  }

  async getManualLinkedSeriesRowsForCatalog(libraryId, catalog, options = {}) {
    const sourceSeriesUrls = this.getCatalogSourceUrls(catalog?.entries || [])
    if (!sourceSeriesUrls.length) return []

    if (options?.manualLinkedSeriesRowsBySourceUrl instanceof Map) {
      const linkedSeriesRows = []
      const seen = new Set()
      sourceSeriesUrls.forEach((sourceSeriesUrl) => {
        ;(options.manualLinkedSeriesRowsBySourceUrl.get(sourceSeriesUrl) || []).forEach((seriesRow) => {
          if (!seriesRow?.id || seen.has(seriesRow.id)) return
          seen.add(seriesRow.id)
          linkedSeriesRows.push(seriesRow)
        })
      })
      return linkedSeriesRows
    }

    const resolver = options?.resolver || (await this.getSeriesNameControlResolverForLibrary(libraryId))
    const localSeriesGroups = options?.localSeriesGroups || (await this.getLocalSeriesGroupsForLibrary(libraryId, resolver))
    const matchRows = await this.getSeriesSourceLinkRowsForLibrary(libraryId, { sourceSeriesUrls, activeOnly: true })
    const linkedSeriesRows = []
    const seen = new Set()

    matchRows.forEach((matchRow) => {
      const group = localSeriesGroups.get(matchRow.localDecisionKey)
      if (!group?.seriesRows?.length) return
      group.seriesRows.forEach((seriesRow) => {
        if (seen.has(seriesRow.id)) return
        seen.add(seriesRow.id)
        linkedSeriesRows.push(seriesRow)
      })
    })

    return linkedSeriesRows
  }

  async buildManualLookupContextForCatalog(libraryId, catalogId) {
    const resolver = await this.getSeriesNameControlResolverForLibrary(libraryId)
    const localSeriesGroups = await this.getLocalSeriesGroupsForLibrary(libraryId, resolver)
    const localOnlyDecisionKey = this.parseLocalOnlyCatalogId(catalogId)
    let group = localOnlyDecisionKey ? localSeriesGroups.get(localOnlyDecisionKey) : null
    let seriesName = group?.seriesName || ''

    if (!group) {
      const catalog = await Database.seriesReviewCatalogModel.findOne({
        where: {
          id: catalogId,
          libraryId
        }
      })
      if (!catalog || catalog.visibilityStatus === 'dismissed') return null
      seriesName = this.normalizeSeriesName(catalog.seriesName || '')
      if (!seriesName) return null
      const catalogDecisionKey = resolver.getDecisionKey(seriesName)
      group = localSeriesGroups.get(catalogDecisionKey) || null
    }

    if (!group?.seriesName) return null

    const localBooks = await this.getLocalCatalogBooks(libraryId, group.seriesName, {
      resolver,
      matchingSeries: group.seriesRows
    })
    if (!localBooks.length) return null
    return {
      localSeriesName: seriesName || group.seriesName,
      localDecisionKey: localOnlyDecisionKey || resolver.getDecisionKey(seriesName || group.seriesName),
      localBooks: localBooks.map((book) => ({
        libraryItemId: book.libraryItemId,
        title: book.title,
        relPath: book.relPath,
        authors: (book.authors || []).map((author) => ({ name: author.name || author })),
        currentSeries: [{ name: book.seriesName, sequence: book.sequence || '' }]
      }))
    }
  }

  async saveLocalSeriesMatchForLibrary(libraryId, catalogId, payload) {
    const context = await this.buildManualLookupContextForCatalog(libraryId, catalogId)
    if (!context) return null

    return this.saveLocalSeriesMatchForSeriesName(libraryId, context.localSeriesName, context.localDecisionKey, payload, catalogId)
  }

  async saveLocalSeriesMatchForSeriesName(libraryId, localSeriesName, localDecisionKey, payload, catalogId = null) {
    const seriesName = this.normalizeSeriesName(localSeriesName || '')
    const decisionKey = this.normalizeDecisionKey(localDecisionKey || localSeriesName || '')
    if (!seriesName || !decisionKey) {
      throw new Error('Series name is required')
    }

    const source = String(payload?.source || 'fictiondb').trim().toLowerCase()
    if (!['fictiondb', 'audible', 'wikidata'].includes(source)) throw new Error('Unsupported manual lookup source')
    const sourceSeriesName = this.normalizeSeriesName(payload?.sourceSeriesName || payload?.evidenceSnapshot?.sourceSeriesName || '')
    const sourceSeriesUrl = String(payload?.sourceSeriesUrl || payload?.sourceUrl || payload?.evidenceSnapshot?.sourceSeriesUrl || payload?.evidenceSnapshot?.sourceUrl || '').trim()
    if (!sourceSeriesName || !sourceSeriesUrl) {
      throw new Error('Missing source series name or URL')
    }

    const sourceAuthor = this.normalizeSeriesName(payload?.sourceAuthor || payload?.evidenceSnapshot?.sourceAuthor || '')
    const evidenceSnapshot = this.normalizeEvidenceSnapshot(payload?.evidenceSnapshot)
    const context = catalogId ? await this.buildManualLookupContextForCatalog(libraryId, catalogId) : null
    const localBooks = Array.isArray(context?.localBooks) ? context.localBooks : []
    const linkedBookCount = this.getSeriesSourceLinkBookCount(evidenceSnapshot)
    const totalBookCount = this.getCoverageEligibleLocalBookCount(localBooks)
    const coverageStatus = totalBookCount > 0 && linkedBookCount >= totalBookCount ? 'linked' : 'partial'
    const existing = await Database.seriesReviewSeriesSourceLinkModel.findOne({
      where: {
        libraryId,
        localDecisionKey: decisionKey,
        sourceSeriesUrl
      }
    })

    if (existing) {
      existing.localSeriesName = seriesName
      existing.source = source
      existing.sourceSeriesName = sourceSeriesName
      existing.sourceAuthor = sourceAuthor || null
      existing.sourceSeriesUrl = sourceSeriesUrl
      existing.coverageStatus = coverageStatus
      existing.linkedBookCount = linkedBookCount
      existing.totalBookCount = totalBookCount
      existing.importStatus = 'pending'
      existing.lastImportedAt = null
      existing.evidenceSnapshot = evidenceSnapshot
      existing.isActive = true
      existing.unlinkedAt = null
      existing.unlinkedByUserId = null
      await existing.save()
    } else {
      await Database.seriesReviewSeriesSourceLinkModel.create({
        libraryId,
        localDecisionKey: decisionKey,
        localSeriesName: seriesName,
        source,
        sourceSeriesName,
        sourceAuthor: sourceAuthor || null,
        sourceSeriesUrl,
        coverageStatus,
        linkedBookCount,
        totalBookCount,
        importStatus: 'pending',
        lastImportedAt: null,
        evidenceSnapshot
      })
    }

    if (catalogId) {
      return this.getCatalogDetailForLibrary(libraryId, catalogId, {
        skipResolvedLookup: true
      })
    }

    return this.getCatalogDetailForLibrary(libraryId, this.buildLocalOnlyCatalogId(decisionKey), {
      skipResolvedLookup: true
    })
  }

  async removeLocalSeriesMatchForLibrary(libraryId, catalogId, matchId, userId = null) {
    const context = await this.buildManualLookupContextForCatalog(libraryId, catalogId)
    if (!context) throw new Error('Manual source lookup is not available for that series')
    const matchRow = await Database.seriesReviewSeriesSourceLinkModel.findOne({
      where: {
        id: matchId,
        libraryId,
        localDecisionKey: context.localDecisionKey
      }
    })
    if (!matchRow) throw new Error('Saved local source link was not found')
    await this.cleanupImportedArtifactsForSeriesSourceLink(libraryId, matchRow, userId)
    await this.cleanupCatalogEvidenceForSeriesSourceLink(libraryId, matchRow)
    matchRow.isActive = false
    matchRow.importStatus = 'imported'
    matchRow.unlinkedAt = new Date()
    matchRow.unlinkedByUserId = userId || null
    await matchRow.save()
    return this.getCatalogDetailForLibrary(libraryId, catalogId)
  }

  async buildLocalSeriesMatchImportPayloadForLibrary(libraryId, selections, options = {}) {
    const resolver = await this.getSeriesNameControlResolverForLibrary(libraryId)
    const localSeriesGroups = await this.getLocalSeriesGroupsForLibrary(libraryId, resolver)
    const forceRefresh = !!options?.forceRefresh
    const requestedSelections = Array.isArray(selections) ? selections : []
    const matches = []

    for (const selection of requestedSelections) {
      const matchId = String(selection?.matchId || '').trim()
      if (!matchId) continue
      const matchRow = await Database.seriesReviewSeriesSourceLinkModel.findOne({
        where: {
          id: matchId,
          libraryId
        }
      })
      if (!matchRow || matchRow.isActive === false) {
        throw new Error('Saved local source link was not found')
      }
      if (!forceRefresh && String(matchRow.importStatus || 'imported').trim().toLowerCase() !== 'pending') continue

      const group = localSeriesGroups.get(matchRow.localDecisionKey)
      if (!group?.seriesName) continue
      const localBooks = await this.getLocalCatalogBooks(libraryId, group.seriesName, {
        resolver,
        matchingSeries: group.seriesRows
      })
      const includedIds = Array.isArray(selection?.includedLibraryItemIds) && selection.includedLibraryItemIds.length
        ? new Set(selection.includedLibraryItemIds.map((id) => String(id || '').trim()).filter(Boolean))
        : null
      const books = localBooks
        .filter((book) => !includedIds || includedIds.has(book.libraryItemId))
        .map((book) => ({
          libraryItemId: book.libraryItemId,
          title: book.title,
          relPath: book.relPath,
          authors: (book.authors || []).map((author) => ({ name: author.name || author })),
          currentSeries: [{ name: book.seriesName, sequence: book.sequence || '' }]
        }))
      if (!books.length) continue

      matches.push({
        matchId: matchRow.id,
        localSeriesName: matchRow.localSeriesName,
        localDecisionKey: matchRow.localDecisionKey,
        source: matchRow.source,
        sourceSeriesName: matchRow.sourceSeriesName,
        sourceAuthor: matchRow.sourceAuthor || '',
        sourceSeriesUrl: matchRow.sourceSeriesUrl,
        evidenceSnapshot: matchRow.evidenceSnapshot || {},
        books
      })
    }

    return matches
  }

  async markSeriesSourceLinksImported(libraryId, options = {}) {
    await this.ensureSeriesReviewSeriesSourceLinkSchemaInner()
    const where = { libraryId }
    let hasSelector = false

    if (Array.isArray(options?.matchIds) && options.matchIds.length) {
      where.id = {
        [Op.in]: [...new Set(options.matchIds.map((value) => String(value || '').trim()).filter(Boolean))]
      }
      hasSelector = where.id[Op.in].length > 0
    }
    if (options?.localDecisionKey) {
      where.localDecisionKey = String(options.localDecisionKey || '').trim()
      hasSelector = true
    }
    if (options?.sourceSeriesUrl) {
      where.sourceSeriesUrl = String(options.sourceSeriesUrl || '').trim()
      hasSelector = true
    }
    if (!hasSelector) return 0

    const rows = await Database.seriesReviewSeriesSourceLinkModel.findAll({ where })
    if (!rows.length) return 0

    const importedAt = new Date()
    const resolver = await this.getSeriesNameControlResolverForLibrary(libraryId)
    const localSeriesGroups = await this.getLocalSeriesGroupsForLibrary(libraryId, resolver)
    const allCatalogs = await Database.seriesReviewCatalogModel.findAll({ where: { libraryId } })
    const sourceUrlMap = this.buildCatalogSourceUrlMap(allCatalogs)
    const localBooksCache = new Map()
    const expandedSeriesCache = new Map()
    const coverageByCatalogId = new Map()
    for (const row of rows) {
      const group = localSeriesGroups.get(row.localDecisionKey)
      const localBooks = group?.seriesName
        ? await this.getLocalCatalogBooks(libraryId, group.seriesName, {
            resolver,
            matchingSeries: group.seriesRows,
            localBooksCache,
            expandedSeriesCache
          })
        : []
      const catalogId = sourceUrlMap.get(row.sourceSeriesUrl) || null
      const coverageOverride = catalogId
        ? (() => {
            if (!coverageByCatalogId.has(catalogId)) {
              coverageByCatalogId.set(
                catalogId,
                this.getCatalogDetailForLibrary(libraryId, catalogId, {
                  resolver,
                  localSeriesGroups,
                  catalogs: allCatalogs,
                  localBooksCache,
                  expandedSeriesCache,
                  skipLocalSeriesMatches: true
                }).then((detail) => this.buildCatalogSourceCoverageBySourceUrl(detail?.rows || detail?.slots || [], detail?.localBooks || localBooks))
              )
            }
            return coverageByCatalogId.get(catalogId)
          })()
        : null

      const resolvedCoverage = coverageOverride ? await coverageOverride : null
      const nextCoverage = resolvedCoverage?.get(this.normalizeExternalUrl(row.sourceSeriesUrl || '')) || null
      if (nextCoverage) {
        row.linkedBookCount = nextCoverage.linkedBookCount
        row.totalBookCount = nextCoverage.totalBookCount
        row.coverageStatus = nextCoverage.coverageStatus
      } else {
        const snapshot = this.getEffectiveEvidenceSnapshot(row.evidenceSnapshot)
        const linkedBookCount = this.getSeriesSourceLinkBookCount(snapshot)
        const totalBookCount = Array.isArray(localBooks) ? this.getCoverageEligibleLocalBookCount(localBooks) : Number(row.totalBookCount || 0)
        row.linkedBookCount = linkedBookCount
        row.totalBookCount = totalBookCount
        row.coverageStatus = totalBookCount > 0 && linkedBookCount >= totalBookCount ? 'linked' : 'partial'
      }
      row.importStatus = 'imported'
      row.lastImportedAt = importedAt
      await row.save()
    }
    return rows.length
  }

  getSeriesSourceLinkSnapshotRichness(snapshot) {
    const normalized = this.normalizeEvidenceSnapshot(snapshot)
    return (
      this.getSeriesSourceLinkSeriesBooks(normalized).length * 10 +
      this.getSeriesSourceLinkBookCount(normalized) * 5 +
      (Array.isArray(normalized?.sampleBooks) ? normalized.sampleBooks.length : 0) * 2 +
      Object.keys(normalized).length
    )
  }

  choosePreferredSeriesSourceLinkSnapshot(primarySnapshot, secondarySnapshot) {
    const primary = this.normalizeEvidenceSnapshot(primarySnapshot)
    const secondary = this.normalizeEvidenceSnapshot(secondarySnapshot)
    return this.getSeriesSourceLinkSnapshotRichness(primary) >= this.getSeriesSourceLinkSnapshotRichness(secondary) ? primary : secondary
  }

  choosePreferredSeriesSourceLinkCoverageStatus(statuses = []) {
    const normalizedStatuses = (Array.isArray(statuses) ? statuses : []).map((status) => String(status || '').trim().toLowerCase())
    if (normalizedStatuses.includes('linked')) return 'linked'
    if (normalizedStatuses.includes('partial')) return 'partial'
    if (normalizedStatuses.includes('previously_linked')) return 'previously_linked'
    return 'partial'
  }

  async mergeSeriesSourceLinkRows(targetRow, sourceRow, targetSeriesName, targetDecisionKey) {
    const nextIsActive = targetRow.isActive !== false || sourceRow.isActive !== false
    const nextLastImportedAt = [targetRow.lastImportedAt, sourceRow.lastImportedAt]
      .filter(Boolean)
      .sort((left, right) => new Date(right).getTime() - new Date(left).getTime())[0] || null
    const nextSnapshot = this.choosePreferredSeriesSourceLinkSnapshot(targetRow.evidenceSnapshot, sourceRow.evidenceSnapshot)

    targetRow.localSeriesName = targetSeriesName
    targetRow.localDecisionKey = targetDecisionKey
    targetRow.coverageStatus = this.choosePreferredSeriesSourceLinkCoverageStatus([targetRow.coverageStatus, sourceRow.coverageStatus])
    targetRow.linkedBookCount = Math.max(Number(targetRow.linkedBookCount || 0), Number(sourceRow.linkedBookCount || 0))
    targetRow.totalBookCount = Math.max(Number(targetRow.totalBookCount || 0), Number(sourceRow.totalBookCount || 0))
    targetRow.importStatus = [targetRow.importStatus, sourceRow.importStatus].some((status) => String(status || '').trim().toLowerCase() === 'pending')
      ? 'pending'
      : 'imported'
    targetRow.lastImportedAt = nextLastImportedAt
    targetRow.evidenceSnapshot = nextSnapshot
    targetRow.isActive = nextIsActive
    targetRow.unlinkedAt = nextIsActive ? null : targetRow.unlinkedAt || sourceRow.unlinkedAt || null
    targetRow.unlinkedByUserId = nextIsActive ? null : targetRow.unlinkedByUserId || sourceRow.unlinkedByUserId || null
    if (!targetRow.sourceAuthor && sourceRow.sourceAuthor) targetRow.sourceAuthor = sourceRow.sourceAuthor
    await targetRow.save()
    await sourceRow.destroy()
  }

  async renameSeriesSourceLinksForLibrary(libraryId, sourceName, targetName) {
    const normalizedSourceName = this.normalizeSeriesName(sourceName)
    const normalizedTargetName = this.normalizeSeriesName(targetName)
    const sourceDecisionKey = this.normalizeDecisionKey(normalizedSourceName)
    const targetDecisionKey = this.normalizeDecisionKey(normalizedTargetName)
    if (!sourceDecisionKey || !targetDecisionKey) {
      return {
        updatedCount: 0,
        mergedCount: 0
      }
    }

    const rows = await Database.seriesReviewSeriesSourceLinkModel.findAll({
      where: {
        libraryId,
        localDecisionKey: {
          [Op.in]: [...new Set([sourceDecisionKey, targetDecisionKey])]
        }
      },
      order: [['updatedAt', 'DESC']]
    })
    if (!rows.length) {
      return {
        updatedCount: 0,
        mergedCount: 0
      }
    }

    let updatedCount = 0
    let mergedCount = 0
    const targetRowsBySourceUrl = new Map()

    rows
      .filter((row) => row.localDecisionKey === targetDecisionKey)
      .forEach((row) => {
        row.localSeriesName = normalizedTargetName
        targetRowsBySourceUrl.set(row.sourceSeriesUrl, row)
      })

    if (sourceDecisionKey === targetDecisionKey) {
      for (const row of rows) {
        if (row.localSeriesName === normalizedTargetName) continue
        row.localSeriesName = normalizedTargetName
        await row.save()
        updatedCount += 1
      }
      return { updatedCount, mergedCount }
    }

    for (const row of rows.filter((candidate) => candidate.localDecisionKey === sourceDecisionKey)) {
      const existingTargetRow = targetRowsBySourceUrl.get(row.sourceSeriesUrl)
      if (existingTargetRow && existingTargetRow.id !== row.id) {
        await this.mergeSeriesSourceLinkRows(existingTargetRow, row, normalizedTargetName, targetDecisionKey)
        mergedCount += 1
        continue
      }

      row.localDecisionKey = targetDecisionKey
      row.localSeriesName = normalizedTargetName
      await row.save()
      updatedCount += 1
      targetRowsBySourceUrl.set(row.sourceSeriesUrl, row)
    }

    return {
      updatedCount,
      mergedCount
    }
  }

  doesContributionMatchSeriesSourceUrl(contribution, sourceSeriesUrl) {
    const normalizedSourceSeriesUrl = String(sourceSeriesUrl || '').trim()
    if (!normalizedSourceSeriesUrl) return false
    const evidenceUrl = String(contribution?.evidenceUrl || '').trim()
    if (evidenceUrl === normalizedSourceSeriesUrl) return true
    const importedUrl = String(contribution?.rawEvidence?.localSeriesImport?.sourceSeriesUrl || '').trim()
    return importedUrl === normalizedSourceSeriesUrl
  }

  async unlinkSuggestionSeriesFromLibraryItem(libraryItem, suggestion, resolver = null) {
    if (!libraryItem || !libraryItem.isBook || !suggestion) return null
    const effectiveResolver = resolver || (await this.getSeriesNameControlResolverForLibrary(libraryItem.libraryId))
    const currentSeries = Array.isArray(libraryItem.media.series) ? libraryItem.media.series : []
    const matchingSeriesIds = currentSeries
      .filter((series) => effectiveResolver.getDecisionKey(series.name) === effectiveResolver.getDecisionKey(suggestion.suggestedName))
      .filter((series) => this.sequencesCompatible(series.bookSeries?.sequence || null, suggestion.suggestedSequence))
      .map((series) => series.id)

    if (!matchingSeriesIds.length) return null

    const nextSeries = currentSeries
      .filter((series) => !matchingSeriesIds.includes(series.id))
      .map((series) => ({
        name: series.name,
        sequence: series.bookSeries?.sequence || null
      }))

    const seriesUpdateData = await libraryItem.media.updateSeriesFromRequest(nextSeries, libraryItem.libraryId)
    await this.persistLibraryItemSeriesChange(libraryItem, seriesUpdateData, { addSeriesEditTag: true })
    return Database.libraryItemModel.getExpandedById(libraryItem.id)
  }

  async rebuildSuggestionsForLibraryItems(libraryId, libraryItemIds = [], resolver = null) {
    const ids = [...new Set((Array.isArray(libraryItemIds) ? libraryItemIds : []).map((value) => String(value || '').trim()).filter(Boolean))]
    if (!ids.length) return

    const activeSuggestions = await Database.seriesReviewSuggestionModel.findAll({
      where: {
        libraryId,
        libraryItemId: {
          [Op.in]: ids
        },
        isActive: true
      }
    })

    const rowsByLibraryItem = new Map()
    activeSuggestions.forEach((suggestion) => {
      if (!rowsByLibraryItem.has(suggestion.libraryItemId)) {
        rowsByLibraryItem.set(suggestion.libraryItemId, [])
      }
      rowsByLibraryItem.get(suggestion.libraryItemId).push(...(Array.isArray(suggestion.contributions) ? suggestion.contributions : []))
    })

    const rows = [...rowsByLibraryItem.entries()].map(([libraryItemId, sourceSuggestions]) => ({
      libraryItemId,
      sourceSuggestions
    }))
    if (!rows.length) return

    await this.importSuggestionsForLibrary(libraryId, rows, {
      resolver: resolver || (await this.getSeriesNameControlResolverForLibrary(libraryId))
    })
  }

  async cleanupImportedArtifactsForSeriesSourceLink(libraryId, matchRow, userId = null) {
    const sourceSeriesUrl = String(matchRow?.sourceSeriesUrl || '').trim()
    if (!sourceSeriesUrl) return

    const suggestions = await Database.seriesReviewSuggestionModel.findAll({
      where: {
        libraryId,
        isActive: true
      }
    })
    if (!suggestions.length) return

    const resolver = await this.getSeriesNameControlResolverForLibrary(libraryId)
    const affectedLibraryItemIds = new Set()
    const libraryItemsById = new Map()

    for (const suggestion of suggestions) {
      const contributions = Array.isArray(suggestion.contributions) ? suggestion.contributions : []
      const removedContributions = contributions.filter((contribution) => this.doesContributionMatchSeriesSourceUrl(contribution, sourceSeriesUrl))
      if (!removedContributions.length) continue

      affectedLibraryItemIds.add(suggestion.libraryItemId)
      const remainingContributions = contributions.filter((contribution) => !this.doesContributionMatchSeriesSourceUrl(contribution, sourceSeriesUrl))
      const removedSeriesSupport = removedContributions.some((contribution) => !contribution?.noSeries)
      const remainingSeriesSupport = remainingContributions.some((contribution) => !contribution?.noSeries)

      if (suggestion.kind === 'series' && removedSeriesSupport && !remainingSeriesSupport && ['linked', 'applied', 'manual_override'].includes(suggestion.state)) {
        let libraryItem = libraryItemsById.get(suggestion.libraryItemId)
        if (!libraryItem) {
          libraryItem = await Database.libraryItemModel.getExpandedById(suggestion.libraryItemId)
          if (libraryItem) libraryItemsById.set(suggestion.libraryItemId, libraryItem)
        }
        if (libraryItem?.isBook) {
          const updatedLibraryItem = await this.unlinkSuggestionSeriesFromLibraryItem(libraryItem, suggestion, resolver)
          if (updatedLibraryItem) libraryItemsById.set(suggestion.libraryItemId, updatedLibraryItem)
        }
      }

      suggestion.contributions = remainingContributions
      suggestion.decisionAction = null
      suggestion.decisionSeriesId = null
      suggestion.decidedAt = null
      suggestion.decidedByUserId = userId || null
      suggestion.state = 'pending'
      if (!remainingContributions.length) {
        suggestion.isActive = false
      }
      await suggestion.save()
    }

    if (affectedLibraryItemIds.size) {
      await this.rebuildSuggestionsForLibraryItems(libraryId, [...affectedLibraryItemIds], resolver)
    }
  }

  async cleanupCatalogEvidenceForSeriesSourceLink(libraryId, matchRow) {
    const sourceSeriesUrl = String(matchRow?.sourceSeriesUrl || '').trim()
    if (!sourceSeriesUrl) return { catalogsChanged: 0, sourcesRemoved: 0 }

    const preferredSource = String(matchRow?.source || '').trim().toLowerCase()
    const catalogs = await Database.seriesReviewCatalogModel.findAll({
      where: {
        libraryId
      }
    })

    let catalogsChanged = 0
    let sourcesRemoved = 0

    for (const catalog of catalogs) {
      const result = this.stripCatalogSourceEvidence(catalog.entries, sourceSeriesUrl, { source: preferredSource })
      if (!result.changed) continue

      catalog.entries = result.entries
      await catalog.save()
      catalogsChanged += 1
      sourcesRemoved += result.removedCount
    }

    return {
      catalogsChanged,
      sourcesRemoved
    }
  }

  async pruneUnsupportedLocalSeriesBooksForCatalog(libraryId, catalogId, options = {}) {
    const detail = options?.detail || (await this.getCatalogDetailForLibrary(libraryId, catalogId))
    if (!detail?.catalog?.seriesName) {
      return {
        removedCount: 0,
        detail: detail || null
      }
    }

    const supportedLibraryItemIds = new Set(
      (detail.rows || [])
        .filter((row) => Array.isArray(row?.sourceSupport) && row.sourceSupport.length)
        .flatMap((row) => (Array.isArray(row?.localBooks) ? row.localBooks : []).map((book) => String(book?.libraryItemId || '').trim()).filter(Boolean))
    )
    const unsupportedLocalBooks = (detail.localBooks || []).filter((book) => {
      const libraryItemId = String(book?.libraryItemId || '').trim()
      return !!libraryItemId && !supportedLibraryItemIds.has(libraryItemId)
    })

    if (!unsupportedLocalBooks.length) {
      return {
        removedCount: 0,
        detail
      }
    }

    const resolver = options?.resolver || (await this.getSeriesNameControlResolverForLibrary(libraryId))
    const localSeriesGroups = options?.localSeriesGroups || (await this.getLocalSeriesGroupsForLibrary(libraryId, resolver))
    const localDecisionKey = resolver.getDecisionKey(detail.catalog.seriesName)
    const matchingSeriesRows = localSeriesGroups.get(localDecisionKey)?.seriesRows || []
    const removableSeriesIds = new Set(matchingSeriesRows.map((seriesRow) => String(seriesRow?.id || '').trim()).filter(Boolean))

    if (!removableSeriesIds.size) {
      return {
        removedCount: 0,
        detail
      }
    }

    let removedCount = 0
    for (const book of unsupportedLocalBooks) {
      const libraryItemId = String(book?.libraryItemId || '').trim()
      if (!libraryItemId) continue
      const libraryItem = await Database.libraryItemModel.getExpandedById(libraryItemId)
      if (!libraryItem?.isBook) continue

      const currentSeries = Array.isArray(libraryItem.media?.series) ? libraryItem.media.series : []
      const seriesEntriesToRemove = currentSeries.filter((seriesEntry) => removableSeriesIds.has(String(seriesEntry?.id || '').trim()))
      if (!seriesEntriesToRemove.length) continue

      const nextSeries = currentSeries
        .filter((seriesEntry) => !removableSeriesIds.has(String(seriesEntry?.id || '').trim()))
        .map((seriesEntry) => ({
          name: seriesEntry.name,
          sequence: seriesEntry.bookSeries?.sequence || null
        }))

      const seriesUpdateData = await libraryItem.media.updateSeriesFromRequest(nextSeries, libraryId)
      await this.persistLibraryItemSeriesChange(libraryItem, seriesUpdateData, { addSeriesEditTag: true })
      removedCount += seriesEntriesToRemove.length
    }

    if (!removedCount) {
      return {
        removedCount: 0,
        detail
      }
    }

    return {
      removedCount,
      detail: await this.getCatalogDetailForLibrary(libraryId, catalogId)
    }
  }

  async refreshLocalSeriesMatchesForLibrary(libraryId, matchIds = [], options = {}) {
    const allowedIds = Array.isArray(matchIds) && matchIds.length ? new Set(matchIds.map((value) => String(value || '').trim()).filter(Boolean)) : null
    const matchRows = await this.getSeriesSourceLinkRowsForLibrary(libraryId, { activeOnly: true })
    const selections = matchRows
      .filter((matchRow) => !allowedIds || allowedIds.has(matchRow.id))
      .map((matchRow) => ({
        matchId: matchRow.id,
        includedLibraryItemIds: []
      }))

    if (!selections.length) {
      return []
    }

    return this.buildLocalSeriesMatchImportPayloadForLibrary(libraryId, selections, {
      ...options,
      forceRefresh: true
    })
  }

  async renameCatalogForLibrary(libraryId, catalogId, targetLabel, userId) {
    const normalizedTargetLabel = this.normalizeSeriesName(targetLabel)
    if (!normalizedTargetLabel) {
      throw new Error('Missing targetLabel')
    }

    const currentDetail = await this.getCatalogDetailForLibrary(libraryId, catalogId)
    if (!currentDetail?.catalog?.seriesName) return null

    const currentSeriesName = this.normalizeSeriesName(currentDetail.catalog.seriesName)
    const result = await this.applySeriesNameControlForLibrary(libraryId, userId, currentSeriesName, normalizedTargetLabel, 'alias', {
      applyLocalRename: true
    })

    const nextCatalogId = this.parseLocalOnlyCatalogId(catalogId)
      ? this.buildLocalOnlyCatalogId(this.normalizeDecisionKey(result.canonicalName || normalizedTargetLabel))
      : catalogId

    const detail =
      (await this.getCatalogDetailForLibrary(libraryId, nextCatalogId)) ||
      (await this.getCatalogDetailForLibrary(libraryId, catalogId))

    return {
      detail,
      canonicalName: result.canonicalName,
      renameResult: result.renameResult,
      sourceLinkRenameResult: result.sourceLinkRenameResult || { updatedCount: 0, mergedCount: 0 }
    }
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
    const localSeriesGroups = await this.getLocalSeriesGroupsForLibrary(libraryId, resolver)
    const preloadedSeriesBooksBySeriesId = await this.getSeriesBooksBySeriesIds(
      libraryId,
      [...localSeriesGroups.values()].flatMap((group) => (group.seriesRows || []).map((series) => series.id))
    )
    const sourceUrlMap = this.buildCatalogSourceUrlMap(allCatalogs)
    const localMatchRows = await this.getSeriesSourceLinkRowsForLibrary(libraryId, { activeOnly: true })
    const localMatchSummaryByCatalogId = new Map()
    const localMatchSummaryByDecisionKey = new Map()
    for (const matchRow of localMatchRows) {
      const importStatus = String(matchRow.importStatus || 'imported').trim().toLowerCase()
      const coverageStatus = String(matchRow.coverageStatus || '').trim().toLowerCase()
      const catalogId = sourceUrlMap.get(matchRow.sourceSeriesUrl) || null
      const summaryTarget = catalogId
        ? localMatchSummaryByCatalogId
        : localMatchSummaryByDecisionKey
      const summaryKey = catalogId || matchRow.localDecisionKey
      if (!summaryKey) continue
      const summary = summaryTarget.get(summaryKey) || { hasPendingLink: false, hasPartialLink: false }
      if (importStatus === 'pending') summary.hasPendingLink = true
      if (coverageStatus === 'partial') summary.hasPartialLink = true
      summaryTarget.set(summaryKey, summary)
    }
    const resolvedLocalDecisionKeys = new Set(localMatchRows.filter((matchRow) => sourceUrlMap.has(matchRow.sourceSeriesUrl)).map((matchRow) => matchRow.localDecisionKey))
    const manualLinkedSeriesRowsBySourceUrl = this.buildManualLinkedSeriesRowsBySourceUrl(localSeriesGroups, localMatchRows)

    const collectLocalBooksForSeriesRows = (seriesRows = []) => {
      const localBooks = []
      const seen = new Set()
      ;(Array.isArray(seriesRows) ? seriesRows : []).forEach((series) => {
        ;(preloadedSeriesBooksBySeriesId.get(series.id) || []).forEach((book) => {
          if (!book?.libraryItemId || seen.has(book.libraryItemId)) return
          seen.add(book.libraryItemId)
          localBooks.push({
            libraryItemId: book.libraryItemId,
            title: book.title || '',
            relPath: book.relPath || '',
            authors: Array.isArray(book.authors) ? book.authors : [],
            sequence: this.normalizeSequence(book.sequence || null),
            seriesName: series.name
          })
        })
      })

      return localBooks.sort((a, b) => {
        const aSeq = a.sequence || 'zzzz'
        const bSeq = b.sequence || 'zzzz'
        if (aSeq !== bSeq) return aSeq.localeCompare(bSeq, undefined, { numeric: true })
        return a.title.localeCompare(b.title)
      })
    }

    const detailSummaries = []
    const catalogDecisionKeys = new Set(
      allCatalogs
        .map((catalog) => resolver.getDecisionKey(catalog.seriesName))
        .filter(Boolean)
    )
    for (const catalog of catalogs) {
      const catalogEntryUrls = this.getCatalogSourceUrls(catalog.entries || [])
      const isLocallyLinked = catalogEntryUrls.some((sourceUrl) => manualLinkedSeriesRowsBySourceUrl.has(sourceUrl))
      const matchingSeriesRows = localSeriesGroups.get(resolver.getDecisionKey(catalog.seriesName))?.seriesRows || []
      const localBooks = collectLocalBooksForSeriesRows(matchingSeriesRows)
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
      const summaryEntries = this.normalizeCatalogEntries(catalog.entries)
      summaryEntries.forEach((entry) => {
        const coveredSlots = entry.coveredSlots.length ? entry.coveredSlots : []
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
      const summaryCounts = this.buildCatalogSummaryCounts(slotMap, catalog.selectionBySlot || {}, localBooks, summaryEntries, {
        seriesName: catalog.seriesName
      })
      const displayBucket = this.getCatalogDisplayBucket({
        trustStatus: catalog.trustStatus,
        visibilityStatus: catalog.visibilityStatus,
        localBookCount: localBooks.length,
        isLocallyLinked
      })
      if (!includeDismissed && displayBucket === 'dismissed') continue
      if (!includeUntrusted && displayBucket !== 'trusted' && displayBucket !== 'local_only' && displayBucket !== 'locally_linked' && displayBucket !== 'dismissed') continue
      const authorMeta = this.buildCatalogAuthorMeta(catalog.seriesName, [], summaryEntries)
      detailSummaries.push({
        ...this.buildCatalogViewPayload({
          id: catalog.id,
          seriesName: catalog.seriesName,
          trustStatus: catalog.trustStatus,
          visibilityStatus: catalog.visibilityStatus,
          dismissedAt: catalog.dismissedAt || null,
          entries: catalog.entries || [],
          localBooks,
          displayBucket,
          isLocallyLinked,
          canDismiss: true
        }),
        ...(localMatchSummaryByCatalogId.get(catalog.id) || { hasPendingLink: false, hasPartialLink: false }),
        authorLine: authorMeta.authorLine,
        authorSearchText: authorMeta.authorSearchText,
        missingCount: summaryCounts.missingCount,
        disputedCount: summaryCounts.disputedCount,
        localBookCount: localBooks.length,
        unsequencedCount: summaryCounts.unsequencedCount
      })
    }

    for (const group of localSeriesGroups.values()) {
      if (resolvedLocalDecisionKeys.has(group.decisionKey)) continue
      if (!group?.seriesName || catalogDecisionKeys.has(group.decisionKey)) continue
      const localBooks = collectLocalBooksForSeriesRows(group.seriesRows)
      if (!localBooks.length) continue
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
      const summaryCounts = this.buildCatalogSummaryCounts(slotMap, {}, localBooks, [], {
        seriesName: group.seriesName
      })
      detailSummaries.push({
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
        ...(localMatchSummaryByDecisionKey.get(group.decisionKey) || { hasPendingLink: false, hasPartialLink: false }),
        missingCount: summaryCounts.missingCount,
        disputedCount: summaryCounts.disputedCount,
        localBookCount: localBooks.length,
        unsequencedCount: summaryCounts.unsequencedCount
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
    const cacheKey = matchingSeries.length
      ? matchingSeries
          .map((series) => String(series?.id || ''))
          .filter(Boolean)
          .sort()
          .join('|')
      : ''
    const localBooksCache = options?.localBooksCache instanceof Map ? options.localBooksCache : null
    if (cacheKey && localBooksCache?.has(cacheKey)) {
      return localBooksCache.get(cacheKey)
    }

    const expandedSeriesCache = options?.expandedSeriesCache instanceof Map ? options.expandedSeriesCache : null
    const preloadedSeriesBooksBySeriesId =
      options?.preloadedSeriesBooksBySeriesId instanceof Map ? options.preloadedSeriesBooksBySeriesId : null
    const localBooks = []
    const seen = new Set()

    for (const series of matchingSeries) {
      const preloadedBooks = preloadedSeriesBooksBySeriesId?.get(series.id) || null
      if (preloadedBooks) {
        for (const book of preloadedBooks) {
          if (!book?.libraryItemId || seen.has(book.libraryItemId)) continue
          seen.add(book.libraryItemId)
          localBooks.push({
            libraryItemId: book.libraryItemId,
            title: book.title || '',
            relPath: book.relPath || '',
            authors: Array.isArray(book.authors) ? book.authors : [],
            sequence: this.normalizeSequence(book.sequence || null),
            seriesName: series.name
          })
        }
        continue
      }

      let expandedSeries = expandedSeriesCache?.get(series.id)
      if (!expandedSeries) {
        expandedSeries = await Database.seriesModel.getExpandedById(series.id)
        if (expandedSeriesCache) expandedSeriesCache.set(series.id, expandedSeries)
      }
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

    const sortedLocalBooks = localBooks.sort((a, b) => {
      const aSeq = a.sequence || 'zzzz'
      const bSeq = b.sequence || 'zzzz'
      if (aSeq !== bSeq) return aSeq.localeCompare(bSeq, undefined, { numeric: true })
      return a.title.localeCompare(b.title)
    })
    if (cacheKey && localBooksCache) localBooksCache.set(cacheKey, sortedLocalBooks)
    return sortedLocalBooks
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
    const titleKeysFor = (value) => this.getCatalogEntryTitleKeys(value, options?.seriesName || '')
    const unsequencedEntrySourceSupportByTitleKey = new Map()
    const omnibusLocalBooksByTitleKey = new Map()
    const buildLocalBookPayload = (book) => ({
      libraryItemId: book.libraryItemId,
      title: book.title,
      relPath: book.relPath,
      sequence: book.sequence,
      authors: Array.isArray(book?.authors) ? book.authors : []
    })
    const pushLocalBookByTitleKey = (targetMap, book) => {
      titleKeysFor(book?.title).forEach((key) => {
        if (!key) return
        if (!targetMap.has(key)) targetMap.set(key, [])
        targetMap.get(key).push(buildLocalBookPayload(book))
      })
    }

    ;(Array.isArray(localBooks) ? localBooks : [])
      .filter((book) => this.isOmnibusCatalogSequenceLabel(book?.sequence || ''))
      .forEach((book) => {
        pushLocalBookByTitleKey(omnibusLocalBooksByTitleKey, book)
      })

    entries
      .filter((entry) => !entry.coveredSlots.length && !entry.isOmnibus)
      .forEach((entry) => {
        const sourceSupport = this.buildCatalogSourceSupport(entry.sources)
        titleKeysFor(entry.title).forEach((key) => {
          if (!key || unsequencedEntrySourceSupportByTitleKey.has(key)) return
          unsequencedEntrySourceSupportByTitleKey.set(key, sourceSupport)
        })
      })

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
        slot.sourceSupport = titleKeysFor(slot.localBooks[0].title).flatMap((key) => unsequencedEntrySourceSupportByTitleKey.get(key) || []).filter((source, index, list) => {
          const identity = `${source.source}:${source.evidenceUrl || ''}:${source.label || ''}`
          return list.findIndex((candidate) => `${candidate.source}:${candidate.evidenceUrl || ''}:${candidate.label || ''}` === identity) === index
        })
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

    const unsequencedBooks = this.getCoverageEligibleLocalBooks(localBooks).filter((book) => !book.sequence)
    const unsequencedLocalBooksByTitle = new Map()
    unsequencedBooks.forEach((book) => {
      titleKeysFor(book.title).forEach((key) => {
        if (!key) return
        if (!unsequencedLocalBooksByTitle.has(key)) unsequencedLocalBooksByTitle.set(key, [])
        unsequencedLocalBooksByTitle.get(key).push({
          libraryItemId: book.libraryItemId,
          title: book.title,
          relPath: book.relPath,
          sequence: book.sequence
        })
      })
    })
    const coveredTitleKeys = new Set()
    this.getCoverageEligibleLocalBooks(localBooks)
      .filter((book) => !!book.sequence)
      .forEach((book) => {
        titleKeysFor(book.title).forEach((key) => {
          if (key) coveredTitleKeys.add(key)
        })
      })
    slots.forEach((slot) => {
      ;(slot.choices || []).forEach((choice) => {
        titleKeysFor(choice.title).forEach((key) => {
          if (key) coveredTitleKeys.add(key)
        })
      })
    })

    const unsequencedSourceEntries = entries
      .filter((entry) => !entry.coveredSlots.length && !entry.isOmnibus)
      .filter((entry) => {
        const keys = titleKeysFor(entry.title)
        return keys.length && !keys.some((key) => coveredTitleKeys.has(key))
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
        localBooks: titleKeysFor(entry.title).flatMap((key) => unsequencedLocalBooksByTitle.get(key) || []).filter((book, index, list) => {
          return list.findIndex((candidate) => candidate.libraryItemId === book.libraryItemId) === index
        }),
        choices: [],
        selectedEntryKey: null,
        status: 'unsequenced'
      }))
      .sort((a, b) => a.title.localeCompare(b.title))
    const matchedUnsequencedLocalIds = new Set(unsequencedSourceEntries.flatMap((row) => (Array.isArray(row.localBooks) ? row.localBooks : []).map((book) => book.libraryItemId)))
    const localOnlyUnsequencedRows = unsequencedBooks
      .filter((book) => !matchedUnsequencedLocalIds.has(book.libraryItemId))
      .map((book) => ({
        rowKey: `unsequenced-local:${this.normalizeKeyPart(book.libraryItemId || book.title).replace(/\s+/g, '')}`,
        rowType: 'unsequenced',
        slot: `unsequenced-local:${this.normalizeKeyPart(book.libraryItemId || book.title).replace(/\s+/g, '')}`,
        entryKey: null,
        title: book.title,
        expectedTitle: book.title,
        expectedAuthors: (Array.isArray(book.authors) ? book.authors : []).map((author) => author?.name || author).filter(Boolean),
        expectedPublishedDate: null,
        authors: (Array.isArray(book.authors) ? book.authors : []).map((author) => author?.name || author).filter(Boolean),
        publishedDate: null,
        sequenceLabel: null,
        sourceSupport: titleKeysFor(book.title).flatMap((key) => unsequencedEntrySourceSupportByTitleKey.get(key) || []).filter((source, index, list) => {
          const identity = `${source.source}:${source.evidenceUrl || ''}:${source.label || ''}`
          return list.findIndex((candidate) => `${candidate.source}:${candidate.evidenceUrl || ''}:${candidate.label || ''}` === identity) === index
        }),
        localBooks: [buildLocalBookPayload(book)],
        choices: [],
        selectedEntryKey: null,
        status: 'unsequenced'
      }))
      .sort((a, b) => a.title.localeCompare(b.title))
    const omnibusRows = entries
      .filter((entry) => entry.isOmnibus)
      .map((entry) => ({
        rowKey: `omnibus:${this.normalizeKeyPart(entry.entryKey).replace(/\s+/g, '')}`,
        rowType: 'omnibus',
        slot: entry.sequenceLabel || 'omnibus',
        entryKey: entry.entryKey,
        title: entry.title,
        expectedTitle: entry.title,
        expectedAuthors: entry.authors || [],
        expectedPublishedDate: entry.publishedDate || null,
        authors: entry.authors || [],
        publishedDate: entry.publishedDate || null,
        sequenceLabel: entry.sequenceLabel || null,
        sourceSupport: this.buildCatalogSourceSupport(entry.sources),
        localBooks: titleKeysFor(entry.title).flatMap((key) => omnibusLocalBooksByTitleKey.get(key) || []).filter((book, index, list) => {
          return list.findIndex((candidate) => candidate.libraryItemId === book.libraryItemId) === index
        }),
        choices: [],
        selectedEntryKey: null,
        status: 'omnibus'
      }))
      .sort((a, b) => String(a.sequenceLabel || '').localeCompare(String(b.sequenceLabel || ''), undefined, { numeric: true }) || a.title.localeCompare(b.title))
    const matchedOmnibusLocalIds = new Set(omnibusRows.flatMap((row) => (Array.isArray(row.localBooks) ? row.localBooks : []).map((book) => book.libraryItemId)))
    const localOnlyOmnibusRows = (Array.isArray(localBooks) ? localBooks : [])
      .filter((book) => this.isOmnibusCatalogSequenceLabel(book?.sequence || ''))
      .filter((book) => !matchedOmnibusLocalIds.has(book.libraryItemId))
      .map((book) => ({
        rowKey: `omnibus-local:${this.normalizeKeyPart(book.libraryItemId || book.title).replace(/\s+/g, '')}`,
        rowType: 'omnibus',
        slot: String(book.sequence || 'omnibus').trim() || 'omnibus',
        entryKey: null,
        title: book.title,
        expectedTitle: book.title,
        expectedAuthors: (Array.isArray(book.authors) ? book.authors : []).map((author) => author?.name || author).filter(Boolean),
        expectedPublishedDate: null,
        authors: (Array.isArray(book.authors) ? book.authors : []).map((author) => author?.name || author).filter(Boolean),
        publishedDate: null,
        sequenceLabel: String(book.sequence || '').trim() || null,
        sourceSupport: [],
        localBooks: [buildLocalBookPayload(book)],
        choices: [],
        selectedEntryKey: null,
        status: 'omnibus'
      }))
      .sort((a, b) => String(a.sequenceLabel || '').localeCompare(String(b.sequenceLabel || ''), undefined, { numeric: true }) || a.title.localeCompare(b.title))
    return {
      slots,
      unsequencedBooks,
      unsequencedSourceEntries,
      omnibusRows: [...omnibusRows, ...localOnlyOmnibusRows],
      rows: [...slots, ...unsequencedSourceEntries, ...localOnlyUnsequencedRows, ...omnibusRows, ...localOnlyOmnibusRows]
    }
  }

  buildCatalogSummaryCounts(slotMap, selectionBySlot, localBooks, entries = [], options = {}) {
    const finalized = this.finalizeCatalogSlots(slotMap, selectionBySlot, localBooks, entries, options)
    return {
      missingCount: finalized.slots.filter((slot) => slot.status === 'missing').length,
      disputedCount: finalized.slots.filter((slot) => slot.status === 'disputed').length,
      unsequencedCount: finalized.rows.filter((row) => row.rowType === 'unsequenced').length
    }
  }

  async getCatalogDetailForLibrary(libraryId, catalogId, options = {}) {
    await this.ensureSeriesReviewCatalogSchema()
    const localOnlyDecisionKey = this.parseLocalOnlyCatalogId(catalogId)
    if (localOnlyDecisionKey) {
      return this.getLocalOnlyCatalogDetailForLibrary(libraryId, localOnlyDecisionKey, options)
    }

    const resolver = options?.resolver || (await this.getSeriesNameControlResolverForLibrary(libraryId))
    const catalog =
      options?.catalogRow?.id === catalogId && options?.catalogRow?.libraryId === libraryId
        ? options.catalogRow
        : await Database.seriesReviewCatalogModel.findOne({
            where: {
              id: catalogId,
              libraryId
            }
          })
    if (!catalog) return null

    const localSeriesGroups = options?.localSeriesGroups || (await this.getLocalSeriesGroupsForLibrary(libraryId, resolver || undefined))
    const effectiveCatalogs = options?.catalogs || (await Database.seriesReviewCatalogModel.findAll({ where: { libraryId } }))
    const matchedSeriesRows = await this.getMatchingSeriesRowsForCatalog(libraryId, catalog.seriesName, {
      resolver: resolver || null,
      seriesRows: [...localSeriesGroups.values()].flatMap((group) => group.seriesRows || [])
    })
    const manualLinkedSeriesRows = await this.getManualLinkedSeriesRowsForCatalog(libraryId, catalog, {
      resolver: resolver || null,
      localSeriesGroups
    })
    const localBooks = await this.getLocalCatalogBooks(libraryId, catalog.seriesName, {
      resolver,
      matchingSeries: [...new Map([...matchedSeriesRows, ...manualLinkedSeriesRows].map((seriesRow) => [seriesRow.id, seriesRow])).values()],
      localBooksCache: options?.localBooksCache,
      expandedSeriesCache: options?.expandedSeriesCache
    })
    const decisionKey = resolver?.getDecisionKey(catalog.seriesName) || ''
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
      const coveredSlots = entry.coveredSlots.length ? entry.coveredSlots : []
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

    const finalized = this.finalizeCatalogSlots(slotMap, catalog.selectionBySlot, localBooks, entries, {
      seriesName: catalog.seriesName
    })
    const coverageBySourceUrl = this.buildCatalogSourceCoverageBySourceUrl(finalized.rows, localBooks)
    let localSeriesMatches = []
    if (!options?.skipLocalSeriesMatches) {
      localSeriesMatches = await this.getLocalSeriesMatchesForLibrary(libraryId, {
        resolver,
        localSeriesGroups,
        catalogs: effectiveCatalogs,
        includeResolved: true,
        localDecisionKey: decisionKey,
        coverageBySourceUrl
      })
    }

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
          isLocallyLinked: manualLinkedSeriesRows.length > 0,
          canDismiss: true
        }),
        selectionBySlot: catalog.selectionBySlot || {},
        localSeriesMatches,
        savedSeriesLinks: localSeriesMatches,
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
    const shouldResolveLinkedCatalog = options?.skipResolvedLookup ? false : true
    const allCatalogs = shouldResolveLinkedCatalog ? options?.catalogs || (await Database.seriesReviewCatalogModel.findAll({ where: { libraryId } })) : null
    if (shouldResolveLinkedCatalog) {
      const resolvedCatalogId = await this.getResolvedCatalogIdForLocalDecisionKey(libraryId, decisionKey, allCatalogs)
      if (resolvedCatalogId) {
        return this.getCatalogDetailForLibrary(libraryId, resolvedCatalogId, {
          ...options,
          resolver,
          localSeriesGroups
        })
      }
    }

    const group = localSeriesGroups.get(decisionKey)
    if (!group?.seriesName) return null

    const localBooks = await this.getLocalCatalogBooks(libraryId, group.seriesName, {
      resolver,
      matchingSeries: group.seriesRows,
      localBooksCache: options?.localBooksCache,
      expandedSeriesCache: options?.expandedSeriesCache
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

    const finalized = this.finalizeCatalogSlots(slotMap, {}, localBooks, [], {
      fillIntegerGaps: false,
      seriesName: group.seriesName
    })
    let localSeriesMatches = []
    if (!options?.skipLocalSeriesMatches) {
      const effectiveCatalogs = allCatalogs || (await Database.seriesReviewCatalogModel.findAll({ where: { libraryId } }))
      localSeriesMatches = await this.getLocalSeriesMatchesForLibrary(libraryId, {
        resolver,
        localSeriesGroups,
        catalogs: effectiveCatalogs,
        sourceUrlMap: this.buildCatalogSourceUrlMap(effectiveCatalogs),
        includeResolved: true,
        localDecisionKey: decisionKey
      })
    }
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
        localSeriesMatches,
        savedSeriesLinks: localSeriesMatches,
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
    const sourceLinkRenameResult = applyLocalRename
      ? await this.renameSeriesSourceLinksForLibrary(libraryId, sourceName, canonicalTargetName)
      : { updatedCount: 0, mergedCount: 0 }

    const nextResolver = await this.getSeriesNameControlResolverForLibrary(libraryId)
    await this.rebuildCatalogsForLibrary(libraryId, nextResolver)
    await this.rebuildSuggestionsForLibrary(libraryId, nextResolver)

    return {
      control,
      renameResult,
      sourceLinkRenameResult,
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
    const updatedLibraryItem = await this.unlinkSuggestionSeriesFromLibraryItem(libraryItem, suggestion, resolver)
    if (!updatedLibraryItem) {
      throw new Error('No linked series entry was found on the book')
    }

    suggestion.state = 'pending'
    suggestion.decisionAction = null
    suggestion.decisionSeriesId = null
    suggestion.decidedByUserId = userId || null
    suggestion.decidedAt = null
    await suggestion.save()

    return {
      suggestion,
      libraryItem: updatedLibraryItem
    }
  }
}

module.exports = new SeriesReviewManager()
