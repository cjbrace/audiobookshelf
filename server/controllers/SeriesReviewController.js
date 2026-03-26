const SeriesReviewManager = require('../managers/SeriesReviewManager')
const SeriesImportBridgeManager = require('../managers/SeriesImportBridgeManager')

function handleActionError(res, error) {
  const message = String(error?.message || '').trim() || 'Series review action failed'
  return res.status(400).send(message)
}

class SeriesReviewController {
  async getQueue(req, res) {
    if (!req.user.isAdminOrUp) return res.sendStatus(403)
    if (!req.library?.isBook) return res.status(400).send('Series review is only available for book libraries')

    const includeDecided = req.query.includeDecided === '1'
    const rows = await SeriesReviewManager.getQueueForLibrary(req.library.id, includeDecided)
    res.json({ rows })
  }

  async getSourceImportStatus(req, res) {
    if (!req.user.isAdminOrUp) return res.sendStatus(403)
    if (!req.library?.isBook) return res.status(400).send('Series review is only available for book libraries')

    try {
      const status = await SeriesImportBridgeManager.getStatus(req.library.id)
      res.json(status)
    } catch (error) {
      const statusCode = Number(error?.statusCode || 0)
      if (statusCode >= 400) {
        return res.status(statusCode).send(String(error?.message || 'Series import status failed'))
      }
      return handleActionError(res, error)
    }
  }

  async startSourceImport(req, res) {
    if (!req.user.isAdminOrUp) return res.sendStatus(403)
    if (!req.library?.isBook) return res.status(400).send('Series review is only available for book libraries')

    try {
      const result = await SeriesImportBridgeManager.startRun(req.library.id)
      res.json(result)
    } catch (error) {
      const statusCode = Number(error?.statusCode || 0)
      if (statusCode >= 400) {
        return res.status(statusCode).send(String(error?.message || 'Series import start failed'))
      }
      return handleActionError(res, error)
    }
  }

  async getManagementData(req, res) {
    if (!req.user.isAdminOrUp) return res.sendStatus(403)
    if (!req.library?.isBook) return res.status(400).send('Series review is only available for book libraries')

    const candidates = await SeriesReviewManager.getSeriesManagementCandidatesForLibrary(req.library.id)
    const recentActions = await SeriesReviewManager.getRecentSeriesManagementActionsForLibrary(req.library.id)
    res.json({ candidates, recentActions })
  }

  async getCatalogs(req, res) {
    if (!req.user.isAdminOrUp) return res.sendStatus(403)
    if (!req.library?.isBook) return res.status(400).send('Series review is only available for book libraries')

    const includeUntrusted = req.query.includeUntrusted === '1'
    const includeDismissed = req.query.includeDismissed === '1'
    const catalogs = await SeriesReviewManager.getCatalogsForLibrary(req.library.id, includeUntrusted, includeDismissed)
    res.json({ catalogs })
  }

  async getCatalogDetail(req, res) {
    if (!req.user.isAdminOrUp) return res.sendStatus(403)
    if (!req.library?.isBook) return res.status(400).send('Series review is only available for book libraries')

    const detail = await SeriesReviewManager.getCatalogDetailForLibrary(req.library.id, req.params.catalogId)
    if (!detail) return res.sendStatus(404)
    res.json(detail)
  }

