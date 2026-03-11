function isLibraryItemTicked(libraryItem) {
  return !!libraryItem?.media?.manualQcCompleted
}

function getManualQcPayloadValue(isTicked) {
  return !!isTicked
}

function getNextCompletionState(isTicked) {
  return !isTicked
}

function getBulkCompletionTarget(selectedMediaItems) {
  const selected = selectedMediaItems || []
  if (!selected.length) return false

  const hasUntickedItem = selected.some((item) => !isLibraryItemTicked(item))
  if (hasUntickedItem) return true
  return false
}

function buildBatchCompletionPayload(selectedMediaItems) {
  const manualQcCompleted = getBulkCompletionTarget(selectedMediaItems)
  return (selectedMediaItems || []).map((item) => ({
    libraryItemId: item.id,
    manualQcCompleted
  }))
}

module.exports = {
  isLibraryItemTicked,
  getManualQcPayloadValue,
  getNextCompletionState,
  getBulkCompletionTarget,
  buildBatchCompletionPayload
}
