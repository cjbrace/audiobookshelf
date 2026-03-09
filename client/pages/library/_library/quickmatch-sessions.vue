<template>
  <div class="page relative" :class="streamLibraryItem ? 'streaming' : ''">
    <app-book-shelf-toolbar is-home />
    <div id="bookshelf" class="w-full h-full px-2 py-4 md:p-8 relative overflow-y-auto">
      <div class="w-full max-w-7xl mx-auto">
        <div class="flex items-center gap-2 mb-3">
          <h1 class="text-2xl font-semibold">Quick Match Sessions</h1>
          <div class="grow" />
          <ui-btn color="bg-bg border border-white/20" small @click="loadSessions">Refresh</ui-btn>
        </div>

        <p class="text-sm text-gray-300 mb-6">
          Run Quick Match normally. Any changes while a session is running are captured here and can be reverted.
        </p>

        <div class="bg-primary/20 rounded-lg p-3 border border-primary/40">
          <div v-if="!selectedSession" class="text-sm text-gray-300">No quick match session data available.</div>
          <template v-else>
            <div class="flex items-center gap-2 mb-3">
              <div class="grow" />
              <ui-btn color="bg-success" small :disabled="!canQueueForFullMatch || queueingFullMatch" :loading="queueingFullMatch" @click="queueFullMatch">
                Queue Full Match (Reverted)
              </ui-btn>
              <ui-btn color="bg-error/70" small :disabled="!canRevertAny || revertingAll" :loading="revertingAll" @click="revertAll">Revert All</ui-btn>
            </div>

            <div class="overflow-auto max-h-[60vh] border border-white/15 rounded">
              <table class="w-full text-sm table-fixed">
                <thead class="bg-black/30 sticky top-0">
                  <tr>
                    <th class="text-left px-2 py-2">Original Title</th>
                    <th class="text-left px-2 py-2">Original Author</th>
                    <th class="text-left px-2 py-2">Original Series</th>
                    <th class="text-left px-2 py-2">New Title</th>
                    <th class="text-left px-2 py-2">New Author</th>
                    <th class="text-left px-2 py-2">New Series</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="row in changedSessionRows" :key="row.id" class="border-t border-white/10">
                    <td class="px-2 py-2">
                      <div class="truncate" :title="row.originalTitle || '-'">{{ row.originalTitle || '-' }}</div>
                    </td>
                    <td class="px-2 py-2">
                      <div class="truncate" :title="row.originalAuthor || '-'">{{ row.originalAuthor || '-' }}</div>
                    </td>
                    <td class="px-2 py-2">
                      <div class="truncate" :title="row.originalSeries || '-'">{{ row.originalSeries || '-' }}</div>
                    </td>
                    <td class="px-2 py-2">
                      <div class="truncate" :title="row.newTitle || '-'">{{ row.newTitle || '-' }}</div>
                    </td>
                    <td class="px-2 py-2">
                      <div class="truncate" :title="row.newAuthor || '-'">{{ row.newAuthor || '-' }}</div>
                    </td>
                    <td class="px-2 py-2">
                      <div class="truncate" :title="row.newSeries || '-'">{{ row.newSeries || '-' }}</div>
                    </td>
                  </tr>
                  <tr v-if="!changedSessionRows.length" class="border-t border-white/10">
                    <td colspan="6" class="px-2 py-3 text-xs text-gray-300">No changed rows found in the current session.</td>
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
      selectedSessionId: null,
      selectedSession: null,
      revertingAll: false,
      queueingFullMatch: false,
      completingQueueIds: []
    }
  },
  computed: {
    streamLibraryItem() {
      return this.$store.state.streamLibraryItem
    },
    canRevertAny() {
      return this.changedSessionRows.some((row) => !row.isReverted)
    },
    canQueueForFullMatch() {
      return (this.selectedSession?.changes || []).some((c) => c.status === 'updated' && c.revertStatus === 'reverted')
    },
    changedSessionRows() {
      return (this.selectedSession?.changes || [])
        .map((change) => this.mapChangeRow(change))
        .filter((row) => row.hasChange)
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
    normalizeText(value) {
      return String(value || '').trim()
    },
    extractTitleText(snapshot) {
      return this.normalizeText(snapshot?.metadata?.title || snapshot?.title)
    },
    extractAuthorText(snapshot) {
      const authors = snapshot?.metadata?.authors
      if (!Array.isArray(authors)) return ''
      return authors
        .map((a) => (typeof a === 'string' ? a : a?.name))
        .map((a) => this.normalizeText(a))
        .filter((a) => !!a)
        .join(', ')
    },
    extractSeriesText(snapshot) {
      const series = snapshot?.metadata?.series
      if (!Array.isArray(series)) return ''
      return series
        .map((entry) => {
          const name = this.normalizeText(typeof entry === 'string' ? entry : entry?.name)
          if (!name) return ''
          const sequence = this.normalizeText(typeof entry === 'string' ? '' : entry?.sequence)
          return sequence ? `${name} #${sequence}` : name
        })
        .filter((value) => !!value)
        .join(', ')
    },
    mapChangeRow(change) {
      const originalTitle = this.extractTitleText(change?.beforeData)
      const originalAuthor = this.extractAuthorText(change?.beforeData)
      const originalSeries = this.extractSeriesText(change?.beforeData)
      const newTitle = this.extractTitleText(change?.afterData)
      const newAuthor = this.extractAuthorText(change?.afterData)
      const newSeries = this.extractSeriesText(change?.afterData)
      const hasChange = originalTitle !== newTitle || originalAuthor !== newAuthor || originalSeries !== newSeries
      return {
        id: change?.id,
        isReverted: change?.revertStatus === 'reverted',
        originalTitle,
        originalAuthor,
        originalSeries,
        newTitle,
        newAuthor,
        newSeries,
        hasChange
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
      if ((!this.selectedSessionId || !this.sessions.some((s) => s.id === this.selectedSessionId)) && this.sessions.length) {
        this.selectedSessionId = this.sessions[0].id
      }
      if (this.selectedSessionId) {
        await this.selectSession(this.selectedSessionId)
      } else {
        this.selectedSession = null
      }
    },
    async selectSession(sessionId) {
      this.selectedSessionId = sessionId
      const payload = await this.$axios.$get(`/api/quick-match-sessions/${sessionId}`).catch((error) => {
        const message = error?.response?.data || 'Failed to load session detail'
        this.$toast.error(message)
        return null
      })
      if (!payload) return
      this.selectedSession = payload.session
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
      const res = await this.$axios.$post(`/api/quick-match-sessions/${this.selectedSessionId}/queue-full-match`, {}).catch((error) => {
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
    }
  },
  mounted() {
    this.loadSessions()
  }
}
</script>
