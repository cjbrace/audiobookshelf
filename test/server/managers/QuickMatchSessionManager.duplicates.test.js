const assert = require('assert')
const QuickMatchSessionManager = require('../../../server/managers/QuickMatchSessionManager')

function makeChange(id, libraryItemId) {
  return {
    id,
    libraryItemId,
    status: 'updated',
    revertStatus: 'not_reverted',
    createdAt: new Date().toISOString()
  }
}

function makeLiveState(libraryItemId, title, author, series = '') {
  const titleTokens = QuickMatchSessionManager.tokenize(title)
  const authorTokens = QuickMatchSessionManager.tokenize(author)
  const seriesTokens = QuickMatchSessionManager.tokenize(series)
  return {
    libraryItemId,
    libraryId: 'lib1',
    updatedAt: new Date().toISOString(),
    title,
    author,
    series,
    coverPath: `/tmp/${libraryItemId}.jpg`,
    titleNorm: QuickMatchSessionManager.normalizeText(title),
    authorNorm: QuickMatchSessionManager.normalizeText(author),
    seriesNorm: QuickMatchSessionManager.normalizeText(series),
    titleTokens,
    authorTokens,
    seriesTokens,
    materialKey: QuickMatchSessionManager.buildMaterialKey({ title, author, series })
  }
}

