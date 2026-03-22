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

        <p class="text-base text-gray-300 mb-4">
          Review stored series suggestions by book. Add keeps the current series entries, clicking a current series chip replaces that specific entry, and Dismiss hides the suggestion from pending review on reruns.
        </p>

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
                    <p class="text-sm text-gray-400 mt-2">Book ID: {{ row.libraryItemId }}</p>
                  </td>
                  <td class="px-3 py-3">
                    <div v-if="row.currentSeries.length" class="flex flex-wrap gap-2">
                      <button
                        v-for="series in row.currentSeries"
                        :key="series.id"
                        type="button"
                        class="px-2 py-1 rounded border text-left transition"
                        :class="selectedReplaceTarget[row.libraryItemId] === series.id ? 'bg-yellow-700/40 border-yellow-400 text-yellow-100' : 'bg-black/20 border-white/15 hover:border-yellow-400/70'"
                        @click="toggleReplaceTarget(row.libraryItemId, series.id)"
                      >
                        <span class="font-medium">{{ series.name }}</span>
                        <span v-if="series.sequence" class="text-sm text-gray-300">&nbsp;#{{ series.sequence }}</span>
                      </button>
                    </div>
                    <p v-else class="text-gray-300">No current ABS series entries</p>
                    <p class="text-xs text-gray-400 mt-2">Click a chip, then use Replace on a suggestion card.</p>
                  </td>
                  <td class="px-3 py-3">
                    <div class="grid grid-cols-1 xl:grid-cols-2 gap-3">
                      <div
                        v-for="suggestion in row.suggestions"
                        :key="suggestion.id"
                        class="rounded border p-3"
                        :class="suggestion.state === 'pending' ? 'bg-black/20 border-white/15' : 'bg-slate-900/40 border-slate-500/40'"
                      >
                        <div class="flex items-start gap-2">
                          <div class="grow">
                            <div class="text-lg font-semibold">
                              <template v-if="suggestion.kind === 'no_series'">No series suggested</template>
                              <template v-else>
                                {{ suggestion.suggestedName }}
                                <span v-if="suggestion.suggestedSequence" class="text-gray-300">#{{ suggestion.suggestedSequence }}</span>
                              </template>
                            </div>
                            <p class="text-sm text-gray-300 mt-1">
                              {{ suggestion.state === 'pending' ? 'Pending review' : formatDecisionState(suggestion) }}
                            </p>
                          </div>
                          <div class="text-xs text-gray-400 whitespace-nowrap">{{ suggestion.sourceCount }} source<span v-if="suggestion.sourceCount !== 1">s</span></div>
                        </div>

                        <div class="mt-3 flex flex-wrap gap-2">
                          <div
                            v-for="contribution in suggestion.contributions"
                            :key="suggestion.id + ':' + contribution.source"
                            class="px-2 py-1 rounded bg-primary/20 border border-primary/30 text-sm"
                          >
                            <span class="font-medium uppercase tracking-wide">{{ contribution.label || contribution.source }}</span>
                            <span v-if="contribution.noSeries" class="text-gray-300"> no series</span>
                            <span v-else class="text-gray-300">
                              {{ contribution.seriesName }}
                              <span v-if="contribution.sequence">&nbsp;#{{ contribution.sequence }}</span>
                            </span>
                          </div>
                        </div>

                        <div class="mt-3 flex flex-wrap gap-2">
                          <ui-btn
                            v-if="suggestion.kind === 'series'"
                            small
                            color="bg-success/80"
                            :loading="actionKey === suggestion.id + ':add'"
                            @click="applySuggestion(row, suggestion, 'add')"
                          >
                            Add
                          </ui-btn>
                          <ui-btn
                            v-if="suggestion.kind === 'series'"
                            small
                            :disabled="!selectedReplaceTarget[row.libraryItemId]"
                            color="bg-warning/70"
                            :loading="actionKey === suggestion.id + ':replace'"
                            @click="applySuggestion(row, suggestion, 'replace')"
                          >
                            Replace Selected Current
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
    }
  },
  mounted() {
    this.loadQueue()
  },
  methods: {
    formatTime(value) {
      return value ? new Date(value).toLocaleString() : '-'
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
    toggleReplaceTarget(libraryItemId, seriesId) {
      if (this.selectedReplaceTarget[libraryItemId] === seriesId) {
        this.$delete(this.selectedReplaceTarget, libraryItemId)
        return
      }
      this.$set(this.selectedReplaceTarget, libraryItemId, seriesId)
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
    async applySuggestion(row, suggestion, mode) {
      const replaceSeriesId = this.selectedReplaceTarget[row.libraryItemId]
      if (mode === 'replace' && !replaceSeriesId) {
        this.$toast.error('Select a current series entry to replace first')
        return
      }

      this.actionKey = `${suggestion.id}:${mode}`
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
