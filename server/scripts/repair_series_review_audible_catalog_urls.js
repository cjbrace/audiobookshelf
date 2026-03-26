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
    } else if (arg === '--limit') {
      out.limit = Number(argv[++index] || 0) || 0
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

function deepClone(value) {
  if (!value || typeof value !== 'object') return value
  return JSON.parse(JSON.stringify(value))
}

async function ensureConfigPaths(configPath, metadataPath) {
  global.Source = 'docker'
  global.ConfigPath = Path.resolve(configPath)
  global.MetadataPath = Path.resolve(metadataPath)
}

async function main() {
  const args = parseArgs(process.argv)
  await ensureConfigPaths(args.configPath || process.env.CONFIG_PATH || '/config', args.metadataPath || process.env.METADATA_PATH || '/metadata')

  await Database.init(false)
  await SeriesReviewManager.ensureSeriesReviewCatalogSchema()

  const libraries = args.libraryId
    ? [await Database.libraryModel.findByPk(args.libraryId)]
    : await Database.libraryModel.findAll({
        where: { mediaType: 'book' },
        order: [['name', 'ASC']]
      })

  const summary = {
    dryRun: args.dryRun,
    libraryId: args.libraryId || '',
    totals: {
      librariesSeen: 0,
      catalogsSeen: 0,
      catalogsChanged: 0,
      audibleSourcesSeen: 0,
      audiblePdSourcesSeen: 0,
      audiblePdSourcesRepaired: 0,
      audiblePdSourcesUnchanged: 0
    },
    libraries: []
  }

  for (const library of libraries.filter(Boolean)) {
    const librarySummary = {
      libraryId: library.id,
      libraryName: library.name || '',
      catalogsSeen: 0,
      catalogsChanged: 0,
      audibleSourcesSeen: 0,
      audiblePdSourcesSeen: 0,
      audiblePdSourcesRepaired: 0,
      audiblePdSourcesUnchanged: 0,
      changedCatalogs: []
    }
    summary.totals.librariesSeen += 1

    const findOptions = {
      where: {
        libraryId: library.id,
        visibilityStatus: {
          [Op.ne]: 'dismissed'
        }
      },
      order: [['seriesName', 'ASC']]
    }
    if (args.limit > 0) findOptions.limit = args.limit

    const catalogs = await Database.seriesReviewCatalogModel.findAll(findOptions)

    for (let index = 0; index < catalogs.length; index += 1) {
      const catalog = catalogs[index]
      librarySummary.catalogsSeen += 1
      summary.totals.catalogsSeen += 1

      let catalogChanged = false
      let catalogAudibleSourcesSeen = 0
      let catalogAudiblePdSourcesSeen = 0
      let catalogAudiblePdSourcesRepaired = 0
      const entries = Array.isArray(catalog.entries) ? catalog.entries : []
      const nextEntries = entries.map((entry) => {
        const nextEntry = { ...entry }
        const nextSources = (Array.isArray(entry?.sources) ? entry.sources : []).map((source) => {
          const sourceKey = String(source?.source || '').trim().toLowerCase()
          if (sourceKey !== 'audible') return source

          catalogAudibleSourcesSeen += 1
          librarySummary.audibleSourcesSeen += 1
          summary.totals.audibleSourcesSeen += 1

          const originalUrl = SeriesReviewManager.normalizeExternalUrl(source?.evidenceUrl || '')
          if (originalUrl.includes('/pd/')) {
            catalogAudiblePdSourcesSeen += 1
            librarySummary.audiblePdSourcesSeen += 1
            summary.totals.audiblePdSourcesSeen += 1
          }

          const repairedSource = SeriesReviewManager.canonicalizeCatalogSource(deepClone(source), {
            fallbackSeriesName: catalog.seriesName || ''
          })
          const repairedUrl = SeriesReviewManager.normalizeExternalUrl(repairedSource?.evidenceUrl || '')
          if (originalUrl && repairedUrl && originalUrl !== repairedUrl && repairedUrl.includes('/series/')) {
            catalogChanged = true
            catalogAudiblePdSourcesRepaired += 1
            librarySummary.audiblePdSourcesRepaired += 1
            summary.totals.audiblePdSourcesRepaired += 1
          } else if (originalUrl.includes('/pd/')) {
            librarySummary.audiblePdSourcesUnchanged += 1
            summary.totals.audiblePdSourcesUnchanged += 1
          }
          return repairedSource
        })
        nextEntry.sources = nextSources
        return nextEntry
      })

      if (catalogChanged) {
        librarySummary.catalogsChanged += 1
        summary.totals.catalogsChanged += 1
        librarySummary.changedCatalogs.push({
          catalogId: catalog.id,
          seriesName: catalog.seriesName,
          audiblePdSourcesRepaired: catalogAudiblePdSourcesRepaired
        })
        if (!args.dryRun) {
          catalog.entries = nextEntries
          await catalog.save()
        }
      }

      if (args.progressEvery > 0 && ((index + 1) % args.progressEvery === 0 || index === catalogs.length - 1)) {
        process.stderr.write(
          `[repair_progress] ${library.name || library.id}: ${index + 1}/${catalogs.length} catalogs ` +
            `changed=${librarySummary.catalogsChanged} repaired=${librarySummary.audiblePdSourcesRepaired}\n`
        )
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