describe('QuickMatchSessionManager duplicate grouping', () => {
  const originalGetLiveBookStates = QuickMatchSessionManager.getLiveBookStates
  const originalListDuplicateSuppressions = QuickMatchSessionManager.listDuplicateSuppressions
  const originalBuildDuplicateGroupsForItemIds = QuickMatchSessionManager.buildDuplicateGroupsForItemIds

  afterEach(() => {
    QuickMatchSessionManager.getLiveBookStates = originalGetLiveBookStates
    QuickMatchSessionManager.listDuplicateSuppressions = originalListDuplicateSuppressions
    QuickMatchSessionManager.buildDuplicateGroupsForItemIds = originalBuildDuplicateGroupsForItemIds
  })

  it('builds fuzzy-positive groups and includes exact duplicates', async () => {
    QuickMatchSessionManager.getLiveBookStates = async () => ({
      a: makeLiveState('a', 'The Hobbit', 'J R R Tolkien'),
      b: makeLiveState('b', 'Hobbit The', 'J.R.R. Tolkien'),
      c: makeLiveState('c', 'The Hobbit', 'J R R Tolkien'),
      d: makeLiveState('d', 'Different Book', 'Different Author')
    })
    QuickMatchSessionManager.listDuplicateSuppressions = async () => ({})

    const result = await QuickMatchSessionManager.buildDuplicateGroups('session-1', [makeChange('c1', 'a'), makeChange('c2', 'b'), makeChange('c3', 'c'), makeChange('c4', 'd')], 0.79)

    assert.strictEqual(result.groupedCount, 1)
    assert.strictEqual(result.groups[0].size, 3)
    const groupedIds = result.groups[0].members.map((member) => member.libraryItemId).sort()
    assert.deepStrictEqual(groupedIds, ['a', 'b', 'c'])
  })

  it('drops groups that become singletons after reassessment', async () => {
    const changes = [makeChange('c1', 'a'), makeChange('c2', 'b')]
    QuickMatchSessionManager.listDuplicateSuppressions = async () => ({})

    QuickMatchSessionManager.getLiveBookStates = async () => ({
      a: makeLiveState('a', 'Project Hail Mary', 'Andy Weir'),
      b: makeLiveState('b', 'Project Hail Mary (Unabridged)', 'Andy Weir')
    })
    const first = await QuickMatchSessionManager.buildDuplicateGroups('session-2', changes, 0.79)
    assert.strictEqual(first.groupedCount, 1)
    assert.strictEqual(first.groups[0].size, 2)

    QuickMatchSessionManager.getLiveBookStates = async () => ({
      a: makeLiveState('a', 'Project Hail Mary', 'Andy Weir'),
      b: makeLiveState('b', 'The Martian', 'Andy Weir')
    })
    const second = await QuickMatchSessionManager.buildDuplicateGroups('session-2', changes, 0.79)
    assert.strictEqual(second.groupedCount, 0)
  })

  it('suppresses unchanged groups and allows reappearance on material key change', async () => {
    const changes = [makeChange('c1', 'a'), makeChange('c2', 'b')]
    const baseA = makeLiveState('a', 'Dune Messiah', 'Frank Herbert')
    const baseB = makeLiveState('b', 'Dune Messiah Unabridged', 'Frank Herbert')
    const groupKey = QuickMatchSessionManager.buildDuplicateGroupKey([baseA, baseB])
    const oldFingerprint = QuickMatchSessionManager.buildDuplicateGroupFingerprint([baseA, baseB])

    QuickMatchSessionManager.listDuplicateSuppressions = async () => ({
      [groupKey]: oldFingerprint
    })
    QuickMatchSessionManager.getLiveBookStates = async () => ({
      a: baseA,
      b: baseB
    })
    const suppressed = await QuickMatchSessionManager.buildDuplicateGroups('session-3', changes, 0.79)
    assert.strictEqual(suppressed.groupedCount, 0)
    assert.strictEqual(suppressed.suppressedCount, 1)

    const changedB = makeLiveState('b', 'Dune Messiah Audio Edition', 'Frank Herbert')
    QuickMatchSessionManager.getLiveBookStates = async () => ({
      a: baseA,
      b: changedB
    })
    const reappeared = await QuickMatchSessionManager.buildDuplicateGroups('session-3', changes, 0.79)
    assert.strictEqual(reappeared.groupedCount, 1)
    assert.strictEqual(reappeared.suppressedCount, 0)
  })

  it('prevents single-token title chaining and enforces near-exact matching at 0.95', async () => {
    const dune = makeLiveState('a', 'Dune', 'Frank Herbert', 'Dune #1')
    const chapterhouse = makeLiveState('b', 'Chapterhouse Dune', 'Frank Herbert', 'Dune #6')
    const exactish = makeLiveState('c', 'Dune', 'Frank Herbert', 'Dune #1')
    const changes = [makeChange('c1', 'a'), makeChange('c2', 'b'), makeChange('c3', 'c')]

    QuickMatchSessionManager.listDuplicateSuppressions = async () => ({})
    QuickMatchSessionManager.getLiveBookStates = async () => ({ a: dune, b: chapterhouse, c: exactish })

    const strict = await QuickMatchSessionManager.buildDuplicateGroups('session-4', changes, 0.95)
    assert.strictEqual(strict.groupedCount, 1)
    const strictIds = strict.groups[0].members.map((member) => member.libraryItemId).sort()
    assert.deepStrictEqual(strictIds, ['a', 'c'])
  })

  it('processes only targeted duplicate groups by item ids', async () => {
    const calls = []
    QuickMatchSessionManager.buildDuplicateGroupsForItemIds = async (sessionId, libraryItemIds, threshold) => {
      calls.push({ sessionId, libraryItemIds, threshold })
      return {
        threshold: Number(threshold || 0.79),
        groupedCount: 0,
        suppressedCount: 0,
        sourceItemsCount: libraryItemIds.length,
        groups: []
      }
    }

    const result = await QuickMatchSessionManager.processDuplicateTargets(
      'session-targeted',
      [
        { token: 'group-a', libraryItemIds: ['a1', 'a2', 'a2'] },
        { token: 'group-b', libraryItemIds: ['b1'] }
      ],
      0.82
    )

    assert.strictEqual(calls.length, 2)
    assert.deepStrictEqual(calls[0], {
      sessionId: 'session-targeted',
      libraryItemIds: ['a1', 'a2'],
      threshold: 0.82
    })
    assert.deepStrictEqual(calls[1], {
      sessionId: 'session-targeted',
      libraryItemIds: ['b1'],
      threshold: 0.82
    })
    assert.strictEqual(result.requestedTargetCount, 2)
    assert.strictEqual(result.processedTargetCount, 2)
    assert.deepStrictEqual(
      result.processedTargets.map((target) => target.token),
      ['group-a', 'group-b']
    )
  })
})
