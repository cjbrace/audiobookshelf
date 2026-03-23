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
    expect(rows.map((row) => row.title)).to.deep.equal(['Conflict A', 'Conflict B', 'Conflict C'])
    expect(rows.map((row) => row.conflictType)).to.deep.equal(['no_series_conflict', 'ordinal_conflict', 'series_name_conflict'])
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
    expect(decidedRows[0].suggestions[0].state).to.equal('applied')
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

  it('keeps prior decision metadata on reopened pending rows so the UI can explain why they returned', async () => {
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
    expect(pendingRows).to.have.length(1)
    expect(pendingRows[0].suggestions[0].state).to.equal('pending')
    expect(pendingRows[0].suggestions[0].previousDecision).to.include({
      action: 'add',
      reopened: true
    })
    expect(pendingRows[0].suggestions[0].hasMeaningfulUpdateSinceDecision).to.equal(true)
    expect(pendingRows[0].suggestions[0].contributions[0].notes).to.equal('Lower confidence after source refresh')
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

    const catalogs = await SeriesReviewManager.getCatalogsForLibrary(library.id)
    expect(catalogs).to.have.length(1)
    expect(catalogs[0].seriesName).to.equal('The Expanse')
    expect(catalogs[0].missingCount).to.equal(5)
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
})
