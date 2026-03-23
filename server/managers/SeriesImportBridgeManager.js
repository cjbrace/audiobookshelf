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

    const defaults = ['http://192.168.0.108:8011', 'http://cjbuntu:8011', 'http://host.docker.internal:8011', 'http://127.0.0.1:8011']
    const urls = [...configured, ...defaults].map((value) => value.replace(/\/+$/, ''))
    return [...new Set(urls)]
  }

  shouldUseCachedBaseUrl() {
    return !!this.cachedBaseUrl && Date.now() - this.cachedAt <= this.cacheTtlMs
  }

  buildUrl(baseUrl, path) {
    return `${baseUrl}${path.startsWith('/') ? path : `/${path}`}`
  }

  async request(method, path, payload = {}) {
    const orderedBaseUrls = this.shouldUseCachedBaseUrl() ? [this.cachedBaseUrl, ...this.getCandidateBaseUrls().filter((url) => url !== this.cachedBaseUrl)] : this.getCandidateBaseUrls()
    let lastNetworkError = null

    for (const baseUrl of orderedBaseUrls) {
      try {
        const response = await axios({
          method,
          url: this.buildUrl(baseUrl, path),
          params: payload.params || undefined,
          data: payload.data || undefined,
          timeout: 10000,
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

    const message = String(lastNetworkError?.message || 'Series import service is unavailable').trim() || 'Series import service is unavailable'
    const error = new Error(message)
    error.statusCode = 503
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
}

module.exports = new SeriesImportBridgeManager()
