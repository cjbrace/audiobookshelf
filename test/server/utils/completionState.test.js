const assert = require('assert')
const { buildBatchCompletionPayload, getBulkCompletionTarget, getNextCompletionState } = require('../../../client/utils/completionState')

describe('completionState helper', () => {
  describe('getNextCompletionState', () => {
    it('returns ticked=true when current state is unticked', () => {
      assert.strictEqual(getNextCompletionState(false), true)
    })

    it('returns ticked=false when current state is ticked', () => {
      assert.strictEqual(getNextCompletionState(true), false)
    })
  })

  describe('getBulkCompletionTarget', () => {
    it('ticks all when any selected item is unticked', () => {
      const selected = [{ id: 'a' }, { id: 'b' }]
      const userMediaProgress = [{ libraryItemId: 'a', isFinished: true }]
      assert.strictEqual(getBulkCompletionTarget(selected, userMediaProgress), true)
    })

    it('unticks all when selected items are fully ticked', () => {
      const selected = [{ id: 'a' }, { id: 'b' }]
      const userMediaProgress = [
        { libraryItemId: 'a', isFinished: true },
        { libraryItemId: 'b', isFinished: true }
      ]
      assert.strictEqual(getBulkCompletionTarget(selected, userMediaProgress), false)
    })
  })

  describe('buildBatchCompletionPayload', () => {
    it('builds payloads with isFinished=true when selection includes unticked', () => {
      const selected = [{ id: 'a' }, { id: 'b' }]
      const userMediaProgress = [{ libraryItemId: 'a', isFinished: true }]
      const payload = buildBatchCompletionPayload(selected, userMediaProgress)

      assert.deepStrictEqual(payload, [
        { libraryItemId: 'a', isFinished: true },
        { libraryItemId: 'b', isFinished: true }
      ])
    })

    it('builds payloads with isFinished=false when selection is fully ticked', () => {
      const selected = [{ id: 'a' }, { id: 'b' }]
      const userMediaProgress = [
        { libraryItemId: 'a', isFinished: true },
        { libraryItemId: 'b', isFinished: true }
      ]
      const payload = buildBatchCompletionPayload(selected, userMediaProgress)

      assert.deepStrictEqual(payload, [
        { libraryItemId: 'a', isFinished: false },
        { libraryItemId: 'b', isFinished: false }
      ])
    })
  })
})
