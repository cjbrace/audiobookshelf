const axios = require('axios')

class SeriesImportBridgeManager {
  constructor() {
    this.cachedBaseUrl = ''
    this.cachedAt = 0
    this.cacheTtlMs = 5 * 60 * 1000
  }

  getCandidateBaseUrls() {
    const configured = []
    const envSingle = String(process.env.SERIES_IMPORT_TOOL_URL || process.env.TRUTHBOARD_API_URL || '').trim()
    if (envSingle) configured.push(envSingle)

    const envMany = String(process.env.SERIES_IMPORT_TOOL_URLS || '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean)
    configured.push(...envMany)

    // Localhost should only ever be used when explicitly configured. Inside the
    // disposable ABS runtime it is commonly a dead end and creates a misleading
    // operator-facing ECONNREFUSED.
    const defaults = ['http://192.168.0.108:8011', 'http://cjbuntu:8011', 'http://host.docker.internal:8011']
    const urls = [...configured, ...defaults].map((value) => value.replace(/\/+$/, ''))
    return [...new Set(urls)]
  }

  getUnavailableMessage(candidateBaseUrls) {
    const configuredCount = candidateBaseUrls.filter((url) => !['http://192.168.0.108:8011', 'http://cjbuntu:8011', 'http://host.docker.internal:8011'].includes(url)).length
    if (configuredCount > 0) {
      return 'Series import service is unavailable at the configured bridge URL. Check SERIES_IMPORT_TOOL_URL / SERIES_IMPORT_TOOL_URLS.'
    }
    return 'Series import service is unavailable. Configure SERIES_IMPORT_TOOL_URL to a reachable companion service.'
  }

  shouldUseCachedBaseUrl() {
    return !!this.cachedBaseUrl && Date.now() - this.cachedAt <= this.cacheTtlMs
  }

  buildUrl(baseUrl, path) {
    return `${baseUrl}${path.startsWith('/') ? path : `/${path}`}`
  }

  async request(method, path, payload = {}) {
    const candidateBaseUrls = this.getCandidateBaseUrls()
    const orderedBaseUrls = this.shouldUseCachedBaseUrl() ? [this.cachedBaseUrl, ...candidateBaseUrls.filter((url) => url !== this.cachedBaseUrl)] : candidateBaseUrls
    let lastNetworkError = null
    const timeout = Number(payload.timeoutMs || 10000)

    for (const baseUrl of orderedBaseUrls) {
      try {
        const response = await axios({
          method,
          url: this.buildUrl(baseUrl, path),
          params: payload.params || undefined,
          data: payload.data || undefined,
          timeout,
          validateStatus: () => true
        })
        if (response.status === 404) {
          lastNetworkError = new Error(`Series import service route missing at ${baseUrl}`)
          continue
        }
        if (response.status >= 200 && response.status < 300) {
          this.cachedBaseUrl = baseUrl
          this.cachedAt = Date.now()
          return response.data
        }
        const detail = typeof response.data === 'string' ? response.data : response.data?.detail || response.data?.message || 'Series import service request failed'
        const error = new Error(detail)
        error.statusCode = response.status
        throw error
      } catch (error) {
        if (error?.statusCode) throw error
        lastNetworkError = error
      }
    }

    const message = this.getUnavailableMessage(candidateBaseUrls)
    const error = new Error(message)
    error.statusCode = 503
    error.cause = lastNetworkError || undefined
    throw error
  }

  async getStatus(libraryId) {
    return this.request('get', '/api/series-import/status', {
      params: {
        library_id: libraryId
      }
    })
  }

  async startRun(libraryId) {
    return this.request('post', '/api/series-import/run', {
      data: {
        library_id: libraryId
      }
    })
  }

  async lookupManualSeries(libraryId, payload) {
    return this.request('post', '/api/series-import/manual-lookup', {
      data: {
        library_id: libraryId,
        ...payload
      },
      timeoutMs: 60000
    })
  }

  async importManualSeriesMatches(libraryId, matches) {
    return this.request('post', '/api/series-import/manual-import', {
      data: {
        library_id: libraryId,
        matches
      },
      timeoutMs: 120000
    })
  }
}

module.exports = new SeriesImportBridgeManager()
