<template>
  <div class="page relative" :class="streamLibraryItem ? 'streaming' : ''">
    <app-book-shelf-toolbar is-home />
    <div id="bookshelf" class="w-full h-full px-2 py-4 md:p-8 relative overflow-y-auto">
      <div class="w-full">
        <div class="flex items-center gap-2 mb-3">
          <h1 class="text-2xl font-semibold">Duplicates</h1>
          <div class="grow" />
          <label class="text-xs text-gray-300">Threshold</label>
          <input v-model.number="duplicateThreshold" type="range" min="0.5" max="0.98" step="0.01" class="w-32" @change="normalizeThreshold" />
          <input v-model.number="duplicateThreshold" type="number" min="0.5" max="0.98" step="0.01" class="w-20 text-xs bg-black/30 border border-white/20 rounded px-2 py-1" @change="normalizeThreshold" />
          <ui-btn color="bg-primary" small :loading="evaluating" @click="evaluateDuplicates">Evaluate Duplicates</ui-btn>
          <ui-btn color="bg-bg border border-white/20" small :loading="refreshing" @click="refreshDuplicates">Refresh Results</ui-btn>
        </div>

        <p class="text-sm text-gray-300 mb-4">
          Fuzzy duplicate grouping uses title + author. Series is assist-only. Groups auto-drop when they become singletons.
        </p>

        <div class="bg-primary/20 rounded-lg p-3 border border-primary/40 mb-4 text-xs text-gray-300">
          <div class="flex flex-wrap gap-x-4 gap-y-1">
            <span>Scope: Current library</span>
            <span>Books scanned: {{ sourceItemsCount }}</span>
            <span>Groups: {{ duplicateGroupCount }}</span>
            <span>Suppressed: {{ suppressedGroupCount }}</span>
            <span v-if="lastEvaluatedAt">Last evaluated: {{ formatTime(lastEvaluatedAt) }}</span>
          </div>
          <div v-if="lastReasonText" class="mt-2 text-gray-400">{{ lastReasonText }}</div>
        </div>

        <div class="bg-primary/20 rounded-lg p-3 border border-primary/40">
          <div v-if="!evaluatedOnce" class="text-sm text-gray-300">
            Duplicate discovery has not run yet. Click <span class="font-semibold">Evaluate Duplicates</span> to scan the current library now.
          </div>

          <template v-else>
            <div v-if="!duplicateGroups.length" class="text-sm text-gray-300">
              <p>No duplicate groups found for this run.</p>
              <p class="text-xs text-gray-400 mt-1">Try lowering the threshold, then click Evaluate Duplicates again.</p>
            </div>

            <div v-else class="overflow-auto max-h-[68vh] border border-white/15 rounded">
              <table class="w-full text-sm table-fixed">
                <thead class="bg-black/30 sticky top-0">
                  <tr>
                    <th class="text-left px-2 py-2 w-44">Group</th>
                    <th class="text-left px-2 py-2">Books</th>
                    <th class="text-left px-2 py-2 w-36">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="group in duplicateGroups" :key="group.groupKey + group.groupFingerprint" class="border-t border-white/10 align-top">
                    <td class="px-2 py-3">
                      <div class="text-xs text-gray-300">{{ group.size }} items</div>
                      <div class="font-semibold truncate" :title="group.titleHint || '-'">{{ group.titleHint || '-' }}</div>
                      <div class="text-xs text-gray-400 truncate" :title="group.authorHint || '-'">{{ group.authorHint || '-' }}</div>
                      <div class="text-xxs text-gray-500 mt-1">Score {{ group.score }}</div>
                    </td>
                    <td class="px-2 py-3">
                      <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2">
                        <div v-for="member in group.members" :key="member.libraryItemId" class="bg-black/20 border border-white/10 rounded p-2">
                          <div class="flex gap-2 items-start">
                            <nuxt-link :to="`/item/${member.libraryItemId}`" class="w-10 h-14 rounded overflow-hidden bg-black/40 border border-white/10 shrink-0">
                              <img :src="getCoverSrc(member)" :alt="member.title || 'cover'" class="w-full h-full object-cover" />
                            </nuxt-link>
                            <div class="min-w-0">
                              <nuxt-link :to="`/item/${member.libraryItemId}`" class="block font-semibold truncate hover:underline" :title="member.title || '-'">
                                {{ member.title || '-' }}
                              </nuxt-link>
                              <p class="text-xs text-gray-300 truncate" :title="member.author || '-'">{{ member.author || '-' }}</p>
                              <p class="text-xxs text-gray-400 truncate" :title="member.series || '-'">{{ member.series || '-' }}</p>
                            </div>
                          </div>
                        </div>
                      </div>
                    </td>
                    <td class="px-2 py-3">
                      <ui-btn color="bg-bg border border-white/20" small :loading="suppressingGroupKey === group.groupKey" @click="markNotDuplicates(group)">
                        Not Duplicates
                      </ui-btn>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </template>
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
    if (!fetchData || !fetchData.library) {
      return redirect(`/oops?message=Library "${libraryId}" not found`)
    }
    if (fetchData.library.mediaType !== 'book') {
      return redirect(`/library/${libraryId}`)
    }
    return {}
  },
  data() {
    return {
      duplicateThreshold: 0.79,
      sessionId: null,
      duplicatePayload: null,
      evaluating: false,
      refreshing: false,
      suppressingGroupKey: null,
      evaluatedOnce: false,
      lastEvaluatedAt: null,
      lastReason: ''
    }
  },
  computed: {
    streamLibraryItem() {
      return this.$store.state.streamLibraryItem
    },
    duplicateGroups() {
      return this.duplicatePayload?.groups || []
    },
    duplicateGroupCount() {
      return Number(this.duplicatePayload?.groupedCount || 0)
    },
    suppressedGroupCount() {
      return Number(this.duplicatePayload?.suppressedCount || 0)
    },
    sourceItemsCount() {
      return Number(this.duplicatePayload?.sourceItemsCount || 0)
    },
    lastReasonText() {
      if (!this.evaluatedOnce) return ''
      if (this.lastReason === 'groups_found') return 'Duplicate discovery completed. Use Not Duplicates to suppress false positives.'
      if (this.lastReason === 'no_groups_above_threshold') return 'Discovery ran successfully but no groups met the current threshold.'
      if (this.lastReason === 'no_books_in_scope') return 'Discovery ran successfully but no book items were available in this library scope.'
      return ''
    }
  },
  methods: {
    formatTime(value) {
      if (!value) return '-'
      return new Date(value).toLocaleString()
    },
    normalizeThreshold() {
      const next = Number(this.duplicateThreshold)
      if (!Number.isFinite(next)) this.duplicateThreshold = 0.79
      this.duplicateThreshold = Math.max(0.5, Math.min(0.98, Number(this.duplicateThreshold.toFixed(2))))
    },
    getCoverSrc(member) {
      return this.$store.getters['globals/getLibraryItemCoverSrc'](
        {
          id: member.libraryItemId,
          updatedAt: member.updatedAt,
          media: {
            coverPath: member.coverPath || null
          }
        },
        null
      )
    },
    async evaluateDuplicates() {
      this.normalizeThreshold()
      this.evaluating = true
      const payload = await this.$axios
        .$post(
          `/api/libraries/${this.$route.params.library}/duplicates/evaluate`,
          { duplicateThreshold: this.duplicateThreshold },
          { params: { duplicateThreshold: this.duplicateThreshold } }
        )
        .catch((error) => {
          const message = error?.response?.data || 'Failed to evaluate duplicates'
          this.$toast.error(message)
          return null
        })
      this.evaluating = false
      if (!payload) return

      this.sessionId = payload.sessionId || this.sessionId
      this.duplicatePayload = payload.duplicateGroups || { groups: [] }
      this.evaluatedOnce = true
      this.lastEvaluatedAt = payload.evaluation?.evaluatedAt || new Date().toISOString()
      this.lastReason = payload.evaluation?.reason || ''
    },
    async refreshDuplicates() {
      this.refreshing = true
      await this.evaluateDuplicates()
      this.refreshing = false
    },
    async markNotDuplicates(group) {
      if (!this.sessionId || !group?.groupKey || !group?.groupFingerprint) {
        this.$toast.error('Run Evaluate Duplicates before suppressing groups')
        return
      }

      this.suppressingGroupKey = group.groupKey
      const payload = await this.$axios
        .$post(
          `/api/quick-match-sessions/${this.sessionId}/duplicates/suppress`,
          {
            groupKey: group.groupKey,
            groupFingerprint: group.groupFingerprint
          },
          {
            params: {
              duplicateThreshold: this.duplicateThreshold
            }
          }
        )
        .catch((error) => {
          const message = error?.response?.data || 'Failed to suppress duplicate group'
          this.$toast.error(message)
          return null
        })
      this.suppressingGroupKey = null
      if (!payload) return

      await this.refreshDuplicates()
      this.$toast.success('Marked as Not Duplicates')
    }
  },
  mounted() {
    this.evaluateDuplicates()
  }
}
</script>
