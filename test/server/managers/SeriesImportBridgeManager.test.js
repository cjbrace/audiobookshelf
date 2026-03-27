const { expect } = require('chai')

describe('SeriesImportBridgeManager', () => {
  const bridgePath = require.resolve('../../../server/managers/SeriesImportBridgeManager')
  const axiosPath = require.resolve('axios')
  const originalAxiosModule = require.cache[axiosPath]
  const originalEnv = {
    SERIES_IMPORT_TOOL_URL: process.env.SERIES_IMPORT_TOOL_URL,
    SERIES_IMPORT_TOOL_URLS: process.env.SERIES_IMPORT_TOOL_URLS,
    TRUTHBOARD_API_URL: process.env.TRUTHBOARD_API_URL
  }

  afterEach(() => {
    if (originalAxiosModule) {
      require.cache[axiosPath] = originalAxiosModule
    } else {
      delete require.cache[axiosPath]
    }
    delete require.cache[bridgePath]
    process.env.SERIES_IMPORT_TOOL_URL = originalEnv.SERIES_IMPORT_TOOL_URL
    process.env.SERIES_IMPORT_TOOL_URLS = originalEnv.SERIES_IMPORT_TOOL_URLS
    process.env.TRUTHBOARD_API_URL = originalEnv.TRUTHBOARD_API_URL
  })

  function loadManagerWithAxios(axiosImpl) {
    require.cache[axiosPath] = {
      id: axiosPath,
      filename: axiosPath,
      loaded: true,
      exports: axiosImpl
    }
    delete require.cache[bridgePath]
    return require('../../../server/managers/SeriesImportBridgeManager')
  }

  it('does not include localhost in implicit fallback bridge URLs', () => {
    delete process.env.SERIES_IMPORT_TOOL_URL
    delete process.env.SERIES_IMPORT_TOOL_URLS
    delete process.env.TRUTHBOARD_API_URL

    const manager = loadManagerWithAxios(async () => ({ status: 200, data: {} }))
    const urls = manager.getCandidateBaseUrls()

    expect(urls).to.deep.equal([
      'http://192.168.0.108:8011',
      'http://cjbuntu:8011',
      'http://host.docker.internal:8011'
    ])
  })

  it('returns a stable generic error instead of leaking a dead localhost refusal', async () => {
    delete process.env.SERIES_IMPORT_TOOL_URL
    delete process.env.SERIES_IMPORT_TOOL_URLS
    delete process.env.TRUTHBOARD_API_URL

    const manager = loadManagerWithAxios(async () => {
      const error = new Error('connect ECONNREFUSED 127.0.0.1:8011')
      error.code = 'ECONNREFUSED'
      throw error
    })

    let caught = null
    try {
      await manager.getStatus('library-1')
    } catch (error) {
      caught = error
    }

    expect(caught).to.be.an('error')
    expect(caught.statusCode).to.equal(503)
    expect(caught.message).to.equal('Series import service is unavailable. Configure SERIES_IMPORT_TOOL_URL to a reachable companion service.')
    expect(caught.cause).to.be.an('error')
    expect(String(caught.cause.message || '')).to.include('127.0.0.1:8011')
  })

  it('prefers a configured bridge URL when one is supplied', () => {
    process.env.SERIES_IMPORT_TOOL_URL = 'http://bridge.example:9000/'
    delete process.env.SERIES_IMPORT_TOOL_URLS
    delete process.env.TRUTHBOARD_API_URL

    const manager = loadManagerWithAxios(async () => ({ status: 200, data: {} }))
    const urls = manager.getCandidateBaseUrls()

    expect(urls[0]).to.equal('http://bridge.example:9000')
  })

  it('uses a longer timeout for manual lookups so large series can finish', async () => {
    let capturedConfig = null
    const manager = loadManagerWithAxios(async (config) => {
      capturedConfig = config
      return { status: 200, data: { results: [] } }
    })

    await manager.lookupManualSeries('library-1', {
      local_series_name: 'Defiance of the Fall',
      local_books: [{ title: 'Defiance of the Fall' }]
    })

    expect(capturedConfig).to.be.an('object')
    expect(capturedConfig.timeout).to.equal(180000)
  })
})
