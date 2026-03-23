const fs = require('fs')
const Path = require('path')
const { expect } = require('chai')

const SERVER_PATH = Path.resolve(__dirname, '../../server/Server.js')
const LIBRARY_PAGES_DIR = Path.resolve(__dirname, '../../client/pages/library/_library')

function listTopLevelLibrarySubpages() {
  return fs
    .readdirSync(LIBRARY_PAGES_DIR, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.vue') && entry.name !== 'index.vue')
    .map((entry) => entry.name.replace(/\.vue$/, ''))
    .sort()
}

function extractStaticLibraryRoutes() {
  const serverSource = fs.readFileSync(SERVER_PATH, 'utf8')
  const routes = Array.from(serverSource.matchAll(/'\/library\/:library(?:\/[^']*)?'/g)).map((match) => match[0].slice(1, -1))
  return new Set(routes)
}

describe('Server library subpage route registration', () => {
  it('allowlists every top-level client library subpage in Server.js', () => {
    const registeredRoutes = extractStaticLibraryRoutes()
    const expectedRoutes = listTopLevelLibrarySubpages().map((slug) => `/library/:library/${slug}`)
    const missingRoutes = expectedRoutes.filter((route) => !registeredRoutes.has(route))

    expect(missingRoutes).to.deep.equal(
      [],
      `Missing Server.js dynamic route registration for: ${missingRoutes.join(', ')}`
    )
  })
})
