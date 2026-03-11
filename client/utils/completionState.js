function getItemProgress(userMediaProgress, libraryItemId) {
  return (userMediaProgress || []).find((progress) => progress.libraryItemId === libraryItemId) || null
}

function isLibraryItemTicked(userMediaProgress, libraryItemId) {
  const progress = getItemProgress(userMediaProgress, libraryItemId)
  return !!progress?.isFinished
}

function getNextCompletionState(isTicked) {
  return !isTicked
}

function getBulkCompletionTarget(selectedMediaItems, userMediaProgress) {
  const selected = selectedMediaItems || []
  if (!selected.length) return false

  const hasUntickedItem = selected.some((item) => !isLibraryItemTicked(userMediaProgress, item.id))
  if (hasUntickedItem) return true
  return false
}

function buildBatchCompletionPayload(selectedMediaItems, userMediaProgress) {
  const isFinished = getBulkCompletionTarget(selectedMediaItems, userMediaProgress)
  return (selectedMediaItems || []).map((item) => ({
    libraryItemId: item.id,
    isFinished
  }))
}

module.exports = {
  getItemProgress,
  isLibraryItemTicked,
  getNextCompletionState,
  getBulkCompletionTarget,
  buildBatchCompletionPayload
}
