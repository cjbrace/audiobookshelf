const { expect } = require('chai')
const Path = require('path')
const { Sequelize } = require('sequelize')
const sinon = require('sinon')

const Database = require('../../../server/Database')
const ApiRouter = require('../../../server/routers/ApiRouter')
const LibraryItemController = require('../../../server/controllers/LibraryItemController')
const ApiCacheManager = require('../../../server/managers/ApiCacheManager')
const Auth = require('../../../server/Auth')
const fs = require('../../../server/libs/fsExtra')
const Logger = require('../../../server/Logger')

describe('LibraryItemController', () => {
  /** @type {ApiRouter} */
  let apiRouter

  beforeEach(async () => {
    global.ServerSettings = {}
    Database.sequelize = new Sequelize({ dialect: 'sqlite', storage: ':memory:', logging: false })
    Database.sequelize.uppercaseFirst = (str) => (str ? `${str[0].toUpperCase()}${str.substr(1)}` : '')
    await Database.buildModels()

    apiRouter = new ApiRouter({
      auth: new Auth(),
      apiCacheManager: new ApiCacheManager()
    })

    sinon.stub(Logger, 'info')
    sinon.stub(Logger, 'warn')
    sinon.stub(Logger, 'error')
    sinon.stub(Logger, 'debug')
  })

  afterEach(async () => {
    sinon.restore()

    // Clear all tables
    await Database.sequelize.sync({ force: true })
  })

  describe('checkRemoveAuthorsAndSeries', () => {
    let libraryItem1Id
    let libraryItem2Id
    let author1Id
    let author2Id
    let author3Id
    let series1Id
    let series2Id

    beforeEach(async () => {
      const newLibrary = await Database.libraryModel.create({ name: 'Test Library', mediaType: 'book' })
      const newLibraryFolder = await Database.libraryFolderModel.create({ path: '/test', libraryId: newLibrary.id })

      const newBook = await Database.bookModel.create({ title: 'Test Book', audioFiles: [], tags: [], narrators: [], genres: [], chapters: [] })
      const newLibraryItem = await Database.libraryItemModel.create({ libraryFiles: [], mediaId: newBook.id, mediaType: 'book', libraryId: newLibrary.id, libraryFolderId: newLibraryFolder.id })
      libraryItem1Id = newLibraryItem.id

      const newBook2 = await Database.bookModel.create({ title: 'Test Book 2', audioFiles: [], tags: [], narrators: [], genres: [], chapters: [] })
      const newLibraryItem2 = await Database.libraryItemModel.create({ libraryFiles: [], mediaId: newBook2.id, mediaType: 'book', libraryId: newLibrary.id, libraryFolderId: newLibraryFolder.id })
      libraryItem2Id = newLibraryItem2.id

      const newAuthor = await Database.authorModel.create({ name: 'Test Author', libraryId: newLibrary.id })
      author1Id = newAuthor.id
      const newAuthor2 = await Database.authorModel.create({ name: 'Test Author 2', libraryId: newLibrary.id })
      author2Id = newAuthor2.id
      const newAuthor3 = await Database.authorModel.create({ name: 'Test Author 3', imagePath: '/fake/path/author.png', libraryId: newLibrary.id })
      author3Id = newAuthor3.id

      // Book 1 has Author 1, Author 2 and Author 3
      await Database.bookAuthorModel.create({ bookId: newBook.id, authorId: newAuthor.id })
      await Database.bookAuthorModel.create({ bookId: newBook.id, authorId: newAuthor2.id })
      await Database.bookAuthorModel.create({ bookId: newBook.id, authorId: newAuthor3.id })

      // Book 2 has Author 2
      await Database.bookAuthorModel.create({ bookId: newBook2.id, authorId: newAuthor2.id })

      const newSeries = await Database.seriesModel.create({ name: 'Test Series', libraryId: newLibrary.id })
      series1Id = newSeries.id
      const newSeries2 = await Database.seriesModel.create({ name: 'Test Series 2', libraryId: newLibrary.id })
      series2Id = newSeries2.id

      // Book 1 is in Series 1 and Series 2
      await Database.bookSeriesModel.create({ bookId: newBook.id, seriesId: newSeries.id })
      await Database.bookSeriesModel.create({ bookId: newBook.id, seriesId: newSeries2.id })

      // Book 2 is in Series 2
      await Database.bookSeriesModel.create({ bookId: newBook2.id, seriesId: newSeries2.id })
    })

    it('should remove authors and series with no books on library item delete', async () => {
      const libraryItem = await Database.libraryItemModel.getExpandedById(libraryItem1Id)

      const fakeReq = {
        query: {},
        libraryItem
      }
      const fakeRes = {
        sendStatus: sinon.spy()
      }
      await LibraryItemController.delete.bind(apiRouter)(fakeReq, fakeRes)

      expect(fakeRes.sendStatus.calledWith(200)).to.be.true

      // Author 1 should be removed because it has no books
      const author1Exists = await Database.authorModel.checkExistsById(author1Id)
      expect(author1Exists).to.be.false

      // Author 2 should not be removed because it still has Book 2
      const author2Exists = await Database.authorModel.checkExistsById(author2Id)
      expect(author2Exists).to.be.true

      // Author 3 should not be removed because it has an image
      const author3Exists = await Database.authorModel.checkExistsById(author3Id)
      expect(author3Exists).to.be.true

      // Series 1 should be removed because it has no books
      const series1Exists = await Database.seriesModel.checkExistsById(series1Id)
      expect(series1Exists).to.be.false

      // Series 2 should not be removed because it still has Book 2
      const series2Exists = await Database.seriesModel.checkExistsById(series2Id)
      expect(series2Exists).to.be.true
    })

    it('should remove authors and series with no books on library item batch delete', async () => {
      // Batch delete library item 1
      const fakeReq = {
        query: {},
        user: {
          canDelete: true
        },
        body: {
          libraryItemIds: [libraryItem1Id]
        }
      }
      const fakeRes = {
        sendStatus: sinon.spy()
      }
      await LibraryItemController.batchDelete.bind(apiRouter)(fakeReq, fakeRes)

      expect(fakeRes.sendStatus.calledWith(200)).to.be.true

      // Author 1 should be removed because it has no books
      const author1Exists = await Database.authorModel.checkExistsById(author1Id)
      expect(author1Exists).to.be.false

      // Author 2 should not be removed because it still has Book 2
      const author2Exists = await Database.authorModel.checkExistsById(author2Id)
      expect(author2Exists).to.be.true

      // Author 3 should not be removed because it has an image
      const author3Exists = await Database.authorModel.checkExistsById(author3Id)
      expect(author3Exists).to.be.true

      // Series 1 should be removed because it has no books
      const series1Exists = await Database.seriesModel.checkExistsById(series1Id)
      expect(series1Exists).to.be.false

      // Series 2 should not be removed because it still has Book 2
      const series2Exists = await Database.seriesModel.checkExistsById(series2Id)
      expect(series2Exists).to.be.true
    })

    it('should remove authors and series with no books on library item update media', async () => {
      const libraryItem = await Database.libraryItemModel.getExpandedById(libraryItem1Id)
      libraryItem.saveMetadataFile = sinon.stub()
      // Update library item 1 remove all authors and series
      const fakeReq = {
        query: {},
        body: {
          metadata: {
            authors: [],
            series: []
          }
        },
        libraryItem
      }
      const fakeRes = {
        json: sinon.spy()
      }
      await LibraryItemController.updateMedia.bind(apiRouter)(fakeReq, fakeRes)

      expect(fakeRes.json.calledOnce).to.be.true

      // Author 1 should be removed because it has no books
      const author1Exists = await Database.authorModel.checkExistsById(author1Id)
      expect(author1Exists).to.be.false

      // Author 2 should not be removed because it still has Book 2
      const author2Exists = await Database.authorModel.checkExistsById(author2Id)
      expect(author2Exists).to.be.true

      // Author 3 should not be removed because it has an image
      const author3Exists = await Database.authorModel.checkExistsById(author3Id)
      expect(author3Exists).to.be.true

      // Series 1 should be removed because it has no books
      const series1Exists = await Database.seriesModel.checkExistsById(series1Id)
      expect(series1Exists).to.be.false

      // Series 2 should not be removed because it still has Book 2
      const series2Exists = await Database.seriesModel.checkExistsById(series2Id)
      expect(series2Exists).to.be.true
    })
  })

  describe('hardDeleteResidueHandling', function () {
    this.timeout(10000)
    let libraryId
    let libraryItemId
    let authorId
    let seriesId
    let libraryItemPath
    let resolvedLibraryItemPath

    async function createDeleteFixture() {
      const newLibrary = await Database.libraryModel.create({ name: 'Delete Test Library', mediaType: 'book' })
      libraryId = newLibrary.id
      const newLibraryFolder = await Database.libraryFolderModel.create({ path: '/library', libraryId })

      const newBook = await Database.bookModel.create({ title: 'Delete Test Book', audioFiles: [], tags: [], narrators: [], genres: [], chapters: [] })
      libraryItemPath = '/library/Delete Author/Delete Test Book'
      resolvedLibraryItemPath = Path.resolve(libraryItemPath)
      const newLibraryItem = await Database.libraryItemModel.create({
        path: libraryItemPath,
        libraryFiles: [],
        mediaId: newBook.id,
        mediaType: 'book',
        libraryId,
        libraryFolderId: newLibraryFolder.id
      })
      libraryItemId = newLibraryItem.id

      const newAuthor = await Database.authorModel.create({ name: 'Delete Author', libraryId })
      authorId = newAuthor.id
      await Database.bookAuthorModel.create({ bookId: newBook.id, authorId })

      const newSeries = await Database.seriesModel.create({ name: 'Delete Series', libraryId })
      seriesId = newSeries.id
      await Database.bookSeriesModel.create({ bookId: newBook.id, seriesId })
    }

    function createFakeResponse() {
      return {
        sendStatus: sinon.spy(),
        send: sinon.spy(),
        status: sinon.stub().returnsThis()
      }
    }

    beforeEach(async () => {
      await createDeleteFixture()
    })

    it('should return success for single hard delete when only known residue remains after db delete', async () => {
      const libraryItem = await Database.libraryItemModel.getExpandedById(libraryItemId)
      const resetIssuesSpy = sinon.spy(Database, 'resetLibraryIssuesFilterData')
      const residueFiles = new Set(['.nfs0001', 'cover.jpg', 'metadata.json'])

      sinon.stub(fs, 'remove').callsFake(async (targetPath) => {
        if (targetPath === resolvedLibraryItemPath) {
          const error = new Error('busy residue')
          error.code = 'EBUSY'
          throw error
        }

        residueFiles.delete(Path.basename(targetPath))
      })
      sinon.stub(fs, 'pathExists').callsFake(async (targetPath) => targetPath === resolvedLibraryItemPath && residueFiles.size > 0)
      sinon.stub(fs, 'readdir').callsFake(async (targetPath) => {
        if (targetPath !== resolvedLibraryItemPath) {
          const error = new Error('not found')
          error.code = 'ENOENT'
          throw error
        }
        return Array.from(residueFiles).map((entryName) => ({
          name: entryName,
          isDirectory: () => false
        }))
      })

      const fakeRes = createFakeResponse()
      await LibraryItemController.delete.bind(apiRouter)({
        query: { hard: 1 },
        libraryItem
      }, fakeRes)

      expect(fakeRes.sendStatus.calledWith(200)).to.be.true
      expect(fakeRes.status.called).to.be.false
      expect(await Database.libraryItemModel.getExpandedById(libraryItemId)).to.equal(null)
      expect(await Database.authorModel.checkExistsById(authorId)).to.be.false
      expect(await Database.seriesModel.checkExistsById(seriesId)).to.be.false
      expect(resetIssuesSpy.calledOnceWith(libraryId)).to.be.true
    })

    it('should return success for batch hard delete when only known residue remains after db delete', async () => {
      const resetIssuesSpy = sinon.spy(Database, 'resetLibraryIssuesFilterData')
      const residueFiles = new Set(['.nfs0002', 'cover.jpg', 'metadata.json'])

      sinon.stub(fs, 'remove').callsFake(async (targetPath) => {
        if (targetPath === resolvedLibraryItemPath) {
          const error = new Error('directory busy')
          error.code = 'ENOTEMPTY'
          throw error
        }

        residueFiles.delete(Path.basename(targetPath))
      })
      sinon.stub(fs, 'pathExists').callsFake(async (targetPath) => targetPath === resolvedLibraryItemPath && residueFiles.size > 0)
      sinon.stub(fs, 'readdir').callsFake(async (targetPath) => {
        if (targetPath !== resolvedLibraryItemPath) {
          const error = new Error('not found')
          error.code = 'ENOENT'
          throw error
        }
        return Array.from(residueFiles).map((entryName) => ({
          name: entryName,
          isDirectory: () => false
        }))
      })

      const fakeRes = createFakeResponse()
      await LibraryItemController.batchDelete.bind(apiRouter)({
        query: { hard: 1 },
        user: {
          canDelete: true
        },
        body: {
          libraryItemIds: [libraryItemId]
        }
      }, fakeRes)

      expect(fakeRes.sendStatus.calledWith(200)).to.be.true
      expect(fakeRes.status.called).to.be.false
      expect(await Database.libraryItemModel.getExpandedById(libraryItemId)).to.equal(null)
      expect(await Database.authorModel.checkExistsById(authorId)).to.be.false
      expect(await Database.seriesModel.checkExistsById(seriesId)).to.be.false
      expect(resetIssuesSpy.calledOnceWith(libraryId)).to.be.true
    })

    it('should still run cleanup and issue reset on hard delete failure after db delete', async () => {
      const libraryItem = await Database.libraryItemModel.getExpandedById(libraryItemId)
      const resetIssuesSpy = sinon.spy(Database, 'resetLibraryIssuesFilterData')

      sinon.stub(fs, 'remove').callsFake(async (targetPath) => {
        if (targetPath === resolvedLibraryItemPath) {
          const error = new Error('permission denied')
          error.code = 'EACCES'
          throw error
        }
      })
      sinon.stub(fs, 'pathExists').callsFake(async (targetPath) => targetPath === resolvedLibraryItemPath)
      sinon.stub(fs, 'readdir').callsFake(async (targetPath) => {
        if (targetPath !== resolvedLibraryItemPath) {
          const error = new Error('not found')
          error.code = 'ENOENT'
          throw error
        }
        return [
          {
            name: 'chapter01.mp3',
            isDirectory: () => false
          }
        ]
      })

      const fakeRes = createFakeResponse()
      await LibraryItemController.delete.bind(apiRouter)({
        query: { hard: 1 },
        libraryItem
      }, fakeRes)

      expect(fakeRes.status.calledWith(500)).to.be.true
      expect(fakeRes.send.calledWith('Failed to fully delete library item from file system')).to.be.true
      expect(await Database.libraryItemModel.getExpandedById(libraryItemId)).to.equal(null)
      expect(await Database.authorModel.checkExistsById(authorId)).to.be.false
      expect(await Database.seriesModel.checkExistsById(seriesId)).to.be.false
      expect(resetIssuesSpy.calledOnceWith(libraryId)).to.be.true
    })
  })
})