  async lookupManualCatalogSources(req, res) {
    if (!req.user.isAdminOrUp) return res.sendStatus(403)
    if (!req.library?.isBook) return res.status(400).send('Series review is only available for book libraries')

    try {
      const context = await SeriesReviewManager.buildManualLookupContextForCatalog(req.library.id, req.params.catalogId)
      if (!context) return res.sendStatus(404)
      const response = await SeriesImportBridgeManager.lookupManualSeries(req.library.id, {
        local_series_name: context.localSeriesName,
        local_decision_key: context.localDecisionKey,
        local_books: context.localBooks
      })
      const linkRows = await SeriesReviewManager.getSeriesSourceLinkRowsForLibrary(req.library.id, {
        localDecisionKey: context.localDecisionKey
      })
      const activeLinksByUrl = new Map()
      const inactiveLinksByUrl = new Map()
      linkRows.forEach((linkRow) => {
        const linkPayload = SeriesReviewManager.buildSeriesSourceLinkPayload(linkRow, {
          localBooks: context.localBooks
        })
        const sourceSeriesUrl = String(linkPayload?.sourceUrl || '').trim()
        if (!sourceSeriesUrl) return
        if (linkPayload.isActive === false) {
          if (!inactiveLinksByUrl.has(sourceSeriesUrl)) inactiveLinksByUrl.set(sourceSeriesUrl, linkPayload)
          return
        }
        activeLinksByUrl.set(sourceSeriesUrl, linkPayload)
      })
      const results = Array.isArray(response?.results) ? response.results : []
      const annotatedResults = results.map((result) => {
        const sourceSeriesUrl = String(result?.sourceSeriesUrl || result?.sourceUrl || result?.sourceIdentifier || '').trim()
        const activeLink = activeLinksByUrl.get(sourceSeriesUrl) || null
        const inactiveLink = activeLink ? null : inactiveLinksByUrl.get(sourceSeriesUrl) || null
        return SeriesReviewManager.buildManualLookupResultWithSeriesSourceLinkState(result, {
          activeLink,
          inactiveLink,
          localBooks: context.localBooks
        })
      })
      return res.json({
        ...response,
        results: annotatedResults
      })
    } catch (error) {
      const statusCode = Number(error?.statusCode || 0)
      if (statusCode >= 400) {
        return res.status(statusCode).send(String(error?.message || 'Manual series lookup failed'))
      }
      return handleActionError(res, error)
    }
  }

  async saveLocalCatalogMatch(req, res) {
    if (!req.user.isAdminOrUp) return res.sendStatus(403)
    if (!req.library?.isBook) return res.status(400).send('Series review is only available for book libraries')

    let detail
    try {
      const catalogDetail = await SeriesReviewManager.getCatalogDetailForLibrary(req.library.id, req.params.catalogId)
      if (!catalogDetail) return res.sendStatus(404)
      detail = await SeriesReviewManager.saveLocalSeriesMatchForSeriesName(
        req.library.id,
        String(catalogDetail.catalog?.seriesName || '').trim(),
        '',
        req.body,
        req.params.catalogId
      )
    } catch (error) {
      return handleActionError(res, error)
    }
    if (!detail) return res.sendStatus(404)
    res.json(detail)
  }

  async removeLocalCatalogMatch(req, res) {
    if (!req.user.isAdminOrUp) return res.sendStatus(403)
    if (!req.library?.isBook) return res.status(400).send('Series review is only available for book libraries')

    let detail
    try {
      detail = await SeriesReviewManager.removeLocalSeriesMatchForLibrary(req.library.id, req.params.catalogId, req.params.matchId, req.user.id)
    } catch (error) {
      return handleActionError(res, error)
    }
    if (!detail) return res.sendStatus(404)
    res.json(detail)
  }

  async getLocalCatalogMatches(req, res) {
    if (!req.user.isAdminOrUp) return res.sendStatus(403)
    if (!req.library?.isBook) return res.status(400).send('Series review is only available for book libraries')

    const includeResolved = req.query.includeResolved === '1'
    const pendingOnly = req.query.pendingOnly === '1'
    const matches = await SeriesReviewManager.getLocalSeriesMatchesForLibrary(req.library.id, { includeResolved, pendingOnly })
    res.json({ matches })
  }

  async importLocalCatalogMatches(req, res) {
    if (!req.user.isAdminOrUp) return res.sendStatus(403)
    if (!req.library?.isBook) return res.status(400).send('Series review is only available for book libraries')

    let matches
    try {
      matches = await SeriesReviewManager.buildLocalSeriesMatchImportPayloadForLibrary(req.library.id, req.body?.matches)
      if (!matches.length) {
        return res.json({
          library_id: req.library.id,
          summary: {
            selected_matches: 0,
            queue_rows_updated: 0,
            series_catalogs_created: 0,
            series_catalogs_updated: 0
          }
        })
      }
      const result = await SeriesImportBridgeManager.importManualSeriesMatches(req.library.id, matches)
      await SeriesReviewManager.markSeriesSourceLinksImported(req.library.id, {
        matchIds: matches.map((match) => match.matchId)
      })
      return res.json(result)
    } catch (error) {
      const statusCode = Number(error?.statusCode || 0)
      if (statusCode >= 400) {
        return res.status(statusCode).send(String(error?.message || 'Manual series import failed'))
      }
      return handleActionError(res, error)
    }
  }

