<template>
  <div class="page relative" :class="streamLibraryItem ? 'streaming' : ''">
    <app-book-shelf-toolbar is-home />
    <div id="bookshelf" class="w-full h-full px-2 py-4 md:p-8 relative overflow-y-auto">
      <div class="w-full">
        <div class="flex items-center gap-2 mb-3">
          <h1 class="text-2xl font-semibold">Duplicates</h1>
          <div class="grow" />
          <label class="text-xs text-gray-300">Threshold</label>
          <input v-model.number="duplicateThreshold" type="range" min="0.5" max="0.98" step="0.01" class="w-32" @change="applyThreshold" />
          <input v-model.number="duplicateThreshold" type="number" min="0.5" max="0.98" step="0.01" class="w-20 text-xs bg-black/30 border border-white/20 rounded px-2 py-1" @change="applyThreshold" />
          <ui-btn color="bg-bg border border-white/20" small @click="loadSessions">Refresh</ui-btn>
        </div>

        <p class="text-sm text-gray-300 mb-6">
          Fuzzy duplicate groups use title + author matching (series is assist-only). Groups auto-reassess and singleton groups are removed.
        </p>

        <div class="bg-primary/20 rounded-lg p-3 border border-primary/40">
          <div v-if="!selectedSession" class="text-sm text-gray-300">No quick match session data available.</div>
          <template v-else>
            <div class="flex items-center gap-2 mb-3">
              <div class="text-xs text-gray-300">
                Groups: {{ duplicateGroupCount }}
                <span class="ml-2">Suppressed: {{ suppressedGroupCount }}</span>
                <span class="ml-2">Source Items: {{ sourceItemsCount }}</span>
              </div>
              <div class="grow" />
              <ui-btn color="bg-success" small :disabled="!canQueueForFullMatch || queueingFullMatch" :loading="queueingFullMatch" @click="queueFullMatch">
                Queue Full Match (Reverted)
              </ui-btn>
              <ui-btn color="bg-error" small :disabled="!selectedIds.length || reverting" :loading="reverting" @click="revertSelected">Revert Selected</ui-btn>
              <ui-btn color="bg-error/70" small :disabled="!canRevertAny || revertingAll" :loading="revertingAll" @click="revertAll">Revert All</ui-btn>
            </div>

            <div class="overflow-auto max-h-[62vh] border border-white/15 rounded">
              <table class="w-full text-sm table-fixed">
                <thead class="bg-black/30 sticky top-0">
                  <tr>
                    <th class="text-left px-2 py-2 w-8"></th>
                    <th class="text-left px-2 py-2 w-40">Group</th>
                    <th class="text-left px-2 py-2">Books</th>
                    <th class="text-left px-2 py-2 w-36">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="group in duplicateGroups" :key="group.groupKey + group.groupFingerprint" class="border-t border-white/10 align-top">
                    <td class="px-2 py-3">
                      <input :checked="groupSelected(group)" type="checkbox" @change="toggleGroupSelected(group, $event.target.checked)" />
                    </td>
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
                            <input :checked="selectedIds.includes(member.libraryItemId)" type="checkbox" class="mt-1" @change="toggleSelected(member.libraryItemId, $event.target.checked)" />
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
                  <tr v-if="!duplicateGroups.length" class="border-t border-white/10">
                    <td colspan="4" class="px-2 py-3 text-xs text-gray-300">No duplicate groups currently detected for this session.</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div class="mt-4">
              <h3 class="text-base mb-2">Full Match Queue</h3>
              <div v-if="!fullMatchQueue.length" class="text-xs text-gray-300">No queued items.</div>
              <div v-else class="overflow-auto max-h-[28vh] border border-white/15 rounded">
                <table class="w-full text-sm">
                  <thead class="bg-black/30 sticky top-0">
                    <tr>
                      <th class="text-left px-2 py-2">Status</th>
                      <th class="text-left px-2 py-2">Book</th>
                      <th class="text-left px-2 py-2">Queued</th>
                      <th class="text-left px-2 py-2">Completed</th>
                      <th class="text-left px-2 py-2">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="q in fullMatchQueue" :key="q.id" class="border-t border-white/10">
                      <td class="px-2 py-2">
                        <span class="text-xs px-2 py-1 rounded bg-black/30">{{ q.status }}</span>
                      </td>
                      <td class="px-2 py-2">
                        <nuxt-link :to="`/item/${q.libraryItemId}`" class="underline hover:text-gray-200">
                          {{ q.change?.libraryItemTitle || q.libraryItemId }}
                        </nuxt-link>
                      </td>
                      <td class="px-2 py-2 text-xs text-gray-300">{{ formatTime(q.createdAt) }}</td>
                      <td class="px-2 py-2 text-xs text-gray-300">{{ formatTime(q.completedAt) }}</td>
                      <td class="px-2 py-2">
                        <ui-btn
                          v-if="q.status === 'queued'"
                          color="bg-primary"
                          small
                          :loading="completingQueueIds.includes(q.id)"
                          @click="markQueueDone(q.id)"
                        >
                          Mark Done
                        </ui-btn>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <p class="text-xs text-gray-400 mt-2">Open each item link, run manual Match tab full match, then mark it done here.</p>
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
      sessions: [],
      selectedIds: [],
      selectedSessionId: null,
      selectedSession: null,
      duplicateThreshold: 0.79,
      reverting: false,
      revertingAll: false,
      queueingFullMatch: false,
      completingQueueIds: [],
      suppressingGroupKey: null,
      autoRefreshTimer: null
    }
  },
  computed: {
    streamLibraryItem() {
      return this.$store.state.streamLibraryItem
    },
    canRevertAny() {
      return (this.selectedSession?.changes || []).some((row) => row.status === 'updated' && row.revertStatus !== 'reverted')
    },
    canQueueForFullMatch() {
      return (this.selectedSession?.changes || []).some((c) => c.status === 'updated' && c.revertStatus === 'reverted')
    },
    duplicatePayload() {
      return this.selectedSession?.duplicateGroups || {}
    },
    duplicateGroups() {
      return this.duplicatePayload.groups || []
    },
    duplicateGroupCount() {
      return Number(this.duplicatePayload.groupedCount || 0)
    },
    suppressedGroupCount() {
      return Number(this.duplicatePayload.suppressedCount || 0)
    },
    sourceItemsCount() {
      return Number(this.duplicatePayload.sourceItemsCount || 0)
    },
    fullMatchQueue() {
      return this.selectedSession?.fullMatchQueue || []
    }
  },
  methods: {
    formatTime(value) {
      if (!value) return '-'
      return new Date(value).toLocaleString()
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
    groupSelected(group) {
      if (!group?.members?.length) return false
      return group.members.every((member) => this.selectedIds.includes(member.libraryItemId))
    },
    toggleGroupSelected(group, checked) {
      if (!group?.members?.length) return
      group.members.forEach((member) => this.toggleSelected(member.libraryItemId, checked))
    },
    toggleSelected(libraryItemId, checked) {
      if (checked) {
        if (!this.selectedIds.includes(libraryItemId)) this.selectedIds.push(libraryItemId)
      } else {
        this.selectedIds = this.selectedIds.filter((id) => id !== libraryItemId)
      }
    },
    async loadSessions() {
      const payload = await this.$axios.$get('/api/quick-match-sessions').catch((error) => {
        const message = error?.response?.data || 'Failed to load quick match sessions'
        this.$toast.error(message)
        return null
      })
      if (!payload) return

      this.sessions = payload.sessions || []
      const activeSessionId = payload.activeSessionId || null
      if ((!this.selectedSessionId || !this.sessions.some((s) => s.id === this.selectedSessionId)) && this.sessions.length) {
        this.selectedSessionId = this.sessions[0].id
      }
      if (!this.selectedSessionId && activeSessionId) {
        this.selectedSessionId = activeSessionId
      }
      if (this.selectedSessionId) {
        await this.selectSession(this.selectedSessionId)
      } else {
        this.selectedIds = []
        this.selectedSession = null
      }
    },
    async selectSession(sessionId) {
      this.selectedSessionId = sessionId
      this.selectedIds = []
      const payload = await this.$axios
        .$get(`/api/quick-match-sessions/${sessionId}`, {
          params: {
            duplicateThreshold: this.duplicateThreshold
          }
        })
        .catch((error) => {
          const message = error?.response?.data || 'Failed to load session detail'
          this.$toast.error(message)
          return null
        })
      if (!payload) return
      this.selectedSession = payload.session
      if (this.selectedSession?.duplicateGroups?.threshold) {
        this.duplicateThreshold = Number(this.selectedSession.duplicateGroups.threshold)
      }
    },
    async applyThreshold() {
      const next = Number(this.duplicateThreshold)
      if (!Number.isFinite(next)) {
        this.duplicateThreshold = 0.79
      }
      this.duplicateThreshold = Math.max(0.5, Math.min(0.98, Number(this.duplicateThreshold.toFixed(2))))
      if (this.selectedSessionId) {
        await this.selectSession(this.selectedSessionId)
      }
    },
    async markNotDuplicates(group) {
      if (!this.selectedSessionId || !group?.groupKey || !group?.groupFingerprint) return
      this.suppressingGroupKey = group.groupKey
      const payload = await this.$axios
        .$post(
          `/api/quick-match-sessions/${this.selectedSessionId}/duplicates/suppress`,
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

      this.selectedSession = payload.session
      this.selectedIds = this.selectedIds.filter((id) => this.duplicateGroups.some((groupRow) => groupRow.members.some((member) => member.libraryItemId === id)))
      this.$toast.success('Marked as Not Duplicates')
    },
    async revertSelected() {
      if (!this.selectedSessionId || !this.selectedIds.length) return
      this.reverting = true
      const res = await this.$axios
        .$post(`/api/quick-match-sessions/${this.selectedSessionId}/revert`, { libraryItemIds: this.selectedIds })
        .catch((error) => {
          const message = error?.response?.data || 'Failed to revert selected changes'
          this.$toast.error(message)
          return null
        })
      this.reverting = false
      if (res) {
        this.$toast.success(`Reverted ${res.reverted} changes${res.failed ? `, failed ${res.failed}` : ''}`)
        await this.selectSession(this.selectedSessionId)
        await this.loadSessions()
      }
    },
    async revertAll() {
      if (!this.selectedSessionId) return
      this.revertingAll = true
      const res = await this.$axios.$post(`/api/quick-match-sessions/${this.selectedSessionId}/revert`, {}).catch((error) => {
        const message = error?.response?.data || 'Failed to revert all changes'
        this.$toast.error(message)
        return null
      })
      this.revertingAll = false
      if (res) {
        this.$toast.success(`Reverted ${res.reverted} changes${res.failed ? `, failed ${res.failed}` : ''}`)
        await this.selectSession(this.selectedSessionId)
        await this.loadSessions()
      }
    },
    async queueFullMatch() {
      if (!this.selectedSessionId) return
      this.queueingFullMatch = true
      const payload = {}
      if (this.selectedIds.length) payload.libraryItemIds = [...this.selectedIds]
      const res = await this.$axios.$post(`/api/quick-match-sessions/${this.selectedSessionId}/queue-full-match`, payload).catch((error) => {
        const message = error?.response?.data || 'Failed to queue full match'
        this.$toast.error(message)
        return null
      })
      this.queueingFullMatch = false
      if (res) {
        this.$toast.success(`Queued ${res.queued} items${res.skipped ? `, skipped ${res.skipped}` : ''}`)
        await this.selectSession(this.selectedSessionId)
      }
    },
    async markQueueDone(queueId) {
      if (!this.selectedSessionId || !queueId) return
      this.completingQueueIds.push(queueId)
      const res = await this.$axios
        .$post(`/api/quick-match-sessions/${this.selectedSessionId}/full-match-queue/complete`, { queueIds: [queueId] })
        .catch((error) => {
          const message = error?.response?.data || 'Failed to mark queue item done'
          this.$toast.error(message)
          return null
        })
      this.completingQueueIds = this.completingQueueIds.filter((id) => id !== queueId)
      if (res) {
        this.$toast.success(`Completed ${res.completed} queued item${res.completed === 1 ? '' : 's'}`)
        await this.selectSession(this.selectedSessionId)
      }
    },
    startAutoRefresh() {
      if (this.autoRefreshTimer) clearInterval(this.autoRefreshTimer)
      this.autoRefreshTimer = setInterval(() => {
        if (this.reverting || this.revertingAll || this.queueingFullMatch || this.suppressingGroupKey) return
        if (!this.selectedSessionId) return
        this.selectSession(this.selectedSessionId)
      }, 15000)
    }
  },
  mounted() {
    this.loadSessions()
    this.startAutoRefresh()
  },
  beforeDestroy() {
    if (this.autoRefreshTimer) clearInterval(this.autoRefreshTimer)
    this.autoRefreshTimer = null
  }
}
</script>
