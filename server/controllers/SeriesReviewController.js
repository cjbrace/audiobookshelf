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

  async dismissSuggestion(req, res) {
    if (!req.user.isAdminOrUp) return res.sendStatus(403)
    const suggestion = await SeriesReviewManager.dismissSuggestion(req.params.suggestionId, req.user.id)
    if (!suggestion) return res.sendStatus(404)
    res.json({
      suggestion: SeriesReviewManager.buildSuggestionPayload(suggestion)
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
