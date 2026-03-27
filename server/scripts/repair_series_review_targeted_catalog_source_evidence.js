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
    catalogId: '',
    seriesName: '',
    source: '',
    sourceSeriesUrl: '',
    dryRun: false,
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
    } else if (arg === '--catalog-id') {
      out.catalogId = argv[++index] || ''
    } else if (arg === '--series-name') {
      out.seriesName = argv[++index] || ''
    } else if (arg === '--source') {
      out.source = argv[++index] || ''
    } else if (arg === '--source-series-url') {
      out.sourceSeriesUrl = argv[++index] || ''
    } else if (arg === '--output-json') {
      out.outputJson = argv[++index] || ''
    } else {
      throw new Error(`Unknown argument: ${arg}`)
    }
  }

  if (!out.catalogId && !out.seriesName) {
    throw new Error('Provide either --catalog-id or --series-name')
  }
  if (!out.source || !out.sourceSeriesUrl) {
    throw new Error('Provide both --source and --source-series-url')
  }

  return out
}

async function ensureConfigPaths(configPath, metadataPath) {
  global.Source = 'docker'
  global.ConfigPath = Path.resolve(configPath)
  global.MetadataPath = Path.resolve(metadataPath)
}

function normalizeSeriesName(value) {
  return String(value || '')
    .trim()
    .replace(/\s+/g, ' ')
}

function getAffectedEntryTitles(beforeEntries = [], afterEntries = []) {
  const nextSourceCountByEntryKey = new Map(
    (Array.isArray(afterEntries) ? afterEntries : []).map((entry) => [String(entry?.entryKey || ''), Array.isArray(entry?.sources) ? entry.sources.length : 0])
  )

  return (Array.isArray(beforeEntries) ? beforeEntries : [])
    .filter((entry) => {
      const entryKey = String(entry?.entryKey || '')
      if (!entryKey) return false
      const beforeCount = Array.isArray(entry?.sources) ? entry.sources.length : 0
      const afterCount = nextSourceCountByEntryKey.get(entryKey)
      return typeof afterCount === 'number' && afterCount < beforeCount
    })
    .map((entry) => String(entry?.title || '').trim())
    .filter(Boolean)
}

async function findTargetCatalogs(args) {
  if (args.catalogId) {
    const catalog = await Database.seriesReviewCatalogModel.findOne({
      where: {
        id: args.catalogId,
        ...(args.libraryId ? { libraryId: args.libraryId } : {})
      }
    })
    return catalog ? [catalog] : []
  }

  const where = {
    seriesName: normalizeSeriesName(args.seriesName)
  }
  if (args.libraryId) where.libraryId = args.libraryId
  return Database.seriesReviewCatalogModel.findAll({
    where,
    order: [['seriesName', 'ASC']]
  })
}

async function main() {
  const args = parseArgs(process.argv)
  await ensureConfigPaths(args.configPath || process.env.CONFIG_PATH || '/config', args.metadataPath || process.env.METADATA_PATH || '/metadata')

  await Database.init(false)
  await SeriesReviewManager.ensureSeriesReviewCatalogSchema()

  const normalizedSource = String(args.source || '').trim().toLowerCase()
  const normalizedSourceSeriesUrl = SeriesReviewManager.normalizeExternalUrl(args.sourceSeriesUrl || '')
  const catalogs = await findTargetCatalogs(args)

  const summary = {
    dryRun: args.dryRun,
    filters: {
      libraryId: args.libraryId || '',
      catalogId: args.catalogId || '',
      seriesName: normalizeSeriesName(args.seriesName || ''),
      source: normalizedSource,
      sourceSeriesUrl: normalizedSourceSeriesUrl
    },
    totals: {
      catalogsMatched: catalogs.length,
      catalogsChanged: 0,
      sourceRowsRemoved: 0
    },
    catalogs: []
  }

  for (const catalog of catalogs) {
    const result = SeriesReviewManager.stripCatalogSourceEvidence(catalog.entries, normalizedSourceSeriesUrl, { source: normalizedSource })
    const affectedEntryTitles = getAffectedEntryTitles(catalog.entries, result.entries)

    const catalogSummary = {
      id: catalog.id,
      libraryId: catalog.libraryId,
      seriesName: catalog.seriesName,
      changed: result.changed,
      sourceRowsRemoved: result.removedCount,
      affectedEntryTitles
    }
    summary.catalogs.push(catalogSummary)

    if (!result.changed) continue

    summary.totals.catalogsChanged += 1
    summary.totals.sourceRowsRemoved += result.removedCount

    if (!args.dryRun) {
      catalog.entries = result.entries
      await catalog.save()
    }
  }

  if (args.outputJson) {
    Fs.writeFileSync(Path.resolve(args.outputJson), JSON.stringify(summary, null, 2))
  }

  console.log(JSON.stringify(summary, null, 2))
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(async () => {
    if (Database.sequelize) {
      await Database.sequelize.close().catch(() => null)
    }
  })
