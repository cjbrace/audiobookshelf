#!/usr/bin/env node
const Path = require('path')
const { Op } = require('../../node_modules/sequelize')

const Database = require('../Database')
const SeriesReviewManager = require('../managers/SeriesReviewManager')

function parseArgs(argv) {
  const out = {
    configPath: '',
    metadataPath: '',
    libraryId: '',
    dryRun: false,
    limit: 0,
    outputJson: '',
    source: '',
    replaceSource: '',
    progressEvery: 1,
    workers: 4
  }

  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--dry-run') {
      out.dryRun = true
    } else if (arg === '--config-path') {
      out.configPath = argv[++index] || ''
    } else if (arg === '--metadata-path') {
      out.metadataPath = argv[++index] || ''
    } else if (arg === '--library-id') {
      out.libraryId = argv[++index] || ''
    } else if (arg === '--limit') {
      out.limit = Number(argv[++index] || 0) || 0
    } else if (arg === '--output-json') {
      out.outputJson = argv[++index] || ''
    } else if (arg === '--source') {
      out.source = String(argv[++index] || '').trim().toLowerCase()
    } else if (arg === '--replace-source') {
      out.replaceSource = String(argv[++index] || '').trim().toLowerCase()
    } else if (arg === '--progress-every') {
      out.progressEvery = Math.max(0, Number(argv[++index] || 0) || 0)
    } else if (arg === '--workers') {
      out.workers = Math.max(1, Number(argv[++index] || 0) || 0)
    } else {
      throw new Error(`Unknown argument: ${arg}`)
    }
  }

  return out
}

function normalizeUrl(value) {
  return String(value || '').trim()
}

function normalizeSourceKey(value) {
  return String(value || '').trim().toLowerCase()
}

function normalizeTitle(value) {
  return SeriesReviewManager.normalizeSeriesName(value || '')
}

function normalizeSequence(value) {
  return SeriesReviewManager.normalizeSequence(value || '')
}

function buildLocalBookIndexes(localBooks = []) {
  const bySequence = new Map()
  const byTitle = new Map()

  ;(Array.isArray(localBooks) ? localBooks : []).forEach((book) => {
    const sequence = normalizeSequence(book?.sequence || '')
    if (sequence && !bySequence.has(sequence)) bySequence.set(sequence, book)
    const titleKey = normalizeTitle(book?.title || '')
    if (titleKey && !byTitle.has(titleKey)) byTitle.set(titleKey, book)
  })

  return { bySequence, byTitle }
}

function chooseLocalBook(entry, indexes) {
  const sequence = normalizeSequence(entry?.sequenceLabel || entry?.sequence || '')
  if (sequence && indexes.bySequence.has(sequence)) return indexes.bySequence.get(sequence)
  const titleKey = normalizeTitle(entry?.title || '')
  if (titleKey && indexes.byTitle.has(titleKey)) return indexes.byTitle.get(titleKey)
  return null
}

function deriveSourceSeriesName(source, fallbackSeriesName) {
  const rawEvidence = source?.rawEvidence && typeof source.rawEvidence === 'object' ? source.rawEvidence : null
  const providerMeta = source?.providerMeta && typeof source.providerMeta === 'object' ? source.providerMeta : null

  const audibleSeriesTitle = rawEvidence?.audible?.series?.[0]?.title
  if (audibleSeriesTitle) return SeriesReviewManager.normalizeSeriesName(audibleSeriesTitle)

  const rawSourceSeriesName = rawEvidence?.sourceSeriesName || providerMeta?.sourceSeriesName || providerMeta?.seriesName
  if (rawSourceSeriesName) return SeriesReviewManager.normalizeSeriesName(rawSourceSeriesName)

  return SeriesReviewManager.normalizeSeriesName(fallbackSeriesName || '')
}

function deriveSourceAuthor(catalogSeriesName, source) {
  const rawEvidence = source?.rawEvidence && typeof source.rawEvidence === 'object' ? source.rawEvidence : null
  const providerMeta = source?.providerMeta && typeof source.providerMeta === 'object' ? source.providerMeta : null
  const evidenceAuthor =
    rawEvidence?.sourceAuthor ||
    rawEvidence?.author ||
    rawEvidence?.audible?.series?.[0]?.author ||
    providerMeta?.sourceAuthor ||
    providerMeta?.author
  if (evidenceAuthor) return SeriesReviewManager.normalizeSeriesName(evidenceAuthor)
  return SeriesReviewManager.extractCatalogAuthorFromEvidenceUrl(catalogSeriesName, source?.evidenceUrl || '')
}

