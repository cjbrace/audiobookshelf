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
})