  async refreshLocalCatalogMatches(req, res) {
    if (!req.user.isAdminOrUp) return res.sendStatus(403)
    if (!req.library?.isBook) return res.status(400).send('Series review is only available for book libraries')

    try {
      const catalogId = String(req.body?.catalogId || '').trim()
      if (!catalogId) {
        return res.status(400).send('Missing catalogId')
      }

      const catalogDetail = await SeriesReviewManager.getCatalogDetailForLibrary(req.library.id, catalogId)
      if (!catalogDetail) return res.sendStatus(404)

      const localBooks = Array.isArray(catalogDetail.localBooks) ? catalogDetail.localBooks : []
      if (!localBooks.length) {
        return res.json({
          library_id: req.library.id,
          summary: {
            selected_matches: 0,
            queue_rows_updated: 0,
            series_catalogs_created: 0,
            series_catalogs_updated: 0
          }
        })
      }

      const lookup = await SeriesImportBridgeManager.lookupManualSeries(req.library.id, {
        local_series_name: String(catalogDetail.catalog?.seriesName || '').trim(),
        local_decision_key: '',
        local_books: localBooks
      })
      const results = Array.isArray(lookup?.results) ? lookup.results : []
      const preferredSource = String(
        catalogDetail.catalog?.savedSeriesLinks?.[0]?.source ||
          catalogDetail.catalog?.localSeriesMatches?.[0]?.source ||
          catalogDetail.catalog?.evidenceLinks?.[0]?.source ||
          ''
      )
        .trim()
        .toLowerCase()
      const selectedResult = results.find((result) => String(result?.source || '').trim().toLowerCase() === preferredSource) || results[0] || null
      if (!selectedResult) {
        return res.json({
          library_id: req.library.id,
          summary: {
            selected_matches: 0,
            queue_rows_updated: 0,
            series_catalogs_created: 0,
            series_catalogs_updated: 0
          }
        })
      }

      await SeriesReviewManager.saveLocalSeriesMatchForSeriesName(req.library.id, String(catalogDetail.catalog?.seriesName || '').trim(), '', {
        source: selectedResult.source,
        sourceSeriesName: selectedResult.sourceSeriesName,
        sourceAuthor: selectedResult.sourceAuthor,
        sourceSeriesUrl: selectedResult.sourceSeriesUrl || selectedResult.sourceUrl || '',
        evidenceSnapshot: selectedResult.evidenceSnapshot || {}
      }, catalogId)

      const matches = [
        {
          matchId: '',
          localSeriesName: String(catalogDetail.catalog?.seriesName || '').trim(),
          localDecisionKey: '',
          source: String(selectedResult.source || '').trim().toLowerCase(),
          sourceSeriesName: selectedResult.sourceSeriesName || '',
          sourceAuthor: selectedResult.sourceAuthor || '',
          sourceSeriesUrl: selectedResult.sourceSeriesUrl || selectedResult.sourceUrl || '',
          evidenceSnapshot: selectedResult.evidenceSnapshot || {},
          books: localBooks.map((book) => ({
            libraryItemId: book.libraryItemId,
            title: book.title,
            relPath: book.relPath,
            authors: (book.authors || []).map((author) => ({ name: author.name || author })),
            currentSeries: [{ name: book.seriesName, sequence: book.sequence || '' }]
          }))
        }
      ]
      const result = await SeriesImportBridgeManager.importManualSeriesMatches(req.library.id, matches)
      await SeriesReviewManager.markSeriesSourceLinksImported(req.library.id, {
        localDecisionKey: SeriesReviewManager.normalizeDecisionKey(String(catalogDetail.catalog?.seriesName || '').trim()),
        sourceSeriesUrl: selectedResult.sourceSeriesUrl || selectedResult.sourceUrl || ''
      })
      return res.json(result)
    } catch (error) {
      const statusCode = Number(error?.statusCode || 0)
      if (statusCode >= 400) {
        return res.status(statusCode).send(String(error?.message || 'Manual series refresh failed'))
      }
      return handleActionError(res, error)
    }
  }

  async importCatalog(req, res) {
    if (!req.user.isAdminOrUp) return res.sendStatus(403)
    if (!req.library?.isBook) return res.status(400).send('Series review is only available for book libraries')
    if (!Array.isArray(req.body?.rows)) return res.status(400).send('Missing rows')

    const result = await SeriesReviewManager.importCatalogForLibrary(req.library.id, req.body.rows)
    res.json(result)
  }

