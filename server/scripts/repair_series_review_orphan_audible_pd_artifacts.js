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

function isAudiblePdContribution(contribution) {
  const source = String(contribution?.source || '').trim().toLowerCase()
  const url = String(contribution?.evidenceUrl || '').trim()
  return source === 'audible' && url.includes('/pd/')
}

async function countActiveAudiblePdContributionsForLibrary(libraryId) {
  const suggestions = await Database.seriesReviewSuggestionModel.findAll({
    where: {
      libraryId,
      isActive: true
    }
  })

  let count = 0
  suggestions.forEach((suggestion) => {
    ;(Array.isArray(suggestion.contributions) ? suggestion.contributions : []).forEach((contribution) => {
      if (isAudiblePdContribution(contribution)) count += 1
    })
  })
  return count
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
      suggestionsSeen: 0,
      audiblePdContributionsSeen: 0,
      orphanAudiblePdContributions: 0,
      orphanAudiblePdUrls: 0,
      backedAudiblePdContributionsSkipped: 0,
      cleanupRuns: 0,
      remainingActiveAudiblePdContributions: 0
    },
    libraries: []
  }

  for (const library of libraries.filter(Boolean)) {
    summary.totals.librariesSeen += 1

    const activeSavedLinks = await Database.seriesReviewSeriesSourceLinkModel.findAll({
      where: {
        libraryId: library.id,
        isActive: true
      }
    })
    const activeSavedLinkUrls = new Set(activeSavedLinks.map((row) => String(row.sourceSeriesUrl || '').trim()).filter(Boolean))

    const suggestions = await Database.seriesReviewSuggestionModel.findAll({
      where: {
        libraryId: library.id,
        isActive: true
      }
    })

    const orphanUrls = new Map()
    let audiblePdContributionsSeen = 0
    let backedAudiblePdContributionsSkipped = 0

    suggestions.forEach((suggestion) => {
      summary.totals.suggestionsSeen += 1
      ;(Array.isArray(suggestion.contributions) ? suggestion.contributions : []).forEach((contribution) => {
        if (!isAudiblePdContribution(contribution)) return

        audiblePdContributionsSeen += 1
        summary.totals.audiblePdContributionsSeen += 1

        const url = String(contribution?.evidenceUrl || '').trim()
        if (activeSavedLinkUrls.has(url)) {
          backedAudiblePdContributionsSkipped += 1
          summary.totals.backedAudiblePdContributionsSkipped += 1
          return
        }

        const existing = orphanUrls.get(url) || {
          url,
          contributionCount: 0,
          suggestionIds: new Set(),
          libraryItemIds: new Set(),
          suggestedNames: new Set(),
          states: new Set()
        }
        existing.contributionCount += 1
        existing.suggestionIds.add(String(suggestion.id))
        existing.libraryItemIds.add(String(suggestion.libraryItemId))
        if (suggestion.suggestedName) existing.suggestedNames.add(String(suggestion.suggestedName))
        if (suggestion.state) existing.states.add(String(suggestion.state))
        orphanUrls.set(url, existing)
      })
    })

    const orphanUrlList = [...orphanUrls.values()].sort((a, b) => b.contributionCount - a.contributionCount)
    const orphanContributionCount = orphanUrlList.reduce((sum, row) => sum + row.contributionCount, 0)

    summary.totals.orphanAudiblePdContributions += orphanContributionCount
    summary.totals.orphanAudiblePdUrls += orphanUrlList.length

    const librarySummary = {
      libraryId: library.id,
      libraryName: library.name || '',
      suggestionsSeen: suggestions.length,
      audiblePdContributionsSeen,
      orphanAudiblePdContributions: orphanContributionCount,
      orphanAudiblePdUrls: orphanUrlList.length,
      backedAudiblePdContributionsSkipped,
      cleanedUrls: 0,
      remainingActiveAudiblePdContributions: 0,
      orphanExamples: orphanUrlList.slice(0, 25).map((row) => ({
        url: row.url,
        contributionCount: row.contributionCount,
        suggestions: row.suggestionIds.size,
        libraryItems: row.libraryItemIds.size,
        suggestedNames: [...row.suggestedNames].slice(0, 8),
        states: [...row.states]
      }))
    }

    if (!args.dryRun) {
      for (let index = 0; index < orphanUrlList.length; index += 1) {
        const row = orphanUrlList[index]
        await SeriesReviewManager.cleanupImportedArtifactsForSeriesSourceLink(library.id, { sourceSeriesUrl: row.url }, null)
        librarySummary.cleanedUrls += 1
        summary.totals.cleanupRuns += 1

        if (args.progressEvery > 0 && ((index + 1) % args.progressEvery === 0 || index === orphanUrlList.length - 1)) {
          process.stderr.write(
            `[repair_progress] ${library.name || library.id}: ${index + 1}/${orphanUrlList.length} orphan Audible /pd/ URLs cleaned\n`
          )
        }
      }
    }

    librarySummary.remainingActiveAudiblePdContributions = await countActiveAudiblePdContributionsForLibrary(library.id)
    summary.totals.remainingActiveAudiblePdContributions += librarySummary.remainingActiveAudiblePdContributions

    summary.libraries.push(librarySummary)
  }

  const rendered = `${JSON.stringify(summary, null, 2)}\n`
  if (args.outputJson) {
    Fs.writeFileSync(Path.resolve(args.outputJson), rendered)
  }
  process.stdout.write(rendered)
}

main().catch((error) => {
  process.stderr.write(`${error?.stack || error}\n`)
  process.exit(1)
})
