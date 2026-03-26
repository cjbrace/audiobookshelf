#!/usr/bin/env node
const Fs = require('fs')
const Path = require('path')

const Database = require('../Database')
const SeriesReviewManager = require('../managers/SeriesReviewManager')

function parseArgs(argv) {
  const out = {
    configPath: '',
    metadataPath: '',
    libraryId: '',
    source: 'audible',
    dryRun: false,
    outputJson: '',
    progressEvery: 25
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
    } else if (arg === '--source') {
      out.source = argv[++index] || 'audible'
    } else if (arg === '--output-json') {
      out.outputJson = argv[++index] || ''
    } else if (arg === '--progress-every') {
      out.progressEvery = Math.max(0, Number(argv[++index] || 0) || 0)
    } else {
      throw new Error(`Unknown argument: ${arg}`)
    }
  }

  return out
}

async function ensureConfigPaths(configPath, metadataPath) {
  global.Source = 'docker'
  global.ConfigPath = Path.resolve(configPath)
  global.MetadataPath = Path.resolve(metadataPath)
}

function buildCatalogOrphanCleanup(entries = [], activeUrls = new Set(), source = '') {
  const normalizedSource = String(source || '').trim().toLowerCase()
  let changed = false
  let sourceRowsSeen = 0
  let sourceRowsRemoved = 0

  const nextEntries = (Array.isArray(entries) ? entries : []).map((entry) => {
    const currentSources = Array.isArray(entry?.sources) ? entry.sources : []
    if (!currentSources.length) return entry

    const nextSources = currentSources.filter((row) => {
      const sourceKey = String(row?.source || '').trim().toLowerCase()
      if (!sourceKey || sourceKey !== normalizedSource) return true

      const evidenceUrl = SeriesReviewManager.normalizeExternalUrl(row?.evidenceUrl || '')
      if (!evidenceUrl) return true

      sourceRowsSeen += 1
      const keep = activeUrls.has(evidenceUrl)
      if (!keep) {
        changed = true
        sourceRowsRemoved += 1
      }
      return keep
    })

    if (nextSources.length === currentSources.length) return entry
    return {
      ...entry,
      sources: nextSources
    }
  })

  return {
    changed,
    sourceRowsSeen,
    sourceRowsRemoved,
    entries: changed ? nextEntries : Array.isArray(entries) ? entries : []
  }
}

async function main() {
  const args = parseArgs(process.argv)
  await ensureConfigPaths(args.configPath || process.env.CONFIG_PATH || '/config', args.metadataPath || process.env.METADATA_PATH || '/metadata')

  await Database.init(false)
  await SeriesReviewManager.ensureSeriesReviewCatalogSchema()

  const normalizedSource = String(args.source || 'audible').trim().toLowerCase()
  const libraries = args.libraryId
    ? [await Database.libraryModel.findByPk(args.libraryId)]
    : await Database.libraryModel.findAll({
        where: { mediaType: 'book' },
        order: [['name', 'ASC']]
      })

  const summary = {
    dryRun: args.dryRun,
    source: normalizedSource,
    libraryId: args.libraryId || '',
    totals: {
      librariesSeen: 0,
      activeSourceUrls: 0,
      catalogsSeen: 0,
      catalogsChanged: 0,
      sourceRowsSeen: 0,
      sourceRowsRemoved: 0
    },
    libraries: []
  }

  for (const library of libraries.filter(Boolean)) {
    summary.totals.librariesSeen += 1

    const activeLinks = await Database.seriesReviewSeriesSourceLinkModel.findAll({
      where: {
        libraryId: library.id,
        isActive: true,
        source: normalizedSource
      }
    })
    const activeUrls = new Set(activeLinks.map((row) => SeriesReviewManager.normalizeExternalUrl(row.sourceSeriesUrl || '')).filter(Boolean))
    summary.totals.activeSourceUrls += activeUrls.size

    const catalogs = await Database.seriesReviewCatalogModel.findAll({
      where: {
        libraryId: library.id
      },
      order: [['seriesName', 'ASC']]
    })

    const librarySummary = {
      libraryId: library.id,
      libraryName: library.name || '',
      activeSourceUrls: activeUrls.size,
      catalogsSeen: catalogs.length,
      catalogsChanged: 0,
      sourceRowsSeen: 0,
      sourceRowsRemoved: 0,
      changedCatalogs: []
    }

    for (let index = 0; index < catalogs.length; index += 1) {
      const catalog = catalogs[index]
      summary.totals.catalogsSeen += 1

      const result = buildCatalogOrphanCleanup(catalog.entries, activeUrls, normalizedSource)
      librarySummary.sourceRowsSeen += result.sourceRowsSeen
      librarySummary.sourceRowsRemoved += result.sourceRowsRemoved
      summary.totals.sourceRowsSeen += result.sourceRowsSeen
      summary.totals.sourceRowsRemoved += result.sourceRowsRemoved

      if (result.changed) {
        librarySummary.catalogsChanged += 1
        summary.totals.catalogsChanged += 1
        librarySummary.changedCatalogs.push({
          catalogId: catalog.id,
          seriesName: catalog.seriesName,
          sourceRowsRemoved: result.sourceRowsRemoved
        })
        if (!args.dryRun) {
          catalog.entries = result.entries
          await catalog.save()
        }
      }

      if (args.progressEvery > 0 && ((index + 1) % args.progressEvery === 0 || index === catalogs.length - 1)) {
        process.stderr.write(
          `[repair_progress] ${library.name || library.id}: ${index + 1}/${catalogs.length} catalogs ` +
            `changed=${librarySummary.catalogsChanged} removed=${librarySummary.sourceRowsRemoved}\n`
        )
      }
    }

    summary.libraries.push(librarySummary)
  }

  const rendered = `${JSON.stringify(summary, null, 2)}\n`
  if (args.outputJson) Fs.writeFileSync(Path.resolve(args.outputJson), rendered)
  process.stdout.write(rendered)
}

main().catch((error) => {
  process.stderr.write(`${error?.stack || error}\n`)
  process.exit(1)
})
