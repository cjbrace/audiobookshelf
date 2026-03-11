const assert = require('assert')
const libraryItemsBookFilters = require('../../../server/utils/queries/libraryItemsBookFilters')

describe('libraryItemsBookFilters completion filter aliases', () => {
  it('maps progress.ticked to the same where clause as progress.finished', () => {
    const finished = libraryItemsBookFilters.getMediaGroupQuery('progress', 'finished')
    const ticked = libraryItemsBookFilters.getMediaGroupQuery('progress', 'ticked')
    assert.deepStrictEqual(ticked, finished)
  })

  it('maps progress.unticked to the same where clause as progress.not-finished', () => {
    const notFinished = libraryItemsBookFilters.getMediaGroupQuery('progress', 'not-finished')
    const unticked = libraryItemsBookFilters.getMediaGroupQuery('progress', 'unticked')
    assert.deepStrictEqual(unticked, notFinished)
  })

  it('maps collapsed-series ticked/unticked aliases to existing finished/not-finished behavior', () => {
    const finished = libraryItemsBookFilters.getCollapseSeriesMediaProgressFilter('finished')
    const ticked = libraryItemsBookFilters.getCollapseSeriesMediaProgressFilter('ticked')
    const notFinished = libraryItemsBookFilters.getCollapseSeriesMediaProgressFilter('not-finished')
    const unticked = libraryItemsBookFilters.getCollapseSeriesMediaProgressFilter('unticked')

    assert.deepStrictEqual(ticked, finished)
    assert.deepStrictEqual(unticked, notFinished)
  })
})
