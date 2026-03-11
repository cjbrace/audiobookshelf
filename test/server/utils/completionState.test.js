const assert = require('assert')
const { buildBatchCompletionPayload, getBulkCompletionTarget, getNextCompletionState, isLibraryItemTicked } = require('../../../client/utils/completionState')

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
      const selected = [
        { id: 'a', media: { manualQcCompleted: true } },
        { id: 'b', media: { manualQcCompleted: false } }
      ]
      assert.strictEqual(getBulkCompletionTarget(selected), true)
    })

    it('unticks all when selected items are fully ticked', () => {
      const selected = [
        { id: 'a', media: { manualQcCompleted: true } },
        { id: 'b', media: { manualQcCompleted: true } }
      ]
      assert.strictEqual(getBulkCompletionTarget(selected), false)
    })
  })

  describe('isLibraryItemTicked', () => {
    it('uses manual QC state and does not infer ticked from playback completion fields', () => {
      const item = {
        id: 'a',
        media: {
          manualQcCompleted: false
        },
        mediaProgress: {
          isFinished: true
        }
      }
      assert.strictEqual(isLibraryItemTicked(item), false)
    })
  })

  describe('buildBatchCompletionPayload', () => {
    it('builds payloads with manualQcCompleted=true when selection includes unticked', () => {
      const selected = [
        { id: 'a', media: { manualQcCompleted: true } },
        { id: 'b', media: { manualQcCompleted: false } }
      ]
      const payload = buildBatchCompletionPayload(selected)

      assert.deepStrictEqual(payload, [
        { libraryItemId: 'a', manualQcCompleted: true },
        { libraryItemId: 'b', manualQcCompleted: true }
      ])
    })

    it('builds payloads with manualQcCompleted=false when selection is fully ticked', () => {
      const selected = [
        { id: 'a', media: { manualQcCompleted: true } },
        { id: 'b', media: { manualQcCompleted: true } }
      ]
      const payload = buildBatchCompletionPayload(selected)

      assert.deepStrictEqual(payload, [
        { libraryItemId: 'a', manualQcCompleted: false },
        { libraryItemId: 'b', manualQcCompleted: false }
      ])
    })
  })
})
