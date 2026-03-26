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
            v-if="activeTab === 'catalog'"
            color="bg-sky-500/80"
            small
            :loading="localCatalogMatchesLoading && localCatalogMatchesExpanded"
            @click="toggleLocalCatalogMatchesPanel"
          >
            {{ localCatalogMatchesExpanded ? 'Hide Lookup Links' : 'Import Lookup Links' }}
          </ui-btn>
          <ui-btn
            v-if="activeTab === 'catalog'"
            color="bg-bg border border-white/20"
            small
            :loading="localCatalogRefreshLoading"
            @click="refreshLocalCatalogMatches"
          >
            Refresh This Link
          </ui-btn>
          <ui-btn
            color="bg-bg border border-white/20"
            small
            :loading="activeTab === 'queue' ? loading : activeTab === 'management' ? managementLoading : catalogLoading"
            @click="refreshActiveTab"
          >
            {{ refreshButtonLabel }}
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
            <span>Visible: {{ filteredCatalogSeries.length }}</span>
            <span v-if="selectedCatalogDetail">Rows: {{ selectedCatalogRows.length }}</span>
            <span v-if="selectedCatalogDetail">Slots: {{ selectedCatalogDetail.slots.length }}</span>
            <span v-if="selectedCatalogDetail">Missing: {{ selectedCatalogDetail.slots.filter((slot) => slot.status === 'missing').length }}</span>
            <span v-if="lastLoadedAt">Last loaded: {{ formatTime(lastLoadedAt) }}</span>
          </div>
        </div>

        <div v-if="activeTab === 'catalog' && localCatalogMatchesExpanded" class="bg-black/20 rounded-lg p-3 border border-white/10 mb-4 space-y-3">
          <div class="flex flex-wrap items-start gap-3">
            <div class="grow min-w-[18rem]">
              <p class="text-sm uppercase tracking-wide text-gray-400">Lookup Link Import</p>
              <p class="text-base text-gray-100 mt-1">Import only the saved lookup links. Untick individual books before running the batch.</p>
            </div>
            <div class="text-sm text-gray-300">
              Saved matches: {{ unresolvedLocalCatalogMatches.length }}
            </div>
          </div>

          <div v-if="!unresolvedLocalCatalogMatches.length && !localCatalogMatchesLoading" class="rounded border border-white/10 bg-black/15 px-3 py-4 text-sm text-gray-400">
            No saved lookup links are waiting for import.
          </div>

          <div v-else class="space-y-3">
            <div
              v-for="match in unresolvedLocalCatalogMatches"
              :key="'local-match-batch:' + match.id"
              class="rounded border border-white/10 bg-black/15 p-3 space-y-3"
            >
              <div class="flex flex-wrap items-start gap-3">
                <div class="grow min-w-[18rem]">
                  <p class="text-sm text-gray-400">Active series</p>
                  <p class="text-lg font-semibold text-white">{{ match.localSeriesName }}</p>
                  <div class="mt-2 flex flex-wrap items-center gap-2">
                    <span class="inline-flex items-center px-2 py-0.5 rounded-full border border-sky-300/35 bg-sky-400/10 text-xs text-sky-50">
                      {{ getManualSourceCode(match) }} · {{ getManualSourceDisplayName(match) }}
                    </span>
                  </div>
                  <p class="text-sm text-gray-300 mt-1">{{ match.sourceSeriesName }}<span v-if="match.sourceAuthor"> - {{ match.sourceAuthor }}</span></p>
                  <p v-if="getManualSourceMeta(match)" class="text-xs text-gray-400 mt-1">{{ getManualSourceMeta(match) }}</p>
                  <p v-if="getManualSequenceStatus(match)" class="text-xs text-amber-200 mt-1">{{ getManualSequenceStatus(match) }}</p>
                  <a v-if="getManualSourceHref(match)" :href="getManualSourceHref(match)" target="_blank" rel="noopener noreferrer" class="mt-1 inline-flex text-sm text-sky-200 hover:underline break-all">
                    {{ getManualSourceText(match) }}
                  </a>
                  <p v-else-if="getManualSourceText(match)" class="mt-1 text-sm text-gray-300 break-all">
                    {{ getManualSourceText(match) }}
                  </p>
                </div>
                <div class="text-sm text-gray-300">
                  Selected books: {{ (localCatalogMatchSelectionById[match.id] || []).length }} / {{ match.localBooks.length }}
                </div>
              </div>

              <div class="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-3">
                <div class="rounded border border-white/10 bg-black/20 p-3">
                  <h3 class="text-sm font-semibold uppercase tracking-wide text-gray-300">Local Books</h3>
                  <div class="mt-2 space-y-2 text-sm text-gray-200">
                    <label
                      v-for="book in match.localBooks"
                      :key="'local-match-book:' + match.id + ':' + book.libraryItemId"
                      class="flex items-start gap-2 rounded border border-white/10 bg-black/15 px-3 py-2"
                    >
                      <input
                        type="checkbox"
                        class="mt-1 rounded border-white/20 bg-black/30"
                        :checked="isLocalCatalogMatchBookSelected(match.id, book.libraryItemId)"
                        @change="toggleLocalCatalogMatchBook(match.id, book.libraryItemId)"
                      />
                      <span class="min-w-0">
                        <span class="block font-medium text-white">{{ book.title }}</span>
                        <span v-if="formatCatalogLocalSeries(book)" class="block text-xs text-gray-400 mt-1">{{ formatCatalogLocalSeries(book) }}</span>
                      </span>
                    </label>
                  </div>
                </div>

                <div class="rounded border border-white/10 bg-black/20 p-3">
                  <h3 class="text-sm font-semibold uppercase tracking-wide text-gray-300">Saved Evidence</h3>
                  <div v-if="match.matchingBooks.length" class="mt-2 space-y-2 text-sm text-gray-200">
                    <div
                      v-for="book in match.matchingBooks"
                      :key="'local-match-evidence:' + match.id + ':' + book.localTitle + ':' + book.sourceTitle"
                      class="rounded border border-white/10 bg-black/15 px-3 py-2"
                    >
                      <p class="font-medium text-white">{{ book.localTitle }}</p>
                      <p class="text-gray-300 mt-1">{{ book.sourceTitle }}</p>
                      <p class="text-xs text-gray-400 mt-1">
                        <span v-if="book.sourceSequence">#{{ book.sourceSequence }}</span>
                        <span v-if="book.sourceSequence && book.sourcePublishedDate"> | </span>
                        <span v-if="book.sourcePublishedDate">{{ book.sourcePublishedDate }}</span>
                      </p>
                    </div>
                  </div>
                  <div v-else-if="match.sampleBooks.length" class="mt-2 space-y-2 text-sm text-gray-200">
                    <div
                      v-for="book in match.sampleBooks"
                      :key="'local-match-sample:' + match.id + ':' + book.title"
                      class="rounded border border-white/10 bg-black/15 px-3 py-2"
                    >
                      <p class="font-medium text-white">{{ book.title }}</p>
                      <p v-if="book.authors && book.authors.length" class="text-xs text-gray-400 mt-1">{{ book.authors.join(', ') }}</p>
                      <p class="text-xs text-gray-400 mt-1">
                        <span v-if="book.sequence">#{{ book.sequence }}</span>
                        <span v-if="book.sequence && book.publishedDate"> | </span>
                        <span v-if="book.publishedDate">{{ book.publishedDate }}</span>
                      </p>
                    </div>
                  </div>
                  <p v-else class="mt-2 text-sm text-gray-400">No saved book evidence snapshot is available.</p>
                </div>
              </div>
            </div>

            <div class="flex justify-end">
              <ui-btn
                color="bg-success/80"
                :loading="localCatalogImporting"
                @click="importSelectedLocalCatalogMatches"
              >
                Import Selected Local Matches
              </ui-btn>
            </div>
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
                    <div v-if="row.queueGroupName" class="mt-2">
                      <span class="inline-flex items-center px-2 py-0.5 rounded-full border border-sky-300/35 bg-sky-500/10 text-xs text-sky-100">
                        Group: {{ row.queueGroupName }}
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
                          <p v-if="suggestion.evidenceSummary?.automatedSecondarySupportCount" class="text-sky-200">
                            Supplemental automated support: {{ suggestion.evidenceSummary.automatedSecondarySupportCount }}
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
                            <p v-if="contribution.sourceRef" class="mt-1 text-xs text-gray-500 break-all">
                              ref: {{ contribution.sourceRef }}
                            </p>
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

                        <div v-if="suggestion.kind === 'series'" class="mt-3 space-y-3">
                          <div v-if="getPrimarySuggestions(row).length > 1" class="flex flex-wrap items-center gap-2">
                            <ui-btn
                              small
                              color="bg-bg border border-white/20"
                              :loading="actionKey === `${suggestion.id}:primary`"
                              @click="toggleAliasPrimary(row, suggestion)"
                            >
                              {{ selectedAliasPrimaryByRow[row.libraryItemId] === suggestion.id ? 'Primary selected' : 'Set primary' }}
                            </ui-btn>
                            <ui-btn
                              v-if="selectedAliasPrimaryByRow[row.libraryItemId] && selectedAliasPrimaryByRow[row.libraryItemId] !== suggestion.id"
                              small
                              color="bg-sky-500/70"
                              :loading="actionKey === `${suggestion.id}:alias`"
                              @click="aliasSuggestion(row, suggestion)"
                            >
                              Alias to {{ getAliasPrimaryLabel(row) }}
                            </ui-btn>
                          </div>

                          <div class="flex flex-wrap items-center gap-2">
                            <input
                              :value="getRenameDraft(suggestion)"
                              type="text"
                              class="min-w-[14rem] rounded border border-white/15 bg-black/20 px-3 py-1.5 text-sm text-white"
                              :placeholder="suggestion.suggestedName || 'Canonical series name'"
                              @input="setRenameDraft(suggestion.id, $event.target.value)"
                            />
                            <ui-btn
                              small
                              color="bg-bg border border-white/20"
                              :loading="actionKey === `${suggestion.id}:rename`"
                              @click="renameSuggestion(row, suggestion)"
                            >
                              Rename
                            </ui-btn>
                          </div>

                          <div v-if="suggestion.canUnlink" class="flex flex-wrap gap-2">
                            <ui-btn
                              small
                              color="bg-red-500/70"
                              :loading="actionKey === `${suggestion.id}:unlink`"
                              @click="unlinkSuggestion(row, suggestion)"
                            >
                              Unlink
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
          </template>

          <template v-else-if="activeTab === 'management'">
            <div class="mb-4 rounded border border-white/10 bg-black/15 p-4 text-sm text-gray-200">
              Use this section to review likely duplicate ABS series labels, choose the label to keep, preview the affected books, untick exceptions, and then apply the cleanup.
            </div>

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
                    <div class="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <p class="text-sm text-gray-300">Possible duplicate labels</p>
                      <span class="text-xs text-gray-400">Strength {{ candidate.score }}</span>
                    </div>
                    <p class="mt-1 text-sm text-gray-400">Click the label you want to keep. Nothing is selected by default.</p>
                    <div class="mt-2 flex flex-wrap gap-2">
                      <button
                        v-for="label in candidate.labels"
                        :key="label.id"
                        type="button"
                        class="inline-flex items-center gap-2 px-2.5 py-1 rounded-full border text-sm transition"
                        :class="selectedManagementTargetId(candidate.groupKey) === label.id ? 'border-sky-300/45 bg-sky-400/20 text-sky-50' : 'border-white/15 bg-black/20 text-gray-100 hover:border-sky-300/35 hover:bg-sky-400/10'"
                        @click="selectManagementTarget(candidate.groupKey, label.id)"
                      >
                        <span>{{ label.name }}</span>
                        <span class="text-gray-400">{{ label.bookCount }}</span>
                      </button>
                    </div>
                  </div>
                  <div class="w-full md:w-72 text-sm text-gray-300">
                    <p class="font-medium text-gray-100">Target label</p>
                    <p class="mt-1">
                      {{ selectedManagementTargetLabel(candidate) || 'Choose one of the labels above to preview the change.' }}
                    </p>
                    <div class="mt-2 flex gap-2">
                      <ui-btn
                        small
                        color="bg-bg border border-white/20"
                        :disabled="!selectedManagementTargetLabel(candidate)"
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
                <label class="min-w-[18rem] grow text-sm text-gray-300">
                  <span class="mb-1 block text-xs uppercase tracking-wide text-gray-500">Search series</span>
                  <input
                    v-model.trim="catalogSearchQuery"
                    type="text"
                    class="w-full rounded border border-white/15 bg-black/25 px-3 py-2 text-sm text-gray-100 placeholder:text-gray-500 focus:border-sky-300/40 focus:outline-none"
                    placeholder="Filter by series or author"
                  />
                </label>
              </div>

              <div v-if="catalogCategoryOptions.length" class="flex flex-wrap gap-2">
                <button
                  type="button"
                  class="px-3 py-1.5 rounded-full border text-sm transition"
                  :class="!catalogCategoryFilter ? 'bg-sky-400/20 border-sky-300/45 text-sky-50' : 'bg-black/20 border-white/15 text-gray-200'"
                  @click="setCatalogCategoryFilter('')"
                >
                  All categories ({{ allVisibleCatalogCount }})
                </button>
                <button
                  v-for="option in catalogCategoryOptions"
                  :key="'catalog-category:' + option.bucket"
                  type="button"
                  class="px-3 py-1.5 rounded-full border text-sm transition"
                  :class="catalogCategoryFilter === option.bucket ? 'bg-sky-400/20 border-sky-300/45 text-sky-50' : 'bg-black/20 border-white/15 text-gray-200'"
                  @click="setCatalogCategoryFilter(option.bucket)"
                >
                  {{ option.label }} ({{ option.count }})
                </button>
              </div>

              <div v-if="!catalogSeries.length && !catalogLoading" class="text-base text-gray-200">
                No series detail catalogs are stored yet.
              </div>

              <div v-else class="grid grid-cols-1 xl:grid-cols-[26rem_minmax(0,1fr)] gap-4">
                <div class="rounded border border-white/15 bg-black/15 p-3 max-h-[72vh] overflow-y-auto self-start space-y-3">
                  <div v-if="!filteredCatalogSeries.length" class="rounded border border-white/10 bg-black/20 px-3 py-4 text-sm text-gray-400">
                    No series match the current filter.
                  </div>
                  <button
                    v-for="catalog in filteredCatalogSeries"
                    :key="catalog.id"
                    type="button"
                    class="w-full rounded border px-3 py-2 text-left transition"
                    :class="selectedCatalogId === catalog.id ? 'bg-sky-400/15 border-sky-300/35 text-sky-50' : 'bg-black/20 border-white/10 text-gray-200'"
                    @click="selectCatalog(catalog.id, { preferCache: true })"
                  >
                    <div class="flex items-start gap-2">
                      <div class="grow min-w-0">
                        <p class="font-medium">{{ catalog.seriesName }}</p>
                        <p v-if="catalog.authorLine" class="text-sm text-gray-500 mt-0.5">{{ catalog.authorLine }}</p>
                        <p class="text-sm text-gray-400 mt-1">
                          {{ catalog.localBookCount }} local, {{ catalog.missingCount }} missing, {{ catalog.disputedCount }} disputed
                        </p>
                      </div>
                      <span
                        class="inline-flex shrink-0 items-center whitespace-nowrap px-2.5 py-1 rounded-full border text-xs text-center leading-none"
                        :class="getCatalogBucketPillClass(catalog.displayBucket)"
                      >
                        {{ catalog.displayLabel }}
                      </span>
                    </div>
                  </button>
                </div>

                <div v-if="selectedCatalogDetail" class="rounded border border-white/15 bg-black/15 p-4 space-y-4">
                  <div class="flex flex-wrap items-start gap-3">
                    <div class="grow min-w-[18rem]">
                      <h2 class="text-2xl font-semibold">{{ selectedCatalogHeading }}</h2>
                    </div>
                    <span
                      class="inline-flex items-center px-2 py-0.5 rounded-full border text-xs"
                      :class="getCatalogBucketPillClass(selectedCatalogDetail.catalog.displayBucket)"
                    >
                      {{ selectedCatalogDetail.catalog.displayLabel }}
                    </span>
                    <ui-btn
                      v-for="link in selectedCatalogDetail.catalog.evidenceLinks || []"
                      :key="selectedCatalogDetail.catalog.id + ':evidence:' + link.source"
                      small
                      color="bg-bg border border-white/20"
                      @click="openCatalogEvidence(link)"
                    >
                      {{ link.label }} Evidence
                    </ui-btn>
                    <ui-btn
                      v-if="selectedCatalogDetail.catalog.canDismiss && selectedCatalogDetail.catalog.visibilityStatus !== 'dismissed'"
                      small
                      color="bg-bg border border-white/20"
                      :loading="catalogVisibilityLoadingKey === selectedCatalogDetail.catalog.id"
                      @click="dismissCatalog(selectedCatalogDetail.catalog)"
                    >
                      Dismiss
                    </ui-btn>
                    <ui-btn
                      v-else-if="selectedCatalogDetail.catalog.canDismiss"
                      small
                      color="bg-success/80"
                      :loading="catalogVisibilityLoadingKey === selectedCatalogDetail.catalog.id"
                      @click="undismissCatalog(selectedCatalogDetail.catalog)"
                    >
                      Restore
                    </ui-btn>
                  </div>

                  <div v-if="canUseManualCatalogLookup" class="rounded border border-white/10 bg-black/20 p-3 space-y-3">
                    <div class="flex flex-wrap items-start gap-3">
                      <div class="grow min-w-[18rem]">
                        <p class="text-sm uppercase tracking-wide text-gray-400">Manual Source Lookup</p>
                        <p class="text-sm text-gray-200 mt-1">Search using the active series title, authors, and book context, then save source links for later review-queue import. Results are ordered FictionDB, Audible, then Wikidata.</p>
                        <p v-if="catalogManualLookupError" class="text-sm text-amber-200 mt-2">{{ catalogManualLookupError }}</p>
                      </div>
                      <ui-btn
                        color="bg-bg border border-white/20"
                        :loading="catalogManualLookupLoading"
                        @click="lookupManualCatalogSources"
                      >
                        Lookup Sources
                      </ui-btn>
                    </div>

                    <div v-if="selectedCatalogLocalMatches.length" class="space-y-3">
                      <h3 class="text-sm font-semibold uppercase tracking-wide text-gray-300">Saved Lookup Links</h3>
                      <div
                        v-for="match in selectedCatalogLocalMatches"
                        :key="'selected-local-match:' + match.id"
                        class="rounded border border-white/10 bg-black/15 p-3"
                      >
                        <div class="flex flex-wrap items-start gap-3">
                          <div class="grow min-w-[18rem]">
                            <div class="flex flex-wrap items-center gap-2">
                              <span class="inline-flex items-center px-2 py-0.5 rounded-full border border-sky-300/35 bg-sky-400/10 text-xs text-sky-50">
                                {{ getManualSourceCode(match) }} · {{ getManualSourceDisplayName(match) }}
                              </span>
                            </div>
                            <p class="text-lg font-semibold text-white">{{ match.sourceSeriesName }}</p>
                            <p v-if="match.sourceAuthor" class="text-sm text-gray-300 mt-1">{{ match.sourceAuthor }}</p>
                            <p v-if="getManualSourceMeta(match)" class="text-xs text-gray-400 mt-1">{{ getManualSourceMeta(match) }}</p>
                            <p v-if="getManualSequenceStatus(match)" class="text-xs text-amber-200 mt-1">{{ getManualSequenceStatus(match) }}</p>
                            <a v-if="getManualSourceHref(match)" :href="getManualSourceHref(match)" target="_blank" rel="noopener noreferrer" class="mt-1 inline-flex text-sm text-sky-200 hover:underline break-all">
                              {{ getManualSourceText(match) }}
                            </a>
                            <p v-else-if="getManualSourceText(match)" class="mt-1 text-sm text-gray-300 break-all">
                              {{ getManualSourceText(match) }}
                            </p>
                          </div>
                          <ui-btn
                            v-if="match.canRemove"
                            small
                            color="bg-bg border border-white/20"
                            :loading="catalogLocalMatchRemovingKey === match.id"
                            @click="removeLocalCatalogMatch(match)"
                          >
                            Remove link
                          </ui-btn>
                        </div>
                        <div v-if="match.matchingBooks.length" class="mt-3 grid grid-cols-1 xl:grid-cols-2 gap-2 text-sm text-gray-200">
                          <div
                            v-for="book in match.matchingBooks"
                            :key="'saved-local-evidence:' + match.id + ':' + book.localTitle + ':' + book.sourceTitle"
                            class="rounded border border-white/10 bg-black/20 px-3 py-2"
                          >
                            <p class="font-medium text-white">{{ book.localTitle }}</p>
                            <p class="text-gray-300 mt-1">{{ book.sourceTitle }}</p>
                            <p class="text-xs text-gray-400 mt-1">
                              <span v-if="book.sourceSequence">#{{ book.sourceSequence }}</span>
                              <span v-if="book.sourceSequence && book.sourcePublishedDate"> | </span>
                              <span v-if="book.sourcePublishedDate">{{ book.sourcePublishedDate }}</span>
                            </p>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div v-if="catalogManualLookupResults.length" class="grid grid-cols-1 xl:grid-cols-2 gap-3">
                      <div
                        v-for="result in catalogManualLookupResults"
                        :key="getManualLookupResultKey(result)"
                        class="rounded border border-white/10 bg-black/15 p-3 space-y-3"
                      >
                        <div class="flex flex-wrap items-start gap-3">
                          <div class="grow min-w-[18rem]">
                            <div class="flex flex-wrap items-center gap-2">
                              <span class="inline-flex items-center px-2 py-0.5 rounded-full border border-sky-300/35 bg-sky-400/10 text-xs text-sky-50">
                                {{ getManualSourceCode(result) }} · {{ getManualSourceDisplayName(result) }}
                              </span>
                            </div>
                            <p class="text-lg font-semibold text-white">{{ result.sourceSeriesName }}</p>
                            <p v-if="result.sourceAuthor" class="text-sm text-gray-300 mt-1">{{ result.sourceAuthor }}</p>
                            <p v-if="getManualSourceMeta(result)" class="text-xs text-gray-400 mt-1">{{ getManualSourceMeta(result) }}</p>
                            <p v-if="getManualSequenceStatus(result)" class="text-xs text-amber-200 mt-1">{{ getManualSequenceStatus(result) }}</p>
                            <a v-if="getManualSourceHref(result)" :href="getManualSourceHref(result)" target="_blank" rel="noopener noreferrer" class="mt-1 inline-flex text-sm text-sky-200 hover:underline break-all">
                              {{ getManualSourceText(result) }}
                            </a>
                            <p v-else-if="getManualSourceText(result)" class="mt-1 text-sm text-gray-300 break-all">
                              {{ getManualSourceText(result) }}
                            </p>
                          </div>
                          <span class="inline-flex items-center px-2 py-0.5 rounded-full border border-sky-300/35 bg-sky-400/10 text-xs text-sky-50">
                            Score {{ result.score }}
                          </span>
                        </div>

                        <div v-if="result.matchingBooks.length">
                          <p class="text-sm font-semibold uppercase tracking-wide text-gray-300">Matching Books</p>
                          <div class="mt-2 space-y-2 text-sm text-gray-200">
                            <div
                              v-for="book in result.matchingBooks"
                              :key="'manual-match-book:' + result.sourceUrl + ':' + book.localTitle + ':' + book.sourceTitle"
                              class="rounded border border-white/10 bg-black/20 px-3 py-2"
                            >
                              <p class="font-medium text-white">{{ book.localTitle }}</p>
                              <p class="text-gray-300 mt-1">{{ book.sourceTitle }}</p>
                              <p class="text-xs text-gray-400 mt-1">
                                <span v-if="book.sourceSequence">#{{ book.sourceSequence }}</span>
                                <span v-if="book.sourceSequence && book.sourcePublishedDate"> | </span>
                                <span v-if="book.sourcePublishedDate">{{ book.sourcePublishedDate }}</span>
                              </p>
                            </div>
                          </div>
                        </div>

                        <div v-if="result.sampleBooks.length">
                          <p class="text-sm font-semibold uppercase tracking-wide text-gray-300">Sample Source Books</p>
                          <div class="mt-2 space-y-2 text-sm text-gray-200">
                            <div
                              v-for="book in result.sampleBooks"
                              :key="'manual-sample-book:' + result.sourceUrl + ':' + book.title"
                              class="rounded border border-white/10 bg-black/20 px-3 py-2"
                            >
                              <p class="font-medium text-white">{{ book.title }}</p>
                              <p v-if="book.authors && book.authors.length" class="text-xs text-gray-400 mt-1">{{ book.authors.join(', ') }}</p>
                              <p class="text-xs text-gray-400 mt-1">
                                <span v-if="book.sequence">#{{ book.sequence }}</span>
                                <span v-if="book.sequence && book.publishedDate"> | </span>
                                <span v-if="book.publishedDate">{{ book.publishedDate }}</span>
                              </p>
                            </div>
                          </div>
                        </div>

                        <div class="flex justify-end">
                          <ui-btn
                            color="bg-success/80"
                            :loading="catalogManualLookupSavingKey === getManualLookupResultKey(result)"
                            @click="saveLocalCatalogMatch(result)"
                          >
                            Save Link
                          </ui-btn>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div class="rounded border border-white/10 bg-black/20 p-3">
                    <p class="text-sm text-gray-200">Series name controls stay aligned with Review Queue alias/rename and Series Management merge behavior.</p>
                    <p v-if="selectedCatalogDetail.catalog.displayBucket === 'local_only'" class="mt-1 text-xs text-gray-400">
                      Local-only series stay visible here until they are linked or merged into a sourced series, and they cannot be dismissed.
                    </p>
                    <p v-else-if="selectedCatalogDetail.catalog.displayBucket === 'locally_linked'" class="mt-1 text-xs text-gray-400">
                      Locally linked series came from saved manual source links and now feed the normal review/catalog pipeline.
                    </p>
                    <p v-else class="mt-1 text-xs text-gray-400">
                      Use Review Queue alias/rename or Series Management merge when this series needs canonical-name cleanup.
                    </p>
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
                    <table class="w-full min-w-[74rem] text-sm">
                      <thead class="bg-black/30">
                        <tr>
                          <th class="text-left px-3 py-2 w-24 font-semibold">Series No</th>
                          <th class="text-left px-3 py-2 w-28">Status</th>
                          <th class="text-left px-3 py-2 w-40">Sources</th>
                          <th class="text-left px-3 py-2">Expected title</th>
                          <th class="text-left px-3 py-2 min-w-[22rem]">Local coverage</th>
                          <th class="text-right px-3 py-2 w-44">Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        <template v-for="row in selectedCatalogRows">
                          <tr :key="getCatalogRowKey(row)" class="border-t border-white/10 align-top">
                            <td class="px-3 py-3 font-semibold text-base text-gray-100">{{ getCatalogRowLabel(row) }}</td>
                            <td class="px-3 py-3">
                              <span
                                class="inline-flex items-center px-2 py-0.5 rounded-full border text-xs"
                                :class="getCatalogSlotStatusClass(row.status)"
                              >
                                {{ formatCatalogSlotStatus(row.status) }}
                              </span>
                            </td>
                            <td class="px-3 py-3">
                              <div v-if="getCatalogRowSourceSupport(row).length" class="flex flex-wrap gap-2">
                                <div
                                  v-for="source in getCatalogRowSourceSupport(row)"
                                  :key="getCatalogRowKey(row) + ':support:' + source.source + ':' + (source.evidenceUrl || '')"
                                  class="rounded border border-sky-300/35 bg-sky-400/10 px-2 py-1 text-xs text-sky-50"
                                >
                                  <div class="flex flex-wrap items-center gap-x-2 gap-y-1">
                                    <span class="font-medium uppercase tracking-wide">{{ source.label || source.source }}</span>
                                    <span class="text-sky-100/90">{{ getSourceDisplayName(source.source) }}</span>
                                    <span v-if="source.confidence !== null && source.confidence !== undefined" class="text-sky-100/80">conf: {{ formatConfidence(source.confidence) }}</span>
                                  </div>
                                  <a
                                    v-if="source.evidenceUrl"
                                    class="mt-1 inline-flex text-sky-200 hover:underline break-all"
                                    :href="source.evidenceUrl"
                                    target="_blank"
                                    rel="noopener noreferrer"
                                  >
                                    Evidence link
                                  </a>
                                  <p v-if="source.sourceRef" class="mt-1 text-[11px] text-sky-100/75 break-all">
                                    ref: {{ source.sourceRef }}
                                  </p>
                                </div>
                              </div>
                              <p v-else class="text-xs text-gray-500">No source support</p>
                            </td>
                            <td class="px-3 py-3">
                              <div v-if="row.choices.length <= 1" class="space-y-1 text-gray-200">
                                <div v-if="getCatalogExpectedDisplay(row).title" class="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                                  <span class="text-lg font-semibold text-white">{{ getCatalogExpectedDisplay(row).title }}</span>
                                  <span v-if="getCatalogExpectedDisplay(row).dateLabel" class="text-sm text-gray-400">{{ getCatalogExpectedDisplay(row).dateLabel }}</span>
                                </div>
                                <p v-if="getCatalogExpectedDisplay(row).subtitle" class="text-sm text-gray-400">{{ getCatalogExpectedDisplay(row).subtitle }}</p>
                                <p v-if="!getCatalogExpectedDisplay(row).title" class="text-sm text-gray-500">No expected title known</p>
                              </div>

                              <div v-else class="space-y-2">
                                <div
                                  v-for="choice in row.choices"
                                  :key="getCatalogRowKey(row) + ':' + choice.entryKey"
                                  class="rounded border border-white/10 bg-black/20 p-2 text-sm text-gray-200"
                                >
                                  <div class="flex flex-wrap items-start gap-2">
                                    <div class="grow">
                                      <div class="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                                        <p class="text-base font-semibold text-white">{{ getCatalogExpectedDisplay(choice).title }}</p>
                                        <p v-if="getCatalogExpectedDisplay(choice).dateLabel" class="text-sm text-gray-400">{{ getCatalogExpectedDisplay(choice).dateLabel }}</p>
                                      </div>
                                      <p v-if="getCatalogExpectedDisplay(choice).subtitle" class="text-sm text-gray-400 mt-1">{{ getCatalogExpectedDisplay(choice).subtitle }}</p>
                                    </div>
                                    <span v-if="choice.sequenceLabel" class="text-xs text-gray-400 mt-1">{{ choice.sequenceLabel }}</span>
                                    <ui-btn
                                      small
                                      :color="row.selectedEntryKey === choice.entryKey ? 'bg-sky-400/25 border border-sky-300/35' : 'bg-bg border border-white/20'"
                                      :loading="catalogChoiceLoadingKey === `${selectedCatalogDetail.catalog.id}:${getCatalogRowKey(row)}:${choice.entryKey}`"
                                      @click="chooseCatalogSlot(choice, row)"
                                    >
                                      {{ row.selectedEntryKey === choice.entryKey ? 'Selected' : 'Use this' }}
                                    </ui-btn>
                                  </div>
                                </div>
                              </div>
                            </td>
                            <td class="px-3 py-3 text-gray-200">
                              <div v-if="row.localBooks.length" class="space-y-2">
                                <div
                                  v-for="book in row.localBooks"
                                  :key="getCatalogRowKey(row) + ':' + book.libraryItemId"
                                  class="rounded border border-white/10 bg-black/15 px-3 py-2"
                                >
                                  <nuxt-link :to="`/item/${book.libraryItemId}`" target="_blank" class="block font-semibold text-white hover:underline">
                                    {{ book.title }}
                                  </nuxt-link>
                                  <p v-if="formatCatalogLocalSeries(book)" class="text-sm text-gray-300 mt-1">{{ formatCatalogLocalSeries(book) }}</p>
                                  <p v-if="book.relPath" class="text-xs text-gray-500 mt-1 break-all">{{ book.relPath }}</p>
                                </div>
                              </div>
                              <p v-else class="text-gray-500">{{ getCatalogLocalCoverageEmptyText(row) }}</p>
                            </td>
                            <td class="px-3 py-3">
                              <div class="flex flex-col items-end gap-2">
                                <ui-btn
                                  v-if="row.rowType === 'unsequenced' || row.status === 'missing' || row.status === 'disputed'"
                                  small
                                  color="bg-bg border border-white/20"
                                  class="w-36 justify-center text-center"
                                  :disabled="row.status === 'disputed' && !row.selectedEntryKey"
                                  :loading="catalogCandidateSearchLoadingKey === `${selectedCatalogDetail.catalog.id}:${getCatalogRowKey(row)}`"
                                  @click="findCatalogCandidates(row)"
                                >
                                  Find candidates
                                </ui-btn>
                                <p v-if="row.status === 'disputed' && !row.selectedEntryKey" class="max-w-[11rem] text-right text-xs text-amber-200">
                                  Choose a preferred match first
                                </p>
                              </div>
                            </td>
                          </tr>
                          <tr v-if="catalogCandidateResultsBySlot[getCatalogRowKey(row)]" :key="getCatalogRowKey(row) + ':candidates'" class="border-t border-white/5 bg-black/10">
                            <td colspan="6" class="px-3 py-3">
                              <div class="rounded border border-white/10 bg-black/20 p-3 space-y-3">
                                <div class="flex flex-wrap items-center gap-3">
                                  <div class="text-sm text-gray-300">
                                    {{ getVisibleCatalogCandidates(getCatalogRowKey(row)).length }} of {{ catalogCandidateResultsBySlot[getCatalogRowKey(row)].results.length }} plausible candidate<span v-if="catalogCandidateResultsBySlot[getCatalogRowKey(row)].results.length !== 1">s</span>
                                  </div>
                                  <div class="grow" />
                                  <ui-btn
                                    small
                                    color="bg-bg border border-white/20"
                                    @click="closeCatalogCandidates(getCatalogRowKey(row))"
                                  >
                                    Close
                                  </ui-btn>
                                </div>
                                <label class="block text-sm text-gray-300">
                                  <span class="mb-1 block text-xs uppercase tracking-wide text-gray-500">Filter candidates</span>
                                  <input
                                    :value="getCatalogCandidateFilter(getCatalogRowKey(row))"
                                    type="text"
                                    class="w-full rounded border border-white/15 bg-black/25 px-3 py-2 text-sm text-gray-100 placeholder:text-gray-500 focus:border-sky-300/40 focus:outline-none"
                                    placeholder="Filter by candidate title or author"
                                    @input="setCatalogCandidateFilter(getCatalogRowKey(row), $event.target.value)"
                                  />
                                </label>
                                <div class="max-h-[26rem] overflow-y-auto space-y-3 pr-1">
                                  <div v-if="!getVisibleCatalogCandidates(getCatalogRowKey(row)).length" class="rounded border border-white/10 bg-black/15 px-3 py-4 text-sm text-gray-400">
                                    No plausible candidates match the current filter.
                                  </div>
                                  <div
                                    v-for="candidate in getVisibleCatalogCandidates(getCatalogRowKey(row))"
                                    :key="getCatalogRowKey(row) + ':' + candidate.libraryItemId"
                                    class="rounded border border-white/10 bg-black/15 p-3 space-y-2"
                                  >
                                    <div class="flex flex-wrap items-start gap-3">
                                      <div class="grow min-w-[20rem]">
                                        <nuxt-link :to="`/item/${candidate.libraryItemId}`" class="block text-base font-semibold hover:underline">
                                          {{ candidate.title }}
                                        </nuxt-link>
                                        <p class="text-sm text-gray-300 mt-1">{{ formatAuthors(candidate.authors) }}</p>
                                        <p v-if="candidate.relPath" class="text-xs text-gray-500 mt-1 break-all">{{ candidate.relPath }}</p>
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
                                        :key="getCatalogRowKey(row) + ':' + candidate.libraryItemId + ':' + reason.key"
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
                                        :loading="catalogCandidateQueueLoadingKey === `${getCatalogRowKey(row)}:${candidate.libraryItemId}`"
                                        @click="queueCatalogCandidate(row, candidate)"
                                      >
                                        Queue in Review
                                      </ui-btn>
                                    </div>
                                  </div>
                                </div>
                              </div>
                            </td>
                          </tr>
                        </template>
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
  audible: { code: 'AUD', name: 'Audible', url: 'https://www.audible.com/' },
  audnexus: { code: 'ANX', name: 'Audnexus', url: 'https://api.audnex.us/' },
  librarything: { code: 'LT', name: 'LibraryThing', url: 'https://www.librarything.com/' },
  fantasticfiction: { code: 'FF', name: 'Fantastic Fiction', url: 'https://www.fantasticfiction.com/' }
}

