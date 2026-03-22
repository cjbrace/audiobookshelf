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

  async function createBookFixture({ title, currentSeries = [] }) {
    const book = await Database.bookModel.create({ title, audioFiles: [], tags: [], narrators: [], genres: [], chapters: [] })
    const libraryItem = await Database.libraryItemModel.create({
      path: `/series-review/${title}`,
      relPath: title,
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
    const { libraryItem } = await createBookFixture({ title: 'Summer Knight' })

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

    const actionableSuggestion = rows[0].suggestions.find((suggestion) => suggestion.kind === 'series')
    expect(actionableSuggestion.suggestedName).to.equal('The Dresden Files')
    expect(actionableSuggestion.suggestedSequence).to.equal('4')
    expect(actionableSuggestion.contributions.map((contribution) => contribution.source)).to.deep.equal(['fictiondb', 'wikidata'])

    const noSeriesSuggestion = rows[0].suggestions.find((suggestion) => suggestion.kind === 'no_series')
    expect(noSeriesSuggestion.contributions).to.have.length(1)
    expect(noSeriesSuggestion.contributions[0].source).to.equal('goodreads')
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

    const decidedRows = await SeriesReviewManager.getQueueForLibrary(library.id, true)
    expect(decidedRows[0].suggestions[0].state).to.equal('manual_override')
    expect(decidedRows[0].suggestions[0].decisionSeriesId).to.equal(replaceSeriesId)
  })

  it('persists dismiss decisions so reruns do not reopen the suggestion', async () => {
    const { libraryItem } = await createBookFixture({ title: 'Ascendant' })

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
  })
})
