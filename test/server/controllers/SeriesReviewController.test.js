const { expect } = require('chai')
const sinon = require('sinon')

const SeriesReviewController = require('../../../server/controllers/SeriesReviewController')
const SeriesReviewManager = require('../../../server/managers/SeriesReviewManager')

describe('SeriesReviewController', () => {
  afterEach(() => {
    sinon.restore()
  })

  it('returns 400 instead of throwing when replace target is missing on the book', async () => {
    sinon.stub(SeriesReviewManager, 'applySuggestion').rejects(new Error('Selected series entry was not found on the book'))

    const req = {
      user: {
        id: 'admin-user',
        isAdminOrUp: true
      },
      params: {
        suggestionId: 'suggestion-1'
      },
      body: {
        replaceSeriesId: 'missing-series-id'
      }
    }
    const res = {
      status: sinon.stub().returnsThis(),
      send: sinon.spy(),
      sendStatus: sinon.spy(),
      json: sinon.spy()
    }

    await SeriesReviewController.replaceSuggestion(req, res)

    expect(res.status.calledOnceWithExactly(400)).to.be.true
    expect(res.send.calledOnceWithExactly('Selected series entry was not found on the book')).to.be.true
    expect(res.sendStatus.notCalled).to.be.true
    expect(res.json.notCalled).to.be.true
  })

  it('returns 400 instead of throwing when remove target is missing on the book', async () => {
    sinon.stub(SeriesReviewManager, 'removeSeriesEntry').rejects(new Error('Selected series entry was not found on the book'))

    const req = {
      user: {
        id: 'admin-user',
        isAdminOrUp: true
      },
      params: {
        libraryItemId: 'library-item-1'
      },
      body: {
        seriesId: 'missing-series-id'
      }
    }
    const res = {
      status: sinon.stub().returnsThis(),
      send: sinon.spy(),
      sendStatus: sinon.spy(),
      json: sinon.spy()
    }

    await SeriesReviewController.removeSeries(req, res)

    expect(res.status.calledOnceWithExactly(400)).to.be.true
    expect(res.send.calledOnceWithExactly('Selected series entry was not found on the book')).to.be.true
    expect(res.sendStatus.notCalled).to.be.true
    expect(res.json.notCalled).to.be.true
  })

  it('resets suggestions for explicit library item ids', async () => {
    sinon.stub(SeriesReviewManager, 'resetSuggestionsForLibrary').resolves({ deletedCount: 3 })

    const req = {
      user: {
        isAdminOrUp: true
      },
      library: {
        id: 'library-1',
        isBook: true
      },
      body: {
        libraryItemIds: ['item-1', 'item-2']
      }
    }
    const res = {
      status: sinon.stub().returnsThis(),
      send: sinon.spy(),
      sendStatus: sinon.spy(),
      json: sinon.spy()
    }

    await SeriesReviewController.resetSuggestions(req, res)

    expect(SeriesReviewManager.resetSuggestionsForLibrary.calledOnceWithExactly('library-1', ['item-1', 'item-2'])).to.be.true
    expect(res.json.calledOnceWithExactly({ deletedCount: 3 })).to.be.true
    expect(res.status.notCalled).to.be.true
    expect(res.send.notCalled).to.be.true
    expect(res.sendStatus.notCalled).to.be.true
  })

  it('returns management candidates and recent actions for the library', async () => {
    sinon.stub(SeriesReviewManager, 'getSeriesManagementCandidatesForLibrary').resolves([{ groupKey: 'g1' }])
    sinon.stub(SeriesReviewManager, 'getRecentSeriesManagementActionsForLibrary').resolves([{ id: 'a1' }])

    const req = {
      user: {
        isAdminOrUp: true
      },
      library: {
        id: 'library-1',
        isBook: true
      }
    }
    const res = {
      status: sinon.stub().returnsThis(),
      send: sinon.spy(),
      sendStatus: sinon.spy(),
      json: sinon.spy()
    }

    await SeriesReviewController.getManagementData(req, res)

    expect(res.json.calledOnceWithExactly({ candidates: [{ groupKey: 'g1' }], recentActions: [{ id: 'a1' }] })).to.be.true
  })

  it('returns catalog summaries for the library', async () => {
    sinon.stub(SeriesReviewManager, 'getCatalogsForLibrary').resolves([{ id: 'catalog-1' }])

    const req = {
      user: {
        isAdminOrUp: true
      },
      library: {
        id: 'library-1',
        isBook: true
      },
      query: {
        includeUntrusted: '1'
      }
    }
    const res = {
      status: sinon.stub().returnsThis(),
      send: sinon.spy(),
      sendStatus: sinon.spy(),
      json: sinon.spy()
    }

    await SeriesReviewController.getCatalogs(req, res)

    expect(SeriesReviewManager.getCatalogsForLibrary.calledOnceWithExactly('library-1', true)).to.be.true
    expect(res.json.calledOnceWithExactly({ catalogs: [{ id: 'catalog-1' }] })).to.be.true
  })

  it('returns catalog detail for the library', async () => {
    sinon.stub(SeriesReviewManager, 'getCatalogDetailForLibrary').resolves({ catalog: { id: 'catalog-1' }, slots: [] })

    const req = {
      user: {
        isAdminOrUp: true
      },
      library: {
        id: 'library-1',
        isBook: true
      },
      params: {
        catalogId: 'catalog-1'
      }
    }
    const res = {
      status: sinon.stub().returnsThis(),
      send: sinon.spy(),
      sendStatus: sinon.spy(),
      json: sinon.spy()
    }

    await SeriesReviewController.getCatalogDetail(req, res)

    expect(res.json.calledOnceWithExactly({ catalog: { id: 'catalog-1' }, slots: [] })).to.be.true
  })

  it('imports catalog rows for the library', async () => {
    sinon.stub(SeriesReviewManager, 'importCatalogForLibrary').resolves({ importedCount: 1 })

    const req = {
      user: {
        isAdminOrUp: true
      },
      library: {
        id: 'library-1',
        isBook: true
      },
      body: {
        rows: [{ seriesName: 'The Expanse', entries: [] }]
      }
    }
    const res = {
      status: sinon.stub().returnsThis(),
      send: sinon.spy(),
      sendStatus: sinon.spy(),
      json: sinon.spy()
    }

    await SeriesReviewController.importCatalog(req, res)

    expect(SeriesReviewManager.importCatalogForLibrary.calledOnceWithExactly('library-1', [{ seriesName: 'The Expanse', entries: [] }])).to.be.true
    expect(res.json.calledOnceWithExactly({ importedCount: 1 })).to.be.true
  })

  it('returns 400 instead of throwing when choosing a slot interpretation fails', async () => {
    sinon.stub(SeriesReviewManager, 'chooseCatalogSlotEntry').rejects(new Error('Selected interpretation was not found for that slot'))

    const req = {
      user: {
        isAdminOrUp: true
      },
      library: {
        id: 'library-1',
        isBook: true
      },
      params: {
        catalogId: 'catalog-1'
      },
      body: {
        slot: '3',
        entryKey: 'entry-1'
      }
    }
    const res = {
      status: sinon.stub().returnsThis(),
      send: sinon.spy(),
      sendStatus: sinon.spy(),
      json: sinon.spy()
    }

    await SeriesReviewController.chooseCatalogSlot(req, res)

    expect(res.status.calledOnceWithExactly(400)).to.be.true
    expect(res.send.calledOnceWithExactly('Selected interpretation was not found for that slot')).to.be.true
  })

  it('returns catalog slot candidates for the library', async () => {
    sinon.stub(SeriesReviewManager, 'findCatalogSlotCandidates').resolves({ slot: '3', results: [{ libraryItemId: 'item-1' }] })

    const req = {
      user: {
        isAdminOrUp: true
      },
      library: {
        id: 'library-1',
        isBook: true
      },
      params: {
        catalogId: 'catalog-1'
      },
      body: {
        slot: '3'
      }
    }
    const res = {
      status: sinon.stub().returnsThis(),
      send: sinon.spy(),
      sendStatus: sinon.spy(),
      json: sinon.spy()
    }

    await SeriesReviewController.findCatalogCandidates(req, res)

    expect(SeriesReviewManager.findCatalogSlotCandidates.calledOnceWithExactly('library-1', 'catalog-1', '3')).to.be.true
    expect(res.json.calledOnceWithExactly({ slot: '3', results: [{ libraryItemId: 'item-1' }] })).to.be.true
  })

  it('queues a selected catalog candidate into the review flow', async () => {
    sinon.stub(SeriesReviewManager, 'queueCatalogCandidateForReview').resolves({ queued: true, libraryItemId: 'item-1' })

    const req = {
      user: {
        isAdminOrUp: true
      },
      library: {
        id: 'library-1',
        isBook: true
      },
      params: {
        catalogId: 'catalog-1'
      },
      body: {
        slot: '3',
        libraryItemId: 'item-1'
      }
    }
    const res = {
      status: sinon.stub().returnsThis(),
      send: sinon.spy(),
      sendStatus: sinon.spy(),
      json: sinon.spy()
    }

    await SeriesReviewController.queueCatalogCandidate(req, res)

    expect(SeriesReviewManager.queueCatalogCandidateForReview.calledOnceWithExactly('library-1', 'catalog-1', '3', 'item-1')).to.be.true
    expect(res.json.calledOnceWithExactly({ queued: true, libraryItemId: 'item-1' })).to.be.true
  })

  it('returns 400 instead of throwing when management preview input is invalid', async () => {
    sinon.stub(SeriesReviewManager, 'previewSeriesManagementAction').rejects(new Error('Missing targetLabel'))

    const req = {
      user: {
        isAdminOrUp: true
      },
      library: {
        id: 'library-1',
        isBook: true
      },
      body: {
        sourceSeriesIds: ['series-1']
      }
    }
    const res = {
      status: sinon.stub().returnsThis(),
      send: sinon.spy(),
      sendStatus: sinon.spy(),
      json: sinon.spy()
    }

    await SeriesReviewController.previewManagementAction(req, res)

    expect(res.status.calledOnceWithExactly(400)).to.be.true
    expect(res.send.calledOnceWithExactly('Missing targetLabel')).to.be.true
  })
})
