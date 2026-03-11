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
          <ui-btn color="bg-red-700 hover:bg-red-600" small :disabled="!doneGroupCount || !sessionId" :loading="processingDoneGroups" @click="processDoneGroups">
            Process Done ({{ doneGroupCount }})
          </ui-btn>
          <ui-btn color="bg-bg border border-white/20" small :loading="refreshing" @click="refreshDuplicates">Refresh Results</ui-btn>
        </div>

        <p class="text-base text-gray-300 mb-4">
          Fuzzy duplicate grouping uses title + author. Series is assist-only. Results are cached locally until you run Evaluate/Refresh.
        </p>

        <div class="bg-primary/20 rounded-lg p-3 border border-primary/40 mb-4 text-sm text-gray-200">
          <div class="flex flex-wrap gap-x-4 gap-y-1">
            <span>Scope: Current library</span>
            <span>Books scanned: {{ sourceItemsCount }}</span>
            <span>Groups: {{ duplicateGroupCount }}</span>
            <span>Suppressed: {{ suppressedGroupCount }}</span>
            <span v-if="lastEvaluatedAt">Last evaluated: {{ formatTime(lastEvaluatedAt) }}</span>
            <span v-if="loadedFromCache" class="text-blue-200">Showing cached results</span>
          </div>
          <div v-if="lastReasonText" class="mt-2 text-gray-300">{{ lastReasonText }}</div>
        </div>

        <div class="bg-primary/20 rounded-lg p-3 border border-primary/40">
          <div v-if="!evaluatedOnce" class="text-base text-gray-200">
            Duplicate discovery has not run yet for this screen. Click <span class="font-semibold">Evaluate Duplicates</span> to scan the current library.
          </div>

          <template v-else>
            <div v-if="!duplicateGroups.length" class="text-base text-gray-200">
              <p>No duplicate groups found for this run.</p>
              <p class="text-sm text-gray-300 mt-1">Try lowering the threshold, then click Evaluate Duplicates again.</p>
            </div>

            <div v-else class="overflow-auto max-h-[68vh] border border-white/15 rounded">
              <table class="w-full text-base table-fixed">
                <thead class="bg-black/30 sticky top-0">
                  <tr>
                    <th class="text-left px-3 py-2 w-56">Group</th>
                    <th class="text-left px-3 py-2">Books</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="group in duplicateGroups" :key="group.groupKey + group.groupFingerprint" class="border-t border-white/10 align-top">
                    <td class="px-3 py-3">
                      <div class="text-sm text-gray-200">{{ group.size }} items</div>
                      <div class="text-lg font-semibold truncate" :title="group.titleHint || '-'">{{ group.titleHint || '-' }}</div>
                      <div class="text-base text-gray-200 truncate" :title="group.authorHint || '-'">{{ group.authorHint || '-' }}</div>
                      <div class="text-sm text-gray-200 mt-1">Score {{ formatScore(group.score) }}</div>
                      <div class="mt-2 flex flex-wrap items-center gap-1.5">
                        <ui-btn color="bg-bg border border-white/20" small :loading="suppressingGroupKey === group.groupKey" @click="markNotDuplicates(group)">
                          Not Duplicates
                        </ui-btn>
                        <ui-btn color="bg-yellow-700 hover:bg-yellow-600" small :loading="isProcessingGroup(group)" @click="processGroup(group)">
                          Process
                        </ui-btn>
                        <ui-btn :color="isGroupDone(group) ? 'bg-error' : 'bg-success'" small @click="toggleGroupDone(group)">
                          {{ isGroupDone(group) ? 'Done (Active)' : 'Done' }}
                        </ui-btn>
                      </div>
                    </td>
                    <td class="px-3 py-3">
                      <div class="grid grid-cols-1 lg:grid-cols-2 2xl:grid-cols-3 gap-3">
                        <div
                          v-for="member in group.members"
                          :key="member.libraryItemId"
                          class="border rounded p-3"
                          :class="isEditedMember(member.libraryItemId) ? 'bg-yellow-900/25 border-yellow-500/60' : 'bg-black/20 border-white/10'"
                        >
                          <div class="flex gap-3 items-start">
                            <nuxt-link :to="`/item/${member.libraryItemId}`" class="w-20 h-20 rounded overflow-hidden bg-black/40 border border-white/10 shrink-0">
                              <img :src="getCoverSrc(member)" :alt="member.title || 'cover'" class="w-full h-full object-cover" />
                            </nuxt-link>
                            <div class="min-w-0 w-full">
                              <nuxt-link :to="`/item/${member.libraryItemId}`" class="block text-lg font-semibold truncate hover:underline" :title="member.title || '-'">
                                {{ member.title || '-' }}
                              </nuxt-link>
                              <p class="text-base text-gray-200 truncate" :title="member.author || '-'">{{ member.author || '-' }}</p>
                              <p class="text-base text-gray-300 truncate" :title="member.series || '-'">{{ member.series || '-' }}</p>
                              <p class="text-sm text-gray-300 truncate mt-0.5" :title="pendingPathSuffix(member)">{{ pendingPathSuffix(member) }}</p>
                            </div>
                          </div>
                          <div class="mt-2 flex items-center gap-1.5">
                            <ui-btn small color="bg-success/80" @click="playMember(member)">
                              <span class="material-symbols text-lg">play_arrow</span>
                            </ui-btn>
                            <ui-btn small color="bg-warning/70" @click="editMember(member)">
                              <span class="material-symbols text-lg">edit</span>
                            </ui-btn>
                            <ui-btn small color="bg-bg border border-white/20" @click="toggleSelectMember(member)">
                              <span class="material-symbols text-lg">{{ isSelected(member.libraryItemId) ? 'radio_button_checked' : 'radio_button_unchecked' }}</span>
                            </ui-btn>
                            <ui-btn small color="bg-bg border border-white/20" @click="$router.push(`/item/${member.libraryItemId}`)">
                              <span class="material-symbols text-lg">open_in_new</span>
                            </ui-btn>
                            <ui-context-menu-dropdown :items="memberMenuItems(member)" @action="memberMenuAction(member, $event)" />
                          </div>
                        </div>
                      </div>
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
      processingDoneGroups: false,
      evaluatedOnce: false,
      lastEvaluatedAt: null,
      lastReason: '',
      loadedFromCache: false,
      libraryItemCache: {},
      doneGroupState: {},
      editedMemberState: {},
      processingGroupState: {}
    }
  },
  computed: {
    streamLibraryItem() {
      return this.$store.state.streamLibraryItem
    },
    selectedMediaItems() {
      return this.$store.state.globals.selectedMediaItems || []
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
    doneGroupCount() {
      return this.duplicateGroups.filter((group) => this.isGroupDone(group)).length
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
    cacheKey() {
      return `abs-duplicates-cache:${this.$route.params.library}`
    },
    formatTime(value) {
      if (!value) return '-'
      return new Date(value).toLocaleString()
    },
    formatScore(value) {
      const score = Number(value)
      if (!Number.isFinite(score)) return '-'
      return score.toFixed(2)
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
    pendingPathSuffix(member) {
      const normalized = String(member?.relPath || '')
        .replace(/\\/g, '/')
        .trim()
      if (!normalized) return '-'
      const lower = normalized.toLowerCase()
      const marker = '/.pending/'
      const markerIndex = lower.indexOf(marker)
      if (markerIndex !== -1) {
        return normalized.slice(markerIndex + marker.length) || '-'
      }
      if (lower.startsWith('.pending/')) return normalized.slice('.pending/'.length) || '-'
      return normalized
    },
    loadCachedEvaluation() {
      if (!process.client) return
      const raw = localStorage.getItem(this.cacheKey())
      if (!raw) return
      try {
        const cached = JSON.parse(raw)
        this.duplicateThreshold = Number(cached.duplicateThreshold || this.duplicateThreshold)
        this.sessionId = cached.sessionId || null
        this.duplicatePayload = cached.duplicatePayload || null
        this.lastEvaluatedAt = cached.lastEvaluatedAt || null
        this.lastReason = cached.lastReason || ''
        this.evaluatedOnce = !!cached.evaluatedOnce
        this.doneGroupState = cached.doneGroupState && typeof cached.doneGroupState === 'object' ? cached.doneGroupState : {}
        this.editedMemberState = cached.editedMemberState && typeof cached.editedMemberState === 'object' ? cached.editedMemberState : {}
        this.loadedFromCache = true
      } catch (error) {
        console.error('[duplicates] Failed to load cached results', error)
      }
    },
    persistCachedEvaluation() {
      if (!process.client) return
      const payload = {
        duplicateThreshold: this.duplicateThreshold,
        sessionId: this.sessionId,
        duplicatePayload: this.duplicatePayload,
        lastEvaluatedAt: this.lastEvaluatedAt,
        lastReason: this.lastReason,
        evaluatedOnce: this.evaluatedOnce,
        doneGroupState: this.doneGroupState,
        editedMemberState: this.editedMemberState
      }
      localStorage.setItem(this.cacheKey(), JSON.stringify(payload))
    },
    groupStateKey(group) {
      return `${group?.groupKey || ''}||${group?.groupFingerprint || ''}`
    },
    isGroupDone(group) {
      return !!this.doneGroupState[this.groupStateKey(group)]
    },
    toggleGroupDone(group) {
      const key = this.groupStateKey(group)
      if (!key) return
      if (this.doneGroupState[key]) {
        this.$delete(this.doneGroupState, key)
      } else {
        this.$set(this.doneGroupState, key, true)
      }
      this.persistCachedEvaluation()
    },
    isProcessingGroup(group) {
      return !!this.processingGroupState[this.groupStateKey(group)]
    },
    isEditedMember(libraryItemId) {
      return !!this.editedMemberState[libraryItemId]
    },
    markMemberEdited(libraryItemId) {
      if (!libraryItemId || this.editedMemberState[libraryItemId]) return
      this.$set(this.editedMemberState, libraryItemId, true)
      this.persistCachedEvaluation()
    },
    normalizeGroupForDisplay(group) {
      const members = Array.isArray(group?.members) ? group.members : []
      return {
        ...group,
        size: members.length,
        titleHint: members[0]?.title || group?.titleHint || '',
        authorHint: members[0]?.author || group?.authorHint || ''
      }
    },
    applyGroups(nextGroups) {
      const groups = Array.isArray(nextGroups) ? nextGroups.map((group) => this.normalizeGroupForDisplay(group)).filter((group) => group.size > 1) : []
      this.duplicatePayload = {
        ...(this.duplicatePayload || {}),
        groups,
        groupedCount: groups.length
      }
      this.persistCachedEvaluation()
    },
    replaceProcessedGroup(existingGroup, replacementGroups) {
      const currentGroups = Array.isArray(this.duplicateGroups) ? [...this.duplicateGroups] : []
      const existingKey = this.groupStateKey(existingGroup)
      const existingIndex = currentGroups.findIndex((group) => this.groupStateKey(group) === existingKey)
      if (existingIndex === -1) return

      const normalizedReplacements = Array.isArray(replacementGroups) ? replacementGroups.map((group) => this.normalizeGroupForDisplay(group)).filter((group) => group.size > 1) : []
      currentGroups.splice(existingIndex, 1, ...normalizedReplacements)
      this.applyGroups(currentGroups)

      if (this.doneGroupState[existingKey]) {
        this.$delete(this.doneGroupState, existingKey)
      }
    },
    removeGroup(group) {
      const key = this.groupStateKey(group)
      const currentGroups = Array.isArray(this.duplicateGroups) ? this.duplicateGroups.filter((entry) => this.groupStateKey(entry) !== key) : []
      this.applyGroups(currentGroups)
      if (this.doneGroupState[key]) {
        this.$delete(this.doneGroupState, key)
      }
    },
    removeMemberFromVisibleGroups(libraryItemId) {
      if (!libraryItemId) return
      const nextGroups = (Array.isArray(this.duplicateGroups) ? this.duplicateGroups : [])
        .map((group) => ({
          ...group,
          members: (Array.isArray(group.members) ? group.members : []).filter((member) => member.libraryItemId !== libraryItemId)
        }))
        .map((group) => this.normalizeGroupForDisplay(group))
        .filter((group) => group.size > 1)
      this.applyGroups(nextGroups)
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
      this.loadedFromCache = false
      this.persistCachedEvaluation()
    },
    async refreshDuplicates() {
      this.refreshing = true
      await this.evaluateDuplicates()
      this.refreshing = false
    },
    isSelected(libraryItemId) {
      return this.selectedMediaItems.some((item) => item.id === libraryItemId)
    },
    buildSelectedStub(member) {
      return {
        id: member.libraryItemId,
        libraryId: this.$route.params.library,
        mediaType: 'book',
        isMissing: false,
        isInvalid: false,
        hasTracks: true,
        media: {
          metadata: {
            title: member.title || '',
            authorName: member.author || ''
          },
          coverPath: member.coverPath || null,
          numTracks: 1
        }
      }
    },
    async fetchLibraryItem(libraryItemId) {
      if (!libraryItemId) return null
      if (this.libraryItemCache[libraryItemId]) return this.libraryItemCache[libraryItemId]
      const item = await this.$axios.$get(`/api/items/${libraryItemId}`).catch((error) => {
        const message = error?.response?.data || 'Failed to load item'
        this.$toast.error(message)
        return null
      })
      if (item) {
        this.$set(this.libraryItemCache, libraryItemId, item)
      }
      return item
    },
    playMember(member) {
      this.$eventBus.$emit('play-item', {
        libraryItemId: member.libraryItemId
      })
    },
    async editMember(member, tab = 'details') {
      const item = await this.fetchLibraryItem(member.libraryItemId)
      if (!item) return
      this.$store.commit('showEditModalOnTab', { libraryItem: item, tab })
    },
    toggleSelectMember(member) {
      const item = this.libraryItemCache[member.libraryItemId] || this.buildSelectedStub(member)
      this.$store.commit('globals/addRemoveSelectedMediaItem', item)
    },
    memberMenuItems(member) {
      return [
        { text: 'Open Item', action: 'open' },
        { text: 'Play', action: 'play' },
        { text: 'Edit Details', action: 'edit-details' },
        { text: 'Edit Match', action: 'edit-match' },
        { text: 'Delete', action: 'delete' },
        { text: this.isSelected(member.libraryItemId) ? 'Unselect' : 'Select', action: 'select' }
      ]
    },
    async memberMenuAction(member, { action }) {
      if (action === 'open') return this.$router.push(`/item/${member.libraryItemId}`)
      if (action === 'play') return this.playMember(member)
      if (action === 'edit-details') return this.editMember(member, 'details')
      if (action === 'edit-match') return this.editMember(member, 'match')
      if (action === 'delete') return this.deleteMember(member)
      if (action === 'select') return this.toggleSelectMember(member)
    },
    deleteMember(member) {
      const payload = {
        message: this.$strings.MessageConfirmDeleteLibraryItem,
        checkboxLabel: this.$strings.LabelDeleteFromFileSystemCheckbox,
        yesButtonText: this.$strings.ButtonDelete,
        yesButtonColor: 'error',
        checkboxDefaultValue: !Number(localStorage.getItem('softDeleteDefault') || 0),
        callback: async (confirmed, hardDelete) => {
          if (!confirmed) return
          localStorage.setItem('softDeleteDefault', hardDelete ? 0 : 1)
          await this.$axios
            .$delete(`/api/items/${member.libraryItemId}?hard=${hardDelete ? 1 : 0}`)
            .then(() => {
              this.removeMemberFromVisibleGroups(member.libraryItemId)
              this.$toast.success(this.$strings.ToastItemDeletedSuccess)
            })
            .catch((error) => {
              console.error('Failed to delete item', error)
              this.$toast.error(this.$strings.ToastItemDeletedFailed)
            })
        },
        type: 'yesNo'
      }
      this.$store.commit('globals/setConfirmPrompt', payload)
    },
    isGroupMember(libraryItemId) {
      if (!libraryItemId) return false
      return this.duplicateGroups.some((group) => (group.members || []).some((member) => member.libraryItemId === libraryItemId))
    },
    onLibraryItemUpdated(item) {
      if (!this.isGroupMember(item?.id)) return
      this.markMemberEdited(item.id)
    },
    onLibraryItemRemoved(item) {
      if (!this.isGroupMember(item?.id)) return
      this.removeMemberFromVisibleGroups(item.id)
    },
    async processGroup(group) {
      if (!this.sessionId) {
        this.$toast.error('Run Evaluate Duplicates before processing groups')
        return
      }
      const stateKey = this.groupStateKey(group)
      const libraryItemIds = (Array.isArray(group?.members) ? group.members : []).map((member) => member.libraryItemId).filter((id) => !!id)
      if (!libraryItemIds.length) return

      this.$set(this.processingGroupState, stateKey, true)
      const payload = await this.$axios
        .$post(
          `/api/quick-match-sessions/${this.sessionId}/duplicates/process-group`,
          {
            token: stateKey,
            libraryItemIds
          },
          {
            params: {
              duplicateThreshold: this.duplicateThreshold
            }
          }
        )
        .catch((error) => {
          const message = error?.response?.data || 'Failed to process group'
          this.$toast.error(message)
          return null
        })
      this.$delete(this.processingGroupState, stateKey)
      if (!payload?.processedTarget) return

      this.replaceProcessedGroup(group, payload.processedTarget.duplicateGroups?.groups || [])
      this.$toast.success('Processed group')
    },
    async processDoneGroups() {
      if (!this.sessionId) {
        this.$toast.error('Run Evaluate Duplicates before processing groups')
        return
      }
      const doneTargets = this.duplicateGroups
        .filter((group) => this.isGroupDone(group))
        .map((group) => ({
          key: this.groupStateKey(group),
          group,
          token: this.groupStateKey(group),
          libraryItemIds: (Array.isArray(group.members) ? group.members : []).map((member) => member.libraryItemId).filter((id) => !!id)
        }))
        .filter((target) => target.libraryItemIds.length > 0)
      if (!doneTargets.length) {
        this.$toast.info('No Done groups to process')
        return
      }

      this.processingDoneGroups = true
      const payload = await this.$axios
        .$post(
          `/api/quick-match-sessions/${this.sessionId}/duplicates/process-done`,
          {
            targets: doneTargets.map((target) => ({
              token: target.token,
              libraryItemIds: target.libraryItemIds
            }))
          },
          {
            params: {
              duplicateThreshold: this.duplicateThreshold
            }
          }
        )
        .catch((error) => {
          const message = error?.response?.data || 'Failed to process done groups'
          this.$toast.error(message)
          return null
        })
      this.processingDoneGroups = false
      if (!payload?.processedTargets?.length) return

      const targetByKey = doneTargets.reduce((acc, target) => {
        acc[target.key] = target
        return acc
      }, {})
      payload.processedTargets.forEach((processedTarget) => {
        const target = targetByKey[processedTarget.token]
        if (!target) return
        this.replaceProcessedGroup(target.group, processedTarget.duplicateGroups?.groups || [])
      })

      doneTargets.forEach((target) => {
        if (this.doneGroupState[target.key]) {
          this.$delete(this.doneGroupState, target.key)
        }
      })
      this.persistCachedEvaluation()
      this.$toast.success('Processed Done groups')
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

      this.removeGroup(group)
      this.duplicatePayload = {
        ...(this.duplicatePayload || {}),
        suppressedCount: this.suppressedGroupCount + 1
      }
      this.persistCachedEvaluation()
      this.$toast.success('Marked as Not Duplicates')
    }
  },
  mounted() {
    this.loadCachedEvaluation()
    this.$root?.socket?.on('item_updated', this.onLibraryItemUpdated)
    this.$root?.socket?.on('item_removed', this.onLibraryItemRemoved)
  },
  beforeDestroy() {
    this.$root?.socket?.off('item_updated', this.onLibraryItemUpdated)
    this.$root?.socket?.off('item_removed', this.onLibraryItemRemoved)
  }
}
</script>