const CATALOG_LIST_CACHE_PREFIX = 'series-review:v2:catalog-list:'
const CATALOG_DETAIL_CACHE_KEY = 'series-review:v2:catalog-detail-cache'

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
      selectedAliasPrimaryByRow: {},
      renameTargetBySuggestion: {},
      actionKey: '',
      managementCandidates: [],
      managementPreviewByGroup: {},
      managementSelectionByGroup: {},
      managementTargetIds: {},
      managementRecentActions: [],
      managementPreviewLoadingKey: '',
      managementActionLoadingKey: '',
      managementRevertLoadingKey: '',
      managementActionDetailsOpen: {},
      catalogLoading: false,
      catalogSeries: [],
      catalogSearchQuery: '',
      catalogCategoryFilter: '',
      selectedCatalogId: '',
      selectedCatalogDetail: null,
      catalogChoiceLoadingKey: '',
      catalogCandidateSearchLoadingKey: '',
      catalogCandidateQueueLoadingKey: '',
      catalogVisibilityLoadingKey: '',
      catalogCandidateResultsBySlot: {},
      catalogCandidateFilterBySlot: {},
      catalogListCache: {},
      catalogDetailCache: {},
      localCatalogMatches: [],
      localCatalogMatchesLoading: false,
      localCatalogMatchesExpanded: false,
      localCatalogMatchSelectionById: {},
      localCatalogImporting: false,
      localCatalogRefreshLoading: false,
      catalogManualLookupResults: [],
      catalogManualLookupCatalogId: '',
      catalogManualLookupLoading: false,
      catalogManualLookupSavingKey: '',
      catalogManualLookupError: '',
      catalogLocalMatchRemovingKey: '',
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
    },
    refreshButtonLabel() {
      if (this.activeTab === 'queue') return 'Refresh Queue'
      if (this.activeTab === 'management') return 'Refresh Management'
      return 'Refresh Detail'
    },
    allVisibleCatalogCount() {
      const visibleCatalogs = this.getCatalogListCache(true, false)
      return visibleCatalogs.length || this.catalogSeries.filter((catalog) => catalog.displayBucket !== 'dismissed').length
    },
    catalogCategoryOptions() {
      const bucketOrder = ['trusted', 'local_only', 'locally_linked', 'potential', 'less_trusted', 'dismissed']
      const countCatalogs = this.getCatalogListCache(true, true).length ? this.getCatalogListCache(true, true) : this.catalogSeries
      const bucketCounts = new Map()
      ;(countCatalogs || []).forEach((catalog) => {
        const bucket = String(catalog?.displayBucket || '').trim()
        if (!bucket) return
        bucketCounts.set(bucket, (bucketCounts.get(bucket) || 0) + 1)
      })
      return bucketOrder.map((bucket) => ({
          bucket,
          label: this.getCatalogBucketLabel(bucket),
          count: bucketCounts.get(bucket) || 0
        }))
    },
    filteredCatalogSeries() {
      const query = String(this.catalogSearchQuery || '').trim().toLowerCase()
      return (this.catalogSeries || []).filter((catalog) => {
        if (this.catalogCategoryFilter && catalog.displayBucket !== this.catalogCategoryFilter) return false
        if (!query) return true
        const haystack = `${catalog.seriesName || ''} ${catalog.authorSearchText || catalog.authorLine || ''}`.toLowerCase()
        return haystack.includes(query)
      })
    },
    selectedCatalogAuthorLine() {
      return this.getCatalogAuthorLine(this.selectedCatalogDetail)
    },
    selectedCatalogRows() {
      return this.selectedCatalogDetail?.rows || this.selectedCatalogDetail?.slots || []
    },
    selectedCatalogHeading() {
      if (!this.selectedCatalogDetail?.catalog) return ''
      const authorLine = this.selectedCatalogAuthorLine
      return authorLine ? `${this.selectedCatalogDetail.catalog.seriesName} - ${authorLine}` : `${this.selectedCatalogDetail.catalog.seriesName}`
    },
    canUseManualCatalogLookup() {
      return this.selectedCatalogDetail?.catalog?.displayBucket !== 'dismissed' && !!this.selectedCatalogDetail?.localBooks?.length
    },
    selectedCatalogLocalMatches() {
      return this.selectedCatalogDetail?.catalog?.localSeriesMatches || []
    },
    unresolvedLocalCatalogMatches() {
      return (this.localCatalogMatches || []).filter((match) => !match.resolvedCatalogId)
    },
    selectedLocalCatalogMatchCount() {
      return this.unresolvedLocalCatalogMatches.filter((match) => (this.localCatalogMatchSelectionById[match.id] || []).length).length
    }
  },
  mounted() {
    this.hydrateCatalogCaches()
    this.loadQueue()
    this.prefetchCatalogData()
  },
  beforeDestroy() {
    this.stopSourceImportPolling()
  },
  methods: {
    async refreshActiveTab() {
      if (this.activeTab === 'queue') {
        await this.loadQueue()
      } else if (this.activeTab === 'management') {
        await this.loadManagementData()
      } else {
        await this.loadCatalogs()
        if (this.localCatalogMatchesExpanded) await this.loadLocalCatalogMatches()
      }
    },
    async switchTab(tab) {
      if (this.activeTab === tab) return
      this.activeTab = tab
      this.errorMessage = ''
      await this.refreshActiveTab()
      if (tab === 'catalog') await this.loadLocalCatalogMatches({ silent: true })
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
    getManualSourceDisplayName(entry) {
      return entry?.sourceName || this.getSourceDisplayName(entry?.source)
    },
    getManualSourceCode(entry) {
      const key = String(entry?.source || '').toLowerCase()
      return SOURCE_LEGEND[key]?.code || key.toUpperCase() || 'SRC'
    },
    getManualSourceHref(entry) {
      const href = String(entry?.sourceSeriesUrl || entry?.sourceLinkUrl || entry?.sourceUrl || '').trim()
      return /^https?:\/\//i.test(href) ? href : ''
    },
    getManualSourceText(entry) {
      return String(entry?.sourceIdentifier || entry?.sourceSeriesUrl || entry?.sourceUrl || '').trim()
    },
    getManualSourceMeta(entry) {
      const parts = []
      if (entry?.sourceAsin) parts.push(`ASIN ${entry.sourceAsin}`)
      if (entry?.sourceRegion) parts.push(String(entry.sourceRegion).toUpperCase())
      return parts.join(' | ')
    },
    getManualSequenceStatus(entry) {
      return String(entry?.sequenceStatusNote || entry?.evidenceSnapshot?.sequenceStatusNote || '').trim()
    },
    getManualLookupResultKey(entry) {
      return `${entry?.source || 'source'}:${entry?.sourceSeriesUrl || entry?.sourceUrl || entry?.sourceIdentifier || entry?.sourceSeriesName || ''}`
    },
    formatAuthors(authors) {
      return (authors || []).map((author) => author.name).join(', ') || '-'
    },
    formatDecisionState(suggestion) {
      if (suggestion.state === 'linked') return 'Already linked'
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
        replace: 'Previously applied by replace',
        assumed_link: 'Auto-linked'
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
    toggleAliasPrimary(row, suggestion) {
      if (this.selectedAliasPrimaryByRow[row.libraryItemId] === suggestion.id) {
        this.$delete(this.selectedAliasPrimaryByRow, row.libraryItemId)
        return
      }
      this.$set(this.selectedAliasPrimaryByRow, row.libraryItemId, suggestion.id)
    },
    getAliasPrimaryLabel(row) {
      const primarySuggestionId = this.selectedAliasPrimaryByRow[row.libraryItemId]
      return (row?.suggestions || []).find((suggestion) => suggestion.id === primarySuggestionId)?.suggestedName || 'selected primary'
    },
    getRenameDraft(suggestion) {
      return this.renameTargetBySuggestion[suggestion.id] ?? suggestion.suggestedName ?? ''
    },
    setRenameDraft(suggestionId, value) {
      this.$set(this.renameTargetBySuggestion, suggestionId, value)
    },
    selectedManagementTargetId(groupKey) {
      return this.managementTargetIds[groupKey] || ''
    },
    selectedManagementTargetLabel(candidate) {
      const targetId = this.selectedManagementTargetId(candidate.groupKey)
      return candidate.labels.find((label) => label.id === targetId)?.name || ''
    },
    selectManagementTarget(groupKey, labelId) {
      if (this.managementTargetIds[groupKey] === labelId) {
        this.$delete(this.managementTargetIds, groupKey)
        this.$delete(this.managementPreviewByGroup, groupKey)
        this.$delete(this.managementSelectionByGroup, groupKey)
        return
      }
      this.$set(this.managementTargetIds, groupKey, labelId)
      this.$delete(this.managementPreviewByGroup, groupKey)
      this.$delete(this.managementSelectionByGroup, groupKey)
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
      if (status === 'unsequenced') return 'Unsequenced'
      return 'Covered'
    },
    getCatalogSlotStatusClass(status) {
      if (status === 'missing') return 'border-red-300/35 bg-red-500/10 text-red-50'
      if (status === 'disputed') return 'border-amber-300/35 bg-amber-500/10 text-amber-100'
      if (status === 'decimal') return 'border-slate-300/35 bg-slate-500/10 text-slate-100'
      if (status === 'unsequenced') return 'border-violet-300/35 bg-violet-500/10 text-violet-100'
      return 'border-emerald-300/35 bg-emerald-500/10 text-emerald-100'
    },
    getCatalogBucketLabel(bucket) {
      if (bucket === 'local_only') return 'Local series'
      if (bucket === 'locally_linked') return 'Locally linked'
      if (bucket === 'less_trusted') return 'Less trusted'
      if (bucket === 'potential') return 'Potential series'
      if (bucket === 'dismissed') return 'Dismissed'
      return 'Trusted'
    },
    getCatalogBucketPillClass(bucket) {
      if (bucket === 'local_only') return 'border-cyan-300/35 bg-cyan-500/10 text-cyan-100'
      if (bucket === 'locally_linked') return 'border-sky-300/35 bg-sky-500/10 text-sky-100'
      if (bucket === 'less_trusted') return 'border-amber-300/35 bg-amber-500/10 text-amber-100'
      if (bucket === 'potential') return 'border-violet-300/35 bg-violet-500/10 text-violet-100'
      if (bucket === 'dismissed') return 'border-slate-300/35 bg-slate-500/10 text-slate-100'
      return 'border-emerald-300/35 bg-emerald-500/10 text-emerald-100'
    },
    async setCatalogCategoryFilter(bucket) {
      this.catalogCategoryFilter = this.catalogCategoryFilter === bucket ? '' : bucket
      await this.loadCatalogs({ preferCache: true })
    },
    getCatalogFetchFlags(bucket = this.catalogCategoryFilter) {
      return {
        includeUntrusted: true,
        includeDismissed: bucket === 'dismissed'
      }
    },
    openCatalogEvidence(link) {
      if (!process.client || !link?.url) return
      window.open(link.url, '_blank', 'noopener')
    },
    catalogListCacheKey(includeUntrusted = true, includeDismissed = false) {
      return `${CATALOG_LIST_CACHE_PREFIX}${includeUntrusted ? 1 : 0}:${includeDismissed ? 1 : 0}`
    },
    persistCatalogCaches() {
      if (!process.client) return
      try {
        Object.keys(window.sessionStorage)
          .filter((key) => key.startsWith('series-review:catalog-list:') || key === 'series-review:catalog-detail-cache')
          .forEach((key) => window.sessionStorage.removeItem(key))
        Object.entries(this.catalogListCache || {}).forEach(([key, value]) => {
          window.sessionStorage.setItem(key, JSON.stringify(value || []))
        })
        window.sessionStorage.setItem(CATALOG_DETAIL_CACHE_KEY, JSON.stringify(this.catalogDetailCache || {}))
      } catch {}
    },
    hydrateCatalogCaches() {
      if (!process.client) return
      try {
        const catalogListCache = {}
        Object.keys(window.sessionStorage)
          .filter((key) => key.startsWith(CATALOG_LIST_CACHE_PREFIX))
          .forEach((key) => {
            const parsed = JSON.parse(window.sessionStorage.getItem(key) || '[]')
            if (Array.isArray(parsed)) catalogListCache[key] = parsed
          })
        this.catalogListCache = catalogListCache

        const detailCacheRaw = window.sessionStorage.getItem(CATALOG_DETAIL_CACHE_KEY)
        if (detailCacheRaw) {
          const parsed = JSON.parse(detailCacheRaw)
          if (parsed && typeof parsed === 'object') this.catalogDetailCache = parsed
        }
      } catch {}
    },
    setCatalogListCache(catalogs, includeUntrusted = true, includeDismissed = false) {
      const key = this.catalogListCacheKey(includeUntrusted, includeDismissed)
      this.$set(this.catalogListCache, key, catalogs || [])
      this.persistCatalogCaches()
    },
    invalidateSeriesReviewCaches() {
      this.catalogSeries = []
      this.selectedCatalogId = ''
      this.selectedCatalogDetail = null
      this.catalogCandidateResultsBySlot = {}
      this.catalogListCache = {}
      this.catalogDetailCache = {}
      if (process.client) {
        try {
          Object.keys(window.sessionStorage)
            .filter((key) => key.startsWith(CATALOG_LIST_CACHE_PREFIX) || key === CATALOG_DETAIL_CACHE_KEY)
            .forEach((key) => window.sessionStorage.removeItem(key))
        } catch {}
      }
    },
    getCatalogListCache(includeUntrusted = true, includeDismissed = false) {
      return this.catalogListCache[this.catalogListCacheKey(includeUntrusted, includeDismissed)] || []
    },
    applyCatalogSeries(catalogs) {
      this.catalogSeries = catalogs || []
      if (!this.catalogSeries.length) {
        this.selectedCatalogId = ''
        this.selectedCatalogDetail = null
        return
      }
      if (this.catalogCategoryFilter && !this.catalogSeries.some((catalog) => catalog.displayBucket === this.catalogCategoryFilter)) {
        this.catalogCategoryFilter = ''
      }
      const visibleCatalogs = this.filteredCatalogSeries
      if (!visibleCatalogs.length) {
        this.selectedCatalogId = ''
        this.selectedCatalogDetail = null
        return
      }
      const nextId = visibleCatalogs.some((catalog) => catalog.id === this.selectedCatalogId) ? this.selectedCatalogId : visibleCatalogs[0].id
      this.selectCatalog(nextId, { preferCache: true })
    },
    getCatalogExpectedDisplay(slotOrChoice) {
      const title = String(slotOrChoice?.expectedTitle || slotOrChoice?.title || '').trim()
      const subtitleItems = Array.isArray(slotOrChoice?.expectedAuthors) ? slotOrChoice.expectedAuthors : Array.isArray(slotOrChoice?.authors) ? slotOrChoice.authors : []
      const publishedDate = String(slotOrChoice?.expectedPublishedDate || slotOrChoice?.publishedDate || '').trim()
      const dateLikeTitle = /^(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*[-/\s]?\d{2,4}$/i.test(title) || /^\d{4}(?:-\d{2}(?:-\d{2})?)?$/.test(title)
      const subtitle = subtitleItems.filter(Boolean).join(', ')
      if (dateLikeTitle && subtitleItems.length === 1) {
        return {
          title: subtitleItems[0],
          dateLabel: title,
          subtitle: ''
        }
      }
      return {
        title,
        dateLabel: publishedDate,
        subtitle
      }
    },
    formatCatalogLocalSeries(book) {
      if (!book?.seriesName) return ''
      return book.sequence ? `${book.seriesName} #${book.sequence}` : book.seriesName
    },
    getCatalogAuthorLine(detail) {
      if (!detail) return ''
      if (detail?.catalog?.authorLine) return detail.catalog.authorLine
      const authors = new Set()
      ;(detail.localBooks || []).forEach((book) => {
        ;(book.authors || []).forEach((author) => {
          if (author?.name) authors.add(author.name)
        })
      })
      ;((detail.rows || detail.slots) || []).forEach((row) => {
        ;(row.expectedAuthors || []).forEach((author) => {
          if (author) authors.add(author)
        })
      })
      return [...authors].slice(0, 3).join(', ')
    },
    getCatalogRowKey(row) {
      return String(row?.rowKey || row?.slot || '').trim()
    },
    getCatalogRowLabel(row) {
      if (row?.rowType === 'unsequenced') return 'Unsequenced'
      return String(row?.slot || '').trim()
    },
    getCatalogRowSourceSupport(row) {
      const choices = Array.isArray(row?.choices) ? row.choices : []
      if (row?.selectedEntryKey) {
        return choices.find((choice) => choice.entryKey === row.selectedEntryKey)?.sources || []
      }
      if (row?.sourceSupport?.length) return row.sourceSupport
      return choices.flatMap((choice) => choice.sources || []).filter((source, index, list) => {
        const key = `${source.source}:${source.evidenceUrl || ''}:${source.label || ''}`
        return list.findIndex((candidate) => `${candidate.source}:${candidate.evidenceUrl || ''}:${candidate.label || ''}` === key) === index
      })
    },
    getCatalogLocalCoverageEmptyText(row) {
      return row?.rowType === 'unsequenced' ? 'No local book matches this entry' : 'No local book covers this slot'
    },
    getCatalogCandidateFilter(rowKey) {
      return this.catalogCandidateFilterBySlot[rowKey] || ''
    },
    setCatalogCandidateFilter(rowKey, value) {
      const normalized = String(value || '').trimStart()
      if (!normalized) {
        this.$delete(this.catalogCandidateFilterBySlot, rowKey)
        return
      }
      this.$set(this.catalogCandidateFilterBySlot, rowKey, normalized)
    },
    getVisibleCatalogCandidates(rowKey) {
      const results = this.catalogCandidateResultsBySlot[rowKey]?.results || []
      const query = String(this.getCatalogCandidateFilter(rowKey) || '').trim().toLowerCase()
      if (!query) return results
      return results.filter((candidate) => {
        const authorText = Array.isArray(candidate?.authors) ? candidate.authors.map((author) => author?.name || '').join(' ') : ''
        const haystack = `${candidate?.title || ''} ${authorText}`.toLowerCase()
        return haystack.includes(query)
      })
    },
    closeCatalogCandidates(rowKey) {
      this.$delete(this.catalogCandidateResultsBySlot, rowKey)
      this.$delete(this.catalogCandidateFilterBySlot, rowKey)
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
    async prefetchCatalogData() {
      await this.fetchCatalogList({ includeUntrusted: true, includeDismissed: false, updateView: this.activeTab === 'catalog', prefetchOnly: this.activeTab !== 'catalog' })
      await this.fetchCatalogList({ includeUntrusted: true, includeDismissed: true, updateView: false, prefetchOnly: true })
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
        this.lastLoadedAt = new Date().toISOString()
      } catch (error) {
        this.errorMessage = error?.response?.data || 'Failed to load series management data'
      } finally {
        this.managementLoading = false
      }
    },
    async fetchCatalogList({ includeUntrusted, includeDismissed, updateView = false, prefetchOnly = false } = {}) {
      const response = await this.$axios.$get(`/api/libraries/${this.$route.params.library}/series-review/catalog`, {
        params: {
          includeUntrusted: includeUntrusted ? 1 : 0,
          includeDismissed: includeDismissed ? 1 : 0
        }
      })
      const catalogs = response.catalogs || []
      this.setCatalogListCache(catalogs, includeUntrusted, includeDismissed)
      if (catalogs.length && !this.catalogDetailCache[catalogs[0].id]) {
        await this.selectCatalog(catalogs[0].id, { preferCache: true, skipLoading: true, updateView })
      }
      if (updateView) this.applyCatalogSeries(catalogs)
      if (!prefetchOnly) this.lastLoadedAt = new Date().toISOString()
      return catalogs
    },
    async loadCatalogs({ preferCache = true } = {}) {
      this.errorMessage = ''
      const flags = this.getCatalogFetchFlags()
      const cachedCatalogs = preferCache ? this.getCatalogListCache(flags.includeUntrusted, flags.includeDismissed) : []
      const shouldShowLoading = !cachedCatalogs.length && !this.catalogSeries.length
      if (cachedCatalogs.length) this.applyCatalogSeries(cachedCatalogs)
      this.catalogLoading = shouldShowLoading
      try {
        await this.fetchCatalogList({
          includeUntrusted: flags.includeUntrusted,
          includeDismissed: flags.includeDismissed,
          updateView: true
        })
      } catch (error) {
        this.errorMessage = error?.response?.data || 'Failed to load series detail catalogs'
      } finally {
        this.catalogLoading = false
      }
    },
    initializeLocalCatalogMatchSelections(matches) {
      const nextSelections = { ...this.localCatalogMatchSelectionById }
      ;(matches || []).forEach((match) => {
        if (match.resolvedCatalogId) return
        const existing = nextSelections[match.id]
        const availableIds = (match.localBooks || []).map((book) => book.libraryItemId)
        if (existing && existing.length) {
          nextSelections[match.id] = existing.filter((id) => availableIds.includes(id))
          return
        }
        nextSelections[match.id] = [...availableIds]
      })
      this.localCatalogMatchSelectionById = nextSelections
    },
    async loadLocalCatalogMatches({ silent = false } = {}) {
      this.localCatalogMatchesLoading = true
      try {
        const response = await this.$axios.$get(`/api/libraries/${this.$route.params.library}/series-review/local-matches`)
        this.localCatalogMatches = response.matches || []
        this.initializeLocalCatalogMatchSelections(this.localCatalogMatches)
      } catch (error) {
        if (!silent) this.$toast.error(error?.response?.data || 'Failed to load locally matched series')
      } finally {
        this.localCatalogMatchesLoading = false
      }
    },
    async toggleLocalCatalogMatchesPanel() {
      this.localCatalogMatchesExpanded = !this.localCatalogMatchesExpanded
      if (this.localCatalogMatchesExpanded) {
        await this.loadLocalCatalogMatches()
      }
    },
    isLocalCatalogMatchBookSelected(matchId, libraryItemId) {
      return (this.localCatalogMatchSelectionById[matchId] || []).includes(libraryItemId)
    },
    toggleLocalCatalogMatchBook(matchId, libraryItemId) {
      const next = new Set(this.localCatalogMatchSelectionById[matchId] || [])
      if (next.has(libraryItemId)) next.delete(libraryItemId)
      else next.add(libraryItemId)
      this.$set(this.localCatalogMatchSelectionById, matchId, [...next])
    },
    async selectCatalog(catalogId, { preferCache = false, skipLoading = false, updateView = true } = {}) {
      if (!catalogId) {
        this.selectedCatalogId = ''
        this.selectedCatalogDetail = null
        this.catalogManualLookupResults = []
        this.catalogManualLookupCatalogId = ''
        this.catalogManualLookupError = ''
        return
      }
      this.selectedCatalogId = catalogId
      this.catalogCandidateResultsBySlot = {}
      this.catalogCandidateFilterBySlot = {}
      if (this.catalogManualLookupCatalogId !== catalogId) {
        this.catalogManualLookupResults = []
        this.catalogManualLookupCatalogId = ''
        this.catalogManualLookupError = ''
      }
      if (preferCache && this.catalogDetailCache[catalogId]) {
        if (updateView) this.selectedCatalogDetail = this.catalogDetailCache[catalogId]
      }
      if (!skipLoading && !(preferCache && this.catalogDetailCache[catalogId])) this.catalogLoading = true
      try {
        const detail = await this.$axios.$get(`/api/libraries/${this.$route.params.library}/series-review/catalog/${catalogId}`)
        this.$set(this.catalogDetailCache, catalogId, detail)
        this.persistCatalogCaches()
        if (updateView && this.selectedCatalogId === catalogId) this.selectedCatalogDetail = detail
      } catch (error) {
        this.errorMessage = error?.response?.data || 'Failed to load series detail'
      } finally {
        if (!skipLoading || !this.catalogDetailCache[catalogId]) this.catalogLoading = false
      }
    },
    async lookupManualCatalogSources() {
      if (!this.selectedCatalogDetail?.catalog?.id) return
      this.catalogManualLookupLoading = true
      this.catalogManualLookupError = ''
      try {
        const response = await this.$axios.$post(
          `/api/libraries/${this.$route.params.library}/series-review/catalog/${this.selectedCatalogDetail.catalog.id}/manual-lookup`
        )
        this.catalogManualLookupResults = response.results || []
        this.catalogManualLookupCatalogId = this.selectedCatalogDetail.catalog.id
        if (!this.catalogManualLookupResults.length) {
          this.catalogManualLookupError = 'No source-series candidates matched this local series context'
        }
      } catch (error) {
        const message = error?.response?.data || 'Failed to look up source-series candidates'
        this.catalogManualLookupError = message
        this.$toast.error(message)
      } finally {
        this.catalogManualLookupLoading = false
      }
    },
    async saveLocalCatalogMatch(result) {
      if (!this.selectedCatalogDetail?.catalog?.id) return
      this.catalogManualLookupSavingKey = this.getManualLookupResultKey(result)
      try {
        const detail = await this.$axios.$post(
          `/api/libraries/${this.$route.params.library}/series-review/catalog/${this.selectedCatalogDetail.catalog.id}/local-match`,
          {
            source: result.source,
            sourceSeriesName: result.sourceSeriesName,
            sourceAuthor: result.sourceAuthor,
            sourceUrl: result.sourceUrl,
            sourceSeriesUrl: result.sourceSeriesUrl || result.sourceUrl,
            evidenceSnapshot: result.evidenceSnapshot || {}
          }
        )
        this.selectedCatalogDetail = detail
        this.selectedCatalogId = detail.catalog.id
        this.$set(this.catalogDetailCache, detail.catalog.id, detail)
        this.persistCatalogCaches()
        this.$toast.success('Saved local source link')
      } catch (error) {
        this.$toast.error(error?.response?.data || 'Failed to save local source link')
      } finally {
        this.catalogManualLookupSavingKey = ''
      }
    },
    async removeLocalCatalogMatch(match) {
      if (!this.selectedCatalogDetail?.catalog?.id) return
      this.catalogLocalMatchRemovingKey = match.id
      try {
        const detail = await this.$axios.$post(
          `/api/libraries/${this.$route.params.library}/series-review/catalog/${this.selectedCatalogDetail.catalog.id}/local-match/${match.id}/remove`
        )
        this.invalidateSeriesReviewCaches()
        await this.loadCatalogs({ preferCache: false })
        this.selectedCatalogDetail = detail
        this.selectedCatalogId = detail.catalog.id
        this.$set(this.catalogDetailCache, detail.catalog.id, detail)
        this.persistCatalogCaches()
        await this.loadLocalCatalogMatches({ silent: true })
        this.$toast.success('Removed local source link')
      } catch (error) {
        this.$toast.error(error?.response?.data || 'Failed to remove local source link')
      } finally {
        this.catalogLocalMatchRemovingKey = ''
      }
    },
    async importSelectedLocalCatalogMatches() {
      const matches = this.unresolvedLocalCatalogMatches
        .map((match) => ({
          matchId: match.id,
          includedLibraryItemIds: this.localCatalogMatchSelectionById[match.id] || []
        }))
        .filter((match) => match.includedLibraryItemIds.length)
      if (!matches.length) {
        this.$toast.error('Select at least one local book to import')
        return
      }
      this.localCatalogImporting = true
      try {
        const response = await this.$axios.$post(`/api/libraries/${this.$route.params.library}/series-review/local-matches/import`, {
          matches
        })
        const summary = response.summary || {}
        this.$toast.success(
          `Imported ${summary.selected_matches || matches.length} match${(summary.selected_matches || matches.length) === 1 ? '' : 'es'}; queued ${summary.queue_rows_updated || 0} review row${(summary.queue_rows_updated || 0) === 1 ? '' : 's'}`
        )
        await this.loadCatalogs({ preferCache: false })
        await this.loadQueue()
        await this.loadLocalCatalogMatches({ silent: true })
      } catch (error) {
        this.$toast.error(error?.response?.data || 'Failed to import locally matched series')
      } finally {
        this.localCatalogImporting = false
      }
    },
    async refreshLocalCatalogMatches() {
      this.localCatalogRefreshLoading = true
      try {
        const response = await this.$axios.$post(`/api/libraries/${this.$route.params.library}/series-review/local-matches/refresh`, {
          catalogId: this.selectedCatalogDetail?.catalog?.id || ''
        })
        const summary = response.summary || {}
        this.$toast.success(
          `Refreshed ${summary.selected_matches || 0} match${(summary.selected_matches || 0) === 1 ? '' : 'es'}; queued ${summary.queue_rows_updated || 0} review row${(summary.queue_rows_updated || 0) === 1 ? '' : 's'}`
        )
        await this.loadCatalogs({ preferCache: false })
        await this.loadQueue()
        await this.loadLocalCatalogMatches({ silent: true })
      } catch (error) {
        this.$toast.error(error?.response?.data || 'Failed to refresh saved links')
      } finally {
        this.localCatalogRefreshLoading = false
      }
    },
    async chooseCatalogSlot(choice, row) {
      if (!this.selectedCatalogDetail) return
      const rowKey = this.getCatalogRowKey(row)
      this.catalogChoiceLoadingKey = `${this.selectedCatalogDetail.catalog.id}:${rowKey}:${choice.entryKey}`
      try {
        this.selectedCatalogDetail = await this.$axios.$post(
          `/api/libraries/${this.$route.params.library}/series-review/catalog/${this.selectedCatalogDetail.catalog.id}/slot-choice`,
          {
            slot: rowKey,
            entryKey: choice.entryKey
          }
        )
        this.$set(this.catalogDetailCache, this.selectedCatalogDetail.catalog.id, this.selectedCatalogDetail)
        this.persistCatalogCaches()
        this.$delete(this.catalogCandidateResultsBySlot, rowKey)
        this.$toast.success('Preferred interpretation updated')
        await this.loadCatalogs({ preferCache: true })
      } catch (error) {
        this.$toast.error(error?.response?.data || 'Failed to update slot interpretation')
      } finally {
        this.catalogChoiceLoadingKey = ''
      }
    },
    async findCatalogCandidates(row) {
      if (!this.selectedCatalogDetail) return
      const rowKey = this.getCatalogRowKey(row)
      this.catalogCandidateSearchLoadingKey = `${this.selectedCatalogDetail.catalog.id}:${rowKey}`
      try {
        const response = await this.$axios.$post(
          `/api/libraries/${this.$route.params.library}/series-review/catalog/${this.selectedCatalogDetail.catalog.id}/find-candidates`,
          {
            slot: rowKey
          }
        )
        this.$set(this.catalogCandidateResultsBySlot, rowKey, response)
      } catch (error) {
        this.$toast.error(error?.response?.data || 'Failed to find candidates')
      } finally {
        this.catalogCandidateSearchLoadingKey = ''
      }
    },
    async queueCatalogCandidate(row, candidate) {
      if (!this.selectedCatalogDetail) return
      const rowKey = this.getCatalogRowKey(row)
      this.catalogCandidateQueueLoadingKey = `${rowKey}:${candidate.libraryItemId}`
      try {
        const response = await this.$axios.$post(
          `/api/libraries/${this.$route.params.library}/series-review/catalog/${this.selectedCatalogDetail.catalog.id}/queue-candidate`,
          {
            slot: rowKey,
            libraryItemId: candidate.libraryItemId
          }
        )
        this.$toast.success(`Queued ${response.title} for review`)
        this.$delete(this.catalogCandidateResultsBySlot, rowKey)
        this.$delete(this.catalogCandidateFilterBySlot, rowKey)
      } catch (error) {
        this.$toast.error(error?.response?.data || 'Failed to queue candidate for review')
      } finally {
        this.catalogCandidateQueueLoadingKey = ''
      }
    },
    async dismissCatalog(catalog) {
      this.catalogVisibilityLoadingKey = catalog.id
      try {
        const detail = await this.$axios.$post(`/api/libraries/${this.$route.params.library}/series-review/catalog/${catalog.id}/dismiss`)
        this.$set(this.catalogDetailCache, catalog.id, detail)
        this.persistCatalogCaches()
        this.$toast.success('Series hidden from future scans and default detail view')
        await this.loadCatalogs({ preferCache: true })
      } catch (error) {
        this.$toast.error(error?.response?.data || 'Failed to dismiss series')
      } finally {
        this.catalogVisibilityLoadingKey = ''
      }
    },
    async undismissCatalog(catalog) {
      this.catalogVisibilityLoadingKey = catalog.id
      try {
        const detail = await this.$axios.$post(`/api/libraries/${this.$route.params.library}/series-review/catalog/${catalog.id}/undismiss`)
        this.$set(this.catalogDetailCache, catalog.id, detail)
        this.persistCatalogCaches()
        this.$toast.success('Series restored')
        await this.loadCatalogs({ preferCache: true })
      } catch (error) {
        this.$toast.error(error?.response?.data || 'Failed to restore series')
      } finally {
        this.catalogVisibilityLoadingKey = ''
      }
    },
    async previewManagementCandidate(candidate) {
      const groupKey = candidate.groupKey
      const targetLabel = this.selectedManagementTargetLabel(candidate)
      if (!targetLabel) {
        this.$toast.error('Choose the label to keep before previewing')
        return
      }
      this.managementPreviewLoadingKey = groupKey
      try {
        const response = await this.$axios.$post(`/api/libraries/${this.$route.params.library}/series-review/management/preview`, {
          sourceSeriesIds: candidate.labels.map((label) => label.id),
          targetLabel
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
      const targetLabel = this.selectedManagementTargetLabel(candidate)
      if (!targetLabel) {
        this.$toast.error('Choose the label to keep before applying')
        return
      }
      this.managementActionLoadingKey = groupKey
      try {
        const response = await this.$axios.$post(`/api/libraries/${this.$route.params.library}/series-review/management/apply`, {
          sourceSeriesIds: candidate.labels.map((label) => label.id),
          targetLabel,
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
    async aliasSuggestion(row, suggestion) {
      const primarySuggestionId = this.selectedAliasPrimaryByRow[row.libraryItemId]
      if (!primarySuggestionId || primarySuggestionId === suggestion.id) {
        this.$toast.error('Select a different primary suggestion first')
        return
      }

      this.actionKey = `${suggestion.id}:alias`
      try {
        await this.$axios.$post(`/api/series-review/suggestions/${suggestion.id}/alias`, {
          primarySuggestionId
        })
        this.$delete(this.selectedAliasPrimaryByRow, row.libraryItemId)
        this.invalidateSeriesReviewCaches()
        await this.loadQueue()
        this.$toast.success('Alias saved')
      } catch (error) {
        this.$toast.error(error?.response?.data || 'Failed to save series alias')
      } finally {
        this.actionKey = ''
      }
    },
    async renameSuggestion(row, suggestion) {
      const targetLabel = String(this.getRenameDraft(suggestion) || '').trim()
      if (!targetLabel) {
        this.$toast.error('Enter the canonical series name first')
        return
      }

      this.actionKey = `${suggestion.id}:rename`
      try {
        await this.$axios.$post(`/api/series-review/suggestions/${suggestion.id}/rename`, {
          targetLabel
        })
        this.$set(this.renameTargetBySuggestion, suggestion.id, targetLabel)
        this.invalidateSeriesReviewCaches()
        await this.loadQueue()
        this.$toast.success('Series name updated')
      } catch (error) {
        this.$toast.error(error?.response?.data || 'Failed to rename the series')
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
    async unlinkSuggestion(row, suggestion) {
      this.actionKey = `${suggestion.id}:unlink`
      try {
        const response = await this.$axios.$post(`/api/series-review/suggestions/${suggestion.id}/unlink`)
        this.updateRowCurrentSeries(row, response.currentSeries)
        this.updateSuggestionState(row, suggestion.id, response.suggestion)
        this.$toast.success('Series unlinked')
      } catch (error) {
        this.$toast.error(error?.response?.data || 'Failed to unlink series')
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
