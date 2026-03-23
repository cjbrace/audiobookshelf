const SeriesReviewManager = require('../managers/SeriesReviewManager')

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
}

module.exports = new SeriesReviewController()
