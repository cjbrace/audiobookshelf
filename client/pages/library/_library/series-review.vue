<template>
  <div class="page relative" :class="streamLibraryItem ? 'streaming' : ''">
    <app-book-shelf-toolbar is-home />
    <div id="bookshelf" class="w-full h-full px-2 py-4 md:p-8 relative overflow-y-auto">
      <div class="w-full">
        <div class="flex items-center gap-2 mb-3">
          <h1 class="text-2xl font-semibold">Series Review</h1>
          <div class="grow" />
          <label class="flex items-center gap-2 text-sm text-gray-300 cursor-pointer">
            <input v-model="includeDecided" type="checkbox" class="rounded border-white/20 bg-black/30" @change="loadQueue" />
            <span>Show decided rows</span>
          </label>
          <ui-btn color="bg-bg border border-white/20" small :loading="loading" @click="loadQueue">
            Refresh
          </ui-btn>
        </div>

        <div v-if="sourceLegendEntries.length" class="flex flex-wrap gap-2 mb-4 text-sm">
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

        <div class="bg-primary/20 rounded-lg p-3 border border-primary/40 mb-4 text-sm text-gray-200">
          <div class="flex flex-wrap gap-x-4 gap-y-1">
            <span>Rows: {{ rows.length }}</span>
            <span>Pending suggestions: {{ pendingSuggestionCount }}</span>
            <span v-if="lastLoadedAt">Last loaded: {{ formatTime(lastLoadedAt) }}</span>
          </div>
        </div>

        <div class="bg-primary/20 rounded-lg p-3 border border-primary/40">
          <div v-if="errorMessage" class="text-red-200 mb-3">{{ errorMessage }}</div>

          <div v-if="!rows.length && !loading" class="text-base text-gray-200">
            No series review rows are stored for this library yet.
          </div>

          <div v-else class="overflow-auto max-h-[70vh] border border-white/15 rounded">
            <table class="w-full text-base table-fixed">
              <thead class="bg-black/30 sticky top-0">
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
                        <div class="flex items-start gap-2">
                          <div class="grow">
                            <div class="text-xl font-semibold text-white">
                              <template v-if="suggestion.kind === 'no_series'">No series suggested</template>
                              <template v-else>
                                {{ suggestion.suggestedName }}
                                <span v-if="suggestion.suggestedSequence" class="ml-2 inline-flex items-center px-2 py-0.5 rounded-full bg-white/10 text-sm text-gray-100 border border-white/15">#{{ suggestion.suggestedSequence }}</span>
                              </template>
                            </div>
                            <p class="text-sm text-gray-300 mt-1">
                              {{ suggestion.state === 'pending' ? 'Pending review' : formatDecisionState(suggestion) }}
                            </p>
                            <p v-if="suggestion.previousDecision" class="text-sm mt-1" :class="suggestion.hasMeaningfulUpdateSinceDecision ? 'text-amber-200' : 'text-gray-400'">
                              {{ formatPreviousDecision(suggestion) }}
                            </p>
                          </div>
                          <div class="text-xs text-gray-400 whitespace-nowrap">{{ suggestion.sourceCount }} source<span v-if="suggestion.sourceCount !== 1">s</span></div>
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
                          <p>
                            Seen {{ formatTime(suggestion.firstSeenAt) }}
                            <span v-if="suggestion.lastSeenAt && suggestion.lastSeenAt !== suggestion.firstSeenAt">, updated {{ formatTime(suggestion.lastSeenAt) }}</span>
                          </p>
                          <p v-if="suggestion.evidenceSummary?.disagreement" class="text-amber-200">
                            Source disagreement: {{ suggestion.evidenceSummary.supportCount }} positive / {{ suggestion.evidenceSummary.conflictCount }} conflicting
                          </p>
                        </div>

                        <div class="mt-3 space-y-2">
                          <div
                            v-for="contribution in suggestion.contributions"
                            :key="suggestion.id + ':detail:' + contribution.source + ':' + (contribution.seriesName || 'no-series')"
                            class="rounded border border-white/10 bg-black/15 px-3 py-2 text-sm text-gray-200"
                          >
                            <div class="flex flex-wrap items-center gap-x-2 gap-y-1">
                              <span class="font-medium uppercase tracking-wide">{{ contribution.label || contribution.source }}</span>
                              <span v-if="contribution.noSeries" class="text-red-200">No series evidence</span>
                              <span v-else>
                                {{ contribution.seriesName }}
                                <span v-if="contribution.sequence">&nbsp;#{{ contribution.sequence }}</span>
                              </span>
                              <span v-if="contribution.confidence !== null && contribution.confidence !== undefined" class="text-gray-400">
                                confidence {{ formatConfidence(contribution.confidence) }}
                              </span>
                            </div>
                            <p v-if="contribution.notes" class="mt-1 text-gray-300">{{ contribution.notes }}</p>
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
      rows: [],
      includeDecided: false,
      loading: false,
      errorMessage: '',
      lastLoadedAt: null,
      selectedReplaceTarget: {},
      actionKey: ''
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
    }
  },
  mounted() {
    this.loadQueue()
  },
  methods: {
    formatTime(value) {
      return value ? new Date(value).toLocaleString() : '-'
    },
    formatConfidence(value) {
      return Number(value).toFixed(2)
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
        this.lastLoadedAt = new Date().toISOString()
      } catch (error) {
        this.errorMessage = error?.response?.data || 'Failed to load series review rows'
      } finally {
        this.loading = false
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