  async chooseCatalogSlot(req, res) {
    if (!req.user.isAdminOrUp) return res.sendStatus(403)
    if (!req.library?.isBook) return res.status(400).send('Series review is only available for book libraries')

    let detail
    try {
      detail = await SeriesReviewManager.chooseCatalogSlotEntry(req.library.id, req.params.catalogId, req.body?.slot, req.body?.entryKey)
    } catch (error) {
      return handleActionError(res, error)
    }
    if (!detail) return res.sendStatus(404)
    res.json(detail)
  }

  async findCatalogCandidates(req, res) {
    if (!req.user.isAdminOrUp) return res.sendStatus(403)
    if (!req.library?.isBook) return res.status(400).send('Series review is only available for book libraries')

    let result
    try {
      result = await SeriesReviewManager.findCatalogSlotCandidates(req.library.id, req.params.catalogId, req.body?.slot)
    } catch (error) {
      return handleActionError(res, error)
    }
    if (!result) return res.sendStatus(404)
    res.json(result)
  }

  async queueCatalogCandidate(req, res) {
    if (!req.user.isAdminOrUp) return res.sendStatus(403)
    if (!req.library?.isBook) return res.status(400).send('Series review is only available for book libraries')

    let result
    try {
      result = await SeriesReviewManager.queueCatalogCandidateForReview(req.library.id, req.params.catalogId, req.body?.slot, req.body?.libraryItemId)
    } catch (error) {
      return handleActionError(res, error)
    }
    if (!result) return res.sendStatus(404)
    res.json(result)
  }

  async dismissCatalog(req, res) {
    if (!req.user.isAdminOrUp) return res.sendStatus(403)
    if (!req.library?.isBook) return res.status(400).send('Series review is only available for book libraries')

    const detail = await SeriesReviewManager.setCatalogVisibilityForLibrary(req.library.id, req.params.catalogId, 'dismissed')
    if (!detail) return res.sendStatus(404)
    res.json(detail)
  }

  async undismissCatalog(req, res) {
    if (!req.user.isAdminOrUp) return res.sendStatus(403)
    if (!req.library?.isBook) return res.status(400).send('Series review is only available for book libraries')

    const detail = await SeriesReviewManager.setCatalogVisibilityForLibrary(req.library.id, req.params.catalogId, 'visible')
    if (!detail) return res.sendStatus(404)
    res.json(detail)
  }

  async previewManagementAction(req, res) {
    if (!req.user.isAdminOrUp) return res.sendStatus(403)
    if (!req.library?.isBook) return res.status(400).send('Series review is only available for book libraries')

    let preview
    try {
      preview = await SeriesReviewManager.previewSeriesManagementAction(req.library.id, req.body?.sourceSeriesIds, req.body?.targetLabel)
    } catch (error) {
      return handleActionError(res, error)
    }
    res.json(preview)
  }

  async applyManagementAction(req, res) {
    if (!req.user.isAdminOrUp) return res.sendStatus(403)
    if (!req.library?.isBook) return res.status(400).send('Series review is only available for book libraries')

    let result
    try {
      result = await SeriesReviewManager.applySeriesManagementAction(
        req.library.id,
        req.user.id,
        req.body?.sourceSeriesIds,
        req.body?.targetLabel,
        req.body?.includedLibraryItemIds
      )
    } catch (error) {
      return handleActionError(res, error)
    }
    res.json(result)
  }

  async importSuggestions(req, res) {
    if (!req.user.isAdminOrUp) return res.sendStatus(403)
    if (!req.library?.isBook) return res.status(400).send('Series review is only available for book libraries')
    if (!Array.isArray(req.body?.rows)) return res.status(400).send('Missing rows')

    const result = await SeriesReviewManager.importSuggestionsForLibrary(req.library.id, req.body.rows)
    res.json(result)
  }

  async resetSuggestions(req, res) {
    if (!req.user.isAdminOrUp) return res.sendStatus(403)
    if (!req.library?.isBook) return res.status(400).send('Series review is only available for book libraries')
    if (!Array.isArray(req.body?.libraryItemIds)) return res.status(400).send('Missing libraryItemIds')

    const result = await SeriesReviewManager.resetSuggestionsForLibrary(req.library.id, req.body.libraryItemIds)
    res.json(result)
  }