function buildMatchingBooks(entry, source, localBooks, indexes) {
  const localBook = chooseLocalBook(entry, indexes)
  const sourceAsin = source?.rawEvidence?.asin || source?.providerMeta?.asin || source?.sourceRef || ''
  const sourceRegion = source?.rawEvidence?.region || source?.providerMeta?.region_used || source?.providerMeta?.region || ''
  const matchingBook = {
    libraryItemId: localBook?.libraryItemId || null,
    localTitle: localBook?.title || entry?.title || '',
    sourceTitle: entry?.title || '',
    sourceSequence: entry?.sequenceLabel || null,
    sourcePublishedDate: entry?.publishedDate || null,
    localAuthors: Array.isArray(localBook?.authors) ? localBook.authors.map((author) => author?.name || author).filter(Boolean) : [],
    sourceAuthors: Array.isArray(entry?.authors) ? entry.authors.filter(Boolean) : [],
    sourceUrl: source?.evidenceUrl || '',
    sourceAsin: sourceAsin || '',
    sourceRegion: sourceRegion || '',
    exactTitleMatch: normalizeTitle(localBook?.title || '') === normalizeTitle(entry?.title || '')
  }
  return localBook ? [matchingBook] : []
}

function buildEvidenceSnapshot(catalogSeriesName, source, matchingBooks) {
  const sourceUrl = normalizeUrl(source?.evidenceUrl || '')
  const sourceAsin = source?.rawEvidence?.asin || source?.providerMeta?.asin || source?.sourceRef || ''
  const sourceRegion = source?.rawEvidence?.region || source?.providerMeta?.region_used || source?.providerMeta?.region || ''
  const sourceSeriesName = deriveSourceSeriesName(source, catalogSeriesName)
  const sourceAuthor = deriveSourceAuthor(catalogSeriesName, source)
  return {
    source: String(source?.source || '').trim().toLowerCase(),
    sourceLabel: source?.label || '',
    sourceName: source?.label || source?.source || '',
    sourceSeriesName,
    sourceAuthor,
    sourceUrl,
    sourceLinkUrl: sourceUrl,
    sourceIdentifier: source?.sourceRef || sourceUrl,
    sourceAsin: sourceAsin || '',
    sourceRegion: sourceRegion || '',
    matchingBooks,
    sampleBooks: matchingBooks.slice(0, 3).map((book) => ({
      title: book.localTitle,
      authors: book.localAuthors || [],
      sequence: book.sourceSequence || null,
      publishedDate: book.sourcePublishedDate || null,
      sourceUrl: book.sourceUrl || '',
      sourceAsin: book.sourceAsin || '',
      sourceRegion: book.sourceRegion || ''
    })),
    sequenceIncomplete: false,
    sequenceStatusNote: '',
    lookedUpAtUtc: new Date().toISOString()
  }
}

function groupSourcesByUrl(entries, { fallbackSeriesName = '', sourceFilter = '' } = {}) {
  const groups = new Map()
  ;(Array.isArray(entries) ? entries : []).forEach((entry) => {
    ;(Array.isArray(entry?.sources) ? entry.sources : []).forEach((source) => {
      const normalizedSource = SeriesReviewManager.cleanCatalogSource(source, { fallbackSeriesName })
      const sourceKey = normalizeSourceKey(normalizedSource?.source || '')
      if (sourceFilter && sourceKey !== sourceFilter) return
      const url = normalizeUrl(normalizedSource?.evidenceUrl || '')
      if (!url) return
      if (!groups.has(url)) {
        groups.set(url, {
          url,
          source: sourceKey,
          label: normalizedSource?.label || '',
          evidenceSource: normalizedSource,
          entries: []
        })
      }
      const group = groups.get(url)
      if (!group.source && normalizedSource?.source) group.source = sourceKey
      if (!group.label && normalizedSource?.label) group.label = normalizedSource.label
      if (!group.evidenceSource?.rawEvidence && normalizedSource?.rawEvidence) group.evidenceSource = normalizedSource
      group.entries.push({ entry, source: normalizedSource })
    })
  })
  return [...groups.values()]
}

