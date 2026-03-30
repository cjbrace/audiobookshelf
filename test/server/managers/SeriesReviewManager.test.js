const { expect } = require('chai')
const sinon = require('sinon')
const { Sequelize } = require('sequelize')

const Database = require('../../../server/Database')
const SeriesReviewManager = require('../../../server/managers/SeriesReviewManager')

describe('SeriesReviewManager', () => {
  let library
  let libraryFolder
  let user

  beforeEach(async () => {
    global.ServerSettings = {
      sortingPrefixes: []
    }
    Database.sequelize = new Sequelize({ dialect: 'sqlite', storage: ':memory:', logging: false })
    Database.sequelize.uppercaseFirst = (str) => (str ? `${str[0].toUpperCase()}${str.substr(1)}` : '')
    await Database.buildModels()

    library = await Database.libraryModel.create({ name: 'Series Review Library', mediaType: 'book' })
    libraryFolder = await Database.libraryFolderModel.create({ path: '/series-review', libraryId: library.id })
    user = await Database.userModel.create({
      username: 'series-review-admin',
      type: 'admin',
      pash: 'hash'
    })
  })

  afterEach(async () => {
    sinon.restore()
    await Database.sequelize.sync({ force: true })
  })

  async function createBookFixture({ title, currentSeries = [], relPath = null, tags = [], authors = [] }) {
    const book = await Database.bookModel.create({ title, audioFiles: [], tags, narrators: [], genres: [], chapters: [] })
    const libraryItem = await Database.libraryItemModel.create({
      path: `/series-review/${title}`,
      relPath: relPath || title,
      libraryFiles: [],
      mediaId: book.id,
      mediaType: 'book',
      libraryId: library.id,
      libraryFolderId: libraryFolder.id
    })

    for (const seriesEntry of currentSeries) {
      const series = await Database.seriesModel.findOrCreateByNameAndLibrary(seriesEntry.name, library.id)
      await Database.bookSeriesModel.create({
        bookId: book.id,
        seriesId: series.id,
        sequence: seriesEntry.sequence || null
      })
    }

    for (const authorName of authors) {
      const author = await Database.authorModel.findOrCreateByNameAndLibrary(authorName, library.id)
      await Database.bookAuthorModel.create({
        bookId: book.id,
        authorId: author.id
      })
    }

    return {
      book,
      libraryItem
    }
  }

  async function stubExpandedLibraryItems() {
    const originalGetExpandedById = Database.libraryItemModel.getExpandedById.bind(Database.libraryItemModel)
    sinon.stub(Database.libraryItemModel, 'getExpandedById').callsFake(async (libraryItemId) => {
      const expanded = await originalGetExpandedById(libraryItemId)
      expanded.saveMetadataFile = sinon.stub().resolves()
      return expanded
    })
  }

  it('groups multi-source suggestions onto one actionable row', async () => {
    const { libraryItem } = await createBookFixture({
      title: 'Summer Knight',
      relPath: 'Butcher, Jim/Summer Knight'
    })

    const result = await SeriesReviewManager.importSuggestionsForLibrary(library.id, [
      {
        libraryItemId: libraryItem.id,
        sourceSuggestions: [
          { source: 'fictiondb', seriesName: 'The Dresden Files', sequence: '4', confidence: 0.92 },
          { source: 'wikidata', seriesName: 'The Dresden Files', sequence: '4', confidence: 0.71 },
          { source: 'goodreads', noSeries: true, confidence: 0.2 }
        ]
      }
    ])

    expect(result.importedCount).to.equal(2)

    const rows = await SeriesReviewManager.getQueueForLibrary(library.id, true)
    expect(rows).to.have.length(1)
    expect(rows[0].suggestions).to.have.length(2)
    expect(rows[0].relPath).to.equal('Butcher, Jim/Summer Knight/')

    const actionableSuggestion = rows[0].suggestions.find((suggestion) => suggestion.kind === 'series')
    expect(actionableSuggestion.suggestedName).to.equal('The Dresden Files')
    expect(actionableSuggestion.suggestedSequence).to.equal('4')
    expect(actionableSuggestion.contributions.map((contribution) => contribution.source)).to.deep.equal(['fictiondb', 'wikidata'])

    const noSeriesSuggestion = rows[0].suggestions.find((suggestion) => suggestion.kind === 'no_series')
    expect(noSeriesSuggestion.contributions).to.have.length(1)
    expect(noSeriesSuggestion.contributions[0].source).to.equal('goodreads')
    expect(rows[0].suggestions[0].kind).to.equal('series')
    expect(actionableSuggestion.evidenceSummary.automatedAgreement).to.equal(true)
    expect(rows[0].conflictType).to.equal('no_series_conflict')
    expect(rows[0].conflictSummary).to.equal('Series vs no-series conflict')
  })

  it('surfaces the expected source title on grouped queue suggestions', async () => {
    const { libraryItem } = await createBookFixture({
      title: 'Summer Knight',
      relPath: 'Butcher, Jim/Summer Knight'
    })

    await SeriesReviewManager.importSuggestionsForLibrary(library.id, [
      {
        libraryItemId: libraryItem.id,
        sourceSuggestions: [
          {
            source: 'fictiondb',
            label: 'FDB',
            seriesName: 'The Dresden Files',
            sequence: '4',
            confidence: 0.98,
            rawEvidence: {
              localSeriesImport: {
                matchedEntryTitle: 'Summer Knight'
              }
            }
          }
        ]
      }
    ])

    const rows = await SeriesReviewManager.getQueueForLibrary(library.id, true)
    expect(rows).to.have.length(1)
    expect(rows[0].suggestions).to.have.length(1)
    expect(rows[0].suggestions[0].expectedTitle).to.equal('Summer Knight')
    expect(rows[0].suggestions[0].contributions[0].expectedTitle).to.equal('Summer Knight')
  })

  it('falls back to current catalog titles for older queue suggestions that lack stored expected titles', async () => {
    const { libraryItem } = await createBookFixture({
      title: 'The Ringworld Engineers',
      relPath: 'Niven, Larry/The Ringworld Engineers'
    })

    await Database.seriesReviewCatalogModel.create({
      libraryId: library.id,
      seriesName: 'Ringworld',
      seriesNameNormalized: 'ringworld',
      trustStatus: 'trusted',
      visibilityStatus: 'visible',
      entries: [
        {
          title: 'Ringworld',
          authors: ['Larry Niven'],
          sequenceLabel: '1',
          sources: [{ source: 'fictiondb', label: 'FDB', confidence: 0.96 }]
        },
        {
          title: 'The Ringworld Engineers',
          authors: ['Larry Niven'],
          sequenceLabel: '2',
          sources: [{ source: 'fictiondb', label: 'FDB', confidence: 0.96 }]
        }
      ],
      selectionBySlot: {}
    })

    await SeriesReviewManager.importSuggestionsForLibrary(library.id, [
      {
        libraryItemId: libraryItem.id,
        sourceSuggestions: [
          { source: 'fictiondb', label: 'FDB', seriesName: 'Ringworld', sequence: '2', confidence: 0.96 }
        ]
      }
    ])

    const rows = await SeriesReviewManager.getQueueForLibrary(library.id, true)
    expect(rows).to.have.length(1)
    expect(rows[0].suggestions[0].expectedTitle).to.equal('The Ringworld Engineers')
  })

  it('preserves audible and audnexus provenance as secondary support on grouped suggestions', async () => {
    const { libraryItem } = await createBookFixture({
      title: 'Leviathan Wakes',
      relPath: 'Corey, James S. A./Leviathan Wakes'
    })

    const result = await SeriesReviewManager.importSuggestionsForLibrary(library.id, [
      {
        libraryItemId: libraryItem.id,
        sourceSuggestions: [
          { source: 'fictiondb', label: 'FDB', seriesName: 'The Expanse', sequence: '1', confidence: 0.95, evidenceUrl: 'https://www.fictiondb.com/series/expanse~1234.htm' },
          {
            source: 'audible',
            label: 'AUD',
            seriesName: 'The Expanse',
            sequence: '1',
            confidence: 0.79,
            evidenceUrl: 'https://www.audible.com/pd/B00ABC1234',
            sourceRef: 'audible:us:B00ABC1234:audible',
            providerMeta: { provider_name: 'audible_audnexus', provider_version: '1.0.0', region_used: 'us' },
            rawEvidence: { source_ref: 'audible:us:B00ABC1234' }
          },
          {
            source: 'audnexus',
            label: 'ANX',
            seriesName: 'The Expanse',
            sequence: '1',
            confidence: 0.74,
            evidenceUrl: 'https://api.audnex.us/books/B00ABC1234?region=us',
            sourceRef: 'audible:us:B00ABC1234:audnexus',
            providerMeta: { provider_name: 'audible_audnexus', provider_version: '1.0.0', region_used: 'us' },
            rawEvidence: { source_ref: 'audible:us:B00ABC1234' }
          }
        ]
      }
    ])

    expect(result.importedCount).to.equal(1)

    const rows = await SeriesReviewManager.getQueueForLibrary(library.id, true)
    expect(rows).to.have.length(1)
    expect(rows[0].suggestions).to.have.length(1)
    const suggestion = rows[0].suggestions[0]
    expect(suggestion.suggestedName).to.equal('The Expanse')
    expect(suggestion.suggestedSequence).to.equal('1')

    const audibleContribution = suggestion.contributions.find((contribution) => contribution.source === 'audible')
    expect(audibleContribution).to.exist
    expect(audibleContribution.role).to.equal('automated_support')
    expect(audibleContribution.sourceRef).to.equal('audible:us:B00ABC1234:audible')
    expect(audibleContribution.providerMeta).to.include({ provider_name: 'audible_audnexus', region_used: 'us' })
    expect(audibleContribution.rawEvidence).to.deep.equal({ source_ref: 'audible:us:B00ABC1234' })

    const audnexusContribution = suggestion.contributions.find((contribution) => contribution.source === 'audnexus')
    expect(audnexusContribution).to.exist
    expect(audnexusContribution.role).to.equal('automated_support')
    expect(audnexusContribution.sourceRef).to.equal('audible:us:B00ABC1234:audnexus')

    expect(suggestion.evidenceSummary.hasPrimaryAutomatedSource).to.equal(true)
    expect(suggestion.evidenceSummary.hasSecondaryAutomatedSource).to.equal(false)
    expect(suggestion.evidenceSummary.automatedSecondarySupportCount).to.equal(2)
  })

  it('prioritizes automated agreement over manual-reference-only matches', async () => {
    const { libraryItem } = await createBookFixture({ title: 'A Memory Called Empire' })

    await SeriesReviewManager.importSuggestionsForLibrary(library.id, [
      {
        libraryItemId: libraryItem.id,
        sourceSuggestions: [
          { source: 'goodreads', label: 'GR', seriesName: 'Teixcalaan', sequence: '1', confidence: 0.44 },
          { source: 'librarything', label: 'LT', seriesName: 'Teixcalaan', sequence: '1', confidence: 0.39 },
          { source: 'fictiondb', label: 'FDB', seriesName: 'Teixcalaan', sequence: '1', confidence: 0.93 },
          { source: 'wikidata', label: 'WD', seriesName: 'Teixcalaan', sequence: '1', confidence: 0.61 },
          { source: 'goodreads', label: 'GR', seriesName: 'Teixcalaan Empire', sequence: '1', confidence: 0.31 }
        ]
      }
    ])

    const rows = await SeriesReviewManager.getQueueForLibrary(library.id, true)
    expect(rows).to.have.length(1)
    expect(rows[0].suggestions[0].suggestedName).to.equal('Teixcalaan')
    expect(rows[0].suggestions[0].evidenceSummary.automatedAgreement).to.equal(true)
    expect(rows[0].suggestions[0].evidenceSummary.manualReferenceCount).to.equal(2)
    expect(rows[0].suggestions[1].suggestedName).to.equal('Teixcalaan Empire')
    expect(rows[0].conflictType).to.equal('series_name_conflict')
  })

  it('orders queue rows by no-series then ordinal then series-name conflicts', async () => {
    const { libraryItem: noSeriesItem } = await createBookFixture({ title: 'Conflict A' })
    const { libraryItem: ordinalItem } = await createBookFixture({ title: 'Conflict B' })
    const { libraryItem: nameItem } = await createBookFixture({ title: 'Conflict C' })

    await SeriesReviewManager.importSuggestionsForLibrary(library.id, [
      {
        libraryItemId: noSeriesItem.id,
        sourceSuggestions: [
          { source: 'fictiondb', label: 'FDB', seriesName: 'Shared Saga', sequence: '1' },
          { source: 'goodreads', label: 'GR', noSeries: true }
        ]
      },
      {
        libraryItemId: ordinalItem.id,
        sourceSuggestions: [
          { source: 'fictiondb', label: 'FDB', seriesName: 'Ordered Saga', sequence: '1' },
          { source: 'wikidata', label: 'WD', seriesName: 'Ordered Saga', sequence: '2' }
        ]
      },
      {
        libraryItemId: nameItem.id,
        sourceSuggestions: [
          { source: 'fictiondb', label: 'FDB', seriesName: 'Name Saga', sequence: '1' },
          { source: 'wikidata', label: 'WD', seriesName: 'Alias Saga', sequence: '1' }
        ]
      }
    ])

    const rows = await SeriesReviewManager.getQueueForLibrary(library.id, true)
    expect(rows.map((row) => row.title)).to.deep.equal(['Conflict C', 'Conflict B', 'Conflict A'])
    expect(rows.map((row) => row.conflictType)).to.deep.equal(['series_name_conflict', 'ordinal_conflict', 'no_series_conflict'])
  })

  it('auto-links safely normalized current series matches and groups queue rows by series name', async () => {
    const { libraryItem: foundationItem } = await createBookFixture({
      title: 'A Title That Would Sort First',
      currentSeries: [{ name: 'Foundation', sequence: '1' }]
    })
    const { libraryItem: amberItem } = await createBookFixture({
      title: 'Z Title That Should Group First',
      currentSeries: [{ name: 'Amber', sequence: '1' }]
    })

    await SeriesReviewManager.importSuggestionsForLibrary(library.id, [
      {
        libraryItemId: foundationItem.id,
        sourceSuggestions: [{ source: 'fictiondb', label: 'FDB', seriesName: 'The Foundation Series', sequence: '1' }]
      },
      {
        libraryItemId: amberItem.id,
        sourceSuggestions: [{ source: 'fictiondb', label: 'FDB', seriesName: 'Amber series', sequence: '1' }]
      }
    ])

    const pendingRows = await SeriesReviewManager.getQueueForLibrary(library.id, false)
    expect(pendingRows).to.have.length(0)

    const decidedRows = await SeriesReviewManager.getQueueForLibrary(library.id, true)
    expect(decidedRows.map((row) => row.queueGroupName)).to.deep.equal(['Amber', 'Foundation'])
    expect(decidedRows[0].title).to.equal('Z Title That Should Group First')
    expect(decidedRows[0].suggestions[0].state).to.equal('linked')
    expect(decidedRows[0].suggestions[0].decisionAction).to.equal('assumed_link')
    expect(decidedRows[1].suggestions[0].state).to.equal('linked')
  })

  it('does not auto-link away source ordinal work when the local series has no ordinal', async () => {
    const { libraryItem } = await createBookFixture({
      title: 'Foundation',
      currentSeries: [{ name: 'Foundation', sequence: '' }]
    })

    await SeriesReviewManager.importSuggestionsForLibrary(library.id, [
      {
        libraryItemId: libraryItem.id,
        sourceSuggestions: [{ source: 'fictiondb', label: 'FDB', seriesName: 'The Foundation Series', sequence: '1' }]
      }
    ])

    const pendingRows = await SeriesReviewManager.getQueueForLibrary(library.id, false)
    expect(pendingRows).to.have.length(1)
    expect(pendingRows[0].suggestions[0].state).to.equal('pending')
    expect(pendingRows[0].suggestions[0].decisionAction).to.equal(null)

    const decidedRows = await SeriesReviewManager.getQueueForLibrary(library.id, true)
    expect(decidedRows).to.have.length(1)
    expect(decidedRows[0].suggestions[0].state).to.equal('pending')
  })

  it('resolves shared source URLs by local decision key instead of collapsing onto the first catalog', async () => {
    const sourceUrl = 'https://www.audible.co.uk/series/Discworld-Audiobooks/B000DISC'
    const firstCatalog = await Database.seriesReviewCatalogModel.create({
      libraryId: library.id,
      seriesName: 'Discworld',
      seriesNameNormalized: 'discworld',
      trustStatus: 'trusted',
      visibilityStatus: 'visible',
      entries: [
        {
          title: 'The Colour of Magic',
          sequenceLabel: '1',
          sources: [{ source: 'audible', label: 'AUD', confidence: 0.93, evidenceUrl: sourceUrl }]
        }
      ],
      selectionBySlot: {}
    })
    const secondCatalog = await Database.seriesReviewCatalogModel.create({
      libraryId: library.id,
      seriesName: 'Discworld (Full Cast)',
      seriesNameNormalized: 'discworld full cast',
      trustStatus: 'trusted',
      visibilityStatus: 'visible',
      entries: [
        {
          title: 'The Colour of Magic',
          sequenceLabel: '1',
          sources: [{ source: 'audible', label: 'AUD', confidence: 0.93, evidenceUrl: sourceUrl }]
        }
      ],
      selectionBySlot: {}
    })
    await Database.seriesReviewSeriesSourceLinkModel.create({
      libraryId: library.id,
      localDecisionKey: 'discworld',
      localSeriesName: 'Discworld',
      source: 'audible',
      sourceSeriesName: 'Discworld',
      sourceSeriesUrl: sourceUrl,
      coverageStatus: 'linked',
      linkedBookCount: 1,
      totalBookCount: 1,
      importStatus: 'imported',
      evidenceSnapshot: {}
    })
    await Database.seriesReviewSeriesSourceLinkModel.create({
      libraryId: library.id,
      localDecisionKey: 'discworld full cast',
      localSeriesName: 'Discworld (Full Cast)',
      source: 'audible',
      sourceSeriesName: 'Discworld',
      sourceSeriesUrl: sourceUrl,
      coverageStatus: 'linked',
      linkedBookCount: 1,
      totalBookCount: 1,
      importStatus: 'imported',
      evidenceSnapshot: {}
    })

    const resolvedFirst = await SeriesReviewManager.getResolvedCatalogIdForLocalDecisionKey(library.id, 'discworld')
    const resolvedSecond = await SeriesReviewManager.getResolvedCatalogIdForLocalDecisionKey(library.id, 'discworld full cast')

    expect(resolvedFirst).to.equal(firstCatalog.id)
    expect(resolvedSecond).to.equal(secondCatalog.id)
  })

  it('creates a new placeholder catalog that still supports empty manual lookup/import context', async () => {
    const detail = await SeriesReviewManager.createCatalogPlaceholderForLibrary(library.id, 'Discworld (Full Cast)')
    expect(detail.catalog.seriesName).to.equal('Discworld (Full Cast)')
    expect(detail.catalog.displayBucket).to.equal('new')
    expect(detail.localBooks).to.deep.equal([])

    const context = await SeriesReviewManager.buildManualLookupContextForCatalog(library.id, detail.catalog.id)
    expect(context.localSeriesName).to.equal('Discworld (Full Cast)')
    expect(context.localDecisionKey).to.equal('discworld full cast')
    expect(context.localBooks).to.deep.equal([])

    await Database.seriesReviewSeriesSourceLinkModel.create({
      libraryId: library.id,
      localDecisionKey: 'discworld full cast',
      localSeriesName: 'Discworld (Full Cast)',
      source: 'audible',
      sourceSeriesName: 'Discworld',
      sourceSeriesUrl: 'https://www.audible.co.uk/series/Discworld-Audiobooks/B000DISC',
      coverageStatus: 'partial',
      linkedBookCount: 0,
      totalBookCount: 0,
      importStatus: 'pending',
      evidenceSnapshot: {}
    })

    const matches = await SeriesReviewManager.buildLocalSeriesMatchImportPayloadForLibrary(library.id, [
      {
        matchId: (await Database.seriesReviewSeriesSourceLinkModel.findOne()).id,
        includedLibraryItemIds: []
      }
    ])

    expect(matches).to.have.length(1)
    expect(matches[0].localSeriesName).to.equal('Discworld (Full Cast)')
    expect(matches[0].books).to.deep.equal([])
  })

  it('aliases one suggestion to another primary and collapses the queue back to the primary name', async () => {
    const { libraryItem } = await createBookFixture({
      title: 'Wyrd Sisters'
    })

    await SeriesReviewManager.importSuggestionsForLibrary(library.id, [
      {
        libraryItemId: libraryItem.id,
        sourceSuggestions: [
          { source: 'fictiondb', label: 'FDB', seriesName: 'Discworld - Witches', sequence: '2' },
          { source: 'wikidata', label: 'WD', seriesName: 'Witches', sequence: '2' }
        ]
      }
    ])

    const beforeAlias = await SeriesReviewManager.getQueueForLibrary(library.id, true)
    const primarySuggestion = beforeAlias[0].suggestions.find((suggestion) => suggestion.suggestedName === 'Witches')
    const aliasSuggestion = beforeAlias[0].suggestions.find((suggestion) => suggestion.suggestedName === 'Discworld - Witches')

    await SeriesReviewManager.aliasSuggestion(aliasSuggestion.id, primarySuggestion.id, user.id)

    const afterAlias = await SeriesReviewManager.getQueueForLibrary(library.id, true)
    expect(afterAlias).to.have.length(1)
    expect(afterAlias[0].suggestions).to.have.length(1)
    expect(afterAlias[0].suggestions[0].suggestedName).to.equal('Witches')
    expect(afterAlias[0].suggestions[0].contributions.map((contribution) => contribution.seriesName)).to.deep.equal(['Discworld - Witches', 'Witches'])
  })

  it('renames a suggested series, updates existing ABS series rows, and recanonicalizes catalogs', async () => {
    const { libraryItem: sourceItem } = await createBookFixture({
      title: 'Dragon Keeper',
      currentSeries: [{ name: 'The Rain Wild Chronicles', sequence: '1' }]
    })
    await createBookFixture({
      title: 'Dragon Haven',
      currentSeries: [{ name: 'Rain Wilds Chronicles', sequence: '2' }]
    })
    await stubExpandedLibraryItems()

    const importResult = await SeriesReviewManager.importCatalogForLibrary(library.id, [
      {
        seriesName: 'The Rain Wild Chronicles',
        entries: [
          {
            title: 'Dragon Keeper',
            sequence: '1',
            sources: [{ source: 'fictiondb', label: 'FDB', confidence: 0.95 }]
          }
        ]
      }
    ])

    await SeriesReviewManager.importSuggestionsForLibrary(library.id, [
      {
        libraryItemId: sourceItem.id,
        sourceSuggestions: [{ source: 'fictiondb', label: 'FDB', seriesName: 'The Rain Wild Chronicles', sequence: '1' }]
      }
    ])

    const initialRows = await SeriesReviewManager.getQueueForLibrary(library.id, true)
    await SeriesReviewManager.renameSuggestion(initialRows[0].suggestions[0].id, 'Rain Wilds Chronicles', user.id)

    const updatedSourceItem = await Database.libraryItemModel.getExpandedById(sourceItem.id)
    expect(updatedSourceItem.media.series.map((series) => `${series.name}#${series.bookSeries.sequence || ''}`)).to.deep.equal(['Rain Wilds Chronicles#1'])

    const catalogs = await SeriesReviewManager.getCatalogsForLibrary(library.id, true)
    expect(catalogs.map((catalog) => catalog.seriesName)).to.deep.equal(['Rain Wilds Chronicles'])

    const updatedDetail = await SeriesReviewManager.getCatalogDetailForLibrary(library.id, importResult.catalogs[0].id)
    expect(updatedDetail.catalog.seriesName).to.equal('Rain Wilds Chronicles')
  })

  it('renames a catalog into an existing target catalog without tripping the unique catalog key', async () => {
    await createBookFixture({
      title: 'The Joiner King',
      currentSeries: [{ name: 'Dark Nest', sequence: '1' }]
    })
    await stubExpandedLibraryItems()

    const sourceImport = await SeriesReviewManager.importCatalogForLibrary(library.id, [
      {
        seriesName: 'Dark Nest',
        entries: [
          {
            title: 'The Joiner King',
            sequence: '1',
            sources: [{ source: 'fictiondb', label: 'FDB', confidence: 0.95 }]
          }
        ]
      }
    ])
    await SeriesReviewManager.importCatalogForLibrary(library.id, [
      {
        seriesName: 'Star Wars: Dark Nest',
        entries: [
          {
            title: 'The Unseen Queen',
            sequence: '2',
            sources: [{ source: 'wikidata', label: 'WD', confidence: 0.8 }]
          }
        ]
      }
    ])

    const result = await SeriesReviewManager.renameCatalogForLibrary(library.id, sourceImport.catalogs[0].id, 'Star Wars: Dark Nest', user.id)

    expect(result.detail.catalog.seriesName).to.equal('Star Wars: Dark Nest')

    const catalogs = await Database.seriesReviewCatalogModel.findAll({
      where: { libraryId: library.id },
      order: [['seriesName', 'ASC']]
    })
    expect(catalogs.map((catalog) => catalog.seriesName)).to.deep.equal(['Star Wars: Dark Nest'])
    expect((catalogs[0].entries || []).map((entry) => `${entry.title}#${entry.sequence || entry.sequenceLabel || ''}`)).to.deep.equal([
      'The Joiner King#1',
      'The Unseen Queen#2'
    ])
  })

  it('marks mixed local label groups as normalized worklist items', async () => {
    await createBookFixture({
      title: 'Rivers One',
      currentSeries: [{ name: 'Rivers of London Series', sequence: '1' }]
    })
    await createBookFixture({
      title: 'Rivers Two',
      currentSeries: [{ name: 'Rivers of London', sequence: '2' }]
    })

    const catalogs = await SeriesReviewManager.getCatalogsForLibrary(library.id, true)
    expect(catalogs).to.have.length(1)
    expect(catalogs[0].displayBucket).to.equal('normalized')
    expect(catalogs[0].baseDisplayBucket).to.equal('local_only')
    expect(catalogs[0].hasNormalizationIssue).to.equal(true)
    expect(catalogs[0].normalizationSeriesNames).to.deep.equal(['Rivers of London', 'Rivers of London Series'])
    expect(catalogs[0].normalizationTargetName).to.equal('Rivers of London')
  })

  it('normalizes mixed local label groups to the heading series name', async () => {
    const { libraryItem: firstItem } = await createBookFixture({
      title: 'Rivers One',
      currentSeries: [{ name: 'Rivers of London Series', sequence: '1' }]
    })
    const { libraryItem: secondItem } = await createBookFixture({
      title: 'Rivers Two',
      currentSeries: [{ name: 'Rivers of London', sequence: '2' }]
    })
    const { libraryItem: duplicateItem } = await createBookFixture({
      title: 'Rivers Three',
      currentSeries: [
        { name: 'Rivers of London', sequence: '3' },
        { name: 'Rivers of London Series', sequence: '3' }
      ]
    })
    await stubExpandedLibraryItems()

    const catalogId = SeriesReviewManager.buildLocalOnlyCatalogId('rivers of london')
    const result = await SeriesReviewManager.normalizeCatalogSeriesNameForLibrary(library.id, catalogId, user.id)

    expect(result.changedCount).to.equal(2)
    expect(result.conflictCount).to.equal(0)
    expect(result.detail.catalog.hasNormalizationIssue).to.equal(false)

    const updatedFirst = await Database.libraryItemModel.getExpandedById(firstItem.id)
    expect(updatedFirst.media.series.map((series) => `${series.name}#${series.bookSeries.sequence || ''}`)).to.deep.equal(['Rivers of London#1'])

    const updatedSecond = await Database.libraryItemModel.getExpandedById(secondItem.id)
    expect(updatedSecond.media.series.map((series) => `${series.name}#${series.bookSeries.sequence || ''}`)).to.deep.equal(['Rivers of London#2'])

    const updatedDuplicate = await Database.libraryItemModel.getExpandedById(duplicateItem.id)
    expect(updatedDuplicate.media.series.map((series) => `${series.name}#${series.bookSeries.sequence || ''}`)).to.deep.equal(['Rivers of London#3'])
  })

  it('lets explicit rename override an older target alias mapping', async () => {
    await SeriesReviewManager.upsertSeriesNameControlForLibrary(library.id, user.id, 'Star Wars: Dark Nest', 'Dark Nest', 'alias')
    await createBookFixture({
      title: 'The Joiner King',
      currentSeries: [{ name: 'Dark Nest', sequence: '1' }]
    })
    await stubExpandedLibraryItems()

    const importResult = await SeriesReviewManager.importCatalogForLibrary(library.id, [
      {
        seriesName: 'Dark Nest',
        entries: [
          {
            title: 'The Joiner King',
            sequence: '1',
            sources: [{ source: 'fictiondb', label: 'FDB', confidence: 0.95 }]
          }
        ]
      }
    ])

    const result = await SeriesReviewManager.renameCatalogForLibrary(library.id, importResult.catalogs[0].id, 'Star Wars: Dark Nest', user.id)
    expect(result.detail.catalog.seriesName).to.equal('Star Wars: Dark Nest')

    const catalogs = await SeriesReviewManager.getCatalogsForLibrary(library.id, true)
    expect(catalogs.map((catalog) => catalog.seriesName)).to.deep.equal(['Star Wars: Dark Nest'])
  })

  it('keeps an aliased surviving suggestion under the renamed canonical label', async () => {
    const { libraryItem } = await createBookFixture({
      title: 'Wyrd Sisters'
    })

    await SeriesReviewManager.importSuggestionsForLibrary(library.id, [
      {
        libraryItemId: libraryItem.id,
        sourceSuggestions: [
          { source: 'fictiondb', label: 'FDB', seriesName: 'Discworld - Witches', sequence: '2' },
          { source: 'wikidata', label: 'WD', seriesName: 'Witches', sequence: '2' }
        ]
      }
    ])

    let rows = await SeriesReviewManager.getQueueForLibrary(library.id, true)
    const primarySuggestion = rows[0].suggestions.find((suggestion) => suggestion.suggestedName === 'Witches')
    const aliasSuggestion = rows[0].suggestions.find((suggestion) => suggestion.suggestedName === 'Discworld - Witches')

    await SeriesReviewManager.aliasSuggestion(aliasSuggestion.id, primarySuggestion.id, user.id)

    rows = await SeriesReviewManager.getQueueForLibrary(library.id, true)
    expect(rows[0].suggestions).to.have.length(1)

    await SeriesReviewManager.renameSuggestion(rows[0].suggestions[0].id, 'The Witches Arc', user.id)

    rows = await SeriesReviewManager.getQueueForLibrary(library.id, true)
    expect(rows).to.have.length(1)
    expect(rows[0].suggestions).to.have.length(1)
    expect(rows[0].suggestions[0].suggestedName).to.equal('The Witches Arc')
    expect(rows[0].suggestions[0].contributions.map((contribution) => contribution.seriesName)).to.deep.equal(['Discworld - Witches', 'Witches'])
  })

  it('blocks rename auto-merge when the target label would create conflicting local coverage', async () => {
    const { libraryItem } = await createBookFixture({
      title: 'Problem Book',
      currentSeries: [
        { name: 'The Rain Wild Chronicles', sequence: '1' },
        { name: 'Rain Wilds Chronicles', sequence: '2' }
      ]
    })
    await stubExpandedLibraryItems()

    await SeriesReviewManager.importSuggestionsForLibrary(library.id, [
      {
        libraryItemId: libraryItem.id,
        sourceSuggestions: [{ source: 'fictiondb', label: 'FDB', seriesName: 'The Rain Wild Chronicles', sequence: '1' }]
      }
    ])

    const rows = await SeriesReviewManager.getQueueForLibrary(library.id, true)
    let failure = null
    try {
      await SeriesReviewManager.renameSuggestion(rows[0].suggestions[0].id, 'Rain Wilds Chronicles', user.id)
    } catch (error) {
      failure = error
    }
    expect(String(failure?.message || failure)).to.equal('Rename would create conflicting local coverage; resolve it manually in Series Management first')
  })

  it('unlinks an auto-linked suggestion and moves it back into pending review', async () => {
    const { libraryItem } = await createBookFixture({
      title: 'Foundation',
      currentSeries: [{ name: 'Foundation', sequence: '1' }]
    })
    await stubExpandedLibraryItems()

    await SeriesReviewManager.importSuggestionsForLibrary(library.id, [
      {
        libraryItemId: libraryItem.id,
        sourceSuggestions: [{ source: 'fictiondb', label: 'FDB', seriesName: 'The Foundation Series', sequence: '1' }]
      }
    ])

    const decidedRows = await SeriesReviewManager.getQueueForLibrary(library.id, true)
    const suggestion = decidedRows[0].suggestions[0]
    expect(suggestion.state).to.equal('linked')

    await SeriesReviewManager.unlinkSuggestion(suggestion.id, user.id)

    const updatedLibraryItem = await Database.libraryItemModel.getExpandedById(libraryItem.id)
    expect(updatedLibraryItem.media.series).to.have.length(0)

    const pendingRows = await SeriesReviewManager.getQueueForLibrary(library.id, false)
    expect(pendingRows).to.have.length(1)
    expect(pendingRows[0].suggestions[0].state).to.equal('pending')
    expect(pendingRows[0].suggestions[0].suggestedName).to.equal('The Foundation Series')
  })

  it('adds a suggestion alongside existing series and persists the applied decision across reimport', async () => {
    const { libraryItem } = await createBookFixture({
      title: 'The Rhesus Chart',
      currentSeries: [{ name: 'Laundry Files', sequence: '5' }]
    })
    await stubExpandedLibraryItems()

    await SeriesReviewManager.importSuggestionsForLibrary(library.id, [
      {
        libraryItemId: libraryItem.id,
        sourceSuggestions: [{ source: 'fictiondb', seriesName: 'A Laundry File', sequence: '5' }]
      }
    ])

    const initialRows = await SeriesReviewManager.getQueueForLibrary(library.id, true)
    const suggestion = initialRows[0].suggestions[0]

    await SeriesReviewManager.applySuggestion(suggestion.id, user.id, 'add')

    const updatedLibraryItem = await Database.libraryItemModel.getExpandedById(libraryItem.id)
    expect(updatedLibraryItem.media.series.map((series) => series.name).sort()).to.deep.equal(['A Laundry File', 'Laundry Files'])
    expect(updatedLibraryItem.media.tags).to.include('-series-edit')

    await SeriesReviewManager.importSuggestionsForLibrary(library.id, [
      {
        libraryItemId: libraryItem.id,
        sourceSuggestions: [{ source: 'fictiondb', seriesName: 'A Laundry File', sequence: '5' }]
      }
    ])

    const decidedRows = await SeriesReviewManager.getQueueForLibrary(library.id, true)
    expect(decidedRows[0].suggestions[0].state).to.equal('linked')
    expect(decidedRows[0].suggestions[0].decisionAction).to.equal('assumed_link')
    const pendingRows = await SeriesReviewManager.getQueueForLibrary(library.id, false)
    expect(pendingRows).to.have.length(0)
  })

  it('replaces the clicked current series entry and records a manual override state', async () => {
    const { libraryItem } = await createBookFixture({
      title: 'Echoes of Honor',
      currentSeries: [
        { name: 'Honor Harrington', sequence: '8' },
        { name: 'Honorverse', sequence: '2' }
      ]
    })
    await stubExpandedLibraryItems()

    await SeriesReviewManager.importSuggestionsForLibrary(library.id, [
      {
        libraryItemId: libraryItem.id,
        sourceSuggestions: [{ source: 'fictiondb', seriesName: 'Honor Harrington Universe', sequence: '8' }]
      }
    ])

    const rows = await SeriesReviewManager.getQueueForLibrary(library.id, true)
    const suggestion = rows[0].suggestions[0]
    const replaceSeriesId = rows[0].currentSeries.find((series) => series.name === 'Honor Harrington').id

    await SeriesReviewManager.applySuggestion(suggestion.id, user.id, 'replace', replaceSeriesId)

    const updatedLibraryItem = await Database.libraryItemModel.getExpandedById(libraryItem.id)
    expect(updatedLibraryItem.media.series.map((series) => series.name).sort()).to.deep.equal(['Honor Harrington Universe', 'Honorverse'])
    expect(updatedLibraryItem.media.tags).to.include('-series-edit')

    const decidedRows = await SeriesReviewManager.getQueueForLibrary(library.id, true)
    expect(decidedRows[0].suggestions[0].state).to.equal('manual_override')
    expect(decidedRows[0].suggestions[0].decisionSeriesId).to.equal(replaceSeriesId)
  })

  it('persists dismiss decisions so reruns do not reopen the suggestion', async () => {
    const { libraryItem } = await createBookFixture({ title: 'Ascendant', tags: ['existing-tag'] })

    await SeriesReviewManager.importSuggestionsForLibrary(library.id, [
      {
        libraryItemId: libraryItem.id,
        sourceSuggestions: [{ source: 'fictiondb', seriesName: 'Ascendant', sequence: '1' }]
      }
    ])

    const initialRows = await SeriesReviewManager.getQueueForLibrary(library.id, true)
    const suggestionId = initialRows[0].suggestions[0].id
    await SeriesReviewManager.dismissSuggestion(suggestionId, user.id)

    await SeriesReviewManager.importSuggestionsForLibrary(library.id, [
      {
        libraryItemId: libraryItem.id,
        sourceSuggestions: [{ source: 'fictiondb', seriesName: 'Ascendant', sequence: '1' }]
      }
    ])

    const decidedRows = await SeriesReviewManager.getQueueForLibrary(library.id, true)
    expect(decidedRows[0].suggestions[0].state).to.equal('dismissed')

    const pendingRows = await SeriesReviewManager.getQueueForLibrary(library.id, false)
    expect(pendingRows).to.have.length(0)

    const updatedLibraryItem = await Database.libraryItemModel.getExpandedById(libraryItem.id)
    expect(updatedLibraryItem.media.tags).to.deep.equal(['existing-tag'])
  })

  it('reopens a decided suggestion when the grouped source evidence changes meaningfully', async () => {
    const { libraryItem } = await createBookFixture({
      title: 'Ancillary Justice',
      tags: ['-series-edit']
    })

    await SeriesReviewManager.importSuggestionsForLibrary(library.id, [
      {
        libraryItemId: libraryItem.id,
        sourceSuggestions: [{ source: 'fictiondb', label: 'FDB', seriesName: 'Imperial Radch', sequence: '1', confidence: 0.91 }]
      }
    ])

    const initialRows = await SeriesReviewManager.getQueueForLibrary(library.id, true)
    const suggestionId = initialRows[0].suggestions[0].id
    await SeriesReviewManager.dismissSuggestion(suggestionId, user.id)

    await SeriesReviewManager.importSuggestionsForLibrary(library.id, [
      {
        libraryItemId: libraryItem.id,
        sourceSuggestions: [
          { source: 'fictiondb', label: 'FDB', seriesName: 'Imperial Radch', sequence: '1', confidence: 0.91 },
          { source: 'wikidata', label: 'WD', seriesName: 'Imperial Radch', sequence: '1', confidence: 0.67, notes: 'Second agreeing source' }
        ]
      }
    ])

    const pendingRows = await SeriesReviewManager.getQueueForLibrary(library.id, false)
    expect(pendingRows).to.have.length(1)
    expect(pendingRows[0].hasPreviousSeriesEdit).to.equal(true)
    expect(pendingRows[0].seriesEditTag).to.equal('-series-edit')
    expect(pendingRows[0].suggestions[0].state).to.equal('pending')
    expect(pendingRows[0].suggestions[0].previousDecision).to.include({
      action: 'dismiss',
      reopened: true
    })
    expect(pendingRows[0].suggestions[0].hasMeaningfulUpdateSinceDecision).to.equal(true)
    expect(pendingRows[0].suggestions[0].evidenceSummary).to.include({
      supportCount: 2,
      conflictCount: 0,
      disagreement: false
    })
  })

  it('does not reopen a dismissed suggestion for cosmetic evidence-only changes', async () => {
    const { libraryItem } = await createBookFixture({
      title: 'Ancillary Justice'
    })

    await SeriesReviewManager.importSuggestionsForLibrary(library.id, [
      {
        libraryItemId: libraryItem.id,
        sourceSuggestions: [
          {
            source: 'fictiondb',
            label: 'FDB',
            seriesName: 'Imperial Radch',
            sequence: '1',
            confidence: 0.91,
            expectedTitle: 'Ancillary Justice',
            notes: 'Original source note',
            providerMeta: { source_version: '1' }
          }
        ]
      }
    ])

    const initialRows = await SeriesReviewManager.getQueueForLibrary(library.id, true)
    const suggestionId = initialRows[0].suggestions[0].id
    await SeriesReviewManager.dismissSuggestion(suggestionId, user.id)

    await SeriesReviewManager.importSuggestionsForLibrary(library.id, [
      {
        libraryItemId: libraryItem.id,
        sourceSuggestions: [
          {
            source: 'fictiondb',
            label: 'FDB',
            seriesName: 'Imperial Radch',
            sequence: '1',
            confidence: 0.98,
            expectedTitle: 'Ancillary Justice (Updated)',
            notes: 'Updated source note',
            providerMeta: { source_version: '2' }
          }
        ]
      }
    ])

    const pendingRows = await SeriesReviewManager.getQueueForLibrary(library.id, false)
    expect(pendingRows).to.have.length(0)

    const decidedRows = await SeriesReviewManager.getQueueForLibrary(library.id, true)
    expect(decidedRows).to.have.length(1)
    expect(decidedRows[0].suggestions[0].state).to.equal('dismissed')
    expect(decidedRows[0].suggestions[0].hasMeaningfulUpdateSinceDecision).to.equal(false)
  })

  it('keeps matched applied rows out of pending review after later source refreshes', async () => {
    const { libraryItem } = await createBookFixture({ title: 'Leviathan Wakes' })
    await stubExpandedLibraryItems()

    await SeriesReviewManager.importSuggestionsForLibrary(library.id, [
      {
        libraryItemId: libraryItem.id,
        sourceSuggestions: [{ source: 'fictiondb', label: 'FDB', seriesName: 'The Expanse', sequence: '1', confidence: 0.93 }]
      }
    ])

    const initialRows = await SeriesReviewManager.getQueueForLibrary(library.id, true)
    const suggestionId = initialRows[0].suggestions[0].id
    await SeriesReviewManager.applySuggestion(suggestionId, user.id, 'add')

    await SeriesReviewManager.importSuggestionsForLibrary(library.id, [
      {
        libraryItemId: libraryItem.id,
        sourceSuggestions: [{ source: 'fictiondb', label: 'FDB', seriesName: 'The Expanse', sequence: '1', confidence: 0.81, notes: 'Lower confidence after source refresh' }]
      }
    ])

    const pendingRows = await SeriesReviewManager.getQueueForLibrary(library.id, false)
    expect(pendingRows).to.have.length(0)

    const decidedRows = await SeriesReviewManager.getQueueForLibrary(library.id, true)
    expect(decidedRows).to.have.length(1)
    expect(decidedRows[0].suggestions[0].state).to.equal('linked')
    expect(decidedRows[0].suggestions[0].decisionAction).to.equal('assumed_link')
    expect(decidedRows[0].suggestions[0].contributions[0].notes).to.equal('Lower confidence after source refresh')
  })

  it('removes a selected current series entry and adds the temp series-edit tag', async () => {
    const { libraryItem } = await createBookFixture({
      title: 'Shards of Honor',
      currentSeries: [
        { name: 'Vorkosigan Saga', sequence: '1' },
        { name: 'Cordelia', sequence: '1' }
      ]
    })
    await stubExpandedLibraryItems()

    const initialLibraryItem = await Database.libraryItemModel.getExpandedById(libraryItem.id)
    const seriesToRemove = initialLibraryItem.media.series.find((series) => series.name === 'Cordelia')

    await SeriesReviewManager.removeSeriesEntry(libraryItem.id, seriesToRemove.id)

    const updatedLibraryItem = await Database.libraryItemModel.getExpandedById(libraryItem.id)
    expect(updatedLibraryItem.media.series.map((series) => series.name)).to.deep.equal(['Vorkosigan Saga'])
    expect(updatedLibraryItem.media.tags).to.include('-series-edit')
  })

  it('hard resets stored suggestions so an identical dismissed suggestion can return as pending', async () => {
    const { libraryItem } = await createBookFixture({ title: '84K' })

    await SeriesReviewManager.importSuggestionsForLibrary(library.id, [
      {
        libraryItemId: libraryItem.id,
        sourceSuggestions: [
          { source: 'fictiondb', label: 'FDB', seriesName: '84K Sequence', sequence: '1' },
          { source: 'goodreads', label: 'GR', seriesName: '84K Sequence', sequence: '1' }
        ]
      }
    ])

    const initialRows = await SeriesReviewManager.getQueueForLibrary(library.id, true)
    const suggestionId = initialRows[0].suggestions[0].id
    await SeriesReviewManager.dismissSuggestion(suggestionId, user.id)

    const resetResult = await SeriesReviewManager.resetSuggestionsForLibrary(library.id, [libraryItem.id])
    expect(resetResult.deletedCount).to.equal(1)

    await SeriesReviewManager.importSuggestionsForLibrary(library.id, [
      {
        libraryItemId: libraryItem.id,
        sourceSuggestions: [
          { source: 'fictiondb', label: 'FDB', seriesName: '84K Sequence', sequence: '1' },
          { source: 'goodreads', label: 'GR', seriesName: '84K Sequence', sequence: '1' }
        ]
      }
    ])

    const pendingRows = await SeriesReviewManager.getQueueForLibrary(library.id, false)
    expect(pendingRows).to.have.length(1)
    expect(pendingRows[0].title).to.equal('84K')
    expect(pendingRows[0].suggestions[0].state).to.equal('pending')
  })

  it('suggests obvious duplicate series groups and prefers the simpler target label', async () => {
    await createBookFixture({
      title: 'Skylark Three',
      currentSeries: [{ name: 'Skylark', sequence: '3' }]
    })
    await createBookFixture({
      title: 'Skylark of Space',
      currentSeries: [{ name: 'Skylark (Smith)', sequence: '1' }]
    })

    const candidates = await SeriesReviewManager.getSeriesManagementCandidatesForLibrary(library.id)
    expect(candidates).to.have.length(1)
    expect(candidates[0].labels.map((label) => label.name)).to.deep.equal(['Skylark', 'Skylark (Smith)'])
    expect(candidates[0].suggestedTargetLabel).to.equal('Skylark')
    expect(candidates[0].score).to.equal(88)
  })

  it('broadens duplicate candidates slightly for leading article variants', async () => {
    await createBookFixture({
      title: 'Dauntless',
      currentSeries: [{ name: 'The Lost Fleet', sequence: '1' }]
    })
    await createBookFixture({
      title: 'Fearless',
      currentSeries: [{ name: 'Lost Fleet', sequence: '2' }]
    })

    const candidates = await SeriesReviewManager.getSeriesManagementCandidatesForLibrary(library.id)
    expect(candidates).to.have.length(1)
    expect(candidates[0].labels.map((label) => label.name)).to.deep.equal(['Lost Fleet', 'The Lost Fleet'])
    expect(candidates[0].score).to.equal(72)
  })

  it('previews, applies, and reverts a safe series management action', async () => {
    const { libraryItem: targetItem } = await createBookFixture({
      title: 'Skylark Three',
      currentSeries: [{ name: 'Skylark', sequence: '3' }]
    })
    const { libraryItem: sourceItem } = await createBookFixture({
      title: 'Skylark of Space',
      currentSeries: [{ name: 'Skylark (Smith)', sequence: '1' }]
    })
    await stubExpandedLibraryItems()

    const candidates = await SeriesReviewManager.getSeriesManagementCandidatesForLibrary(library.id)
    const sourceSeriesIds = candidates[0].labels.map((label) => label.id)

    const preview = await SeriesReviewManager.previewSeriesManagementAction(library.id, sourceSeriesIds, 'Skylark')
    expect(preview.changedCount).to.equal(1)
    expect(preview.conflictCount).to.equal(0)
    expect(preview.books[0].title).to.equal('Skylark of Space')

    const applyResult = await SeriesReviewManager.applySeriesManagementAction(library.id, user.id, sourceSeriesIds, 'Skylark', [sourceItem.id])
    expect(applyResult.changedCount).to.equal(1)
    expect(applyResult.action.targetLabel).to.equal('Skylark')

    const updatedSourceItem = await Database.libraryItemModel.getExpandedById(sourceItem.id)
    expect(updatedSourceItem.media.series.map((series) => `${series.name}#${series.bookSeries.sequence || ''}`)).to.deep.equal(['Skylark#1'])
    expect(updatedSourceItem.media.tags).to.include('-series-edit')

    const revertResult = await SeriesReviewManager.revertSeriesManagementAction(applyResult.action.id, user.id)
    expect(revertResult.reverted).to.equal(1)
    expect(revertResult.failed).to.equal(0)

    const revertedSourceItem = await Database.libraryItemModel.getExpandedById(sourceItem.id)
    expect(revertedSourceItem.media.series.map((series) => `${series.name}#${series.bookSeries.sequence || ''}`)).to.deep.equal(['Skylark (Smith)#1'])
    const untouchedTargetItem = await Database.libraryItemModel.getExpandedById(targetItem.id)
    expect(untouchedTargetItem.media.series.map((series) => `${series.name}#${series.bookSeries.sequence || ''}`)).to.deep.equal(['Skylark#3'])
  })

  it('imports trusted catalog rows and summarizes missing/disputed slots', async () => {
    await createBookFixture({
      title: 'Leviathan Wakes',
      currentSeries: [{ name: 'The Expanse', sequence: '1' }]
    })
    await createBookFixture({
      title: 'Caliban\'s War',
      currentSeries: [{ name: 'The Expanse', sequence: '2' }]
    })

    const importResult = await SeriesReviewManager.importCatalogForLibrary(library.id, [
      {
        seriesName: 'The Expanse',
        trustStatus: 'trusted',
        entries: [
          {
            title: 'Leviathan Wakes',
            sequence: '1',
            publishedDate: 'Jun-2011',
            sources: [{ source: 'fictiondb', label: 'FDB', confidence: 0.95 }]
          },
          {
            title: 'Caliban\'s War',
            sequence: '2',
            sources: [{ source: 'fictiondb', label: 'FDB', confidence: 0.94 }]
          },
          {
            title: 'Abaddon\'s Gate',
            sequence: '3',
            sources: [{ source: 'fictiondb', label: 'FDB', confidence: 0.93 }]
          },
          {
            title: 'Persepolis Rising',
            sequence: '7',
            sources: [{ source: 'fictiondb', label: 'FDB', confidence: 0.88 }]
          }
        ]
      }
    ])

    expect(importResult.importedCount).to.equal(1)
    expect(importResult.createdCount).to.equal(1)
    expect(importResult.updatedCount).to.equal(0)

    const catalogs = await SeriesReviewManager.getCatalogsForLibrary(library.id)
    expect(catalogs).to.have.length(1)
    expect(catalogs[0].seriesName).to.equal('The Expanse')
    expect(catalogs[0].missingCount).to.equal(5)
    expect(catalogs[0].displayBucket).to.equal('trusted')
  })

  it('includes local-only series in the catalog list and builds non-dismissible local detail without invented gaps', async () => {
    await createBookFixture({
      title: 'Alpha Start',
      currentSeries: [{ name: 'Alpha Saga', sequence: '1' }],
      authors: ['Author A']
    })
    await createBookFixture({
      title: 'Alpha Return',
      currentSeries: [{ name: 'Alpha Saga', sequence: '3' }],
      authors: ['Author A']
    })
    await createBookFixture({
      title: 'Beta One',
      currentSeries: [{ name: 'Beta Cycle', sequence: '1' }],
      authors: ['Author B']
    })
    await createBookFixture({
      title: 'Zeta Zero',
      currentSeries: [{ name: 'Zeta Files', sequence: '1' }],
      authors: ['Author Z']
    })

    await SeriesReviewManager.importCatalogForLibrary(library.id, [
      {
        seriesName: 'Beta Cycle',
        entries: [
          {
            title: 'Beta One',
            authors: ['Author B'],
            sequence: '1',
            sources: [{ source: 'fictiondb', label: 'FDB', confidence: 0.95, evidenceUrl: 'https://www.fictiondb.com/series/beta-cycle~1111.htm' }]
          }
        ]
      }
    ])

    const catalogs = await SeriesReviewManager.getCatalogsForLibrary(library.id, true)
    expect(catalogs.map((catalog) => `${catalog.seriesName}:${catalog.displayBucket}`)).to.deep.equal([
      'Alpha Saga:local_only',
      'Beta Cycle:trusted',
      'Zeta Files:local_only'
    ])
    expect(catalogs[0].authorLine).to.equal('Author A')
    expect(catalogs[0].canDismiss).to.equal(false)
    expect(catalogs[1].evidenceLinks).to.deep.equal([
      {
        source: 'fictiondb',
        label: 'FDB',
        url: 'https://www.fictiondb.com/series/beta-cycle~1111.htm'
      }
    ])

    const alphaDetail = await SeriesReviewManager.getCatalogDetailForLibrary(library.id, catalogs[0].id)
    expect(alphaDetail.catalog.displayBucket).to.equal('local_only')
    expect(alphaDetail.catalog.displayLabel).to.equal('Local series')
    expect(alphaDetail.catalog.canDismiss).to.equal(false)
    expect(alphaDetail.catalog.evidenceLinks).to.deep.equal([])
    expect(alphaDetail.slots.map((slot) => slot.slot)).to.deep.equal(['1', '3'])
    expect(alphaDetail.slots.every((slot) => slot.status === 'covered')).to.equal(true)
  })

  it('stores a saved local source-series match on local-only detail', async () => {
    await createBookFixture({
      title: 'Alpha Start',
      currentSeries: [{ name: 'Alpha Saga', sequence: '1' }],
      authors: ['Author A']
    })

    const catalogs = await SeriesReviewManager.getCatalogsForLibrary(library.id, true)
    const localCatalog = catalogs.find((catalog) => catalog.seriesName === 'Alpha Saga')
    expect(localCatalog).to.exist

    const detail = await SeriesReviewManager.saveLocalSeriesMatchForLibrary(library.id, localCatalog.id, {
      source: 'fictiondb',
      sourceSeriesName: 'The Alpha Saga',
      sourceAuthor: 'Author A',
      sourceUrl: 'https://www.fictiondb.com/series/the-alpha-saga-author-a~123.htm',
      evidenceSnapshot: {
        sourceSeriesName: 'The Alpha Saga',
        sourceAuthor: 'Author A',
        sourceUrl: 'https://www.fictiondb.com/series/the-alpha-saga-author-a~123.htm',
        matchingBooks: [{ localTitle: 'Alpha Start', sourceTitle: 'Alpha Start', sourceSequence: '1' }],
        sampleBooks: [{ title: 'Alpha Start', sequence: '1' }]
      }
    })

    expect(detail.catalog.localSeriesMatches).to.have.length(1)
    expect(detail.catalog.localSeriesMatches[0].sourceSeriesName).to.equal('The Alpha Saga')
    expect(detail.catalog.localSeriesMatches[0].sourceUrl).to.equal('https://www.fictiondb.com/series/the-alpha-saga-author-a~123.htm')
    expect(detail.catalog.localSeriesMatches[0].pendingImport).to.equal(true)

    const batchMatches = await SeriesReviewManager.getLocalSeriesMatchesForLibrary(library.id)
    expect(batchMatches).to.have.length(1)
    expect(batchMatches[0].localSeriesName).to.equal('Alpha Saga')
    expect(batchMatches[0].localBooks).to.have.length(1)
    expect(batchMatches[0].pendingImport).to.equal(true)
  })

  it('stores multiple saved source-series links on a sourced catalog detail', async () => {
    await createBookFixture({
      title: 'Alpha Start',
      currentSeries: [{ name: 'Alpha Saga', sequence: '1' }],
      authors: ['Author A']
    })

    const importResult = await SeriesReviewManager.importCatalogForLibrary(library.id, [
      {
        seriesName: 'Alpha Saga',
        entries: [
          {
            title: 'Alpha Start',
            authors: ['Author A'],
            sequence: '1',
            sources: [{ source: 'fictiondb', label: 'FDB', confidence: 0.95, evidenceUrl: 'https://www.fictiondb.com/series/alpha-saga-author-a~123.htm' }]
          }
        ]
      }
    ])
    const sourcedCatalogId = importResult.catalogs[0].id

    const firstDetail = await SeriesReviewManager.saveLocalSeriesMatchForLibrary(library.id, sourcedCatalogId, {
      source: 'fictiondb',
      sourceSeriesName: 'The Alpha Saga',
      sourceAuthor: 'Author A',
      sourceUrl: 'https://www.fictiondb.com/series/the-alpha-saga-author-a~123.htm',
      evidenceSnapshot: {
        sourceSeriesName: 'The Alpha Saga',
        sourceAuthor: 'Author A',
        sourceUrl: 'https://www.fictiondb.com/series/the-alpha-saga-author-a~123.htm',
        matchingBooks: [{ localTitle: 'Alpha Start', sourceTitle: 'Alpha Start', sourceSequence: '1' }],
        sampleBooks: [{ title: 'Alpha Start', sequence: '1' }]
      }
    })
    expect(firstDetail.catalog.localSeriesMatches).to.have.length(1)
    expect(firstDetail.catalog.localSeriesMatches[0].source).to.equal('fictiondb')

    const secondDetail = await SeriesReviewManager.saveLocalSeriesMatchForLibrary(library.id, sourcedCatalogId, {
      source: 'audible',
      sourceSeriesName: 'The Alpha Saga',
      sourceAuthor: 'Author A',
      sourceUrl: 'https://www.audible.co.uk/series/Alpha-Saga-Audiobooks/B0ALPHA001',
      evidenceSnapshot: {
        source: 'audible',
        sourceSeriesName: 'The Alpha Saga',
        sourceAuthor: 'Author A',
        sourceUrl: 'https://www.audible.co.uk/series/Alpha-Saga-Audiobooks/B0ALPHA001',
        sourceLinkUrl: 'https://www.audible.co.uk/series/Alpha-Saga-Audiobooks/B0ALPHA001',
        sourceIdentifier: 'ASIN B0ALPHA001',
        sourceAsin: 'B0ALPHA001',
        sourceRegion: 'UK',
        matchingBooks: [{ localTitle: 'Alpha Start', sourceTitle: 'Alpha Start', sourceSequence: '1' }]
      }
    })

    expect(secondDetail.catalog.localSeriesMatches).to.have.length(2)
    expect(secondDetail.catalog.localSeriesMatches.map((match) => match.source).sort()).to.deep.equal(['audible', 'fictiondb'])

    const batchMatches = await SeriesReviewManager.getLocalSeriesMatchesForLibrary(library.id, { includeResolved: true })
    expect(batchMatches).to.have.length(2)
    expect(batchMatches.map((match) => match.source).sort()).to.deep.equal(['audible', 'fictiondb'])
    expect(batchMatches.every((match) => match.pendingImport)).to.equal(true)
  })

  it('refreshes saved source-book snapshots without resetting the saved-link import lifecycle', async () => {
    await createBookFixture({
      title: 'Alpha Start',
      currentSeries: [{ name: 'Alpha Saga', sequence: '1' }],
      authors: ['Author A']
    })

    const localCatalogs = await SeriesReviewManager.getCatalogsForLibrary(library.id, true)
    const localCatalog = localCatalogs.find((catalog) => catalog.seriesName === 'Alpha Saga')
    const detail = await SeriesReviewManager.saveLocalSeriesMatchForLibrary(library.id, localCatalog.id, {
      source: 'fictiondb',
      sourceSeriesName: 'The Alpha Saga',
      sourceAuthor: 'Author A',
      sourceUrl: 'https://www.fictiondb.com/series/the-alpha-saga-author-a~123.htm',
      evidenceSnapshot: {
        source: 'fictiondb',
        sourceSeriesName: 'The Alpha Saga',
        sourceAuthor: 'Author A',
        sourceUrl: 'https://www.fictiondb.com/series/the-alpha-saga-author-a~123.htm',
        matchingBooks: [{ localTitle: 'Alpha Start', sourceTitle: 'Alpha Start', sourceSequence: '1' }],
        seriesBooks: [{ title: 'Alpha Start', sequence: '1' }]
      }
    })
    const matchId = detail.catalog.localSeriesMatches[0].id
    await SeriesReviewManager.markSeriesSourceLinksImported(library.id, { matchIds: [matchId] })

    const refreshedMatch = await SeriesReviewManager.refreshSeriesSourceLinkEvidenceForLibrary(library.id, localCatalog.id, matchId, {
      evidenceSnapshot: {
        source: 'fictiondb',
        sourceSeriesName: 'The Alpha Saga',
        sourceAuthor: 'Author A',
        sourceUrl: 'https://www.fictiondb.com/series/the-alpha-saga-author-a~123.htm',
        sampleBooks: [
          { title: 'Alpha Start', sequence: '1' },
          { title: 'Alpha Return', sequence: '2' }
        ],
        seriesBooks: [
          { title: 'Alpha Start', sequence: '1' },
          { title: 'Alpha Return', sequence: '2' }
        ],
        sequenceIncomplete: false,
        sequenceStatusNote: '',
        lookedUpAtUtc: '2026-03-29T12:00:00Z'
      }
    })

    expect(refreshedMatch.pendingImport).to.equal(false)
    expect(refreshedMatch.importStatus).to.equal('imported')
    expect(refreshedMatch.matchingBooks).to.have.length(1)
    expect(refreshedMatch.seriesBooks.map((book) => book.title)).to.deep.equal(['Alpha Start', 'Alpha Return'])
    expect(refreshedMatch.evidenceSnapshot.lookedUpAtUtc).to.equal('2026-03-29T12:00:00Z')
  })

  it('keeps pending saved links visible for batch import even when they already resolve to a catalog', async () => {
    await createBookFixture({
      title: 'Alpha Start',
      currentSeries: [{ name: 'Alpha Saga', sequence: '1' }],
      authors: ['Author A']
    })

    const detail = await SeriesReviewManager.saveLocalSeriesMatchForSeriesName(library.id, 'Alpha Saga', '', {
      source: 'fictiondb',
      sourceSeriesName: 'The Alpha Saga',
      sourceAuthor: 'Author A',
      sourceSeriesUrl: 'https://www.fictiondb.com/series/the-alpha-saga-author-a~123.htm',
      evidenceSnapshot: {
        sourceSeriesName: 'The Alpha Saga',
        sourceAuthor: 'Author A',
        sourceSeriesUrl: 'https://www.fictiondb.com/series/the-alpha-saga-author-a~123.htm',
        matchingBooks: [{ localTitle: 'Alpha Start', sourceTitle: 'Alpha Start', sourceSequence: '1' }],
        sampleBooks: [{ title: 'Alpha Start', sequence: '1' }]
      }
    })
    expect(detail.catalog.localSeriesMatches[0].pendingImport).to.equal(true)

    const importResult = await SeriesReviewManager.importCatalogForLibrary(library.id, [
      {
        seriesName: 'The Alpha Saga',
        entries: [
          {
            title: 'Alpha Start',
            authors: ['Author A'],
            sequence: '1',
            sources: [{ source: 'fictiondb', label: 'FDB', confidence: 0.95, evidenceUrl: 'https://www.fictiondb.com/series/the-alpha-saga-author-a~123.htm' }]
          }
        ]
      }
    ])

    const pendingMatches = await SeriesReviewManager.getLocalSeriesMatchesForLibrary(library.id, {
      includeResolved: true,
      pendingOnly: true
    })
    expect(pendingMatches).to.have.length(1)
    expect(pendingMatches[0].resolvedCatalogId).to.equal(null)
    expect(pendingMatches[0].pendingImport).to.equal(true)

    await SeriesReviewManager.markSeriesSourceLinksImported(library.id, {
      matchIds: [pendingMatches[0].id]
    })

    const pendingAfterImport = await SeriesReviewManager.getLocalSeriesMatchesForLibrary(library.id, {
      includeResolved: true,
      pendingOnly: true
    })
    expect(pendingAfterImport).to.have.length(0)

    const allMatches = await SeriesReviewManager.getLocalSeriesMatchesForLibrary(library.id, {
      includeResolved: true
    })
    expect(allMatches).to.have.length(1)
    expect(allMatches[0].pendingImport).to.equal(false)
    expect(allMatches[0].importStatus).to.equal('imported')
    expect(allMatches[0].lastImportedAt).to.exist
  })

  it('fully removes imported source-link artifacts when a saved link is removed', async () => {
    const { libraryItem } = await createBookFixture({
      title: 'Alpha Start',
      currentSeries: [{ name: 'Alpha Saga', sequence: '1' }],
      authors: ['Author A']
    })
    await stubExpandedLibraryItems()

    await SeriesReviewManager.saveLocalSeriesMatchForSeriesName(library.id, 'Alpha Saga', '', {
      source: 'fictiondb',
      sourceSeriesName: 'The Alpha Saga',
      sourceAuthor: 'Author A',
      sourceSeriesUrl: 'https://www.fictiondb.com/series/the-alpha-saga-author-a~123.htm',
      evidenceSnapshot: {
        sourceSeriesName: 'The Alpha Saga',
        sourceAuthor: 'Author A',
        sourceSeriesUrl: 'https://www.fictiondb.com/series/the-alpha-saga-author-a~123.htm',
        matchingBooks: [{ localTitle: 'Alpha Start', sourceTitle: 'Alpha Start', sourceSequence: '1' }],
        sampleBooks: [{ title: 'Alpha Start', sequence: '1' }]
      }
    })

    const linkRow = await Database.seriesReviewSeriesSourceLinkModel.findOne({
      where: {
        libraryId: library.id,
        sourceSeriesUrl: 'https://www.fictiondb.com/series/the-alpha-saga-author-a~123.htm'
      }
    })
    linkRow.importStatus = 'imported'
    linkRow.lastImportedAt = new Date()
    await linkRow.save()

    const catalogImport = await SeriesReviewManager.importCatalogForLibrary(library.id, [
      {
        seriesName: 'Alpha Saga',
        trustStatus: 'trusted',
        entries: [
          {
            title: 'Alpha Start',
            sequenceLabel: '1',
            authors: ['Author A'],
            sources: [
              {
                source: 'fictiondb',
                label: 'FDB',
                confidence: 0.98,
                evidenceUrl: 'https://www.fictiondb.com/series/the-alpha-saga-author-a~123.htm'
              }
            ]
          }
        ]
      }
    ])

    await SeriesReviewManager.importSuggestionsForLibrary(library.id, [
      {
        libraryItemId: libraryItem.id,
        sourceSuggestions: [
          {
            source: 'fictiondb',
            label: 'FDB',
            seriesName: 'The Alpha Saga',
            sequence: '1',
            confidence: 0.98,
            evidenceUrl: 'https://www.fictiondb.com/series/the-alpha-saga-author-a~123.htm',
            rawEvidence: {
              localSeriesImport: {
                sourceSeriesUrl: 'https://www.fictiondb.com/series/the-alpha-saga-author-a~123.htm'
              }
            }
          }
        ]
      }
    ])

    const queueBeforeApply = await SeriesReviewManager.getQueueForLibrary(library.id, true)
    const suggestion = queueBeforeApply[0].suggestions.find((candidate) => candidate.suggestedName === 'The Alpha Saga')
    await SeriesReviewManager.applySuggestion(suggestion.id, user.id, 'add')

    await SeriesReviewManager.removeLocalSeriesMatchForLibrary(library.id, SeriesReviewManager.buildLocalOnlyCatalogId('alpha saga'), linkRow.id, user.id)

    const updatedLinkRow = await Database.seriesReviewSeriesSourceLinkModel.findByPk(linkRow.id)
    expect(updatedLinkRow.isActive).to.equal(false)

    const updatedLibraryItem = await Database.libraryItemModel.getExpandedById(libraryItem.id)
    expect(updatedLibraryItem.media.series).to.deep.equal([])

    const activeSuggestions = await Database.seriesReviewSuggestionModel.findAll({
      where: {
        libraryId: library.id,
        libraryItemId: libraryItem.id,
        isActive: true
      }
    })
    expect(activeSuggestions).to.have.length(0)

    const updatedCatalogDetail = await SeriesReviewManager.getCatalogDetailForLibrary(library.id, catalogImport.catalogs[0].id)
    expect(updatedCatalogDetail.catalog.evidenceLinks).to.deep.equal([])

    const updatedCatalogRow = await Database.seriesReviewCatalogModel.findByPk(catalogImport.catalogs[0].id)
    expect(updatedCatalogRow.entries[0].sources).to.deep.equal([])
  })

  it('backfills legacy saved local links into the persistent source-link table on first series-review access', async () => {
    await createBookFixture({
      title: 'Alpha Start',
      currentSeries: [{ name: 'Alpha Saga', sequence: '1' }],
      authors: ['Author A']
    })

    await Database.seriesReviewLocalSeriesMatchModel.create({
      libraryId: library.id,
      localDecisionKey: 'alpha saga',
      localSeriesName: 'Alpha Saga',
      source: 'fictiondb',
      sourceSeriesName: 'The Alpha Saga',
      sourceAuthor: 'Author A',
      sourceSeriesUrl: 'https://www.fictiondb.com/series/the-alpha-saga-author-a~123.htm',
      evidenceSnapshot: {
        sourceSeriesName: 'The Alpha Saga',
        sourceAuthor: 'Author A',
        sourceSeriesUrl: 'https://www.fictiondb.com/series/the-alpha-saga-author-a~123.htm',
        matchingBooks: [{ localTitle: 'Alpha Start', sourceTitle: 'Alpha Start', sourceSequence: '1' }],
        sampleBooks: [{ title: 'Alpha Start', sequence: '1' }]
      }
    })

    const catalogs = await SeriesReviewManager.getCatalogsForLibrary(library.id, true)
    expect(catalogs.find((catalog) => catalog.seriesName === 'Alpha Saga')).to.exist

    const backfilledRows = await Database.seriesReviewSeriesSourceLinkModel.findAll({
      where: { libraryId: library.id }
    })
    expect(backfilledRows).to.have.length(1)
    expect(backfilledRows[0].sourceSeriesUrl).to.equal('https://www.fictiondb.com/series/the-alpha-saga-author-a~123.htm')
    expect(backfilledRows[0].coverageStatus).to.equal('linked')
  })

  it('canonicalizes audible product evidence urls to the series page when raw provider series metadata exists', async () => {
    const cleaned = SeriesReviewManager.cleanCatalogSource({
      source: 'audible',
      label: 'AUD',
      confidence: 0.88,
      evidenceUrl: 'https://www.audible.co.uk/pd/B0BOOK0001',
      sourceRef: 'audible:uk:B0BOOK0001:audible',
      providerMeta: { provider_name: 'audible_audnexus', region_used: 'uk' },
      rawEvidence: {
        asin: 'B0BOOK0001',
        region: 'uk',
        audible: {
          series: [
            {
              asin: 'B0SERIES99',
              sequence: '2',
              title: 'The Example Saga',
              url: '/pd/The-Example-Saga-Audiobook/B0SERIES99'
            }
          ]
        }
      }
    })

    expect(cleaned.evidenceUrl).to.equal('https://www.audible.co.uk/series/The-Example-Saga-Audiobooks/B0SERIES99')
    expect(cleaned.rawEvidence.audible.series[0].url).to.equal('https://www.audible.co.uk/series/The-Example-Saga-Audiobooks/B0SERIES99')
  })

  it('preserves audible product evidence urls when no canonical series metadata is available', async () => {
    const cleaned = SeriesReviewManager.cleanCatalogSource({
      source: 'audible',
      label: 'AUD',
      confidence: 0.77,
      evidenceUrl: 'https://www.audible.co.uk/pd/B0BOOK0002',
      rawEvidence: {
        localSeriesImport: {
          sourceSeriesUrl: 'https://www.audible.co.uk/pd/B0BOOK0002',
          sourceSeriesName: 'Standalone Import'
        }
      }
    })

    expect(cleaned.evidenceUrl).to.equal('https://www.audible.co.uk/pd/B0BOOK0002')
  })

  it('hides resolved local-only series and applies saved local links to imported catalog coverage', async () => {
    await createBookFixture({
      title: 'Alpha Start',
      currentSeries: [{ name: 'Alpha Saga', sequence: '1' }],
      authors: ['Author A']
    })
    await createBookFixture({
      title: 'Alpha Return',
      currentSeries: [{ name: 'Alpha Saga', sequence: '3' }],
      authors: ['Author A']
    })

    const localCatalogs = await SeriesReviewManager.getCatalogsForLibrary(library.id, true)
    const localCatalog = localCatalogs.find((catalog) => catalog.seriesName === 'Alpha Saga')
    await SeriesReviewManager.saveLocalSeriesMatchForLibrary(library.id, localCatalog.id, {
      source: 'fictiondb',
      sourceSeriesName: 'The Alpha Saga',
      sourceAuthor: 'Author A',
      sourceUrl: 'https://www.fictiondb.com/series/the-alpha-saga-author-a~123.htm',
      evidenceSnapshot: {
        sourceSeriesName: 'The Alpha Saga',
        sourceAuthor: 'Author A',
        sourceUrl: 'https://www.fictiondb.com/series/the-alpha-saga-author-a~123.htm',
        matchingBooks: [{ localTitle: 'Alpha Start', sourceTitle: 'Alpha Start', sourceSequence: '1' }],
        sampleBooks: [{ title: 'Alpha Start', sequence: '1' }]
      }
    })

    const importResult = await SeriesReviewManager.importCatalogForLibrary(library.id, [
      {
        seriesName: 'The Alpha Saga',
        entries: [
          {
            title: 'Alpha Start',
            authors: ['Author A'],
            sequence: '1',
            sources: [{ source: 'fictiondb', label: 'FDB', confidence: 0.95, evidenceUrl: 'https://www.fictiondb.com/series/the-alpha-saga-author-a~123.htm' }]
          },
          {
            title: 'Alpha Return',
            authors: ['Author A'],
            sequence: '3',
            sources: [{ source: 'fictiondb', label: 'FDB', confidence: 0.95, evidenceUrl: 'https://www.fictiondb.com/series/the-alpha-saga-author-a~123.htm' }]
          }
        ]
      }
    ])

    const catalogs = await SeriesReviewManager.getCatalogsForLibrary(library.id, true)
    expect(catalogs.map((catalog) => `${catalog.seriesName}:${catalog.displayBucket}`)).to.deep.equal(['The Alpha Saga:locally_linked'])

    const detail = await SeriesReviewManager.getCatalogDetailForLibrary(library.id, importResult.catalogs[0].id)
    expect(detail.localBooks.map((book) => book.title)).to.deep.equal(['Alpha Start', 'Alpha Return'])

    const resolvedLocalOnlyDetail = await SeriesReviewManager.getCatalogDetailForLibrary(library.id, localCatalog.id)
    expect(resolvedLocalOnlyDetail.catalog.id).to.equal(importResult.catalogs[0].id)
    expect(resolvedLocalOnlyDetail.catalog.displayBucket).to.equal('locally_linked')
  })

  it('surfaces pending and partial saved-link summary flags on catalog list rows', async () => {
    await createBookFixture({
      title: 'Alpha Start',
      currentSeries: [{ name: 'Alpha Saga', sequence: '1' }],
      authors: ['Author A']
    })
    await createBookFixture({
      title: 'Alpha Return',
      currentSeries: [{ name: 'Alpha Saga', sequence: '2' }],
      authors: ['Author A']
    })

    const localCatalogs = await SeriesReviewManager.getCatalogsForLibrary(library.id, true)
    const localCatalog = localCatalogs.find((catalog) => catalog.seriesName === 'Alpha Saga')
    await SeriesReviewManager.saveLocalSeriesMatchForLibrary(library.id, localCatalog.id, {
      source: 'fictiondb',
      sourceSeriesName: 'The Alpha Saga',
      sourceAuthor: 'Author A',
      sourceUrl: 'https://www.fictiondb.com/series/the-alpha-saga-author-a~123.htm',
      evidenceSnapshot: {
        sourceSeriesName: 'The Alpha Saga',
        sourceAuthor: 'Author A',
        sourceUrl: 'https://www.fictiondb.com/series/the-alpha-saga-author-a~123.htm',
        matchingBooks: [{ localTitle: 'Alpha Start', sourceTitle: 'Alpha Start', sourceSequence: '1' }],
        sampleBooks: [{ title: 'Alpha Start', sequence: '1' }]
      }
    })

    const pendingCatalogs = await SeriesReviewManager.getCatalogsForLibrary(library.id, true)
    const pendingLocalCatalog = pendingCatalogs.find((catalog) => catalog.seriesName === 'Alpha Saga')
    expect(pendingLocalCatalog.displayBucket).to.equal('local_only')
    expect(pendingLocalCatalog.hasPendingLink).to.equal(true)
    expect(pendingLocalCatalog.hasPartialLink).to.equal(true)
    expect(pendingLocalCatalog.savedSourceCount).to.equal(1)
    expect(pendingLocalCatalog.savedSourceKeys).to.deep.equal(['fictiondb'])

    const importResult = await SeriesReviewManager.importCatalogForLibrary(library.id, [
      {
        seriesName: 'The Alpha Saga',
        entries: [
          {
            title: 'Alpha Start',
            authors: ['Author A'],
            sequence: '1',
            sources: [{ source: 'fictiondb', label: 'FDB', confidence: 0.95, evidenceUrl: 'https://www.fictiondb.com/series/the-alpha-saga-author-a~123.htm' }]
          }
        ]
      }
    ])
    await SeriesReviewManager.markSeriesSourceLinksImported(library.id, {
      localDecisionKey: 'alpha saga',
      sourceSeriesUrl: 'https://www.fictiondb.com/series/the-alpha-saga-author-a~123.htm'
    })

    const linkedCatalogs = await SeriesReviewManager.getCatalogsForLibrary(library.id, true)
    const linkedCatalog = linkedCatalogs.find((catalog) => catalog.id === importResult.catalogs[0].id)
    expect(linkedCatalog.displayBucket).to.equal('locally_linked')
    expect(linkedCatalog.hasPendingLink).to.equal(false)
    expect(linkedCatalog.hasPartialLink).to.equal(true)
    expect(linkedCatalog.savedSourceCount).to.equal(1)
    expect(linkedCatalog.savedSourceKeys).to.deep.equal(['fictiondb'])
  })

  it('keeps partial summary flags when a linked catalog also has an unresolved partial saved link', async () => {
    await createBookFixture({
      title: 'Mort',
      currentSeries: [{ name: 'Discworld - Death', sequence: '1' }],
      authors: ['Terry Pratchett']
    })
    await createBookFixture({
      title: 'Reaper Man',
      currentSeries: [{ name: 'Discworld - Death', sequence: '2' }],
      authors: ['Terry Pratchett']
    })

    const localCatalogs = await SeriesReviewManager.getCatalogsForLibrary(library.id, true)
    const localCatalog = localCatalogs.find((catalog) => catalog.seriesName === 'Discworld - Death')

    await SeriesReviewManager.saveLocalSeriesMatchForLibrary(library.id, localCatalog.id, {
      source: 'fictiondb',
      sourceSeriesName: 'Discworld - Death',
      sourceAuthor: 'Terry Pratchett',
      sourceUrl: 'https://www.fictiondb.com/series/discworld-death-terry-pratchett~15585.htm',
      evidenceSnapshot: {
        sourceSeriesName: 'Discworld - Death',
        sourceAuthor: 'Terry Pratchett',
        sourceUrl: 'https://www.fictiondb.com/series/discworld-death-terry-pratchett~15585.htm',
        matchingBooks: [
          { localTitle: 'Mort', sourceTitle: 'Mort', sourceSequence: '1' },
          { localTitle: 'Reaper Man', sourceTitle: 'Reaper Man', sourceSequence: '2' }
        ],
        sampleBooks: [
          { title: 'Mort', sequence: '1' },
          { title: 'Reaper Man', sequence: '2' }
        ]
      }
    })

    const importResult = await SeriesReviewManager.importCatalogForLibrary(library.id, [
      {
        seriesName: 'Discworld - Death',
        entries: [
          {
            title: 'Mort',
            authors: ['Terry Pratchett'],
            sequence: '1',
            sources: [{ source: 'fictiondb', label: 'FDB', confidence: 0.95, evidenceUrl: 'https://www.fictiondb.com/series/discworld-death-terry-pratchett~15585.htm' }]
          },
          {
            title: 'Reaper Man',
            authors: ['Terry Pratchett'],
            sequence: '2',
            sources: [{ source: 'fictiondb', label: 'FDB', confidence: 0.95, evidenceUrl: 'https://www.fictiondb.com/series/discworld-death-terry-pratchett~15585.htm' }]
          }
        ]
      }
    ])
    await SeriesReviewManager.markSeriesSourceLinksImported(library.id, {
      localDecisionKey: 'discworld death',
      sourceSeriesUrl: 'https://www.fictiondb.com/series/discworld-death-terry-pratchett~15585.htm'
    })

    await SeriesReviewManager.saveLocalSeriesMatchForLibrary(library.id, importResult.catalogs[0].id, {
      source: 'audible',
      sourceSeriesName: 'Discworld',
      sourceAuthor: 'Terry Pratchett',
      sourceUrl: 'https://www.audible.co.uk/series/Discworld-Audiobooks/B00HRG5ZPU',
      evidenceSnapshot: {
        sourceSeriesName: 'Discworld',
        sourceAuthor: 'Terry Pratchett',
        sourceUrl: 'https://www.audible.co.uk/series/Discworld-Audiobooks/B00HRG5ZPU',
        matchingBooks: [{ localTitle: 'Mort', sourceTitle: 'Mort', sourceSequence: '4' }],
        sampleBooks: [
          { title: 'Mort', sequence: '4' },
          { title: 'Reaper Man', sequence: '11' }
        ]
      }
    })

    const catalogs = await SeriesReviewManager.getCatalogsForLibrary(library.id, true)
    const linkedCatalog = catalogs.find((catalog) => catalog.id === importResult.catalogs[0].id)
    expect(linkedCatalog.displayBucket).to.equal('locally_linked')
    expect(linkedCatalog.hasPendingLink).to.equal(true)
    expect(linkedCatalog.hasPartialLink).to.equal(true)
    expect(linkedCatalog.savedSourceCount).to.equal(2)
    expect(linkedCatalog.savedSourceKeys).to.deep.equal(['audible', 'fictiondb'])
  })

  it('recomputes left-list partial flags from current local coverage instead of stale stored saved-link state', async () => {
    await createBookFixture({
      title: 'Dune',
      currentSeries: [{ name: 'Dune Chronicles', sequence: '1' }],
      authors: ['Frank Herbert']
    })
    await createBookFixture({
      title: 'Dune Messiah',
      currentSeries: [{ name: 'Dune Chronicles', sequence: '2' }],
      authors: ['Frank Herbert']
    })

    const localCatalogs = await SeriesReviewManager.getCatalogsForLibrary(library.id, true)
    const localCatalog = localCatalogs.find((catalog) => catalog.seriesName === 'Dune Chronicles')
    await SeriesReviewManager.saveLocalSeriesMatchForLibrary(library.id, localCatalog.id, {
      source: 'fictiondb',
      sourceSeriesName: 'Dune Chronicles',
      sourceAuthor: 'Frank Herbert',
      sourceUrl: 'https://www.fictiondb.com/series/dune-chronicles-frank-herbert~3735.htm',
      evidenceSnapshot: {
        sourceSeriesName: 'Dune Chronicles',
        sourceAuthor: 'Frank Herbert',
        sourceUrl: 'https://www.fictiondb.com/series/dune-chronicles-frank-herbert~3735.htm',
        matchingBooks: [
          { localTitle: 'Dune', sourceTitle: 'Dune', sourceSequence: '1' },
          { localTitle: 'Dune Messiah', sourceTitle: 'Dune Messiah', sourceSequence: '2' }
        ],
        seriesBooks: [
          { title: 'Dune', sequence: '1' },
          { title: 'Dune Messiah', sequence: '2' }
        ]
      }
    })

    const matchRow = await Database.seriesReviewSeriesSourceLinkModel.findOne({
      where: {
        libraryId: library.id,
        localDecisionKey: 'dune chronicles',
        sourceSeriesUrl: 'https://www.fictiondb.com/series/dune-chronicles-frank-herbert~3735.htm'
      }
    })
    matchRow.coverageStatus = 'partial'
    matchRow.linkedBookCount = 2
    matchRow.totalBookCount = 0
    matchRow.importStatus = 'imported'
    await matchRow.save()

    const catalogs = await SeriesReviewManager.getCatalogsForLibrary(library.id, true)
    const catalog = catalogs.find((entry) => entry.seriesName === 'Dune Chronicles')
    expect(catalog.hasPartialLink).to.equal(false)
  })

  it('recomputes saved-link coverage from imported catalog rows when an imported link becomes complete', async () => {
    await createBookFixture({
      title: 'Android X',
      currentSeries: [{ name: 'Android X', sequence: '1' }],
      authors: ['Michael La Ronn']
    })
    await createBookFixture({
      title: 'Android X 2',
      currentSeries: [{ name: 'Android X', sequence: '2' }],
      authors: ['Michael La Ronn']
    })

    const localCatalogs = await SeriesReviewManager.getCatalogsForLibrary(library.id, true)
    const localCatalog = localCatalogs.find((catalog) => catalog.seriesName === 'Android X')
    await SeriesReviewManager.saveLocalSeriesMatchForLibrary(library.id, localCatalog.id, {
      source: 'audible',
      sourceSeriesName: 'Android X',
      sourceAuthor: 'Michael La Ronn',
      sourceUrl: 'https://www.audible.co.uk/series/Android-X-Audiobooks/B012C5FZPU',
      sourceSeriesUrl: 'https://www.audible.co.uk/series/Android-X-Audiobooks/B012C5FZPU',
      evidenceSnapshot: {
        source: 'audible',
        sourceSeriesName: 'Android X',
        sourceAuthor: 'Michael La Ronn',
        sourceUrl: 'https://www.audible.co.uk/series/Android-X-Audiobooks/B012C5FZPU',
        sourceSeriesUrl: 'https://www.audible.co.uk/series/Android-X-Audiobooks/B012C5FZPU',
        sourceLinkUrl: 'https://www.audible.co.uk/series/Android-X-Audiobooks/B012C5FZPU',
        sourceIdentifier: 'B012C5FZPU',
        matchingBooks: [{ localTitle: 'Android X', sourceTitle: 'Android X', sourceSequence: '1' }]
      }
    })

    const importResult = await SeriesReviewManager.importCatalogForLibrary(library.id, [
      {
        seriesName: 'Android X',
        entries: [
          {
            title: 'Android X',
            authors: ['Michael La Ronn'],
            sequence: '1',
            sources: [{ source: 'audible', label: 'AUD', confidence: 0.95, evidenceUrl: 'https://www.audible.co.uk/series/Android-X-Audiobooks/B012C5FZPU' }]
          },
          {
            title: 'Android X 2',
            authors: ['Michael La Ronn'],
            sequence: '2',
            sources: [{ source: 'audible', label: 'AUD', confidence: 0.95, evidenceUrl: 'https://www.audible.co.uk/series/Android-X-Audiobooks/B012C5FZPU' }]
          }
        ]
      }
    ])

    await SeriesReviewManager.markSeriesSourceLinksImported(library.id, {
      localDecisionKey: 'android x',
      sourceSeriesUrl: 'https://www.audible.co.uk/series/Android-X-Audiobooks/B012C5FZPU'
    })

    const staleRow = await Database.seriesReviewSeriesSourceLinkModel.findOne({
      where: {
        libraryId: library.id,
        localDecisionKey: 'android x',
        sourceSeriesUrl: 'https://www.audible.co.uk/series/Android-X-Audiobooks/B012C5FZPU'
      }
    })
    staleRow.coverageStatus = 'partial'
    staleRow.linkedBookCount = 1
    staleRow.totalBookCount = 1
    await staleRow.save()

    const linkedCatalogs = await SeriesReviewManager.getCatalogsForLibrary(library.id, true)
    const linkedCatalog = linkedCatalogs.find((catalog) => catalog.id === importResult.catalogs[0].id)
    expect(linkedCatalog.hasPendingLink).to.equal(false)
    expect(linkedCatalog.hasPartialLink).to.equal(false)

    const detail = await SeriesReviewManager.getCatalogDetailForLibrary(library.id, importResult.catalogs[0].id)
    expect(detail.catalog.savedSeriesLinks[0].coverageStatus).to.equal('linked')
    expect(detail.catalog.savedSeriesLinks[0].linkedBookCount).to.equal(2)
    expect(detail.catalog.savedSeriesLinks[0].totalBookCount).to.equal(2)
  })

  it('resolves audible manual links into the locally linked category', async () => {
    await createBookFixture({
      title: 'Gamma Start',
      currentSeries: [{ name: 'Gamma Saga', sequence: '1' }],
      authors: ['Author G']
    })

    const localCatalogs = await SeriesReviewManager.getCatalogsForLibrary(library.id, true)
    const localCatalog = localCatalogs.find((catalog) => catalog.seriesName === 'Gamma Saga')
    await SeriesReviewManager.saveLocalSeriesMatchForLibrary(library.id, localCatalog.id, {
      source: 'audible',
      sourceSeriesName: 'The Gamma Saga',
      sourceAuthor: 'Author G',
      sourceUrl: 'https://www.audible.co.uk/pd/B0GAMMA001',
      evidenceSnapshot: {
        source: 'audible',
        sourceSeriesName: 'The Gamma Saga',
        sourceAuthor: 'Author G',
        sourceUrl: 'https://www.audible.co.uk/pd/B0GAMMA001',
        sourceLinkUrl: 'https://www.audible.co.uk/pd/B0GAMMA001',
        sourceIdentifier: 'ASIN B0GAMMA001',
        sourceAsin: 'B0GAMMA001',
        sourceRegion: 'UK',
        matchingBooks: [{ localTitle: 'Gamma Start', sourceTitle: 'Gamma Start', sourceSequence: '1' }]
      }
    })

    await SeriesReviewManager.importCatalogForLibrary(library.id, [
      {
        seriesName: 'The Gamma Saga',
        entries: [
          {
            title: 'Gamma Start',
            authors: ['Author G'],
            sequence: '1',
            sources: [{ source: 'audible', label: 'AUD', confidence: 0.93, evidenceUrl: 'https://www.audible.co.uk/pd/B0GAMMA001' }]
          }
        ]
      }
    ])

    const catalogs = await SeriesReviewManager.getCatalogsForLibrary(library.id, true)
    expect(catalogs.map((catalog) => `${catalog.seriesName}:${catalog.displayBucket}`)).to.deep.equal(['The Gamma Saga:locally_linked'])

    const detail = await SeriesReviewManager.getCatalogDetailForLibrary(library.id, catalogs[0].id)
    expect(detail.localBooks.map((book) => book.title)).to.deep.equal(['Gamma Start'])
  })

  it('classifies source-only catalogs as potential series and hides them from the default trusted list', async () => {
    await SeriesReviewManager.importCatalogForLibrary(library.id, [
      {
        seriesName: 'The Lost Fleet',
        trustStatus: 'trusted',
        entries: [
          {
            title: 'Dauntless',
            sequence: '1',
            sources: [{ source: 'fictiondb', label: 'FDB', confidence: 0.92 }]
          }
        ]
      }
    ])

    const defaultCatalogs = await SeriesReviewManager.getCatalogsForLibrary(library.id)
    expect(defaultCatalogs).to.have.length(0)

    const expandedCatalogs = await SeriesReviewManager.getCatalogsForLibrary(library.id, true)
    expect(expandedCatalogs).to.have.length(1)
    expect(expandedCatalogs[0].displayBucket).to.equal('potential')
    expect(expandedCatalogs[0].displayLabel).to.equal('Potential series')
  })

  it('prefers source-series author names over title fragments for source-only potential catalogs', async () => {
    const importResult = await SeriesReviewManager.importCatalogForLibrary(library.id, [
      {
        seriesName: 'The Coldfire Project',
        trustStatus: 'untrusted',
        entries: [
          {
            title: 'Sep-2006',
            author: 'Shatter Zone',
            sequence: '1',
            sources: [{ source: 'fictiondb', label: 'FDB', confidence: 0.92, evidenceUrl: 'https://www.fictiondb.com/series/the-coldfire-project-james-axler~15594.htm' }]
          },
          {
            title: 'Dec-2006',
            author: 'Perdition Valley',
            sequence: '2',
            sources: [{ source: 'fictiondb', label: 'FDB', confidence: 0.92, evidenceUrl: 'https://www.fictiondb.com/series/the-coldfire-project-james-axler~15594.htm' }]
          }
        ]
      }
    ])

    const expandedCatalogs = await SeriesReviewManager.getCatalogsForLibrary(library.id, true)
    expect(expandedCatalogs).to.have.length(1)
    expect(expandedCatalogs[0].displayBucket).to.equal('potential')
    expect(expandedCatalogs[0].authorLine).to.equal('James Axler')

    const detail = await SeriesReviewManager.getCatalogDetailForLibrary(library.id, importResult.catalogs[0].id)
    expect(detail.catalog.authorLine).to.equal('James Axler')
  })

  it('repairs legacy fictiondb date-title-author swaps into unsequenced source entries', async () => {
    const importResult = await SeriesReviewManager.importCatalogForLibrary(library.id, [
      {
        seriesName: 'Journey to Star Wars: The Force Awakens',
        trustStatus: 'untrusted',
        entries: [
          {
            title: 'Sep-2015',
            authors: ['Moving Target: A Princess Leia Adventure'],
            sequenceLabel: 'Castellucci, Cecil',
            sources: [{ source: 'fictiondb', label: 'FDB', confidence: 0.92, evidenceUrl: 'https://www.fictiondb.com/series/journey-to-star-wars-the-force-awakens~41289.htm' }]
          },
          {
            title: 'Sep-2015',
            authors: ['The Weapon of a Jedi: A Luke Skywalker Adventure'],
            sequenceLabel: 'Fry, Jason',
            sources: [{ source: 'fictiondb', label: 'FDB', confidence: 0.92, evidenceUrl: 'https://www.fictiondb.com/series/journey-to-star-wars-the-force-awakens~41289.htm' }]
          },
          {
            title: 'Sep-2015',
            authors: ["Smuggler's Run: A Han Solo Adventure"],
            sequenceLabel: 'Rucka, Greg',
            sources: [{ source: 'fictiondb', label: 'FDB', confidence: 0.92, evidenceUrl: 'https://www.fictiondb.com/series/journey-to-star-wars-the-force-awakens~41289.htm' }]
          }
        ]
      }
    ])

    const expandedCatalogs = await SeriesReviewManager.getCatalogsForLibrary(library.id, true)
    expect(expandedCatalogs).to.have.length(1)
    expect(expandedCatalogs[0].authorLine).to.equal('Castellucci, Cecil, Fry, Jason, Rucka, Greg')

    const detail = await SeriesReviewManager.getCatalogDetailForLibrary(library.id, importResult.catalogs[0].id)
    expect(detail.slots).to.deep.equal([])
    expect(detail.unsequencedSourceEntries.map((entry) => entry.title)).to.deep.equal([
      'Moving Target: A Princess Leia Adventure',
      "Smuggler's Run: A Han Solo Adventure",
      'The Weapon of a Jedi: A Luke Skywalker Adventure'
    ])
    expect(detail.unsequencedSourceEntries.map((entry) => entry.publishedDate)).to.deep.equal([
      'Sep-2015',
      'Sep-2015',
      'Sep-2015'
    ])
    expect(detail.unsequencedSourceEntries.map((entry) => entry.expectedAuthors[0])).to.deep.equal([
      'Castellucci, Cecil',
      'Rucka, Greg',
      'Fry, Jason'
    ])
  })

  it('builds catalog detail with gaps, decimal handling, disputes, and unsequenced books', async () => {
    await createBookFixture({
      title: 'Leviathan Wakes',
      currentSeries: [{ name: 'The Expanse', sequence: '1' }]
    })
    await createBookFixture({
      title: 'Caliban\'s War',
      currentSeries: [{ name: 'The Expanse', sequence: '2' }]
    })
    await createBookFixture({
      title: 'The Churn',
      currentSeries: [{ name: 'The Expanse', sequence: '3.5' }]
    })
    await createBookFixture({
      title: 'Expanse Stories',
      currentSeries: [{ name: 'The Expanse', sequence: '' }]
    })

    const importResult = await SeriesReviewManager.importCatalogForLibrary(library.id, [
      {
        seriesName: 'The Expanse',
        entries: [
          {
            title: 'Leviathan Wakes',
            sequence: '1',
            sources: [{ source: 'fictiondb', label: 'FDB', confidence: 0.95 }]
          },
          {
            title: 'Caliban\'s War',
            sequence: '2',
            sources: [{ source: 'fictiondb', label: 'FDB', confidence: 0.94 }]
          },
          {
            title: 'Abaddon\'s Gate',
            sequence: '3',
            sources: [{ source: 'fictiondb', label: 'FDB', confidence: 0.93 }]
          },
          {
            title: 'Cibola Burn',
            sequence: '4',
            sources: [{ source: 'fictiondb', label: 'FDB', confidence: 0.92 }]
          },
          {
            title: 'The Churn',
            sequence: '3.5',
            sources: [{ source: 'fictiondb', label: 'FDB', confidence: 0.89 }]
          },
          {
            title: 'Babylon\'s Ashes',
            sequence: '6',
            sources: [{ source: 'fictiondb', label: 'FDB', confidence: 0.91 }]
          },
          {
            title: 'Nemesis Games',
            sequence: '5',
            sources: [{ source: 'fictiondb', label: 'FDB', confidence: 0.9 }]
          },
          {
            title: 'Nemesis Game',
            sequence: '5',
            sources: [{ source: 'wikidata', label: 'WD', confidence: 0.62 }]
          }
        ]
      }
    ])

    const detail = await SeriesReviewManager.getCatalogDetailForLibrary(library.id, importResult.catalogs[0].id)
    const slot3 = detail.slots.find((slot) => slot.slot === '3')
    const slot35 = detail.slots.find((slot) => slot.slot === '3.5')
    const slot5 = detail.slots.find((slot) => slot.slot === '5')

    expect(slot3.status).to.equal('missing')
    expect(slot3.expectedTitle).to.equal('Abaddon\'s Gate')
    expect(slot35.status).to.equal('covered')
    expect(slot5.status).to.equal('disputed')
    expect(slot5.choices).to.have.length(2)
    expect(detail.unsequencedBooks.map((book) => book.title)).to.deep.equal(['Expanse Stories'])
    expect(detail.rows.some((row) => row.rowType === 'unsequenced' && row.title === 'Expanse Stories')).to.equal(true)
  })

  it('does not use local book titles as expected titles in source-backed slots with no source choice', async () => {
    await createBookFixture({
      title: 'Rincewind Book Three Full Cast',
      currentSeries: [{ name: 'Discworld - Rincewind', sequence: '3' }]
    })

    const importResult = await SeriesReviewManager.importCatalogForLibrary(library.id, [
      {
        seriesName: 'Discworld - Rincewind',
        entries: [
          {
            title: 'The Colour of Magic',
            sequence: '1',
            sources: [{ source: 'audible', label: 'AUD', confidence: 0.93, evidenceUrl: 'https://www.audible.co.uk/series/Discworld-Rincewind-Audiobooks/B07MF4H5L2' }]
          }
        ]
      }
    ])

    const detail = await SeriesReviewManager.getCatalogDetailForLibrary(library.id, importResult.catalogs[0].id)
    const slot3 = detail.slots.find((slot) => slot.slot === '3')

    expect(slot3).to.exist
    expect(slot3.expectedTitle).to.equal(null)
    expect(slot3.localBooks).to.have.length(1)
    expect(slot3.localBooks[0].title).to.equal('Rincewind Book Three Full Cast')
  })

  it('lets local omnibus ranges cover numbered slots while keeping source omnibus rows separate', async () => {
    await createBookFixture({
      title: 'Android Paradox',
      currentSeries: [{ name: 'Android X', sequence: '1' }]
    })
    await createBookFixture({
      title: 'Android Deception',
      currentSeries: [{ name: 'Android X', sequence: '2' }]
    })
    await createBookFixture({
      title: 'Android X: The Complete Series',
      currentSeries: [{ name: 'Android X', sequence: '1-3' }]
    })

    const importResult = await SeriesReviewManager.importCatalogForLibrary(library.id, [
      {
        seriesName: 'Android X',
        entries: [
          {
            title: 'Android X: The Complete Series',
            sequence: '1-3',
            sources: [{ source: 'audible', label: 'AUD', confidence: 0.93, evidenceUrl: 'https://www.audible.co.uk/series/Android-X-Audiobooks/B012C5FZPU' }]
          },
          {
            title: 'Android Paradox',
            sequence: '1',
            sources: [{ source: 'audible', label: 'AUD', confidence: 0.93, evidenceUrl: 'https://www.audible.co.uk/series/Android-X-Audiobooks/B012C5FZPU' }]
          },
          {
            title: 'Android Deception',
            sequence: '2',
            sources: [{ source: 'audible', label: 'AUD', confidence: 0.93, evidenceUrl: 'https://www.audible.co.uk/series/Android-X-Audiobooks/B012C5FZPU' }]
          },
          {
            title: 'Android Winter',
            sequence: '3',
            sources: [{ source: 'audible', label: 'AUD', confidence: 0.93, evidenceUrl: 'https://www.audible.co.uk/series/Android-X-Audiobooks/B012C5FZPU' }]
          }
        ]
      }
    ])

    const detail = await SeriesReviewManager.getCatalogDetailForLibrary(library.id, importResult.catalogs[0].id)
    const slot1 = detail.slots.find((slot) => slot.slot === '1')
    const slot2 = detail.slots.find((slot) => slot.slot === '2')
    const slot3 = detail.slots.find((slot) => slot.slot === '3')
    const omnibusRow = detail.rows.find((row) => row.rowType === 'omnibus')
    const coverage = SeriesReviewManager.buildCatalogSourceCoverageBySourceUrl(detail.rows, detail.localBooks).get('https://www.audible.co.uk/series/Android-X-Audiobooks/B012C5FZPU')

    expect(slot1.status).to.equal('covered')
    expect(slot1.choices).to.have.length(1)
    expect(slot1.localBooks.map((book) => book.title)).to.include('Android X: The Complete Series')
    expect(slot2.status).to.equal('covered')
    expect(slot2.choices).to.have.length(1)
    expect(slot2.localBooks.map((book) => book.title)).to.include('Android X: The Complete Series')
    expect(slot3.status).to.equal('covered')
    expect(slot3.localBooks.map((book) => book.title)).to.deep.equal(['Android X: The Complete Series'])
    expect(detail.slots.filter((slot) => slot.status === 'disputed')).to.have.length(0)
    expect(omnibusRow).to.exist
    expect(omnibusRow.status).to.equal('omnibus')
    expect(omnibusRow.sequenceLabel).to.equal('1-3')
    expect(omnibusRow.localBooks).to.have.length(1)
    expect(omnibusRow.localBooks[0].title).to.equal('Android X: The Complete Series')
    expect(coverage).to.deep.equal({
      linkedBookCount: 3,
      totalBookCount: 2,
      coverageStatus: 'linked'
    })
  })

  it('does not mark a source partial just because the source has more books than the local series', async () => {
    await createBookFixture({
      title: 'A Borrowed Man',
      currentSeries: [{ name: 'A Borrowed Man', sequence: '1' }],
      authors: ['Gene Wolfe']
    })

    const importResult = await SeriesReviewManager.importCatalogForLibrary(library.id, [
      {
        seriesName: 'A Borrowed Man',
        entries: [
          {
            title: 'A Borrowed Man',
            sequence: '1',
            sources: [{ source: 'audible', label: 'AUD', confidence: 0.95, evidenceUrl: 'https://www.audible.co.uk/series/A-Borrowed-Man-Audiobooks/B082WTFWYB' }]
          },
          {
            title: 'Interlibrary Loan',
            sequence: '2',
            sources: [{ source: 'audible', label: 'AUD', confidence: 0.95, evidenceUrl: 'https://www.audible.co.uk/series/A-Borrowed-Man-Audiobooks/B082WTFWYB' }]
          }
        ]
      }
    ])

    const detail = await SeriesReviewManager.getCatalogDetailForLibrary(library.id, importResult.catalogs[0].id)
    const coverage = SeriesReviewManager.buildCatalogSourceCoverageBySourceUrl(detail.rows, detail.localBooks).get('https://www.audible.co.uk/series/A-Borrowed-Man-Audiobooks/B082WTFWYB')

    expect(coverage).to.deep.equal({
      linkedBookCount: 1,
      totalBookCount: 1,
      coverageStatus: 'linked'
    })
  })

  it('counts decimal and unsequenced local matches toward saved-link coverage', async () => {
    await createBookFixture({
      title: 'The Serpent and the Wings of Night',
      currentSeries: [{ name: 'Crowns of Nyaxia', sequence: '1' }],
      authors: ['Carissa Broadbent']
    })
    await createBookFixture({
      title: 'The Ashes and the Star-Cursed King',
      currentSeries: [{ name: 'Crowns of Nyaxia', sequence: '2' }],
      authors: ['Carissa Broadbent']
    })
    await createBookFixture({
      title: 'Slaying the Vampire Conqueror',
      currentSeries: [{ name: 'Crowns of Nyaxia', sequence: '2.5' }],
      authors: ['Carissa Broadbent']
    })
    await createBookFixture({
      title: 'Encounter [Dramatized Adaptation]',
      currentSeries: [{ name: 'Deathlands', sequence: '' }],
      authors: ['James Axler']
    })

    const crownsImport = await SeriesReviewManager.importCatalogForLibrary(library.id, [
      {
        seriesName: 'Crowns of Nyaxia',
        entries: [
          {
            title: 'The Serpent and the Wings of Night',
            sequence: '1',
            sources: [{ source: 'audible', label: 'AUD', confidence: 0.95, evidenceUrl: 'https://www.audible.co.uk/series/Crowns-of-Nyaxia-Audiobooks/B0BW49JH69' }]
          },
          {
            title: 'The Ashes and the Star-Cursed King',
            sequence: '2',
            sources: [{ source: 'audible', label: 'AUD', confidence: 0.95, evidenceUrl: 'https://www.audible.co.uk/series/Crowns-of-Nyaxia-Audiobooks/B0BW49JH69' }]
          },
          {
            title: 'Slaying the Vampire Conqueror',
            sequence: '2.5',
            sources: [{ source: 'audible', label: 'AUD', confidence: 0.95, evidenceUrl: 'https://www.audible.co.uk/series/Crowns-of-Nyaxia-Audiobooks/B0BW49JH69' }]
          }
        ]
      },
      {
        seriesName: 'Deathlands',
        entries: [
          {
            title: 'Encounter',
            sequence: '',
            sources: [{ source: 'fictiondb', label: 'FDB', confidence: 0.95, evidenceUrl: 'https://www.fictiondb.com/series/deathlands-james-axler~3452.htm' }]
          }
        ]
      }
    ])

    const crownsDetail = await SeriesReviewManager.getCatalogDetailForLibrary(library.id, crownsImport.catalogs.find((catalog) => catalog.seriesName === 'Crowns of Nyaxia').id)
    const crownsCoverage = SeriesReviewManager.buildCatalogSourceCoverageBySourceUrl(crownsDetail.rows, crownsDetail.localBooks).get('https://www.audible.co.uk/series/Crowns-of-Nyaxia-Audiobooks/B0BW49JH69')
    expect(crownsCoverage).to.deep.equal({
      linkedBookCount: 3,
      totalBookCount: 3,
      coverageStatus: 'linked'
    })

    const deathlandsDetail = await SeriesReviewManager.getCatalogDetailForLibrary(library.id, crownsImport.catalogs.find((catalog) => catalog.seriesName === 'Deathlands').id)
    const deathlandsCoverage = SeriesReviewManager.buildCatalogSourceCoverageBySourceUrl(deathlandsDetail.rows, deathlandsDetail.localBooks).get('https://www.fictiondb.com/series/deathlands-james-axler~3452.htm')
    expect(deathlandsCoverage).to.deep.equal({
      linkedBookCount: 1,
      totalBookCount: 1,
      coverageStatus: 'linked'
    })
  })

  it('treats ranged local sequences as compatible with individual suggestion slots', async () => {
    expect(SeriesReviewManager.sequencesCompatible('1-2', '1')).to.equal(true)
    expect(SeriesReviewManager.sequencesCompatible('1-2', '2')).to.equal(true)
    expect(SeriesReviewManager.sequencesCompatible('1-3', '2')).to.equal(true)
    expect(SeriesReviewManager.sequencesCompatible('1', '1-2')).to.equal(false)
  })

  it('preserves catalog source provenance metadata in series detail support rows', async () => {
    const importResult = await SeriesReviewManager.importCatalogForLibrary(library.id, [
      {
        seriesName: 'The Expanse',
        entries: [
          {
            title: 'Leviathan Wakes',
            sequence: '1',
            sources: [
              { source: 'fictiondb', label: 'FDB', confidence: 0.95, evidenceUrl: 'https://www.fictiondb.com/series/expanse~1234.htm' },
              {
                source: 'audible',
                label: 'AUD',
                confidence: 0.79,
                evidenceUrl: 'https://www.audible.com/pd/B00ABC1234',
                sourceRef: 'audible:us:B00ABC1234:audible',
                providerMeta: { provider_name: 'audible_audnexus', provider_version: '1.0.0', region_used: 'us' },
                rawEvidence: { source_ref: 'audible:us:B00ABC1234' }
              }
            ]
          }
        ]
      }
    ])

    const detail = await SeriesReviewManager.getCatalogDetailForLibrary(library.id, importResult.catalogs[0].id)
    const slot = detail.slots.find((entry) => entry.slot === '1')
    expect(slot).to.exist
    const audibleSupport = (slot.sourceSupport || []).find((support) => support.source === 'audible')
    expect(audibleSupport).to.exist
    expect(audibleSupport.label).to.equal('AUD')
    expect(audibleSupport.sourceRef).to.equal('audible:us:B00ABC1234:audible')
    expect(audibleSupport.providerMeta).to.include({ provider_name: 'audible_audnexus', region_used: 'us' })
    expect(audibleSupport.rawEvidence).to.deep.equal({ source_ref: 'audible:us:B00ABC1234' })
  })

  it('attaches unsequenced source support to covered local slots when local titles carry the series prefix', async () => {
    await createBookFixture({
      title: 'HALO: The Fall of Reach',
      currentSeries: [{ name: 'Halo', sequence: '1' }]
    })
    await createBookFixture({
      title: 'HALO: The Flood',
      currentSeries: [{ name: 'Halo', sequence: '2' }]
    })

    const importResult = await SeriesReviewManager.importCatalogForLibrary(library.id, [
      {
        seriesName: 'Halo',
        entries: [
          {
            title: 'The Fall of Reach',
            authors: ['Nylund, Eric'],
            sources: [{ source: 'fictiondb', label: 'FDB', confidence: 0.92, evidenceUrl: 'https://www.fictiondb.com/series/halo~13242.htm' }]
          },
          {
            title: 'Halo: The Flood',
            authors: ['Dietz, William C.'],
            sources: [{ source: 'fictiondb', label: 'FDB', confidence: 0.92, evidenceUrl: 'https://www.fictiondb.com/series/halo~13242.htm' }]
          }
        ]
      }
    ])

    const detail = await SeriesReviewManager.getCatalogDetailForLibrary(library.id, importResult.catalogs[0].id)
    const slot1 = detail.slots.find((slot) => slot.slot === '1')
    const slot2 = detail.slots.find((slot) => slot.slot === '2')
    expect(slot1).to.exist
    expect(slot2).to.exist
    expect((slot1.sourceSupport || []).map((support) => support.source)).to.deep.equal(['fictiondb'])
    expect((slot2.sourceSupport || []).map((support) => support.source)).to.deep.equal(['fictiondb'])
    expect(detail.unsequencedSourceEntries.map((entry) => entry.title)).to.deep.equal([])
  })

  it('matches unsequenced source rows to local books when local titles carry a collector prefix', async () => {
    await createBookFixture({
      title: 'Dune: The Butlerian Jihad',
      currentSeries: [{ name: 'Dune Saga', sequence: '' }],
      authors: ['Brian Herbert', 'Kevin J. Anderson']
    })

    const importResult = await SeriesReviewManager.importCatalogForLibrary(library.id, [
      {
        seriesName: 'Dune Saga',
        entries: [
          {
            title: 'The Butlerian Jihad',
            authors: ['Frank Herbert'],
            publishedDate: '2002',
            sources: [{ source: 'fantasticfiction', label: 'FF', confidence: 0.9, evidenceUrl: 'https://www.fantasticfiction.com/h/frank-herbert/dune/' }]
          }
        ]
      }
    ])

    const detail = await SeriesReviewManager.getCatalogDetailForLibrary(library.id, importResult.catalogs[0].id)
    const unsequencedRow = detail.rows.find((row) => row.rowType === 'unsequenced' && row.expectedTitle === 'The Butlerian Jihad')

    expect(unsequencedRow).to.exist
    expect(unsequencedRow.localBooks).to.have.length(1)
    expect(unsequencedRow.localBooks[0].title).to.equal('Dune: The Butlerian Jihad')
    expect((unsequencedRow.sourceSupport || []).map((support) => support.source)).to.deep.equal(['fantasticfiction'])
    expect(detail.rows.some((row) => row.rowKey.startsWith('unsequenced-local:') && row.expectedTitle === 'Dune: The Butlerian Jihad')).to.equal(false)
  })

  it('persists reviewed manual candidate links for unsequenced rows even when titles differ materially', async () => {
    await stubExpandedLibraryItems()
    const { libraryItem } = await createBookFixture({
      title: 'Legends Volume One',
      relPath: 'Herbert, Frank/Legends of Dune - Book 1',
      authors: ['Brian Herbert', 'Kevin J. Anderson']
    })

    const importResult = await SeriesReviewManager.importCatalogForLibrary(library.id, [
      {
        seriesName: 'Dune Saga',
        entries: [
          {
            title: 'The Butlerian Jihad',
            authors: ['Frank Herbert'],
            publishedDate: '2002',
            sources: [{ source: 'fantasticfiction', label: 'FF', confidence: 0.9, evidenceUrl: 'https://www.fantasticfiction.com/h/frank-herbert/dune/' }]
          }
        ]
      }
    ])

    await SeriesReviewManager.importSuggestionsForLibrary(library.id, [
      {
        libraryItemId: libraryItem.id,
        sourceSuggestions: [
          {
            source: 'catalog',
            label: 'CAT',
            seriesName: 'Dune Saga',
            sequence: null,
            confidence: 0.95,
            rawEvidence: {
              catalogId: importResult.catalogs[0].id,
              rowType: 'unsequenced',
              rowKey: 'unsequenced:thebutlerianjihadunsequenced',
              entryKey: 'the butlerian jihad::unsequenced',
              expectedTitle: 'The Butlerian Jihad',
              expectedSeriesName: 'Dune Saga'
            }
          }
        ]
      }
    ])

    const queue = await SeriesReviewManager.getQueueForLibrary(library.id, true)
    const row = queue.find((entry) => entry.libraryItemId === libraryItem.id)
    const suggestion = row.suggestions.find((entry) => entry.suggestedName === 'Dune Saga')
    await SeriesReviewManager.applySuggestion(suggestion.id, user.id, 'add')

    const detail = await SeriesReviewManager.getCatalogDetailForLibrary(library.id, importResult.catalogs[0].id)
    const unsequencedRow = detail.rows.find((candidate) => candidate.rowType === 'unsequenced' && candidate.expectedTitle === 'The Butlerian Jihad')

    expect(unsequencedRow).to.exist
    expect(unsequencedRow.localBooks).to.have.length(1)
    expect(unsequencedRow.localBooks[0].title).to.equal('Legends Volume One')
    expect(unsequencedRow.localBooks[0].manualCandidateSuggestionId).to.equal(suggestion.id)
    expect(detail.rows.some((candidate) => candidate.rowKey.startsWith('unsequenced-local:') && candidate.expectedTitle === 'Legends Volume One')).to.equal(false)
  })

  it('keeps source-only unsequenced continuation entries visible in catalog detail', async () => {
    await createBookFixture({
      title: 'Dune',
      currentSeries: [{ name: 'Dune', sequence: '1' }]
    })
    await createBookFixture({
      title: 'Dune Messiah',
      currentSeries: [{ name: 'Dune', sequence: '2' }]
    })
    await createBookFixture({
      title: 'House Atreides',
      currentSeries: [{ name: 'Dune', sequence: '' }]
    })

    const importResult = await SeriesReviewManager.importCatalogForLibrary(library.id, [
      {
        seriesName: 'Dune',
        entries: [
          {
            title: 'Dune',
            authors: ['Frank Herbert'],
            sequence: '',
            publishedDate: '1965',
            sources: [{ source: 'fictiondb', label: 'FDB', confidence: 0.92 }]
          },
          {
            title: 'Dune Messiah',
            authors: ['Frank Herbert'],
            sequence: '',
            publishedDate: '1970',
            sources: [{ source: 'fictiondb', label: 'FDB', confidence: 0.92 }]
          },
          {
            title: 'House Atreides',
            authors: ['Brian Herbert; Anderson, Kevin J.'],
            sequence: '',
            publishedDate: 'Oct-1999',
            sources: [{ source: 'fictiondb', label: 'FDB', confidence: 0.92 }]
          }
        ]
      }
    ])

    const detail = await SeriesReviewManager.getCatalogDetailForLibrary(library.id, importResult.catalogs[0].id)
    expect(detail.rows.map((row) => row.rowType || 'slot')).to.deep.equal(['slot', 'slot', 'unsequenced'])
    expect(detail.rows[2].title).to.equal('House Atreides')
    expect(detail.rows[2].rowKey).to.match(/^unsequenced:/)
    expect(detail.unsequencedSourceEntries.map((entry) => entry.title)).to.deep.equal(['House Atreides'])
    expect(detail.unsequencedSourceEntries[0].authors).to.deep.equal(['Brian Herbert; Anderson, Kevin J.'])
  })

  it('keeps unsequenced source rows actionable with local coverage and candidate search', async () => {
    await createBookFixture({
      title: 'House Atreides',
      currentSeries: [{ name: 'Dune', sequence: '' }]
    })
    await createBookFixture({
      title: 'House Atreides: Prelude',
      relPath: 'Herbert, Brian/House Atreides Prelude',
      authors: ['Brian Herbert', 'Kevin J. Anderson']
    })

    const importResult = await SeriesReviewManager.importCatalogForLibrary(library.id, [
      {
        seriesName: 'Dune',
        entries: [
          {
            title: 'House Atreides',
            authors: ['Brian Herbert; Anderson, Kevin J.'],
            sequence: '',
            publishedDate: 'Oct-1999',
            sources: [{ source: 'fictiondb', label: 'FDB', confidence: 0.92 }]
          }
        ]
      }
    ])

    const detail = await SeriesReviewManager.getCatalogDetailForLibrary(library.id, importResult.catalogs[0].id)
    const unsequencedRow = detail.rows.find((row) => row.rowType === 'unsequenced')

    expect(unsequencedRow).to.exist
    expect(unsequencedRow.localBooks).to.have.length(1)
    expect(unsequencedRow.localBooks[0].title).to.equal('House Atreides')

    const candidates = await SeriesReviewManager.findCatalogSlotCandidates(library.id, importResult.catalogs[0].id, unsequencedRow.slot)
    expect(candidates.expectedTitle).to.equal('House Atreides')
    expect(candidates.rowType).to.equal('unsequenced')
    expect(candidates.results.length).to.be.greaterThan(0)

    const queued = await SeriesReviewManager.queueCatalogCandidateForReview(
      library.id,
      importResult.catalogs[0].id,
      unsequencedRow.slot,
      candidates.results[0].libraryItemId
    )

    expect(queued.queued).to.equal(true)
    expect(queued.rowType).to.equal('unsequenced')

    const pendingRows = await SeriesReviewManager.getQueueForLibrary(library.id, false)
    expect(pendingRows).to.have.length(1)
    expect(pendingRows[0].suggestions[0].suggestedName).to.equal('Dune')
    expect(pendingRows[0].suggestions[0].suggestedSequence).to.equal(null)
  })

  it('keeps local-only unsequenced books in the main actionable rows', async () => {
    await createBookFixture({
      title: 'Expanse Stories',
      currentSeries: [{ name: 'The Expanse', sequence: '' }]
    })
    await createBookFixture({
      title: 'Expanse Stories Companion',
      relPath: 'Corey, James S. A./Expanse Stories Companion',
      authors: ['James S. A. Corey']
    })

    const importResult = await SeriesReviewManager.importCatalogForLibrary(library.id, [
      {
        seriesName: 'The Expanse',
        entries: [
          {
            title: 'Leviathan Wakes',
            sequence: '1',
            sources: [{ source: 'fictiondb', label: 'FDB', confidence: 0.95 }]
          }
        ]
      }
    ])

    const detail = await SeriesReviewManager.getCatalogDetailForLibrary(library.id, importResult.catalogs[0].id)
    const row = detail.rows.find((candidate) => candidate.rowType === 'unsequenced' && candidate.title === 'Expanse Stories')

    expect(row).to.exist
    expect(row.localBooks).to.have.length(1)
    expect(row.localBooks[0].title).to.equal('Expanse Stories')

    const candidates = await SeriesReviewManager.findCatalogSlotCandidates(library.id, importResult.catalogs[0].id, row.slot)
    expect(candidates.rowType).to.equal('unsequenced')
    expect(candidates.expectedTitle).to.equal('Expanse Stories')
  })

  it('keeps local-only omnibus books in the main actionable rows', async () => {
    await createBookFixture({
      title: 'Android X: The Complete Series',
      currentSeries: [{ name: 'Android X', sequence: '1-3' }]
    })

    const importResult = await SeriesReviewManager.importCatalogForLibrary(library.id, [
      {
        seriesName: 'Android X',
        entries: [
          {
            title: 'Android Paradox',
            sequence: '1',
            sources: [{ source: 'audible', label: 'AUD', confidence: 0.93 }]
          }
        ]
      }
    ])

    const detail = await SeriesReviewManager.getCatalogDetailForLibrary(library.id, importResult.catalogs[0].id)
    const row = detail.rows.find((candidate) => candidate.rowType === 'omnibus' && candidate.title === 'Android X: The Complete Series')

    expect(row).to.exist
    expect(row.localBooks).to.have.length(1)
    expect(row.localBooks[0].sequence).to.equal('1-3')
  })

  it('prunes unsupported local series books after a rebuild-style catalog restore', async () => {
    await stubExpandedLibraryItems()
    const supported = await createBookFixture({
      title: 'A Court of Thorns and Roses',
      currentSeries: [{ name: 'Court of Thorns and Roses', sequence: '1' }]
    })
    const stale = await createBookFixture({
      title: 'A Court of Silver Flames',
      currentSeries: [{ name: 'Court of Thorns and Roses', sequence: '5' }]
    })

    const importResult = await SeriesReviewManager.importCatalogForLibrary(library.id, [
      {
        seriesName: 'Court of Thorns and Roses',
        entries: [
          {
            title: 'A Court of Thorns and Roses',
            sequence: '1',
            sources: [{ source: 'fictiondb', label: 'FDB', confidence: 0.95 }]
          },
          {
            title: 'A Court of Mist and Fury',
            sequence: '2',
            sources: [{ source: 'fictiondb', label: 'FDB', confidence: 0.95 }]
          },
          {
            title: 'A Court of Wings and Ruin',
            sequence: '3',
            sources: [{ source: 'fictiondb', label: 'FDB', confidence: 0.95 }]
          },
          {
            title: 'A Court of Frost and Starlight',
            sequence: '3.5',
            sources: [{ source: 'fictiondb', label: 'FDB', confidence: 0.95 }]
          }
        ]
      }
    ])

    const before = await SeriesReviewManager.getCatalogDetailForLibrary(library.id, importResult.catalogs[0].id)
    expect(before.rows.find((row) => row.slot === '5')?.localBooks?.[0]?.title).to.equal('A Court of Silver Flames')

    const pruneResult = await SeriesReviewManager.pruneUnsupportedLocalSeriesBooksForCatalog(library.id, importResult.catalogs[0].id, {
      detail: before
    })

    expect(pruneResult.removedCount).to.equal(1)
    expect(pruneResult.detail.rows.find((row) => row.slot === '5')).to.equal(undefined)

    const refreshedStaleBook = await Database.libraryItemModel.getExpandedById(stale.libraryItem.id)
    const refreshedSupportedBook = await Database.libraryItemModel.getExpandedById(supported.libraryItem.id)
    expect((refreshedStaleBook.media.series || []).map((series) => series.name)).to.deep.equal([])
    expect((refreshedSupportedBook.media.series || []).map((series) => series.name)).to.deep.equal(['Court of Thorns and Roses'])
  })

  it('stores preferred slot interpretations for disputed catalog slots', async () => {
    const importResult = await SeriesReviewManager.importCatalogForLibrary(library.id, [
      {
        seriesName: 'The Expanse',
        entries: [
          {
            title: 'Nemesis Games',
            sequence: '5',
            sources: [{ source: 'fictiondb', label: 'FDB', confidence: 0.9 }]
          },
          {
            title: 'Nemesis Game',
            sequence: '5',
            sources: [{ source: 'wikidata', label: 'WD', confidence: 0.62 }]
          }
        ]
      }
    ])

    const initialDetail = await SeriesReviewManager.getCatalogDetailForLibrary(library.id, importResult.catalogs[0].id)
    expect(initialDetail.slots.find((slot) => slot.slot === '5').status).to.equal('disputed')

    const selectedDetail = await SeriesReviewManager.chooseCatalogSlotEntry(
      library.id,
      importResult.catalogs[0].id,
      '5',
      initialDetail.slots.find((slot) => slot.slot === '5').choices[0].entryKey
    )

    expect(selectedDetail.slots.find((slot) => slot.slot === '5').selectedEntryKey).to.be.a('string')
    expect(selectedDetail.slots.find((slot) => slot.slot === '5').status).to.equal('missing')
  })

  it('finds ranked catalog candidates and keeps path-heavy matches visible', async () => {
    await createBookFixture({
      title: 'Barrayar',
      relPath: 'Bujold, Lois McMaster/Barrayar',
      authors: ['Lois McMaster Bujold']
    })
    await createBookFixture({
      title: 'Disc 01',
      relPath: 'Bujold, Lois McMaster/Barrayar (Folder Only Match)',
      authors: ['Unknown Narrator']
    })
    await createBookFixture({
      title: 'Unrelated Book',
      relPath: 'Other/Unrelated Book',
      authors: ['Somebody Else']
    })

    const importResult = await SeriesReviewManager.importCatalogForLibrary(library.id, [
      {
        seriesName: 'Vorkosigan Saga',
        entries: [
          {
            title: 'Barrayar',
            authors: ['Lois McMaster Bujold'],
            sequence: '2',
            sources: [{ source: 'fictiondb', label: 'FDB', confidence: 0.95 }]
          }
        ]
      }
    ])

    const candidates = await SeriesReviewManager.findCatalogSlotCandidates(library.id, importResult.catalogs[0].id, '2')
    expect(candidates.expectedTitle).to.equal('Barrayar')
    expect(candidates.results).to.have.length(2)
    expect(candidates.results[0].title).to.equal('Barrayar')
    expect(candidates.results[0].reasons.map((reason) => reason.key)).to.include('title-exact')
    expect(candidates.results[1].title).to.equal('Disc 01')
    expect(candidates.results[1].reasons.map((reason) => reason.key)).to.include('path-title')
  })

  it('finds bulk catalog candidate suggestions for selected row scopes only', async () => {
    await createBookFixture({
      title: 'Barrayar',
      relPath: 'Bujold, Lois McMaster/Barrayar',
      authors: ['Lois McMaster Bujold']
    })
    await createBookFixture({
      title: 'Vorkosigan Saga Collection',
      relPath: 'Bujold, Lois McMaster/Vorkosigan Saga Collection',
      authors: ['Lois McMaster Bujold']
    })

    const importResult = await SeriesReviewManager.importCatalogForLibrary(library.id, [
      {
        seriesName: 'Vorkosigan Saga',
        entries: [
          {
            title: 'Barrayar',
            authors: ['Lois McMaster Bujold'],
            sequence: '2',
            sources: [{ source: 'fictiondb', label: 'FDB', confidence: 0.95 }]
          },
          {
            title: 'Vorkosigan Saga Collection',
            authors: ['Lois McMaster Bujold'],
            sequence: '1-3',
            sources: [{ source: 'fictiondb', label: 'FDB', confidence: 0.95 }]
          }
        ]
      }
    ])

    const suggestions = await SeriesReviewManager.findBulkCatalogCandidateSuggestions(library.id, importResult.catalogs[0].id, {
      includeNormal: true,
      includeUnsequenced: true,
      includeDecimal: false,
      includeOmnibus: false
    })

    expect(suggestions.rows).to.have.length(1)
    expect(suggestions.rows[0].rowType).to.equal('slot')
    expect(suggestions.rows[0].results[0].title).to.equal('Barrayar')
  })

  it('queues a selected catalog candidate into the existing series review flow without mutating metadata', async () => {
    const { libraryItem } = await createBookFixture({
      title: 'Barrayar',
      relPath: 'Bujold, Lois McMaster/Barrayar',
      authors: ['Lois McMaster Bujold']
    })

    const importResult = await SeriesReviewManager.importCatalogForLibrary(library.id, [
      {
        seriesName: 'Vorkosigan Saga',
        entries: [
          {
            title: 'Barrayar',
            authors: ['Lois McMaster Bujold'],
            sequence: '2',
            sources: [{ source: 'fictiondb', label: 'FDB', confidence: 0.95 }]
          }
        ]
      }
    ])

    const queueResult = await SeriesReviewManager.queueCatalogCandidateForReview(library.id, importResult.catalogs[0].id, '2', libraryItem.id)
    expect(queueResult.queued).to.equal(true)
    expect(queueResult.importedCount).to.equal(1)

    const pendingRows = await SeriesReviewManager.getQueueForLibrary(library.id, false)
    expect(pendingRows).to.have.length(1)
    expect(pendingRows[0].title).to.equal('Barrayar')
    expect(pendingRows[0].suggestions[0].suggestedName).to.equal('Vorkosigan Saga')
    expect(pendingRows[0].suggestions[0].suggestedSequence).to.equal('2')

    const updatedLibraryItem = await Database.libraryItemModel.getExpandedById(libraryItem.id)
    expect(updatedLibraryItem.media.series).to.have.length(0)
  })

  it('accepts a selected catalog candidate directly into local coverage', async () => {
    await stubExpandedLibraryItems()
    const { libraryItem } = await createBookFixture({
      title: 'Barrayar',
      relPath: 'Bujold, Lois McMaster/Barrayar',
      authors: ['Lois McMaster Bujold']
    })

    const importResult = await SeriesReviewManager.importCatalogForLibrary(library.id, [
      {
        seriesName: 'Vorkosigan Saga',
        entries: [
          {
            title: 'Barrayar',
            authors: ['Lois McMaster Bujold'],
            sequence: '2',
            sources: [{ source: 'fictiondb', label: 'FDB', confidence: 0.95 }]
          }
        ]
      }
    ])

    const accepted = await SeriesReviewManager.acceptCatalogCandidateForLibrary(
      library.id,
      importResult.catalogs[0].id,
      '2',
      libraryItem.id,
      null
    )

    expect(accepted.accepted).to.equal(true)
    expect(accepted.suggestionId).to.be.a('string')
    expect(accepted.detail.rows.find((row) => row.slot === '2').localBooks[0].manualCandidateSuggestionId).to.equal(accepted.suggestionId)

    const updatedLibraryItem = await Database.libraryItemModel.getExpandedById(libraryItem.id)
    expect(updatedLibraryItem.media.series.map((series) => series.name)).to.include('Vorkosigan Saga')

    const appliedSuggestion = await Database.seriesReviewSuggestionModel.findByPk(accepted.suggestionId)
    expect(appliedSuggestion.state).to.equal('applied')
  })

  it('can replace a selected existing series when accepting a catalog candidate', async () => {
    await stubExpandedLibraryItems()
    const { libraryItem } = await createBookFixture({
      title: 'Barrayar',
      relPath: 'Bujold, Lois McMaster/Barrayar',
      authors: ['Lois McMaster Bujold'],
      currentSeries: [{ name: 'Old Saga', sequence: '2' }]
    })
    const expandedLibraryItem = await Database.libraryItemModel.getExpandedById(libraryItem.id)
    const oldSeriesId = expandedLibraryItem.media.series[0].id

    const importResult = await SeriesReviewManager.importCatalogForLibrary(library.id, [
      {
        seriesName: 'Vorkosigan Saga',
        entries: [
          {
            title: 'Barrayar',
            authors: ['Lois McMaster Bujold'],
            sequence: '2',
            sources: [{ source: 'fictiondb', label: 'FDB', confidence: 0.95 }]
          }
        ]
      }
    ])

    const accepted = await SeriesReviewManager.acceptCatalogCandidateForLibrary(
      library.id,
      importResult.catalogs[0].id,
      '2',
      libraryItem.id,
      null,
      oldSeriesId
    )

    expect(accepted.decisionAction).to.equal('replace')
    expect(accepted.replacedSeriesId).to.equal(oldSeriesId)

    const updatedLibraryItem = await Database.libraryItemModel.getExpandedById(libraryItem.id)
    expect(updatedLibraryItem.media.series.map((series) => series.name)).to.deep.equal(['Vorkosigan Saga'])

    const updatedSuggestion = await Database.seriesReviewSuggestionModel.findByPk(accepted.suggestionId)
    expect(updatedSuggestion.state).to.equal('manual_override')
    expect(updatedSuggestion.decisionAction).to.equal('replace')
    expect(updatedSuggestion.decisionSeriesId).to.equal(oldSeriesId)
  })

  it('dismisses and restores a catalog without letting import overwrite the hidden state', async () => {
    const importResult = await SeriesReviewManager.importCatalogForLibrary(library.id, [
      {
        seriesName: 'The Lost Fleet',
        trustStatus: 'trusted',
        entries: [
          {
            title: 'Dauntless',
            sequence: '1',
            sources: [{ source: 'fictiondb', label: 'FDB', confidence: 0.92 }]
          }
        ]
      }
    ])

    const catalogId = importResult.catalogs[0].id
    const dismissedDetail = await SeriesReviewManager.setCatalogVisibilityForLibrary(library.id, catalogId, 'dismissed')
    expect(dismissedDetail.catalog.visibilityStatus).to.equal('dismissed')
    expect(dismissedDetail.catalog.displayBucket).to.equal('dismissed')

    const visibleCatalogs = await SeriesReviewManager.getCatalogsForLibrary(library.id, true, false)
    expect(visibleCatalogs).to.have.length(0)

    await SeriesReviewManager.importCatalogForLibrary(library.id, [
      {
        seriesName: 'The Lost Fleet',
        trustStatus: 'trusted',
        entries: [
          {
            title: 'Dauntless',
            sequence: '1',
            sources: [{ source: 'fictiondb', label: 'FDB', confidence: 0.95 }]
          }
        ]
      }
    ])

    const withDismissed = await SeriesReviewManager.getCatalogsForLibrary(library.id, true, true)
    expect(withDismissed).to.have.length(1)
    expect(withDismissed[0].visibilityStatus).to.equal('dismissed')

    const restoredDetail = await SeriesReviewManager.setCatalogVisibilityForLibrary(library.id, catalogId, 'visible')
    expect(restoredDetail.catalog.visibilityStatus).to.equal('visible')
  })

  it('marks a catalog as checked and keeps checked local-only series out of the linked bucket', async () => {
    await createBookFixture({
      title: 'The Blade Itself',
      currentSeries: [{ name: 'The First Law', sequence: '1' }],
      authors: ['Joe Abercrombie']
    })

    const localOnlyCatalogId = SeriesReviewManager.buildLocalOnlyCatalogId('first law')
    const checkedDetail = await SeriesReviewManager.setCatalogVisibilityForLibrary(library.id, localOnlyCatalogId, 'checked')
    expect(checkedDetail.catalog.visibilityStatus).to.equal('checked')
    expect(checkedDetail.catalog.displayBucket).to.equal('checked')

    const visibleCatalogs = await SeriesReviewManager.getCatalogsForLibrary(library.id, true, false)
    expect(visibleCatalogs).to.have.length(1)
    expect(visibleCatalogs[0].seriesName).to.equal('The First Law')
    expect(visibleCatalogs[0].displayBucket).to.equal('checked')

    await SeriesReviewManager.rebuildCatalogsForLibrary(library.id)
    const rebuiltCatalogs = await SeriesReviewManager.getCatalogsForLibrary(library.id, true, false)
    expect(rebuiltCatalogs).to.have.length(1)
    expect(rebuiltCatalogs[0].displayBucket).to.equal('checked')

    const uncheckedDetail = await SeriesReviewManager.setCatalogVisibilityForLibrary(library.id, checkedDetail.catalog.id, 'visible')
    expect(uncheckedDetail.catalog.visibilityStatus).to.equal('visible')
  })

  it('renames persisted series source links when a local series label is renamed', async () => {
    const sourceUrl = 'https://www.fictiondb.com/series/polity~123.htm'
    await Database.seriesReviewSeriesSourceLinkModel.create({
      libraryId: library.id,
      localDecisionKey: 'polity chronological',
      localSeriesName: 'Polity (Chronological)',
      source: 'fictiondb',
      sourceSeriesName: 'Polity',
      sourceSeriesUrl: sourceUrl,
      evidenceSnapshot: {
        matchingBooks: [
          {
            localTitle: 'Gridlinked',
            sourceTitle: 'Gridlinked',
            sourceSequence: '1'
          }
        ],
        seriesBooks: [
          {
            title: 'Gridlinked',
            sequence: '1'
          }
        ]
      }
    })

    const result = await SeriesReviewManager.renameSeriesSourceLinksForLibrary(library.id, 'Polity (Chronological)', 'Polity (Chrono)')
    expect(result.updatedCount).to.equal(1)
    expect(result.mergedCount).to.equal(0)

    const updatedRow = await Database.seriesReviewSeriesSourceLinkModel.findOne({
      where: {
        libraryId: library.id,
        sourceSeriesUrl: sourceUrl
      }
    })
    expect(updatedRow.localDecisionKey).to.equal('polity chrono')
    expect(updatedRow.localSeriesName).to.equal('Polity (Chrono)')

    const payload = SeriesReviewManager.buildSeriesSourceLinkPayload(updatedRow, {
      localBooks: []
    })
    expect(payload.seriesBooks).to.deep.equal([
      {
        title: 'Gridlinked',
        sequence: '1',
        publishedDate: null,
        authors: [],
        sourceUrl: '',
        sourceAsin: '',
        sourceRegion: ''
      }
    ])
  })
})
