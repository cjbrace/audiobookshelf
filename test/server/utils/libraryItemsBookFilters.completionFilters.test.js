const assert = require('assert')
const Sequelize = require('sequelize')
const libraryItemsBookFilters = require('../../../server/utils/queries/libraryItemsBookFilters')

describe('libraryItemsBookFilters manual QC completion filters', () => {
  it('maps progress.ticked to manual QC completed only', () => {
    const ticked = libraryItemsBookFilters.getMediaGroupQuery('progress', 'ticked')
    assert.deepStrictEqual(ticked.replacements, {})
    assert.deepStrictEqual(ticked.mediaWhere, {
      manualQcCompleted: true
    })
  })

  it('maps progress.unticked to manual QC incomplete only', () => {
    const unticked = libraryItemsBookFilters.getMediaGroupQuery('progress', 'unticked')
    assert.deepStrictEqual(unticked.replacements, {})
    assert.deepStrictEqual(unticked.mediaWhere, {
      manualQcCompleted: {
        [Sequelize.Op.or]: [null, false]
      }
    })
  })

  it('keeps playback finished/not-finished filters separate from ticked/unticked', () => {
    const finished = libraryItemsBookFilters.getMediaGroupQuery('progress', 'finished')
    const notFinished = libraryItemsBookFilters.getMediaGroupQuery('progress', 'not-finished')
    const ticked = libraryItemsBookFilters.getMediaGroupQuery('progress', 'ticked')
    const unticked = libraryItemsBookFilters.getMediaGroupQuery('progress', 'unticked')

    assert.notDeepStrictEqual(ticked.mediaWhere, finished.mediaWhere)
    assert.notDeepStrictEqual(unticked.mediaWhere, notFinished.mediaWhere)
  })

  it('maps collapsed-series ticked/unticked to manual QC fields', () => {
    const ticked = libraryItemsBookFilters.getCollapseSeriesMediaProgressFilter('ticked')
    const unticked = libraryItemsBookFilters.getCollapseSeriesMediaProgressFilter('unticked')

    assert.deepStrictEqual(ticked, {
      '$books.manualQcCompleted$': true
    })
    assert.deepStrictEqual(unticked, {
      '$books.manualQcCompleted$': {
        [Sequelize.Op.or]: [null, false]
      }
    })
  })

  it('keeps collapsed-series playback filters separate from ticked/unticked', () => {
    const finished = libraryItemsBookFilters.getCollapseSeriesMediaProgressFilter('finished')
    const notFinished = libraryItemsBookFilters.getCollapseSeriesMediaProgressFilter('not-finished')
    const ticked = libraryItemsBookFilters.getCollapseSeriesMediaProgressFilter('ticked')
    const unticked = libraryItemsBookFilters.getCollapseSeriesMediaProgressFilter('unticked')

    assert.notDeepStrictEqual(ticked, finished)
    assert.notDeepStrictEqual(unticked, notFinished)
  })
})
