#!/usr/bin/env node
const QuickMatchSessionManager = require('../server/managers/QuickMatchSessionManager')

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
  return {
    libraryItemId,
    libraryId: 'probe-library',
    updatedAt: new Date().toISOString(),
    title,
    author,
    series,
    coverPath: `/covers/${libraryItemId}.jpg`,
    titleNorm: QuickMatchSessionManager.normalizeText(title),
    authorNorm: QuickMatchSessionManager.normalizeText(author),
    seriesNorm: QuickMatchSessionManager.normalizeText(series),
    titleTokens: QuickMatchSessionManager.tokenize(title),
    authorTokens: QuickMatchSessionManager.tokenize(author),
    seriesTokens: QuickMatchSessionManager.tokenize(series),
    materialKey: QuickMatchSessionManager.buildMaterialKey({ title, author, series })
  }
}

async function withStubbedState(stateById, suppressionByGroupKey, fn) {
  const originalGetLiveBookStates = QuickMatchSessionManager.getLiveBookStates
  const originalListDuplicateSuppressions = QuickMatchSessionManager.listDuplicateSuppressions
  QuickMatchSessionManager.getLiveBookStates = async () => stateById
  QuickMatchSessionManager.listDuplicateSuppressions = async () => suppressionByGroupKey || {}
  try {
    return await fn()
  } finally {
    QuickMatchSessionManager.getLiveBookStates = originalGetLiveBookStates
    QuickMatchSessionManager.listDuplicateSuppressions = originalListDuplicateSuppressions
  }
}

async function run() {
  const threshold = 0.79

  const fuzzyAndExactChanges = [makeChange('f1', 'a'), makeChange('f2', 'b'), makeChange('f3', 'c'), makeChange('f4', 'z')]
  const fuzzyAndExactStates = {
    a: makeLiveState('a', 'The Hobbit', 'J R R Tolkien'),
    b: makeLiveState('b', 'Hobbit The', 'J.R.R. Tolkien'),
    c: makeLiveState('c', 'The Hobbit', 'J R R Tolkien'),
    z: makeLiveState('z', 'Different Book', 'Different Author')
  }
  const fuzzyAndExact = await withStubbedState(fuzzyAndExactStates, {}, async () => {
    return QuickMatchSessionManager.buildDuplicateGroups('probe-session', fuzzyAndExactChanges, threshold)
  })

  const reassessChanges = [makeChange('r1', 'r-a'), makeChange('r2', 'r-b')]
  const reassessBefore = await withStubbedState(
    {
      'r-a': makeLiveState('r-a', 'Project Hail Mary', 'Andy Weir'),
      'r-b': makeLiveState('r-b', 'Project Hail Mary Unabridged', 'Andy Weir')
    },
    {},
    async () => QuickMatchSessionManager.buildDuplicateGroups('probe-session-reassess', reassessChanges, threshold)
  )
  const reassessAfter = await withStubbedState(
    {
      'r-a': makeLiveState('r-a', 'Project Hail Mary', 'Andy Weir'),
      'r-b': makeLiveState('r-b', 'The Martian', 'Andy Weir')
    },
    {},
    async () => QuickMatchSessionManager.buildDuplicateGroups('probe-session-reassess', reassessChanges, threshold)
  )

  const suppressBaseA = makeLiveState('s-a', 'Dune', 'Frank Herbert')
  const suppressBaseB = makeLiveState('s-b', 'Dune Unabridged', 'Frank Herbert')
  const suppressGroupKey = QuickMatchSessionManager.buildDuplicateGroupKey([suppressBaseA, suppressBaseB])
  const suppressFingerprint = QuickMatchSessionManager.buildDuplicateGroupFingerprint([suppressBaseA, suppressBaseB])
  const suppressionChanges = [makeChange('s1', 's-a'), makeChange('s2', 's-b')]

  const suppressed = await withStubbedState(
    {
      's-a': suppressBaseA,
      's-b': suppressBaseB
    },
    { [suppressGroupKey]: suppressFingerprint },
    async () => QuickMatchSessionManager.buildDuplicateGroups('probe-session-suppress', suppressionChanges, threshold)
  )

  const reappeared = await withStubbedState(
    {
      's-a': suppressBaseA,
      's-b': makeLiveState('s-b', 'Dune Audio Edition', 'Frank Herbert')
    },
    { [suppressGroupKey]: suppressFingerprint },
    async () => QuickMatchSessionManager.buildDuplicateGroups('probe-session-suppress', suppressionChanges, threshold)
  )

  const payload = {
    threshold,
    fuzzy_positive_groups: fuzzyAndExact.groups.map((group) => ({ size: group.size, ids: group.members.map((member) => member.libraryItemId) })),
    exact_duplicates_included: fuzzyAndExact.groups.some((group) => group.members.map((member) => member.libraryItemId).includes('a') && group.members.map((member) => member.libraryItemId).includes('c')),
    singleton_drop_after_reassessment: {
      before_grouped_count: reassessBefore.groupedCount,
      after_grouped_count: reassessAfter.groupedCount
    },
    suppression_persistence_and_reappearance: {
      suppressed_grouped_count: suppressed.groupedCount,
      suppressed_count: suppressed.suppressedCount,
      reappeared_grouped_count_after_material_change: reappeared.groupedCount,
      reappeared_suppressed_count_after_material_change: reappeared.suppressedCount
    }
  }

  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`)
}

run().catch((error) => {
  process.stderr.write(`${error?.stack || error}\n`)
  process.exit(1)
})