async function mapWithConcurrency(items, concurrency, mapper) {
  const queue = Array.isArray(items) ? items : []
  const workerCount = Math.max(1, Number(concurrency || 1) || 1)
  const results = new Array(queue.length)
  let nextIndex = 0

  async function worker() {
    while (true) {
      const currentIndex = nextIndex
      nextIndex += 1
      if (currentIndex >= queue.length) return
      results[currentIndex] = await mapper(queue[currentIndex], currentIndex)
    }
  }

  await Promise.all(Array.from({ length: workerCount }, () => worker()))
  return results
}

function chunkArray(items, size) {
  const list = Array.isArray(items) ? items : []
  const chunkSize = Math.max(1, Number(size || 1) || 1)
  const chunks = []
  for (let index = 0; index < list.length; index += chunkSize) {
    chunks.push(list.slice(index, index + chunkSize))
  }
  return chunks
}

async function bulkInsertSeriesSourceLinks(rows) {
  const inserts = Array.isArray(rows) ? rows.filter(Boolean) : []
  if (!inserts.length) return 0
  let inserted = 0
  await Database.sequelize.transaction(async (transaction) => {
    for (const chunk of chunkArray(inserts, 100)) {
      await Database.seriesReviewSeriesSourceLinkModel.bulkCreate(chunk, {
        ignoreDuplicates: true,
        transaction
      })
      inserted += chunk.length
    }
  })
  return inserted
}

async function ensureConfigPaths(configPath, metadataPath) {
  global.Source = 'docker'
  global.ConfigPath = Path.resolve(configPath)
  global.MetadataPath = Path.resolve(metadataPath)
}

async function deleteExistingSeriesSourceLinks(libraryId, sourceFilter) {
  const normalizedSource = normalizeSourceKey(sourceFilter)
  if (!normalizedSource) return 0
  return Database.seriesReviewSeriesSourceLinkModel.destroy({
    where: {
      libraryId,
      source: normalizedSource
    }
  })
}

