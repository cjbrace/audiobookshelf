<template>
  <div class="page relative" :class="streamLibraryItem ? 'streaming' : ''">
    <app-book-shelf-toolbar is-home />
    <div id="bookshelf" class="w-full h-full px-2 py-4 md:p-8 relative overflow-y-auto">
      <div class="w-full max-w-7xl mx-auto">
        <div class="flex items-center gap-2 mb-3">
          <h1 class="text-2xl font-semibold">Quick Match Sessions</h1>
          <div class="grow" />
          <ui-btn color="bg-primary" small :loading="startingSession" @click="startSession">Start Session</ui-btn>
          <ui-btn color="bg-warning" small :loading="stoppingSession" :disabled="!activeSessionId" @click="stopSession">Stop Session</ui-btn>
          <ui-btn color="bg-bg border border-white/20" small @click="loadSessions">Refresh</ui-btn>
        </div>

        <p class="text-sm text-gray-300 mb-6">
          Run Quick Match normally. Any changes while a session is running are captured here and can be reverted.
        </p>

        <div class="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div class="bg-primary/20 rounded-lg p-3 border border-primary/40">
            <h2 class="text-lg mb-2">Recent Sessions</h2>
            <div class="space-y-2 max-h-[60vh] overflow-y-auto pr-1">
              <button
                v-for="session in sessions"
                :key="session.id"
                type="button"
                class="w-full text-left px-3 py-2 rounded border"
                :class="selectedSessionId === session.id ? 'bg-primary/70 border-yellow-400/70' : 'bg-black/20 border-white/10 hover:border-white/30'"
                @click="selectSession(session.id)"
              >
                <div class="flex items-center">
                  <p class="text-sm font-semibold">{{ formatStatus(session.status) }}</p>
                  <div class="grow" />
                  <p class="text-xs text-gray-300">{{ formatTime(session.startedAt) }}</p>
                </div>
                <p class="text-xs text-gray-300 mt-1">By {{ session.startedByUser?.username || 'unknown' }}</p>
                <p class="text-xs text-gray-200 mt-1">
                  {{ session.stats?.totalChanges || 0 }} changes
                  · {{ session.stats?.updatedChanges || 0 }} updated
                  · {{ session.stats?.revertedChanges || 0 }} reverted
                </p>
              </button>
            </div>
          </div>

          <div class="lg:col-span-2 bg-primary/20 rounded-lg p-3 border border-primary/40">
            <div v-if="!selectedSession" class="text-sm text-gray-300">Select a session to view changes.</div>
            <template v-else>
              <div class="flex items-center gap-2 mb-3">
                <h2 class="text-lg">Session {{ selectedSession.id }}</h2>
                <span class="text-xs px-2 py-1 rounded bg-black/30">{{ formatStatus(selectedSession.status) }}</span>
                <div class="grow" />
                <ui-btn color="bg-success" small :disabled="!canQueueForFullMatch || queueingFullMatch" :loading="queueingFullMatch" @click="queueFullMatch">
                  Queue Full Match (Reverted)
                </ui-btn>
                <ui-btn color="bg-error" small :disabled="!selectedIds.length || reverting" :loading="reverting" @click="revertSelected">Revert Selected</ui-btn>
                <ui-btn color="bg-error/70" small :disabled="!canRevertAny || revertingAll" :loading="revertingAll" @click="revertAll">Revert All</ui-btn>
              </div>

              <div class="text-xs text-gray-300 mb-2">
                Started: {{ formatTime(selectedSession.startedAt) }} | Ended: {{ formatTime(selectedSession.endedAt) }}
              </div>

              <div class="overflow-auto max-h-[60vh] border border-white/15 rounded">
                <table class="w-full text-sm">
                  <thead class="bg-black/30 sticky top-0">
                    <tr>
                      <th class="text-left px-2 py-2 w-8"></th>
                      <th class="text-left px-2 py-2">Status</th>
                      <th class="text-left px-2 py-2">Book</th>
                      <th class="text-left px-2 py-2">When</th>
                      <th class="text-left px-2 py-2">Warning/Error</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="change in selectedSession.changes || []" :key="change.id" class="border-t border-white/10">
                      <td class="px-2 py-2">
                        <input
                          v-if="change.status === 'updated' && change.revertStatus !== 'reverted'"
                          :value="change.libraryItemId"
                          type="checkbox"
                          @change="toggleSelected(change.libraryItemId, $event.target.checked)"
                        />
                      </td>
                      <td class="px-2 py-2">
                        <span class="text-xs px-2 py-1 rounded bg-black/30">
                          {{ change.status }}{{ change.revertStatus === 'reverted' ? ' (reverted)' : '' }}
                        </span>
                      </td>
                      <td class="px-2 py-2">
                        <nuxt-link :to="`/item/${change.libraryItemId}`" class="underline hover:text-gray-200">
                          {{ change.libraryItemTitle || change.libraryItemId }}
                        </nuxt-link>
                      </td>
                      <td class="px-2 py-2 text-xs text-gray-300">{{ formatTime(change.createdAt) }}</td>
                      <td class="px-2 py-2 text-xs text-gray-300">{{ change.warningText || change.errorText || '-' }}</td>
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
      activeSessionId: null,
      selectedSessionId: null,
      selectedSession: null,
      selectedIds: [],
      startingSession: false,
      stoppingSession: false,
      reverting: false,
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
      return (this.selectedSession?.changes || []).some((c) => c.status === 'updated' && c.revertStatus !== 'reverted')
    },
    canQueueForFullMatch() {
      return (this.selectedSession?.changes || []).some((c) => c.status === 'updated' && c.revertStatus === 'reverted')
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
    formatStatus(status) {
      if (!status) return 'Unknown'
      return status.charAt(0).toUpperCase() + status.slice(1)
    },
    async loadSessions() {
      const payload = await this.$axios.$get('/api/quick-match-sessions').catch((error) => {
        const message = error?.response?.data || 'Failed to load quick match sessions'
        this.$toast.error(message)
        return null
      })
      if (!payload) return
      this.sessions = payload.sessions || []
      this.activeSessionId = payload.activeSessionId || null
      if (!this.selectedSessionId && this.sessions.length) {
        this.selectedSessionId = this.sessions[0].id
      }
      if (this.selectedSessionId) {
        await this.selectSession(this.selectedSessionId)
      }
    },
    async selectSession(sessionId) {
      this.selectedSessionId = sessionId
      this.selectedIds = []
      const payload = await this.$axios.$get(`/api/quick-match-sessions/${sessionId}`).catch((error) => {
        const message = error?.response?.data || 'Failed to load session detail'
        this.$toast.error(message)
        return null
      })
      if (!payload) return
      this.selectedSession = payload.session
    },
    toggleSelected(libraryItemId, checked) {
      if (checked) {
        if (!this.selectedIds.includes(libraryItemId)) this.selectedIds.push(libraryItemId)
      } else {
        this.selectedIds = this.selectedIds.filter((id) => id !== libraryItemId)
      }
    },
    async startSession() {
      this.startingSession = true
      await this.$axios.$post('/api/quick-match-sessions/start', {}).catch((error) => {
        const message = error?.response?.data || 'Failed to start session'
        this.$toast.error(message)
      })
      this.startingSession = false
      await this.loadSessions()
    },
    async stopSession() {
      this.stoppingSession = true
      await this.$axios.$post('/api/quick-match-sessions/stop', {}).catch((error) => {
        const message = error?.response?.data || 'Failed to stop session'
        this.$toast.error(message)
      })
      this.stoppingSession = false
      await this.loadSessions()
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
    }
  },
  mounted() {
    this.loadSessions()
  }
}
</script>
