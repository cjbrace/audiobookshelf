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

  async function createBookFixture({ title, currentSeries = [], relPath = null, tags = [] }) {
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
})