async function processCatalog(library, resolver, localSeriesGroups, preloadedSeriesBooksBySeriesId, catalog, index, args, inactiveKeys) {
  const catalogSeriesName = SeriesReviewManager.normalizeSeriesName(catalog.seriesName || '')
  const decisionKey = resolver.getDecisionKey(catalogSeriesName)
  const group = localSeriesGroups.get(decisionKey) || null
  const normalizedEntries = SeriesReviewManager.normalizeCatalogEntries(catalog.entries || [])
  const sourceGroups = group?.seriesName
    ? groupSourcesByUrl(normalizedEntries, {
        fallbackSeriesName: catalogSeriesName,
        sourceFilter: normalizeSourceKey(args.source || args.replaceSource || '')
      })
    : []
  const localBooks = group?.seriesName
    ? await SeriesReviewManager.getLocalCatalogBooks(library.id, group.seriesName, {
        resolver,
        matchingSeries: group.seriesRows,
        preloadedSeriesBooksBySeriesId
      })
    : []
  const localBookIndexes = buildLocalBookIndexes(localBooks)
  const catalogSummary = {
    catalogId: catalog.id,
    seriesName: catalogSeriesName,
    sourceLinksSeen: 0,
    sourceLinksSaved: 0,
    sourceLinksSkippedInactive: 0,
    sourceLinksSkippedUnmatched: 0,
    sourceLinks: []
  }
  const rowsToInsert = []

  process.stderr.write(
    `[catalog_start] ${library.name || library.id}: ${catalogSeriesName} sources=${sourceGroups.length} books=${localBooks.length}\n`
  )

  try {
    for (let groupIndex = 0; groupIndex < sourceGroups.length; groupIndex += 1) {
      const groupEntry = sourceGroups[groupIndex]
      process.stderr.write(
        `[catalog_source] ${library.name || library.id}: ${catalogSeriesName} ${groupIndex + 1}/${sourceGroups.length} url=${groupEntry.url}\n`
      )

      const matchingBooks = []
      const seenBookIds = new Set()
      for (const { entry, source } of groupEntry.entries) {
        const booksForEntry = buildMatchingBooks(entry, source, localBooks, localBookIndexes)
        booksForEntry.forEach((book) => {
          const bookId = String(book.libraryItemId || '')
          if (!bookId || seenBookIds.has(bookId)) return
          seenBookIds.add(bookId)
          matchingBooks.push(book)
        })
      }

      if (!matchingBooks.length) {
        catalogSummary.sourceLinksSkippedUnmatched += 1
        continue
      }

      const targetUrl = groupEntry.url
      const inactiveKey = `${decisionKey}::${targetUrl}`
      if (inactiveKeys.has(inactiveKey)) {
        catalogSummary.sourceLinksSkippedInactive += 1
        continue
      }

      const source = groupEntry.evidenceSource || groupEntry.entries[0]?.source || {}
      const evidenceSnapshot = buildEvidenceSnapshot(catalogSeriesName, source, matchingBooks)
      evidenceSnapshot.sequenceIncomplete = matchingBooks.length < localBooks.length
      evidenceSnapshot.sequenceStatusNote = evidenceSnapshot.sequenceIncomplete ? 'Partial source coverage from current catalog entries' : ''

      const payload = {
        source: String(source.source || '').trim().toLowerCase() || 'fictiondb',
        sourceSeriesName: deriveSourceSeriesName(source, catalogSeriesName),
        sourceAuthor: deriveSourceAuthor(catalogSeriesName, source),
        sourceSeriesUrl: targetUrl,
        evidenceSnapshot
      }

      rowsToInsert.push({
        libraryId: library.id,
        localDecisionKey: decisionKey,
        localSeriesName: catalogSeriesName,
        source: payload.source,
        sourceSeriesName: payload.sourceSeriesName,
        sourceAuthor: payload.sourceAuthor || null,
        sourceSeriesUrl: payload.sourceSeriesUrl,
        coverageStatus: evidenceSnapshot.sequenceIncomplete ? 'partial' : 'linked',
        linkedBookCount: matchingBooks.length,
        totalBookCount: localBooks.length,
        evidenceSnapshot,
        isActive: true,
        unlinkedAt: null,
        unlinkedByUserId: null,
        createdAt: new Date(),
        updatedAt: new Date()
      })

      catalogSummary.sourceLinksSeen += 1
      catalogSummary.sourceLinksSaved += 1
      catalogSummary.sourceLinks.push({
        source: payload.source,
        sourceSeriesUrl: targetUrl,
        sourceSeriesName: payload.sourceSeriesName,
        coverage: evidenceSnapshot.sequenceIncomplete ? 'partial' : 'linked',
        matchingBookCount: matchingBooks.length,
        totalBookCount: localBooks.length
      })
    }
  } catch (error) {
    catalogSummary.error = String(error?.message || error)
    process.stderr.write(`[catalog_error] ${library.name || library.id} ${catalog.id}: ${catalogSummary.error}\n`)
  }

  process.stderr.write(
    `[catalog_done] ${library.name || library.id}: ${catalogSeriesName} seen=${catalogSummary.sourceLinksSeen} ` +
      `saved=${catalogSummary.sourceLinksSaved} inactive=${catalogSummary.sourceLinksSkippedInactive} ` +
      `unmatched=${catalogSummary.sourceLinksSkippedUnmatched}\n`
  )

  return {
    catalogSummary,
    rowsToInsert
  }
}

