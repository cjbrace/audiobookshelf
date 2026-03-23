<template>
  <div class="page relative" :class="streamLibraryItem ? 'streaming' : ''">
    <app-book-shelf-toolbar is-home />
    <div id="bookshelf" class="w-full h-full px-2 py-4 md:p-8 relative overflow-y-auto">
      <div class="w-full">
        <div class="flex items-center gap-2 mb-3">
          <h1 class="text-2xl font-semibold">Series Review</h1>
          <div class="grow" />
          <label v-if="activeTab === 'queue'" class="flex items-center gap-2 text-sm text-gray-300 cursor-pointer">
            <input v-model="includeDecided" type="checkbox" class="rounded border-white/20 bg-black/30" @change="loadQueue" />
            <span>Show decided rows</span>
          </label>
          <ui-btn
            v-if="activeTab === 'queue'"
            color="bg-sky-500/80"
            small
            :loading="sourceImportStarting"
            :disabled="sourceImportStatus?.has_active_run"
            @click="startSourceImport"
          >
            Import Trusted Sources
          </ui-btn>
          <ui-btn
            color="bg-bg border border-white/20"
            small
            :loading="activeTab === 'queue' ? loading : activeTab === 'management' ? managementLoading : catalogLoading"
            @click="activeTab === 'queue' ? loadQueue() : activeTab === 'management' ? loadManagementData() : loadCatalogs()"
          >
            Refresh
          </ui-btn>
        </div>

        <div class="flex flex-wrap gap-2 mb-4">
          <button
            type="button"
            class="px-3 py-1.5 rounded-full border text-sm transition"
            :class="activeTab === 'queue' ? 'bg-sky-400/20 border-sky-300/45 text-sky-50' : 'bg-black/20 border-white/15 text-gray-200'"
            @click="switchTab('queue')"
          >
            Review Queue
          </button>
          <button
            type="button"
            class="px-3 py-1.5 rounded-full border text-sm transition"
            :class="activeTab === 'management' ? 'bg-sky-400/20 border-sky-300/45 text-sky-50' : 'bg-black/20 border-white/15 text-gray-200'"
            @click="switchTab('management')"
          >
            Series Management
          </button>
          <button
            type="button"
            class="px-3 py-1.5 rounded-full border text-sm transition"
            :class="activeTab === 'catalog' ? 'bg-sky-400/20 border-sky-300/45 text-sky-50' : 'bg-black/20 border-white/15 text-gray-200'"
            @click="switchTab('catalog')"
          >
            Series Detail
          </button>
        </div>

        <div v-if="activeTab === 'queue' && sourceLegendEntries.length" class="flex flex-wrap gap-2 mb-4 text-sm">
          <a
            v-for="entry in sourceLegendEntries"
            :key="entry.code"
            class="inline-flex items-center gap-2 px-2.5 py-1 rounded-full bg-sky-400/15 border border-sky-300/35 text-sky-50 hover:bg-sky-400/25 transition"
            :href="entry.url"
            target="_blank"
            rel="noopener noreferrer"
          >
            <span class="font-semibold">{{ entry.code }}</span>
            <span class="text-sky-100/90">{{ entry.name }}</span>
          </a>
        </div>

        <div v-if="activeTab === 'queue'" class="bg-black/20 rounded-lg p-3 border border-white/10 mb-4">
          <div class="flex flex-wrap items-start gap-3">
            <button
              type="button"
              class="grow min-w-[18rem] text-left"
              @click="sourceImportExpanded = !sourceImportExpanded"
            >
              <div class="flex flex-wrap items-center gap-x-3 gap-y-1">
                <p class="text-sm uppercase tracking-wide text-gray-400">Trusted Source Import</p>
                <span class="text-xs text-gray-500">{{ sourceImportExpanded ? 'Hide details' : 'Show details' }}</span>
              </div>
              <p class="text-base text-gray-100 mt-1">{{ sourceImportStatusLine }}</p>
              <div v-if="sourceImportSummaryLine" class="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm text-gray-200">
                <span v-for="entry in sourceImportSummaryLine" :key="entry">{{ entry }}</span>
              </div>
              <p v-if="sourceImportStatus?.recent_warning" class="text-sm text-amber-200 mt-1">{{ sourceImportStatus.recent_warning }}</p>
              <p v-if="sourceImportError" class="text-sm text-red-200 mt-1">{{ sourceImportError }}</p>
            </button>
            <div v-if="sourceImportDisplayJob" class="text-sm text-gray-300">
              <div>Job: {{ sourceImportDisplayJob.job_id }}</div>
            </div>
          </div>

          <div v-if="sourceImportExpanded && sourceImportFilterButtons.length" class="flex flex-wrap gap-2 mt-3">
            <button
              v-for="button in sourceImportFilterButtons"
              :key="button.key"
              type="button"
              class="px-3 py-1.5 rounded-full border text-sm transition"
              :class="sourceImportResultFilter === button.key ? 'bg-sky-400/20 border-sky-300/45 text-sky-50' : 'bg-black/20 border-white/15 text-gray-200'"
              @click="toggleSourceImportResultFilter(button.key)"
            >
              {{ button.label }} ({{ button.count }})
            </button>
          </div>

          <div v-if="sourceImportExpanded && sourceImportFilteredResults.length" class="mt-3 space-y-2">
            <div
              v-for="entry in sourceImportFilteredResults"
              :key="sourceImportResultFilter + ':' + entry.libraryItemId + ':' + (entry.title || entry.error)"
              class="rounded border border-white/10 bg-black/15 px-3 py-2 text-sm text-gray-200"
            >
              <div class="flex flex-wrap gap-x-2 gap-y-1">
                <nuxt-link v-if="entry.libraryItemId" :to="`/item/${entry.libraryItemId}`" class="font-medium text-sky-200 hover:underline">
                  {{ entry.title || entry.libraryItemId }}
                </nuxt-link>
                <span v-else class="font-medium">{{ entry.title || 'Lookup failure' }}</span>
                <span v-if="entry.author" class="text-gray-400">{{ entry.author }}</span>
              </div>
              <p v-if="entry.currentSeries?.length" class="mt-1 text-gray-300">Current: {{ formatSeriesList(entry.currentSeries) }}</p>
              <p v-if="entry.suggestedSeries?.length" class="mt-1 text-gray-300">Suggested: {{ formatImportSuggestions(entry.suggestedSeries) }}</p>
              <p v-if="entry.error" class="mt-1 text-red-200">{{ entry.error }}</p>
            </div>
          </div>
        </div>

        <div class="bg-primary/20 rounded-lg p-3 border border-primary/40 mb-4 text-sm text-gray-200">
          <div v-if="activeTab === 'queue'" class="flex flex-wrap gap-x-4 gap-y-1">
            <span>Rows: {{ rows.length }}</span>
            <span>Pending suggestions: {{ pendingSuggestionCount }}</span>
            <span v-if="lastLoadedAt">Last loaded: {{ formatTime(lastLoadedAt) }}</span>
          </div>
          <div v-else-if="activeTab === 'management'" class="flex flex-wrap gap-x-4 gap-y-1">
            <span>Candidate groups: {{ managementCandidates.length }}</span>
            <span>Recent actions: {{ managementRecentActions.length }}</span>
            <span v-if="lastLoadedAt">Last loaded: {{ formatTime(lastLoadedAt) }}</span>
          </div>
          <div v-else class="flex flex-wrap gap-x-4 gap-y-1">
            <span>Series: {{ catalogSeries.length }}</span>
            <span v-if="selectedCatalogDetail">Slots: {{ selectedCatalogDetail.slots.length }}</span>
            <span v-if="selectedCatalogDetail">Missing: {{ selectedCatalogDetail.slots.filter((slot) => slot.status === 'missing').length }}</span>
            <span v-if="lastLoadedAt">Last loaded: {{ formatTime(lastLoadedAt) }}</span>
          </div>
        </div>

        <div class="bg-primary/20 rounded-lg p-3 border border-primary/40">
          <div v-if="errorMessage" class="text-red-200 mb-3">{{ errorMessage }}</div>

          <template v-if="activeTab === 'queue'">
          <div v-if="!rows.length && !loading" class="text-base text-gray-200">
            No series review rows are stored for this library yet.
          </div>

          <div v-else class="overflow-auto max-h-[70vh] border border-white/15 rounded">
            <table class="w-full text-base table-fixed">
              <thead class="bg-slate-950 sticky top-0">
                <tr>
                  <th class="text-left px-3 py-2 w-72">Book</th>
                  <th class="text-left px-3 py-2 w-72">Current Series</th>
                  <th class="text-left px-3 py-2">Suggested Series</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="row in rows" :key="row.libraryItemId" class="border-t border-white/10 align-top">
                  <td class="px-3 py-3">
                    <nuxt-link :to="`/item/${row.libraryItemId}`" class="block text-lg font-semibold hover:underline">
                      {{ row.title || '-' }}
                    </nuxt-link>
                    <p class="text-base text-gray-200 mt-1">{{ formatAuthors(row.authors) }}</p>
                    <div v-if="row.hasPreviousSeriesEdit" class="mt-2">
                      <span class="inline-flex items-center px-2.5 py-1 rounded-full border border-amber-300/35 bg-amber-500/10 text-sm text-amber-50">
                        Previous series edit
                      </span>
                    </div>
                    <div v-if="row.conflictSummary" class="mt-2">
                      <span class="inline-flex items-center px-2 py-0.5 rounded-full border border-amber-300/35 bg-amber-500/10 text-xs text-amber-100">
                        {{ row.conflictSummary }}
                      </span>
                    </div>
                    <p v-if="row.relPath" class="text-sm text-gray-400 mt-2 break-all">{{ row.relPath }}</p>
                  </td>
                  <td class="px-3 py-3">
                    <div v-if="row.currentSeries.length" class="flex flex-wrap gap-2">
                      <div
                        v-for="series in row.currentSeries"
                        :key="series.id"
                        class="inline-flex items-center gap-2 px-2 py-1 rounded border text-left transition"
                        :class="selectedReplaceTarget[row.libraryItemId] === series.id ? 'bg-yellow-700/40 border-yellow-400 text-yellow-100' : 'bg-black/20 border-white/15 hover:border-yellow-400/70'"
                      >
                        <button type="button" class="contents" @click="toggleReplaceTarget(row.libraryItemId, series.id)">
                          <span class="font-medium">{{ series.name }}</span>
                          <span v-if="series.sequence" class="text-sm text-gray-300">#{{ series.sequence }}</span>
                        </button>
                        <button
                          v-if="selectedReplaceTarget[row.libraryItemId] === series.id"
                          type="button"
                          class="w-5 h-5 rounded-full border border-red-300/50 bg-red-500/15 text-red-100 leading-none hover:bg-red-500/25"
                          :disabled="actionKey === `${row.libraryItemId}:remove:${series.id}`"
                          @click.stop="removeCurrentSeries(row, series)"
                        >
                          X
                        </button>
                      </div>
                    </div>
                    <p v-else class="text-gray-300">No current ABS series entries</p>
                  </td>
                  <td class="px-3 py-3">
                    <div class="grid grid-cols-1 xl:grid-cols-2 gap-3">
                      <div
                        v-for="suggestion in getPrimarySuggestions(row)"
                        :key="suggestion.id"
                        class="rounded border p-3"
                        :class="getSuggestionCardClass(suggestion)"
                      >
                        <div class="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
                          <div class="grow min-w-[16rem]">
                            <div class="flex flex-wrap items-center gap-x-2 gap-y-1 text-lg font-semibold text-white">
                              <template v-if="suggestion.kind === 'no_series'">No series suggested</template>
                              <template v-else>
                                <span>{{ suggestion.suggestedName }}</span>
                                <span v-if="suggestion.suggestedSequence" class="inline-flex items-center px-2 py-0.5 rounded-full bg-white/10 text-xs text-gray-100 border border-white/15">#{{ suggestion.suggestedSequence }}</span>
                              </template>
                            </div>
                            <p v-if="suggestion.previousDecision" class="text-sm mt-1" :class="suggestion.hasMeaningfulUpdateSinceDecision ? 'text-amber-200' : 'text-gray-400'">
                              {{ formatPreviousDecision(suggestion) }}
                            </p>
                          </div>
                          <div class="flex flex-wrap items-center justify-end gap-x-3 gap-y-1 text-xs text-gray-400 text-right">
                            <span class="whitespace-nowrap">Seen {{ formatTime(suggestion.firstSeenAt) }}</span>
                            <span v-if="suggestion.lastSeenAt && suggestion.lastSeenAt !== suggestion.firstSeenAt" class="whitespace-nowrap">Updated {{ formatTime(suggestion.lastSeenAt) }}</span>
                            <span class="whitespace-nowrap">{{ suggestion.sourceCount }} source<span v-if="suggestion.sourceCount !== 1">s</span></span>
                          </div>
                        </div>

                        <div class="mt-3 flex flex-wrap gap-2">
                          <div
                            v-for="contribution in suggestion.contributions"
                            :key="suggestion.id + ':' + contribution.source"
                            class="px-2.5 py-1 rounded-full border text-sm"
                            :class="getContributionPillClass(contribution)"
                          >
                            <span class="font-medium uppercase tracking-wide">{{ contribution.label || contribution.source }}</span>
                            <span v-if="contribution.noSeries" class="text-gray-300"> no series</span>
                          </div>
                          <div
                            v-for="contribution in getConflictContributions(row)"
                            v-if="showSubordinateConflicts(row, suggestion)"
                            :key="suggestion.id + ':conflict:' + contribution.source + ':' + (contribution.seriesName || 'no-series')"
                            class="px-2.5 py-1 rounded-full border border-red-300/35 bg-red-500/10 text-sm text-red-50"
                          >
                            <span class="font-medium uppercase tracking-wide">{{ contribution.label || contribution.source }}</span>
                            <span v-if="contribution.noSeries"> no series</span>
                            <span v-else>
                              {{ contribution.seriesName }}
                              <span v-if="contribution.sequence">&nbsp;#{{ contribution.sequence }}</span>
                            </span>
                          </div>
                        </div>

                        <div class="mt-3 text-sm text-gray-300 space-y-1">
                          <p v-if="suggestion.evidenceSummary?.automatedAgreement" class="text-emerald-200">
                            Cross-check agreement: FictionDB + Wikidata agree
                          </p>
                          <p v-else-if="suggestion.evidenceSummary?.hasPrimaryAutomatedSource && suggestion.evidenceSummary?.hasSecondaryAutomatedSource" class="text-amber-200">
                            Automated sources both present; inspect disagreement details below
                          </p>
                          <p v-if="suggestion.evidenceSummary?.disagreement" class="text-amber-200">
                            Source disagreement: {{ suggestion.evidenceSummary.supportCount }} positive / {{ suggestion.evidenceSummary.conflictCount }} conflicting
                          </p>
                          <p v-if="suggestion.evidenceSummary?.manualReferenceCount" class="text-gray-400">
                            Manual references: {{ suggestion.evidenceSummary.manualReferenceCount }}
                          </p>
                        </div>

                        <div class="mt-3 space-y-2">
                          <div
                            v-for="contribution in suggestion.contributions"
                            :key="suggestion.id + ':detail:' + contribution.source + ':' + (contribution.seriesName || 'no-series')"
                            class="rounded border border-white/10 bg-black/15 px-3 py-2 text-sm text-gray-200"
                          >
                            <div class="flex flex-wrap items-center gap-x-3 gap-y-1">
                              <span class="font-medium text-white">{{ getSourceDisplayName(contribution.source) }}</span>
                              <span v-if="contribution.noSeries" class="text-red-200">No series evidence</span>
                              <span v-else>
                                {{ contribution.seriesName }}
                                <span v-if="contribution.sequence">&nbsp;#{{ contribution.sequence }}</span>
                              </span>
                              <span v-if="contribution.confidence !== null && contribution.confidence !== undefined" class="text-gray-400">
                                conf: {{ formatConfidence(contribution.confidence) }}
                              </span>
                            </div>
                            <a
                              v-if="contribution.evidenceUrl"
                              class="mt-1 inline-flex text-sky-200 hover:underline"
                              :href="contribution.evidenceUrl"
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              Evidence link
                            </a>
                          </div>
                        </div>

                        <div v-if="suggestion.state === 'pending'" class="mt-3 flex flex-wrap gap-2">
                          <ui-btn
                            v-if="suggestion.kind === 'series'"
                            small
                            class="w-28 justify-center text-center"
                            :color="selectedReplaceTarget[row.libraryItemId] ? 'bg-warning/70' : 'bg-success/80'"
                            :loading="actionKey === suggestion.id + ':apply'"
                            @click="applySuggestion(row, suggestion)"
                          >
                            {{ selectedReplaceTarget[row.libraryItemId] ? 'Replace' : 'Add' }}
                          </ui-btn>
                          <ui-btn
                            small
                            color="bg-bg border border-white/20"
                            :loading="actionKey === suggestion.id + ':dismiss'"
                            @click="dismissSuggestion(suggestion)"
                          >
                            Dismiss
                          </ui-btn>
                        </div>
                      </div>
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          </template>

          <template v-else-if="activeTab === 'management'">
            <div v-if="!managementCandidates.length && !managementLoading" class="text-base text-gray-200">
              No obvious duplicate series labels are queued for management yet.
            </div>

            <div v-else class="space-y-4">
              <div
                v-for="candidate in managementCandidates"
                :key="candidate.groupKey"
                class="rounded border border-white/15 bg-black/15 p-4"
              >
                <div class="flex flex-wrap items-start gap-3">
                  <div class="grow min-w-[16rem]">
                    <p class="text-sm text-gray-300">Possible duplicate labels</p>
                    <div class="mt-2 flex flex-wrap gap-2">
                      <span
                        v-for="label in candidate.labels"
                        :key="label.id"
                        class="inline-flex items-center gap-2 px-2.5 py-1 rounded-full border border-white/15 bg-black/20 text-sm text-gray-100"
                      >
                        <span>{{ label.name }}</span>
                        <span class="text-gray-400">{{ label.bookCount }}</span>
                      </span>
                    </div>
                  </div>
                  <div class="w-full md:w-72">
                    <label class="block text-sm text-gray-300 mb-1">Target label</label>
                    <input
                      v-model="managementTargetLabels[candidate.groupKey]"
                      type="text"
                      class="w-full rounded border border-white/20 bg-black/20 px-3 py-2 text-gray-100"
                    />
                    <div class="mt-2 flex gap-2">
                      <ui-btn
                        small
                        color="bg-bg border border-white/20"
                        :loading="managementPreviewLoadingKey === candidate.groupKey"
                        @click="previewManagementCandidate(candidate)"
                      >
                        Preview
                      </ui-btn>
                    </div>
                  </div>
                </div>

                <div v-if="managementPreviewByGroup[candidate.groupKey]" class="mt-4 space-y-3">
                  <div class="text-sm text-gray-300">
                    {{ managementPreviewByGroup[candidate.groupKey].changedCount }} ready to change,
                    {{ managementPreviewByGroup[candidate.groupKey].conflictCount }} conflict<span v-if="managementPreviewByGroup[candidate.groupKey].conflictCount !== 1">s</span>
                  </div>

                  <div class="overflow-auto border border-white/10 rounded">
                    <table class="w-full text-sm table-fixed">
                      <thead class="bg-black/30">
                        <tr>
                          <th class="text-left px-3 py-2 w-12">Use</th>
                          <th class="text-left px-3 py-2 w-64">Book</th>
                          <th class="text-left px-3 py-2 w-72">Current duplicate labels</th>
                          <th class="text-left px-3 py-2">Preview / conflict</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr
                          v-for="book in managementPreviewByGroup[candidate.groupKey].books"
                          :key="book.libraryItemId"
                          class="border-t border-white/10 align-top"
                        >
                          <td class="px-3 py-3">
                            <input
                              type="checkbox"
                              class="rounded border-white/20 bg-black/30"
                              :checked="isManagementBookSelected(candidate.groupKey, book.libraryItemId)"
                              :disabled="book.conflictReasons.length > 0"
                              @change="toggleManagementBook(candidate.groupKey, book.libraryItemId)"
                            />
                          </td>
                          <td class="px-3 py-3">
                            <nuxt-link :to="`/item/${book.libraryItemId}`" class="block font-semibold hover:underline">
                              {{ book.title }}
                            </nuxt-link>
                            <p class="text-gray-300 mt-1">{{ formatAuthors(book.authors) }}</p>
                            <p v-if="book.relPath" class="text-gray-400 mt-2 break-all">{{ book.relPath }}</p>
                          </td>
                          <td class="px-3 py-3 text-gray-200">
                            {{ formatSeriesList(book.sourceSeries) }}
                          </td>
                          <td class="px-3 py-3">
                            <div v-if="book.conflictReasons.length" class="space-y-1 text-red-200">
                              <p
                                v-for="reason in book.conflictReasons"
                                :key="book.libraryItemId + ':' + reason"
                              >
                                {{ reason }}
                              </p>
                            </div>
                            <div v-else class="text-gray-200">
                              {{ formatSeriesList(book.nextSeriesPreview) }}
                            </div>
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>

                  <ui-btn
                    small
                    color="bg-success/80"
                    :loading="managementActionLoadingKey === candidate.groupKey"
                    @click="applyManagementCandidate(candidate)"
                  >
                    Apply
                  </ui-btn>
                </div>
              </div>

              <div v-if="managementRecentActions.length" class="rounded border border-white/15 bg-black/15 p-4">
                <h2 class="text-lg font-semibold">Recent management actions</h2>
                <div class="mt-3 space-y-3">
                  <div
                    v-for="action in managementRecentActions"
                    :key="action.id"
                    class="rounded border border-white/10 bg-black/20 p-3"
                  >
                    <div class="flex flex-wrap items-center gap-3">
                      <div class="grow">
                        <p class="font-medium text-gray-100">
                          {{ action.sourceSeriesNames.join(', ') }} -> {{ action.targetLabel }}
                        </p>
                        <p class="text-sm text-gray-300">
                          {{ action.changedCount }} book<span v-if="action.changedCount !== 1">s</span> changed on {{ formatTime(action.createdAt) }}
                        </p>
                        <p v-if="action.revertStatus === 'reverted'" class="text-sm text-amber-200">
                          Reverted {{ formatTime(action.revertedAt) }}
                        </p>
                      </div>
                      <ui-btn
                        small
                        color="bg-bg border border-white/20"
                        @click="toggleManagementActionDetails(action.id)"
                      >
                        {{ managementActionDetailsOpen[action.id] ? 'Hide changes' : 'Show changes' }}
                      </ui-btn>
                      <ui-btn
                        v-if="action.revertStatus !== 'reverted'"
                        small
                        color="bg-warning/70"
                        :loading="managementRevertLoadingKey === action.id"
                        @click="revertManagementAction(action)"
                      >
                        Revert
                      </ui-btn>
                    </div>

                    <div v-if="managementActionDetailsOpen[action.id]" class="mt-3 space-y-2">
                      <div
                        v-for="book in action.changedBooks"
                        :key="action.id + ':' + book.libraryItemId"
                        class="rounded border border-white/10 bg-black/15 px-3 py-2 text-sm text-gray-200"
                      >
                        <p class="font-medium">{{ book.title }}</p>
                        <p class="text-gray-400">Before: {{ formatSeriesList(book.beforeSeries) || '-' }}</p>
                        <p class="text-gray-300">After: {{ formatSeriesList(book.afterSeries) || '-' }}</p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </template>

          <template v-else>
            <div class="space-y-4">
              <div class="flex flex-wrap items-center gap-3">
                <label class="flex items-center gap-2 text-sm text-gray-300 cursor-pointer">
                  <input v-model="includeUntrustedCatalogs" type="checkbox" class="rounded border-white/20 bg-black/30" @change="loadCatalogs" />
                  <span>Show less-trusted series</span>
                </label>
              </div>

              <div v-if="!catalogSeries.length && !catalogLoading" class="text-base text-gray-200">
                No series detail catalogs are stored yet.
              </div>

              <div v-else class="grid grid-cols-1 xl:grid-cols-[24rem_minmax(0,1fr)] gap-4">
                <div class="rounded border border-white/15 bg-black/15 p-3 space-y-2">
                  <button
                    v-for="catalog in catalogSeries"
                    :key="catalog.id"
                    type="button"
                    class="w-full rounded border px-3 py-2 text-left transition"
                    :class="selectedCatalogId === catalog.id ? 'bg-sky-400/15 border-sky-300/35 text-sky-50' : 'bg-black/20 border-white/10 text-gray-200'"
                    @click="selectCatalog(catalog.id)"
                  >
                    <div class="flex items-start gap-2">
                      <div class="grow">
                        <p class="font-medium">{{ catalog.seriesName }}</p>
                        <p class="text-sm text-gray-400">
                          {{ catalog.localBookCount }} local, {{ catalog.missingCount }} missing, {{ catalog.disputedCount }} disputed
                        </p>
                      </div>
                      <span
                        class="inline-flex items-center px-2 py-0.5 rounded-full border text-xs"
                        :class="catalog.trustStatus === 'trusted' ? 'border-emerald-300/35 bg-emerald-500/10 text-emerald-100' : 'border-amber-300/35 bg-amber-500/10 text-amber-100'"
                      >
                        {{ catalog.trustStatus === 'trusted' ? 'Trusted' : 'Less trusted' }}
                      </span>
                    </div>
                  </button>
                </div>

                <div v-if="selectedCatalogDetail" class="rounded border border-white/15 bg-black/15 p-4 space-y-4">
                  <div class="flex flex-wrap items-center gap-3">
                    <h2 class="text-xl font-semibold">{{ selectedCatalogDetail.catalog.seriesName }}</h2>
                    <span
                      class="inline-flex items-center px-2 py-0.5 rounded-full border text-xs"
                      :class="selectedCatalogDetail.catalog.trustStatus === 'trusted' ? 'border-emerald-300/35 bg-emerald-500/10 text-emerald-100' : 'border-amber-300/35 bg-amber-500/10 text-amber-100'"
                    >
                      {{ selectedCatalogDetail.catalog.trustStatus === 'trusted' ? 'Trusted' : 'Less trusted' }}
                    </span>
                  </div>

                  <div class="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm text-gray-200">
                    <div class="rounded border border-white/10 bg-black/20 p-3">
                      <p class="text-gray-400">Local books</p>
                      <p class="text-lg font-semibold">{{ selectedCatalogDetail.localBooks.length }}</p>
                    </div>
                    <div class="rounded border border-white/10 bg-black/20 p-3">
                      <p class="text-gray-400">Missing slots</p>
                      <p class="text-lg font-semibold">{{ selectedCatalogDetail.slots.filter((slot) => slot.status === 'missing').length }}</p>
                    </div>
                    <div class="rounded border border-white/10 bg-black/20 p-3">
                      <p class="text-gray-400">Disputed slots</p>
                      <p class="text-lg font-semibold">{{ selectedCatalogDetail.slots.filter((slot) => slot.status === 'disputed').length }}</p>
                    </div>
                  </div>

                  <div class="overflow-auto border border-white/10 rounded">
                    <table class="w-full text-sm table-fixed">
                      <thead class="bg-black/30">
                        <tr>
                          <th class="text-left px-3 py-2 w-24">Slot</th>
                          <th class="text-left px-3 py-2 w-32">Status</th>
                          <th class="text-left px-3 py-2 w-72">Local coverage</th>
                          <th class="text-left px-3 py-2">Expected / source support</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr v-for="slot in selectedCatalogDetail.slots" :key="slot.slot" class="border-t border-white/10 align-top">
                          <td class="px-3 py-3 font-medium text-gray-100">{{ slot.slot }}</td>
                          <td class="px-3 py-3">
                            <span
                              class="inline-flex items-center px-2 py-0.5 rounded-full border text-xs"
                              :class="getCatalogSlotStatusClass(slot.status)"
                            >
                              {{ formatCatalogSlotStatus(slot.status) }}
                            </span>
                          </td>
                          <td class="px-3 py-3 text-gray-200">
                            <div v-if="slot.localBooks.length" class="space-y-1">
                              <p v-for="book in slot.localBooks" :key="slot.slot + ':' + book.libraryItemId">
                                {{ book.title }}<span v-if="book.sequence" class="text-gray-400"> (#{{ book.sequence }})</span>
                              </p>
                            </div>
                            <p v-else class="text-gray-400">No local book covers this slot</p>
                          </td>
                          <td class="px-3 py-3">
                            <div v-if="slot.choices.length <= 1" class="space-y-2 text-gray-200">
                              <p v-if="slot.expectedTitle">{{ slot.expectedTitle }}</p>
                              <p v-if="slot.expectedAuthors && slot.expectedAuthors.length" class="text-gray-400">
                                {{ slot.expectedAuthors.join(', ') }}
                              </p>
                              <div v-if="slot.sourceSupport.length" class="flex flex-wrap gap-2">
                                <span
                                  v-for="source in slot.sourceSupport"
                                  :key="slot.slot + ':' + source.source + ':' + (source.evidenceUrl || '')"
                                  class="inline-flex items-center gap-2 px-2 py-0.5 rounded-full border border-sky-300/35 bg-sky-400/10 text-xs text-sky-50"
                                >
                                  <span>{{ source.label || source.source }}</span>
                                  <span v-if="source.confidence !== null && source.confidence !== undefined" class="text-sky-100/80">{{ formatConfidence(source.confidence) }}</span>
                                </span>
                              </div>
                              <p v-if="!slot.expectedTitle && !slot.sourceSupport.length" class="text-gray-400">No expected title known</p>
                            </div>

                            <div v-else class="space-y-2">
                              <div
                                v-for="choice in slot.choices"
                                :key="slot.slot + ':' + choice.entryKey"
                                class="rounded border border-white/10 bg-black/20 p-2 text-sm text-gray-200"
                              >
                                <div class="flex flex-wrap items-center gap-2">
                                  <span class="font-medium">{{ choice.title }}</span>
                                  <span v-if="choice.sequenceLabel" class="text-gray-400">{{ choice.sequenceLabel }}</span>
                                  <ui-btn
                                    small
                                    :color="slot.selectedEntryKey === choice.entryKey ? 'bg-sky-400/25 border border-sky-300/35' : 'bg-bg border border-white/20'"
                                    :loading="catalogChoiceLoadingKey === `${selectedCatalogDetail.catalog.id}:${slot.slot}:${choice.entryKey}`"
                                    @click="chooseCatalogSlot(choice, slot)"
                                  >
                                    {{ slot.selectedEntryKey === choice.entryKey ? 'Selected' : 'Use this' }}
                                  </ui-btn>
                                </div>
                                <div class="mt-2 flex flex-wrap gap-2">
                                  <span
                                    v-for="source in choice.sources"
                                    :key="slot.slot + ':' + choice.entryKey + ':' + source.source + ':' + (source.evidenceUrl || '')"
                                    class="inline-flex items-center gap-2 px-2 py-0.5 rounded-full border border-sky-300/35 bg-sky-400/10 text-xs text-sky-50"
                                  >
                                    <span>{{ source.label || source.source }}</span>
                                    <span v-if="source.confidence !== null && source.confidence !== undefined" class="text-sky-100/80">{{ formatConfidence(source.confidence) }}</span>
                                  </span>
                                </div>
                              </div>
                            </div>

                            <div v-if="slot.status === 'missing' || slot.status === 'disputed'" class="mt-3 space-y-3">
                              <div class="flex flex-wrap items-center gap-2">
                                <ui-btn
                                  small
                                  color="bg-bg border border-white/20"
                                  :disabled="slot.status === 'disputed' && !slot.selectedEntryKey"
                                  :loading="catalogCandidateSearchLoadingKey === `${selectedCatalogDetail.catalog.id}:${slot.slot}`"
                                  @click="findCatalogCandidates(slot)"
                                >
                                  Find candidates
                                </ui-btn>
                                <p v-if="slot.status === 'disputed' && !slot.selectedEntryKey" class="text-sm text-amber-200">
                                  Choose a preferred interpretation before searching
                                </p>
                              </div>

                              <div v-if="catalogCandidateResultsBySlot[slot.slot]" class="rounded border border-white/10 bg-black/20 p-3 space-y-3">
                                <div class="text-sm text-gray-300">
                                  {{ catalogCandidateResultsBySlot[slot.slot].results.length }} plausible candidate<span v-if="catalogCandidateResultsBySlot[slot.slot].results.length !== 1">s</span>
                                </div>

                                <div
                                  v-for="candidate in catalogCandidateResultsBySlot[slot.slot].results"
                                  :key="slot.slot + ':' + candidate.libraryItemId"
                                  class="rounded border border-white/10 bg-black/15 p-3 space-y-2"
                                >
                                  <div class="flex flex-wrap items-start gap-2">
                                    <div class="grow">
                                      <nuxt-link :to="`/item/${candidate.libraryItemId}`" class="block font-semibold hover:underline">
                                        {{ candidate.title }}
                                      </nuxt-link>
                                      <p class="text-sm text-gray-300 mt-1">{{ formatAuthors(candidate.authors) }}</p>
                                      <p v-if="candidate.relPath" class="text-sm text-gray-400 mt-1 break-all">{{ candidate.relPath }}</p>
                                    </div>
                                    <span class="inline-flex items-center px-2 py-0.5 rounded-full border border-sky-300/35 bg-sky-400/10 text-xs text-sky-50">
                                      Score {{ candidate.score }}
                                    </span>
                                  </div>

                                  <div v-if="candidate.currentSeries.length" class="text-sm text-gray-300">
                                    Current series: {{ formatSeriesList(candidate.currentSeries) }}
                                  </div>

                                  <div class="flex flex-wrap gap-2">
                                    <span
                                      v-for="reason in candidate.reasons"
                                      :key="slot.slot + ':' + candidate.libraryItemId + ':' + reason.key"
                                      class="inline-flex items-center px-2 py-0.5 rounded-full border border-white/15 bg-black/20 text-xs text-gray-200"
                                    >
                                      {{ reason.text }}
                                    </span>
                                  </div>

                                  <div class="flex flex-wrap gap-2">
                                    <nuxt-link :to="`/item/${candidate.libraryItemId}`" class="inline-flex items-center px-3 py-1.5 rounded border border-white/20 bg-black/20 text-sm text-gray-100 hover:border-sky-300/35">
                                      Open book
                                    </nuxt-link>
                                    <ui-btn
                                      small
                                      color="bg-success/80"
                                      :loading="catalogCandidateQueueLoadingKey === `${slot.slot}:${candidate.libraryItemId}`"
                                      @click="queueCatalogCandidate(slot, candidate)"
                                    >
                                      Queue in Review
                                    </ui-btn>
                                  </div>
                                </div>
                              </div>
                            </div>
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>

                  <div v-if="selectedCatalogDetail.unsequencedBooks.length" class="rounded border border-white/10 bg-black/20 p-3">
                    <h3 class="text-base font-semibold">Unsequenced local books</h3>
                    <div class="mt-2 space-y-1 text-sm text-gray-200">
                      <p v-for="book in selectedCatalogDetail.unsequencedBooks" :key="'unseq:' + book.libraryItemId">
                        {{ book.title }}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </template>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
const SOURCE_LEGEND = {
  fictiondb: { code: 'FDB', name: 'FictionDB', url: 'https://www.fictiondb.com/' },
  goodreads: { code: 'GR', name: 'Goodreads', url: 'https://www.goodreads.com/' },
  wikidata: { code: 'WD', name: 'Wikidata', url: 'https://www.wikidata.org/' },
  librarything: { code: 'LT', name: 'LibraryThing', url: 'https://www.librarything.com/' },
  fantasticfiction: { code: 'FF', name: 'Fantastic Fiction', url: 'https://www.fantasticfiction.com/' }
}

export default {
  async asyncData({ redirect, store, params }) {
    if (!store.getters['user/getIsAdminOrUp']) {
      redirect('/')
      return
    }
    const libraryId = params.library
    const fetchData = await store.dispatch('libraries/fetch', libraryId)
    if (!fetchData || !fetchData.library) return redirect(`/oops?message=Library "${libraryId}" not found`)
    if (fetchData.library.mediaType !== 'book') return redirect(`/library/${libraryId}`)
    return {}
  },
  data() {
    return {
      activeTab: 'queue',
      rows: [],
      includeDecided: false,
      loading: false,
      managementLoading: false,
      errorMessage: '',
      lastLoadedAt: null,
      selectedReplaceTarget: {},
      actionKey: '',
      managementCandidates: [],
      managementPreviewByGroup: {},
      managementSelectionByGroup: {},
      managementTargetLabels: {},
      managementRecentActions: [],
      managementPreviewLoadingKey: '',
      managementActionLoadingKey: '',
      managementRevertLoadingKey: '',
      managementActionDetailsOpen: {},
      catalogLoading: false,
      catalogSeries: [],
      selectedCatalogId: '',
      selectedCatalogDetail: null,
      includeUntrustedCatalogs: false,
      catalogChoiceLoadingKey: '',
      catalogCandidateSearchLoadingKey: '',
      catalogCandidateQueueLoadingKey: '',
      catalogCandidateResultsBySlot: {},
      sourceImportStatus: null,
      sourceImportError: '',
      sourceImportStarting: false,
      sourceImportResultFilter: '',
      sourceImportPollHandle: null,
      sourceImportExpanded: false
    }
  },
  computed: {
    streamLibraryItem() {
      return this.$store.state.streamLibraryItem
    },
    pendingSuggestionCount() {
      return this.rows.reduce((count, row) => count + row.suggestions.filter((suggestion) => suggestion.state === 'pending').length, 0)
    },
    sourceLegendEntries() {
      const sources = new Map()
      this.rows.forEach((row) => {
        ;(row.suggestions || []).forEach((suggestion) => {
          ;(suggestion.contributions || []).forEach((contribution) => {
            const sourceKey = String(contribution.source || '').toLowerCase()
            if (!sourceKey || sources.has(sourceKey)) return
            const knownEntry = SOURCE_LEGEND[sourceKey]
            const fallbackCode = (contribution.label || sourceKey).toUpperCase()
            sources.set(sourceKey, knownEntry || {
              code: fallbackCode,
              name: fallbackCode,
              url: '#'
            })
          })
        })
      })
      return [...sources.values()]
    },
    sourceImportDisplayJob() {
      return this.sourceImportStatus?.active_job || this.sourceImportStatus?.latest_job || null
    },
    sourceImportSummary() {
      return this.sourceImportDisplayJob?.summary || null
    },
    sourceImportStatusText() {
      if (!this.sourceImportStatus?.configured) return 'Series import service is not configured yet.'
      if (this.sourceImportStatus?.has_active_run) return 'Library-wide trusted source import is running.'
      if (this.sourceImportDisplayJob?.status_label) return `Last run: ${this.sourceImportDisplayJob.status_label}`
      return 'No trusted source import has run for this library yet.'
    },
    sourceImportStatusLine() {
      const baseText = this.sourceImportStatusText
      const finishedAt = this.sourceImportDisplayJob?.finished_at_utc
      if (!finishedAt || this.sourceImportStatus?.has_active_run) return baseText
      return `${baseText} ${this.formatTime(finishedAt)}`
    },
    sourceImportSummaryLine() {
      const summary = this.sourceImportSummary
      if (!summary) return []
      const counts = this.sourceImportExpanded
        ? [
            `Scanned: ${summary.books_scanned || 0} / ${summary.books_total || 0}`,
            `Lookups: ${summary.source_lookups_attempted || 0}`,
            `Cats created: ${summary.series_catalogs_created || 0}`,
            `Cats updated: ${summary.series_catalogs_updated || 0}`,
            `Ambiguous: ${summary.likely_ambiguous_matches || 0}`,
            `Failures: ${summary.failures || 0}`
          ]
        : [
            `Scanned: ${summary.books_scanned || 0} / ${summary.books_total || 0}`,
            `Lookups: ${summary.source_lookups_attempted || 0}`,
            `Conflicts: ${summary.new_conflicts_count || 0}`,
            `Failures: ${summary.failures || 0}`
          ]
      return counts
    },
    sourceImportFilterButtons() {
      const summary = this.sourceImportSummary
      if (!summary) return []
      return [
        { key: 'new_conflicts', label: 'New conflicts', count: summary.new_conflicts_count || 0 },
        { key: 'new_possible_series', label: 'New possible series', count: summary.new_possible_series_count || 0 },
        { key: 'failed_lookups', label: 'Failed lookups', count: (summary.filtered_results?.failed_lookups || []).length }
      ].filter((entry) => entry.count > 0)
    },
    sourceImportFilteredResults() {
      const summary = this.sourceImportSummary
      if (!summary || !this.sourceImportResultFilter) return []
      return summary.filtered_results?.[this.sourceImportResultFilter] || []
    }
  },
  mounted() {
    this.loadQueue()
  },
  beforeDestroy() {
    this.stopSourceImportPolling()
  },
  methods: {
    async switchTab(tab) {
      if (this.activeTab === tab) return
      this.activeTab = tab
      this.errorMessage = ''
      if (tab === 'queue') {
        await this.loadQueue()
      } else if (tab === 'management') {
        await this.loadManagementData()
      } else {
        await this.loadCatalogs()
      }
    },
    formatTime(value) {
      if (!value) return '-'
      const date = new Date(value)
      if (Number.isNaN(date.getTime())) return '-'
      const pad = (part) => String(part).padStart(2, '0')
      return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${pad(date.getFullYear() % 100)} ${pad(date.getHours())}:${pad(date.getMinutes())}`
    },
    formatConfidence(value) {
      return Number(value).toFixed(2)
    },
    getSourceDisplayName(source) {
      const key = String(source || '').toLowerCase()
      return SOURCE_LEGEND[key]?.name || source || 'Unknown source'
    },
    formatAuthors(authors) {
      return (authors || []).map((author) => author.name).join(', ') || '-'
    },
    formatDecisionState(suggestion) {
      if (suggestion.state === 'dismissed') return 'Dismissed'
      if (suggestion.state === 'manual_override') return 'Applied by replace'
      if (suggestion.state === 'applied') return 'Applied by add'
      return suggestion.state
    },
    formatPreviousDecision(suggestion) {
      if (!suggestion.previousDecision) return ''
      const actionMap = {
        dismiss: 'Previously dismissed',
        add: 'Previously applied by add',
        replace: 'Previously applied by replace'
      }
      const baseLabel = actionMap[suggestion.previousDecision.action] || 'Previously decided'
      if (!suggestion.hasMeaningfulUpdateSinceDecision) return `${baseLabel} on ${this.formatTime(suggestion.previousDecision.decidedAt)}`
      return `${baseLabel} on ${this.formatTime(suggestion.previousDecision.decidedAt)}; reopened after evidence changed`
    },
    toggleReplaceTarget(libraryItemId, seriesId) {
      if (this.selectedReplaceTarget[libraryItemId] === seriesId) {
        this.$delete(this.selectedReplaceTarget, libraryItemId)
        return
      }
      this.$set(this.selectedReplaceTarget, libraryItemId, seriesId)
    },
    getPrimarySuggestions(row) {
      const suggestions = row?.suggestions || []
      const positiveSuggestions = suggestions.filter((suggestion) => suggestion.kind === 'series')
      return positiveSuggestions.length ? positiveSuggestions : suggestions
    },
    getConflictContributions(row) {
      return (row?.suggestions || [])
        .filter((suggestion) => suggestion.kind !== 'series')
        .flatMap((suggestion) => suggestion.contributions || [])
    },
    showSubordinateConflicts(row, suggestion) {
      return suggestion.kind === 'series' && this.getPrimarySuggestions(row).length !== (row?.suggestions || []).length && this.getConflictContributions(row).length > 0
    },
    getSuggestionCardClass(suggestion) {
      if (suggestion.kind === 'no_series') return 'bg-red-950/30 border-red-400/35'
      if (suggestion.state === 'pending') return 'bg-black/20 border-white/15'
      return 'bg-slate-900/40 border-slate-500/40'
    },
    getContributionPillClass(contribution) {
      if (contribution.noSeries) return 'bg-red-500/10 border-red-300/35 text-red-50'
      return 'bg-sky-400/15 border-sky-300/35 text-sky-50'
    },
    formatCatalogSlotStatus(status) {
      if (status === 'missing') return 'Missing'
      if (status === 'disputed') return 'Disputed'
      if (status === 'decimal') return 'Decimal only'
      return 'Covered'
    },
    getCatalogSlotStatusClass(status) {
      if (status === 'missing') return 'border-red-300/35 bg-red-500/10 text-red-50'
      if (status === 'disputed') return 'border-amber-300/35 bg-amber-500/10 text-amber-100'
      if (status === 'decimal') return 'border-slate-300/35 bg-slate-500/10 text-slate-100'
      return 'border-emerald-300/35 bg-emerald-500/10 text-emerald-100'
    },
    formatSeriesList(seriesList) {
      return (seriesList || [])
        .map((series) => (series.sequence ? `${series.name} #${series.sequence}` : series.name))
        .join(' | ')
    },
    formatImportSuggestions(suggestions) {
      const seen = new Set()
      return (suggestions || [])
        .map((suggestion) => {
          const name = suggestion.seriesName || suggestion.suggestedName || ''
          const sequence = suggestion.sequence || suggestion.suggestedSequence || ''
          return sequence ? `${name} #${sequence}` : name
        })
        .filter((entry) => {
          if (!entry || seen.has(entry)) return false
          seen.add(entry)
          return true
        })
        .join(' | ')
    },
    toggleSourceImportResultFilter(key) {
      this.sourceImportResultFilter = this.sourceImportResultFilter === key ? '' : key
    },
    ensureSourceImportPolling() {
      if (!this.sourceImportStatus?.has_active_run || this.sourceImportPollHandle) return
      this.sourceImportPollHandle = setInterval(() => {
        this.loadSourceImportStatus({ silent: true })
      }, 4000)
    },
    stopSourceImportPolling() {
      if (!this.sourceImportPollHandle) return
      clearInterval(this.sourceImportPollHandle)
      this.sourceImportPollHandle = null
    },
    async loadSourceImportStatus({ silent = false } = {}) {
      try {
        const status = await this.$axios.$get(`/api/libraries/${this.$route.params.library}/series-review/source-import/status`)
        this.sourceImportStatus = status
        this.sourceImportError = ''
        if (this.sourceImportFilterButtons.length && !this.sourceImportFilterButtons.some((entry) => entry.key === this.sourceImportResultFilter)) {
          this.sourceImportResultFilter = this.sourceImportFilterButtons[0]?.key || ''
        }
        if (!this.sourceImportResultFilter && this.sourceImportFilterButtons.length) {
          this.sourceImportResultFilter = this.sourceImportFilterButtons[0].key
        }
        if (status?.has_active_run) this.ensureSourceImportPolling()
        else this.stopSourceImportPolling()
      } catch (error) {
        this.stopSourceImportPolling()
        this.sourceImportStatus = null
        this.sourceImportError = error?.response?.data || 'Failed to load trusted source import status'
        if (!silent) this.$toast.error(this.sourceImportError)
      }
    },
    async startSourceImport() {
      this.sourceImportStarting = true
      try {
        const response = await this.$axios.$post(`/api/libraries/${this.$route.params.library}/series-review/source-import/start`)
        this.sourceImportStatus = response.status || this.sourceImportStatus
        this.sourceImportError = ''
        this.sourceImportResultFilter = ''
        this.ensureSourceImportPolling()
        this.$toast.success('Trusted source import queued')
      } catch (error) {
        const message = error?.response?.data || 'Failed to start trusted source import'
        this.sourceImportError = message
        this.$toast.error(message)
      } finally {
        this.sourceImportStarting = false
      }
    },
    async loadQueue() {
      this.loading = true
      this.errorMessage = ''
      try {
        const response = await this.$axios.$get(`/api/libraries/${this.$route.params.library}/series-review`, {
          params: {
            includeDecided: this.includeDecided ? 1 : 0
          }
        })
        this.rows = response.rows || []
        await this.loadSourceImportStatus({ silent: true })
        this.lastLoadedAt = new Date().toISOString()
      } catch (error) {
        this.errorMessage = error?.response?.data || 'Failed to load series review rows'
      } finally {
        this.loading = false
      }
    },
    async loadManagementData() {
      this.managementLoading = true
      this.errorMessage = ''
      try {
        const response = await this.$axios.$get(`/api/libraries/${this.$route.params.library}/series-review/management`)
        this.managementCandidates = response.candidates || []
        this.managementRecentActions = response.recentActions || []
        this.managementCandidates.forEach((candidate) => {
          if (!this.managementTargetLabels[candidate.groupKey]) {
            this.$set(this.managementTargetLabels, candidate.groupKey, candidate.suggestedTargetLabel)
          }
        })
        this.lastLoadedAt = new Date().toISOString()
      } catch (error) {
        this.errorMessage = error?.response?.data || 'Failed to load series management data'
      } finally {
        this.managementLoading = false
      }
    },
    async loadCatalogs() {
      this.catalogLoading = true
      this.errorMessage = ''
      try {
        const response = await this.$axios.$get(`/api/libraries/${this.$route.params.library}/series-review/catalog`, {
          params: {
            includeUntrusted: this.includeUntrustedCatalogs ? 1 : 0
          }
        })
        this.catalogSeries = response.catalogs || []
        if (this.catalogSeries.length) {
          const nextId = this.catalogSeries.some((catalog) => catalog.id === this.selectedCatalogId) ? this.selectedCatalogId : this.catalogSeries[0].id
          await this.selectCatalog(nextId)
        } else {
          this.selectedCatalogId = ''
          this.selectedCatalogDetail = null
        }
        this.lastLoadedAt = new Date().toISOString()
      } catch (error) {
        this.errorMessage = error?.response?.data || 'Failed to load series detail catalogs'
      } finally {
        this.catalogLoading = false
      }
    },
    async selectCatalog(catalogId) {
      if (!catalogId) {
        this.selectedCatalogId = ''
        this.selectedCatalogDetail = null
        return
      }
      this.selectedCatalogId = catalogId
      this.catalogLoading = true
      try {
        this.selectedCatalogDetail = await this.$axios.$get(`/api/libraries/${this.$route.params.library}/series-review/catalog/${catalogId}`)
        this.catalogCandidateResultsBySlot = {}
      } catch (error) {
        this.errorMessage = error?.response?.data || 'Failed to load series detail'
      } finally {
        this.catalogLoading = false
      }
    },
    async chooseCatalogSlot(choice, slot) {
      if (!this.selectedCatalogDetail) return
      this.catalogChoiceLoadingKey = `${this.selectedCatalogDetail.catalog.id}:${slot.slot}:${choice.entryKey}`
      try {
        this.selectedCatalogDetail = await this.$axios.$post(
          `/api/libraries/${this.$route.params.library}/series-review/catalog/${this.selectedCatalogDetail.catalog.id}/slot-choice`,
          {
            slot: slot.slot,
            entryKey: choice.entryKey
          }
        )
        this.$delete(this.catalogCandidateResultsBySlot, slot.slot)
        this.$toast.success('Preferred interpretation updated')
        await this.loadCatalogs()
      } catch (error) {
        this.$toast.error(error?.response?.data || 'Failed to update slot interpretation')
      } finally {
        this.catalogChoiceLoadingKey = ''
      }
    },
    async findCatalogCandidates(slot) {
      if (!this.selectedCatalogDetail) return
      this.catalogCandidateSearchLoadingKey = `${this.selectedCatalogDetail.catalog.id}:${slot.slot}`
      try {
        const response = await this.$axios.$post(
          `/api/libraries/${this.$route.params.library}/series-review/catalog/${this.selectedCatalogDetail.catalog.id}/find-candidates`,
          {
            slot: slot.slot
          }
        )
        this.$set(this.catalogCandidateResultsBySlot, slot.slot, response)
      } catch (error) {
        this.$toast.error(error?.response?.data || 'Failed to find candidates')
      } finally {
        this.catalogCandidateSearchLoadingKey = ''
      }
    },
    async queueCatalogCandidate(slot, candidate) {
      if (!this.selectedCatalogDetail) return
      this.catalogCandidateQueueLoadingKey = `${slot.slot}:${candidate.libraryItemId}`
      try {
        const response = await this.$axios.$post(
          `/api/libraries/${this.$route.params.library}/series-review/catalog/${this.selectedCatalogDetail.catalog.id}/queue-candidate`,
          {
            slot: slot.slot,
            libraryItemId: candidate.libraryItemId
          }
        )
        this.$toast.success(`Queued ${response.title} for review`)
        this.activeTab = 'queue'
        await this.loadQueue()
      } catch (error) {
        this.$toast.error(error?.response?.data || 'Failed to queue candidate for review')
      } finally {
        this.catalogCandidateQueueLoadingKey = ''
      }
    },
    async previewManagementCandidate(candidate) {
      const groupKey = candidate.groupKey
      this.managementPreviewLoadingKey = groupKey
      try {
        const response = await this.$axios.$post(`/api/libraries/${this.$route.params.library}/series-review/management/preview`, {
          sourceSeriesIds: candidate.labels.map((label) => label.id),
          targetLabel: this.managementTargetLabels[groupKey] || candidate.suggestedTargetLabel
        })
        this.$set(this.managementPreviewByGroup, groupKey, response)
        this.$set(
          this.managementSelectionByGroup,
          groupKey,
          (response.books || []).filter((book) => book.includedByDefault).map((book) => book.libraryItemId)
        )
      } catch (error) {
        this.$toast.error(error?.response?.data || 'Failed to build management preview')
      } finally {
        this.managementPreviewLoadingKey = ''
      }
    },
    toggleManagementBook(groupKey, libraryItemId) {
      const current = new Set(this.managementSelectionByGroup[groupKey] || [])
      if (current.has(libraryItemId)) current.delete(libraryItemId)
      else current.add(libraryItemId)
      this.$set(this.managementSelectionByGroup, groupKey, [...current])
    },
    isManagementBookSelected(groupKey, libraryItemId) {
      return (this.managementSelectionByGroup[groupKey] || []).includes(libraryItemId)
    },
    async applyManagementCandidate(candidate) {
      const groupKey = candidate.groupKey
      this.managementActionLoadingKey = groupKey
      try {
        const response = await this.$axios.$post(`/api/libraries/${this.$route.params.library}/series-review/management/apply`, {
          sourceSeriesIds: candidate.labels.map((label) => label.id),
          targetLabel: this.managementTargetLabels[groupKey] || candidate.suggestedTargetLabel,
          includedLibraryItemIds: this.managementSelectionByGroup[groupKey] || []
        })
        this.$toast.success(`Applied to ${response.changedCount} book${response.changedCount === 1 ? '' : 's'}`)
        await this.loadManagementData()
        delete this.managementPreviewByGroup[groupKey]
        delete this.managementSelectionByGroup[groupKey]
        await this.loadQueue()
      } catch (error) {
        this.$toast.error(error?.response?.data || 'Failed to apply series management action')
      } finally {
        this.managementActionLoadingKey = ''
      }
    },
    toggleManagementActionDetails(actionId) {
      this.$set(this.managementActionDetailsOpen, actionId, !this.managementActionDetailsOpen[actionId])
    },
    async revertManagementAction(action) {
      this.managementRevertLoadingKey = action.id
      try {
        const response = await this.$axios.$post(`/api/series-review/management/actions/${action.id}/revert`)
        if (response.failed) {
          this.$toast.error(`Reverted ${response.reverted}; ${response.failed} could not be reverted safely`)
        } else {
          this.$toast.success(`Reverted ${response.reverted} book${response.reverted === 1 ? '' : 's'}`)
        }
        await this.loadManagementData()
        await this.loadQueue()
      } catch (error) {
        this.$toast.error(error?.response?.data || 'Failed to revert series management action')
      } finally {
        this.managementRevertLoadingKey = ''
      }
    },
    updateRowCurrentSeries(row, currentSeries) {
      row.currentSeries = currentSeries || []
    },
    updateSuggestionState(row, suggestionId, nextSuggestion) {
      const suggestion = row.suggestions.find((entry) => entry.id === suggestionId)
      if (!suggestion) return
      Object.assign(suggestion, nextSuggestion)
      if (!this.includeDecided && suggestion.state !== 'pending') {
        row.suggestions = row.suggestions.filter((entry) => entry.id !== suggestionId)
        if (!row.suggestions.length) {
          this.rows = this.rows.filter((entry) => entry.libraryItemId !== row.libraryItemId)
        }
      }
    },
    async applySuggestion(row, suggestion) {
      const mode = this.selectedReplaceTarget[row.libraryItemId] ? 'replace' : 'add'
      const replaceSeriesId = this.selectedReplaceTarget[row.libraryItemId]
      if (mode === 'replace' && !replaceSeriesId) {
        this.$toast.error('Select a current series entry to replace first')
        return
      }

      this.actionKey = `${suggestion.id}:apply`
      try {
        const payload = mode === 'replace' ? { replaceSeriesId } : {}
        const response = await this.$axios.$post(`/api/series-review/suggestions/${suggestion.id}/${mode}`, payload)
        this.updateRowCurrentSeries(row, response.currentSeries)
        this.updateSuggestionState(row, suggestion.id, response.suggestion)
        if (mode === 'replace') this.$delete(this.selectedReplaceTarget, row.libraryItemId)
        this.$toast.success(mode === 'replace' ? 'Series replaced' : 'Series added')
      } catch (error) {
        this.$toast.error(error?.response?.data || 'Failed to apply suggestion')
      } finally {
        this.actionKey = ''
      }
    },
    async removeCurrentSeries(row, series) {
      this.actionKey = `${row.libraryItemId}:remove:${series.id}`
      try {
        const response = await this.$axios.$post(`/api/series-review/library-items/${row.libraryItemId}/remove-series`, {
          seriesId: series.id
        })
        this.updateRowCurrentSeries(row, response.currentSeries)
        this.$delete(this.selectedReplaceTarget, row.libraryItemId)
        this.$toast.success('Series removed')
      } catch (error) {
        this.$toast.error(error?.response?.data || 'Failed to remove series')
      } finally {
        this.actionKey = ''
      }
    },
    async dismissSuggestion(suggestion) {
      this.actionKey = `${suggestion.id}:dismiss`
      try {
        const response = await this.$axios.$post(`/api/series-review/suggestions/${suggestion.id}/dismiss`)
        const row = this.rows.find((entry) => entry.suggestions.some((candidate) => candidate.id === suggestion.id))
        if (row) this.updateSuggestionState(row, suggestion.id, response.suggestion)
        this.$toast.success('Suggestion dismissed')
      } catch (error) {
        this.$toast.error(error?.response?.data || 'Failed to dismiss suggestion')
      } finally {
        this.actionKey = ''
      }
    }
  }
}
</script>
