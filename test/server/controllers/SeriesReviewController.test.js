const { expect } = require('chai')
const sinon = require('sinon')

const SeriesReviewController = require('../../../server/controllers/SeriesReviewController')
const SeriesReviewManager = require('../../../server/managers/SeriesReviewManager')
const SeriesImportBridgeManager = require('../../../server/managers/SeriesImportBridgeManager')

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

  it('creates an alias relationship between two suggestions on the same row', async () => {
    sinon.stub(SeriesReviewManager, 'aliasSuggestion').resolves({ canonicalName: 'Witches' })

    const req = {
      user: {
        id: 'admin-user',
        isAdminOrUp: true
      },
      params: {
        suggestionId: 'alias-suggestion'
      },
      body: {
        primarySuggestionId: 'primary-suggestion'
      }
    }
    const res = {
      status: sinon.stub().returnsThis(),
      send: sinon.spy(),
      sendStatus: sinon.spy(),
      json: sinon.spy()
    }

    await SeriesReviewController.aliasSuggestion(req, res)

    expect(SeriesReviewManager.aliasSuggestion.calledOnceWithExactly('alias-suggestion', 'primary-suggestion', 'admin-user')).to.be.true
    expect(res.json.calledOnceWithExactly({ canonicalName: 'Witches' })).to.be.true
  })

  it('renames a suggestion to the chosen canonical label', async () => {
    sinon.stub(SeriesReviewManager, 'renameSuggestion').resolves({ canonicalName: 'Rain Wilds Chronicles', renameResult: { changedCount: 2, conflictCount: 0 } })

    const req = {
      user: {
        id: 'admin-user',
        isAdminOrUp: true
      },
      params: {
        suggestionId: 'rename-suggestion'
      },
      body: {
        targetLabel: 'Rain Wilds Chronicles'
      }
    }
    const res = {
      status: sinon.stub().returnsThis(),
      send: sinon.spy(),
      sendStatus: sinon.spy(),
      json: sinon.spy()
    }

    await SeriesReviewController.renameSuggestion(req, res)

    expect(SeriesReviewManager.renameSuggestion.calledOnceWithExactly('rename-suggestion', 'Rain Wilds Chronicles', 'admin-user')).to.be.true
    expect(res.json.calledOnceWithExactly({ canonicalName: 'Rain Wilds Chronicles', renameResult: { changedCount: 2, conflictCount: 0 } })).to.be.true
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

    expect(SeriesReviewManager.getCatalogsForLibrary.calledOnceWithExactly('library-1', true, false)).to.be.true
    expect(res.json.calledOnceWithExactly({ catalogs: [{ id: 'catalog-1' }] })).to.be.true
  })

  it('returns trusted source import status for the library', async () => {
    sinon.stub(SeriesImportBridgeManager, 'getStatus').resolves({ has_active_run: true, library_id: 'library-1' })

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

    await SeriesReviewController.getSourceImportStatus(req, res)

    expect(SeriesImportBridgeManager.getStatus.calledOnceWithExactly('library-1')).to.be.true
    expect(res.json.calledOnceWithExactly({ has_active_run: true, library_id: 'library-1' })).to.be.true
  })

  it('starts a trusted source import for the library', async () => {
    sinon.stub(SeriesImportBridgeManager, 'startRun').resolves({ queued: true, job_id: 'job-1' })

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

    await SeriesReviewController.startSourceImport(req, res)

    expect(SeriesImportBridgeManager.startRun.calledOnceWithExactly('library-1')).to.be.true
    expect(res.json.calledOnceWithExactly({ queued: true, job_id: 'job-1' })).to.be.true
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

  it('looks up manual source-series candidates for a local catalog', async () => {
    sinon.stub(SeriesReviewManager, 'buildManualLookupContextForCatalog').resolves({
      localSeriesName: 'Alpha Saga',
      localDecisionKey: 'alpha saga',
      localBooks: [{ libraryItemId: 'item-1', title: 'Alpha Start' }]
    })
    sinon.stub(SeriesImportBridgeManager, 'lookupManualSeries').resolves({
      results: [{ sourceSeriesName: 'Alpha Saga', sourceSeriesUrl: 'https://example.com/alpha' }]
    })
    sinon.stub(SeriesReviewManager, 'getSeriesSourceLinkRowsForLibrary').resolves([
      {
        id: 'link-1',
        localDecisionKey: 'alpha saga',
        localSeriesName: 'Alpha Saga',
        source: 'fictiondb',
        sourceSeriesName: 'Alpha Saga',
        sourceSeriesUrl: 'https://example.com/alpha',
        evidenceSnapshot: { matchingBooks: [{ libraryItemId: 'item-1' }] },
        isActive: true
      }
    ])

    const req = {
      user: { isAdminOrUp: true },
      library: { id: 'library-1', isBook: true },
      params: { catalogId: 'local-series:alpha' }
    }
    const res = {
      status: sinon.stub().returnsThis(),
      send: sinon.spy(),
      sendStatus: sinon.spy(),
      json: sinon.spy()
    }

    await SeriesReviewController.lookupManualCatalogSources(req, res)

    expect(SeriesReviewManager.buildManualLookupContextForCatalog.calledOnceWithExactly('library-1', 'local-series:alpha')).to.be.true
    expect(SeriesReviewManager.getSeriesSourceLinkRowsForLibrary.calledOnceWithExactly('library-1', { localDecisionKey: 'alpha saga' })).to.be.true
    expect(SeriesImportBridgeManager.lookupManualSeries.calledOnceWithExactly('library-1', {
      local_series_name: 'Alpha Saga',
      local_decision_key: 'alpha saga',
      local_books: [{ libraryItemId: 'item-1', title: 'Alpha Start' }]
    })).to.be.true
    expect(res.json.calledOnce).to.be.true
    expect(res.json.firstCall.args[0].results[0]).to.include({
      sourceSeriesName: 'Alpha Saga',
      linkState: 'linked',
      linkStateLabel: 'Linked',
      canLink: false
    })
  })

  it('lists saved local catalog matches for batch import', async () => {
    sinon.stub(SeriesReviewManager, 'getLocalSeriesMatchesForLibrary').resolves([{ id: 'match-1' }])

    const req = {
      user: { isAdminOrUp: true },
      library: { id: 'library-1', isBook: true },
      query: {}
    }
    const res = {
      status: sinon.stub().returnsThis(),
      send: sinon.spy(),
      sendStatus: sinon.spy(),
      json: sinon.spy()
    }

    await SeriesReviewController.getLocalCatalogMatches(req, res)

    expect(SeriesReviewManager.getLocalSeriesMatchesForLibrary.calledOnceWithExactly('library-1', { includeResolved: false, pendingOnly: false })).to.be.true
    expect(res.json.calledOnceWithExactly({ matches: [{ id: 'match-1' }] })).to.be.true
  })

  it('lists pending saved local catalog matches including resolved rows for batch import', async () => {
    sinon.stub(SeriesReviewManager, 'getLocalSeriesMatchesForLibrary').resolves([{ id: 'match-2' }])

    const req = {
      user: { isAdminOrUp: true },
      library: { id: 'library-1', isBook: true },
      query: {
        includeResolved: '1',
        pendingOnly: '1'
      }
    }
    const res = {
      status: sinon.stub().returnsThis(),
      send: sinon.spy(),
      sendStatus: sinon.spy(),
      json: sinon.spy()
    }

    await SeriesReviewController.getLocalCatalogMatches(req, res)

    expect(SeriesReviewManager.getLocalSeriesMatchesForLibrary.calledOnceWithExactly('library-1', { includeResolved: true, pendingOnly: true })).to.be.true
    expect(res.json.calledOnceWithExactly({ matches: [{ id: 'match-2' }] })).to.be.true
  })

  it('saves a selected local source-series link', async () => {
    sinon.stub(SeriesReviewManager, 'getCatalogDetailForLibrary').resolves({
      catalog: { id: 'local-series:alpha', seriesName: 'Alpha Saga' }
    })
    sinon.stub(SeriesReviewManager, 'saveLocalSeriesMatchForSeriesName').resolves({ catalog: { id: 'local-series:alpha' } })

    const req = {
      user: { isAdminOrUp: true },
      library: { id: 'library-1', isBook: true },
      params: { catalogId: 'local-series:alpha' },
      body: { sourceSeriesName: 'Alpha Saga', sourceUrl: 'https://www.fictiondb.com/series/alpha~123.htm' }
    }
    const res = {
      status: sinon.stub().returnsThis(),
      send: sinon.spy(),
      sendStatus: sinon.spy(),
      json: sinon.spy()
    }

    await SeriesReviewController.saveLocalCatalogMatch(req, res)

    expect(SeriesReviewManager.saveLocalSeriesMatchForSeriesName.calledOnceWithExactly('library-1', 'Alpha Saga', '', {
      sourceSeriesName: 'Alpha Saga',
      sourceUrl: 'https://www.fictiondb.com/series/alpha~123.htm'
    }, 'local-series:alpha')).to.be.true
    expect(SeriesReviewManager.getCatalogDetailForLibrary.calledOnceWithExactly('library-1', 'local-series:alpha')).to.be.true
    expect(res.json.calledOnceWithExactly({ catalog: { id: 'local-series:alpha' } })).to.be.true
  })

  it('refreshes a saved local link by persisting the repaired source-series url before import', async () => {
    sinon.stub(SeriesReviewManager, 'getCatalogDetailForLibrary').resolves({
      catalog: {
        id: 'local-series:android-x',
        seriesName: 'Android X',
        evidenceLinks: [{ source: 'audible' }]
      },
      localBooks: [{ libraryItemId: 'item-1', title: 'Android Deception', relPath: 'Books/Android Deception.m4b', authors: [{ name: 'Michael La Ronn' }], seriesName: 'Android X', sequence: '1' }]
    })
    sinon.stub(SeriesImportBridgeManager, 'lookupManualSeries').resolves({
      results: [
        {
          source: 'audible',
          sourceSeriesName: 'Android X',
          sourceAuthor: 'Michael La Ronn',
          sourceUrl: 'https://www.audible.co.uk/pd/B012C5FZPU',
          sourceSeriesUrl: 'https://www.audible.co.uk/series/Android-X-Audiobooks/B012C5FZPU',
          evidenceSnapshot: { sourceSeriesUrl: 'https://www.audible.co.uk/series/Android-X-Audiobooks/B012C5FZPU' }
        }
      ]
    })
    sinon.stub(SeriesReviewManager, 'saveLocalSeriesMatchForSeriesName').resolves({ id: 'match-1' })
    sinon.stub(SeriesReviewManager, 'markSeriesSourceLinksImported').resolves(1)
    sinon.stub(SeriesImportBridgeManager, 'importManualSeriesMatches').resolves({ summary: { selected_matches: 1, queue_rows_updated: 1 } })

    const req = {
      user: { isAdminOrUp: true },
      library: { id: 'library-1', isBook: true },
      body: { catalogId: 'local-series:android-x' }
    }
    const res = {
      status: sinon.stub().returnsThis(),
      send: sinon.spy(),
      sendStatus: sinon.spy(),
      json: sinon.spy()
    }

    await SeriesReviewController.refreshLocalCatalogMatches(req, res)

    expect(SeriesReviewManager.saveLocalSeriesMatchForSeriesName.calledOnceWithExactly('library-1', 'Android X', '', {
      source: 'audible',
      sourceSeriesName: 'Android X',
      sourceAuthor: 'Michael La Ronn',
      sourceSeriesUrl: 'https://www.audible.co.uk/series/Android-X-Audiobooks/B012C5FZPU',
      evidenceSnapshot: { sourceSeriesUrl: 'https://www.audible.co.uk/series/Android-X-Audiobooks/B012C5FZPU' }
    }, 'local-series:android-x')).to.be.true
    expect(SeriesImportBridgeManager.importManualSeriesMatches.calledOnce).to.be.true
    expect(SeriesReviewManager.markSeriesSourceLinksImported.calledOnceWithExactly('library-1', {
      localDecisionKey: 'android x',
      sourceSeriesUrl: 'https://www.audible.co.uk/series/Android-X-Audiobooks/B012C5FZPU'
    })).to.be.true
    expect(res.json.calledOnceWithExactly({ summary: { selected_matches: 1, queue_rows_updated: 1 } })).to.be.true
  })

  it('imports selected saved local source-series links', async () => {
    sinon.stub(SeriesReviewManager, 'buildLocalSeriesMatchImportPayloadForLibrary').resolves([{ matchId: 'match-1' }])
    sinon.stub(SeriesReviewManager, 'markSeriesSourceLinksImported').resolves(1)
    sinon.stub(SeriesImportBridgeManager, 'importManualSeriesMatches').resolves({ summary: { selected_matches: 1 } })

    const req = {
      user: { isAdminOrUp: true },
      library: { id: 'library-1', isBook: true },
      body: { matches: [{ matchId: 'match-1', includedLibraryItemIds: ['item-1'] }] }
    }
    const res = {
      status: sinon.stub().returnsThis(),
      send: sinon.spy(),
      sendStatus: sinon.spy(),
      json: sinon.spy()
    }

    await SeriesReviewController.importLocalCatalogMatches(req, res)

    expect(SeriesReviewManager.buildLocalSeriesMatchImportPayloadForLibrary.calledOnceWithExactly('library-1', [{ matchId: 'match-1', includedLibraryItemIds: ['item-1'] }])).to.be.true
    expect(SeriesImportBridgeManager.importManualSeriesMatches.calledOnceWithExactly('library-1', [{ matchId: 'match-1' }])).to.be.true
    expect(SeriesReviewManager.markSeriesSourceLinksImported.calledOnceWithExactly('library-1', { matchIds: ['match-1'] })).to.be.true
    expect(res.json.calledOnceWithExactly({ summary: { selected_matches: 1 } })).to.be.true
  })

  it('returns an empty summary when no pending saved local source-series links are ready to import', async () => {
    sinon.stub(SeriesReviewManager, 'buildLocalSeriesMatchImportPayloadForLibrary').resolves([])

    const req = {
      user: { isAdminOrUp: true },
      library: { id: 'library-1', isBook: true },
      body: { matches: [{ matchId: 'match-1', includedLibraryItemIds: ['item-1'] }] }
    }
    const res = {
      status: sinon.stub().returnsThis(),
      send: sinon.spy(),
      sendStatus: sinon.spy(),
      json: sinon.spy()
    }

    await SeriesReviewController.importLocalCatalogMatches(req, res)

    expect(res.json.calledOnceWithExactly({
      library_id: 'library-1',
      summary: {
        selected_matches: 0,
        queue_rows_updated: 0,
        series_catalogs_created: 0,
        series_catalogs_updated: 0
      }
    })).to.be.true
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

  it('dismisses a catalog for the library', async () => {
    sinon.stub(SeriesReviewManager, 'setCatalogVisibilityForLibrary').resolves({ catalog: { id: 'catalog-1', visibilityStatus: 'dismissed' } })

    const req = {
      user: { isAdminOrUp: true },
      library: { id: 'library-1', isBook: true },
      params: { catalogId: 'catalog-1' }
    }
    const res = {
      status: sinon.stub().returnsThis(),
      send: sinon.spy(),
      sendStatus: sinon.spy(),
      json: sinon.spy()
    }

    await SeriesReviewController.dismissCatalog(req, res)

    expect(SeriesReviewManager.setCatalogVisibilityForLibrary.calledOnceWithExactly('library-1', 'catalog-1', 'dismissed')).to.be.true
    expect(res.json.calledOnceWithExactly({ catalog: { id: 'catalog-1', visibilityStatus: 'dismissed' } })).to.be.true
  })

  it('restores a dismissed catalog for the library', async () => {
    sinon.stub(SeriesReviewManager, 'setCatalogVisibilityForLibrary').resolves({ catalog: { id: 'catalog-1', visibilityStatus: 'visible' } })

    const req = {
      user: { isAdminOrUp: true },
      library: { id: 'library-1', isBook: true },
      params: { catalogId: 'catalog-1' }
    }
    const res = {
      status: sinon.stub().returnsThis(),
      send: sinon.spy(),
      sendStatus: sinon.spy(),
      json: sinon.spy()
    }

    await SeriesReviewController.undismissCatalog(req, res)

    expect(SeriesReviewManager.setCatalogVisibilityForLibrary.calledOnceWithExactly('library-1', 'catalog-1', 'visible')).to.be.true
    expect(res.json.calledOnceWithExactly({ catalog: { id: 'catalog-1', visibilityStatus: 'visible' } })).to.be.true
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

  it('unlinks a previously linked series suggestion from the book', async () => {
    sinon.stub(SeriesReviewManager, 'unlinkSuggestion').resolves({
      suggestion: { id: 'suggestion-1', kind: 'series', state: 'pending', contributions: [] },
      libraryItem: {
        media: {
          series: []
        }
      }
    })
    sinon.stub(SeriesReviewManager, 'buildSuggestionPayload').returns({ id: 'suggestion-1', kind: 'series', state: 'pending', contributions: [] })
    sinon.stub(SeriesReviewManager, 'getCurrentSeriesPayload').returns([])

    const req = {
      user: {
        id: 'admin-user',
        isAdminOrUp: true
      },
      params: {
        suggestionId: 'suggestion-1'
      }
    }
    const res = {
      status: sinon.stub().returnsThis(),
      send: sinon.spy(),
      sendStatus: sinon.spy(),
      json: sinon.spy()
    }

    await SeriesReviewController.unlinkSuggestion(req, res)

    expect(SeriesReviewManager.unlinkSuggestion.calledOnceWithExactly('suggestion-1', 'admin-user')).to.be.true
    expect(res.json.calledOnceWithExactly({ suggestion: { id: 'suggestion-1', kind: 'series', state: 'pending', contributions: [] }, currentSeries: [] })).to.be.true
  })
})