async function main() {
  const args = parseArgs(process.argv)
  const configPath = args.configPath || process.env.CONFIG_PATH || '/config'
  const metadataPath = args.metadataPath || process.env.METADATA_PATH || '/metadata'
  await ensureConfigPaths(configPath, metadataPath)

  const summary = {
    dryRun: args.dryRun,
    configPath: global.ConfigPath,
    metadataPath: global.MetadataPath,
    libraryId: args.libraryId || '',
    totals: {
      librariesSeen: 0,
      catalogsSeen: 0,
      catalogsFailed: 0,
      rowsDeleted: 0,
      sourceLinksSeen: 0,
      sourceLinksSaved: 0,
      sourceLinksSkippedInactive: 0,
      sourceLinksSkippedUnmatched: 0
    },
    libraries: []
  }

  await Database.init(false)
  await SeriesReviewManager.ensureSeriesReviewCatalogSchema()

  const libraries = args.libraryId
    ? [await Database.libraryModel.findByPk(args.libraryId)]
    : await Database.libraryModel.findAll({
        where: {
          mediaType: 'book'
        },
        order: [['name', 'ASC']]
      })

  for (const library of libraries.filter(Boolean)) {
    summary.totals.librariesSeen += 1
    const resolver = await SeriesReviewManager.getSeriesNameControlResolverForLibrary(library.id)
    const catalogs = await Database.seriesReviewCatalogModel.findAll({
      where: {
        libraryId: library.id,
        visibilityStatus: {
          [Op.ne]: 'dismissed'
        }
      },
      order: [['seriesName', 'ASC']]
    })
    const localSeriesGroups = await SeriesReviewManager.getLocalSeriesGroupsForLibrary(library.id, resolver)
    const seriesIds = [...localSeriesGroups.values()].flatMap((group) => (group.seriesRows || []).map((series) => series.id))
    const preloadedSeriesBooksBySeriesId = await SeriesReviewManager.getSeriesBooksBySeriesIds(library.id, seriesIds)
    const existingRows = await Database.seriesReviewSeriesSourceLinkModel.findAll({
      where: {
        libraryId: library.id
      },
      raw: true
    })
    const inactiveKeys = new Set(
      existingRows
        .filter((row) => row && row.isActive === false)
        .map((row) => `${String(row.localDecisionKey || '').trim()}::${String(row.sourceSeriesUrl || '').trim()}`)
    )

    if (!args.dryRun && normalizeSourceKey(args.replaceSource || '')) {
      summary.totals.rowsDeleted += await deleteExistingSeriesSourceLinks(library.id, args.replaceSource)
    }

    process.stderr.write(
      `[library_start] ${library.name || library.id}: ${catalogs.length} catalogs, mode=${args.dryRun ? 'dry-run' : 'write'} workers=${args.workers}\n`
    )

    const librarySummary = {
      libraryId: library.id,
      libraryName: library.name || '',
      catalogsSeen: 0,
      catalogsFailed: 0,
      sourceLinksSeen: 0,
      sourceLinksSaved: 0,
      sourceLinksSkippedInactive: 0,
      sourceLinksSkippedUnmatched: 0,
      catalogs: []
    }

    const catalogResults = await mapWithConcurrency(
      catalogs,
      args.workers,
      async (catalog, index) => processCatalog(library, resolver, localSeriesGroups, preloadedSeriesBooksBySeriesId, catalog, index, args, inactiveKeys)
    )

    for (const result of catalogResults) {
      if (!result?.catalogSummary) continue
      librarySummary.catalogsSeen += 1
      librarySummary.sourceLinksSeen += result.catalogSummary.sourceLinksSeen || 0
      librarySummary.sourceLinksSaved += result.catalogSummary.sourceLinksSaved || 0
      librarySummary.sourceLinksSkippedInactive += result.catalogSummary.sourceLinksSkippedInactive || 0
      librarySummary.sourceLinksSkippedUnmatched += result.catalogSummary.sourceLinksSkippedUnmatched || 0
      librarySummary.catalogs.push(result.catalogSummary)
      summary.totals.catalogsSeen += 1
      summary.totals.sourceLinksSeen += result.catalogSummary.sourceLinksSeen || 0
      summary.totals.sourceLinksSaved += result.catalogSummary.sourceLinksSaved || 0
      summary.totals.sourceLinksSkippedInactive += result.catalogSummary.sourceLinksSkippedInactive || 0
      summary.totals.sourceLinksSkippedUnmatched += result.catalogSummary.sourceLinksSkippedUnmatched || 0
      if (result.catalogSummary.error) summary.totals.catalogsFailed += 1
    }

    const rowsToInsert = catalogResults.flatMap((result) => result?.rowsToInsert || [])
    if (!args.dryRun && rowsToInsert.length) {
      await bulkInsertSeriesSourceLinks(rowsToInsert)
    }

    process.stderr.write(
      `[library_done] ${library.name || library.id}: ${librarySummary.catalogsSeen}/${catalogs.length} catalogs, ` +
        `seen=${librarySummary.sourceLinksSeen} saved=${librarySummary.sourceLinksSaved} ` +
        `inactive=${librarySummary.sourceLinksSkippedInactive} unmatched=${librarySummary.sourceLinksSkippedUnmatched}\n`
    )

    summary.libraries.push(librarySummary)
  }

  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`)
}

main().catch((error) => {
  process.stderr.write(`${error?.stack || error}\n`)
  process.exit(1)
})
