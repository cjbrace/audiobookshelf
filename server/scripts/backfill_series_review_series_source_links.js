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
    outputJson: ''
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
    } else {
      throw new Error(`Unknown argument: ${arg}`)
    }
  }

  return out
}

function normalizeUrl(value) {
  return String(value || '').trim()
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

function groupSourcesByUrl(entries) {
  const groups = new Map()
  ;(Array.isArray(entries) ? entries : []).forEach((entry) => {
    ;(Array.isArray(entry?.sources) ? entry.sources : []).forEach((source) => {
      const url = normalizeUrl(source?.evidenceUrl || '')
      if (!url) return
      if (!groups.has(url)) {
        groups.set(url, {
          url,
          source: String(source?.source || '').trim().toLowerCase(),
          label: source?.label || '',
          evidenceSource: source,
          entries: []
        })
      }
      const group = groups.get(url)
      if (!group.source && source?.source) group.source = String(source.source).trim().toLowerCase()
      if (!group.label && source?.label) group.label = source.label
      if (!group.evidenceSource?.rawEvidence && source?.rawEvidence) group.evidenceSource = source
      group.entries.push({ entry, source })
    })
  })
  return [...groups.values()]
}

async function ensureConfigPaths(configPath, metadataPath) {
  global.Source = 'docker'
  global.ConfigPath = Path.resolve(configPath)
  global.MetadataPath = Path.resolve(metadataPath)
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

    for (const catalog of catalogs) {
      const catalogSeriesName = SeriesReviewManager.normalizeSeriesName(catalog.seriesName || '')
      const decisionKey = resolver.getDecisionKey(catalogSeriesName)
      const normalizedEntries = SeriesReviewManager.normalizeCatalogEntries(catalog.entries || [])
      const localBooks = await SeriesReviewManager.getLocalCatalogBooks(library.id, catalogSeriesName, {
        resolver
      })
      const localBookIndexes = buildLocalBookIndexes(localBooks)
      const sourceGroups = groupSourcesByUrl(normalizedEntries)
      const catalogSummary = {
        catalogId: catalog.id,
        seriesName: catalogSeriesName,
        sourceLinksSeen: 0,
        sourceLinksSaved: 0,
        sourceLinksSkippedInactive: 0,
        sourceLinksSkippedUnmatched: 0,
        sourceLinks: []
      }

      try {
        for (const group of sourceGroups) {
          const matchingBooks = []
          const seenBookIds = new Set()
          for (const { entry, source } of group.entries) {
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
            librarySummary.sourceLinksSkippedUnmatched += 1
            summary.totals.sourceLinksSkippedUnmatched += 1
            continue
          }

          const targetUrl = group.url
          const inactiveKey = `${decisionKey}::${targetUrl}`
          if (inactiveKeys.has(inactiveKey)) {
            catalogSummary.sourceLinksSkippedInactive += 1
            librarySummary.sourceLinksSkippedInactive += 1
            summary.totals.sourceLinksSkippedInactive += 1
            continue
          }

          const source = group.evidenceSource || group.entries[0]?.source || {}
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

          if (!args.dryRun) {
            await SeriesReviewManager.saveLocalSeriesMatchForSeriesName(
              library.id,
              catalogSeriesName,
              decisionKey,
              payload,
              catalog.id
            )
          }

          catalogSummary.sourceLinksSeen += 1
          catalogSummary.sourceLinksSaved += 1
          librarySummary.sourceLinksSeen += 1
          librarySummary.sourceLinksSaved += 1
          summary.totals.sourceLinksSeen += 1
          summary.totals.sourceLinksSaved += 1
          catalogSummary.sourceLinks.push({
            source: payload.source,
            sourceSeriesUrl: targetUrl,
            sourceSeriesName: payload.sourceSeriesName,
            coverage: evidenceSnapshot.sequenceIncomplete ? 'partial' : 'linked',
            matchingBookCount: matchingBooks.length,
            totalBookCount: localBooks.length
          })
        }

        librarySummary.catalogsSeen += 1
        summary.totals.catalogsSeen += 1
        librarySummary.catalogs.push(catalogSummary)
        if (librarySummary.catalogsSeen % 25 === 0) {
          process.stderr.write(`[catalog] ${library.name || library.id}: ${librarySummary.catalogsSeen}/${catalogs.length}\n`)
        }
      } catch (error) {
        catalogSummary.error = String(error?.message || error)
        librarySummary.catalogsFailed += 1
        summary.totals.catalogsFailed += 1
        librarySummary.catalogs.push(catalogSummary)
        process.stderr.write(`[catalog_error] ${library.name || library.id} ${catalog.id}: ${catalogSummary.error}\n`)
      }
    }

    summary.libraries.push(librarySummary)
  }

  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`)
}

main().catch((error) => {
  process.stderr.write(`${error?.stack || error}\n`)
  process.exit(1)
})