  async addSuggestion(req, res) {
    if (!req.user.isAdminOrUp) return res.sendStatus(403)
    let result
    try {
      result = await SeriesReviewManager.applySuggestion(req.params.suggestionId, req.user.id, 'add')
    } catch (error) {
      return handleActionError(res, error)
    }
    if (!result) return res.sendStatus(404)

    res.json({
      suggestion: SeriesReviewManager.buildSuggestionPayload(result.suggestion),
      currentSeries: result.libraryItem.media.series.map((series) => ({
        id: series.id,
        name: series.name,
        sequence: series.bookSeries?.sequence || null
      }))
    })
  }

  async replaceSuggestion(req, res) {
    if (!req.user.isAdminOrUp) return res.sendStatus(403)
    const replaceSeriesId = typeof req.body?.replaceSeriesId === 'string' ? req.body.replaceSeriesId : ''
    if (!replaceSeriesId) return res.status(400).send('Missing replaceSeriesId')

    let result
    try {
      result = await SeriesReviewManager.applySuggestion(req.params.suggestionId, req.user.id, 'replace', replaceSeriesId)
    } catch (error) {
      return handleActionError(res, error)
    }
    if (!result) return res.sendStatus(404)

    res.json({
      suggestion: SeriesReviewManager.buildSuggestionPayload(result.suggestion),
      currentSeries: result.libraryItem.media.series.map((series) => ({
        id: series.id,
        name: series.name,
        sequence: series.bookSeries?.sequence || null
      }))
    })
  }

  async aliasSuggestion(req, res) {
    if (!req.user.isAdminOrUp) return res.sendStatus(403)
    const primarySuggestionId = typeof req.body?.primarySuggestionId === 'string' ? req.body.primarySuggestionId : ''
    if (!primarySuggestionId) return res.status(400).send('Missing primarySuggestionId')

    let result
    try {
      result = await SeriesReviewManager.aliasSuggestion(req.params.suggestionId, primarySuggestionId, req.user.id)
    } catch (error) {
      return handleActionError(res, error)
    }
    if (!result) return res.sendStatus(404)
    res.json(result)
  }

  async renameSuggestion(req, res) {
    if (!req.user.isAdminOrUp) return res.sendStatus(403)
    const targetLabel = typeof req.body?.targetLabel === 'string' ? req.body.targetLabel : ''
    if (!targetLabel.trim()) return res.status(400).send('Missing targetLabel')

    let result
    try {
      result = await SeriesReviewManager.renameSuggestion(req.params.suggestionId, targetLabel, req.user.id)
    } catch (error) {
      return handleActionError(res, error)
    }
    if (!result) return res.sendStatus(404)
    res.json(result)
  }

  async dismissSuggestion(req, res) {
    if (!req.user.isAdminOrUp) return res.sendStatus(403)
    const suggestion = await SeriesReviewManager.dismissSuggestion(req.params.suggestionId, req.user.id)
    if (!suggestion) return res.sendStatus(404)
    res.json({
      suggestion: SeriesReviewManager.buildSuggestionPayload(suggestion)
    })
  }

  async unlinkSuggestion(req, res) {
    if (!req.user.isAdminOrUp) return res.sendStatus(403)

    let result
    try {
      result = await SeriesReviewManager.unlinkSuggestion(req.params.suggestionId, req.user.id)
    } catch (error) {
      return handleActionError(res, error)
    }
    if (!result) return res.sendStatus(404)
    res.json({
      suggestion: SeriesReviewManager.buildSuggestionPayload(result.suggestion),
      currentSeries: SeriesReviewManager.getCurrentSeriesPayload(result.libraryItem)
    })
  }

  async removeSeries(req, res) {
    if (!req.user.isAdminOrUp) return res.sendStatus(403)
    const seriesId = typeof req.body?.seriesId === 'string' ? req.body.seriesId : ''
    if (!seriesId) return res.status(400).send('Missing seriesId')

    let result
    try {
      result = await SeriesReviewManager.removeSeriesEntry(req.params.libraryItemId, seriesId)
    } catch (error) {
      return handleActionError(res, error)
    }
    if (!result) return res.sendStatus(404)

    res.json({
      currentSeries: SeriesReviewManager.getCurrentSeriesPayload(result.libraryItem)
    })
  }

  async revertManagementAction(req, res) {
    if (!req.user.isAdminOrUp) return res.sendStatus(403)

    let result
    try {
      result = await SeriesReviewManager.revertSeriesManagementAction(req.params.actionId, req.user.id)
    } catch (error) {
      return handleActionError(res, error)
    }
    if (!result) return res.sendStatus(404)
    res.json(result)
  }
}

module.exports = new SeriesReviewController()
