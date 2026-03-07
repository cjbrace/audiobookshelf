<template>
  <div class="bg-bg rounded-md shadow-lg border border-white/5 p-4 mb-8 relative" style="min-height: 200px">
    <div class="flex items-center mb-4">
      <nuxt-link to="/config/item-metadata-utils" class="w-8 h-8 flex items-center justify-center rounded-full cursor-pointer hover:bg-white/10 text-center">
        <span class="material-symbols text-2xl">arrow_back</span>
      </nuxt-link>
      <h1 class="text-xl mx-2">Manage Issue Categories</h1>
    </div>

    <div class="flex items-center gap-2 mb-4">
      <ui-text-input v-model="newCategory" placeholder="New issue category (example: bad-match)" />
      <ui-btn color="bg-success" small @click="addCategory">Add</ui-btn>
    </div>

    <p class="text-xs text-gray-400 mb-4">These appear in Library Filter - DB Issues. ABS matches them against tags like issue:&lt;name&gt;.</p>

    <p v-if="!issueCategories.length" class="text-center py-8 text-lg text-gray-300">No issue categories configured</p>

    <div class="border border-white/10">
      <template v-for="(category, index) in issueCategories">
        <div :key="category" class="w-full p-2 flex items-center text-gray-400 hover:text-white" :class="{ 'bg-primary/20': index % 2 === 0 }">
          <p v-if="editingCategory !== category" class="text-sm md:text-base text-gray-100">{{ category }}</p>
          <ui-text-input v-else v-model="editingValue" />
          <div class="grow" />
          <template v-if="editingCategory !== category">
            <ui-icon-btn icon="edit" borderless :size="8" icon-font-size="1.1rem" class="mx-1" @click="startEdit(category)" />
            <ui-icon-btn icon="delete" borderless :size="8" icon-font-size="1.1rem" @click="removeCategory(category)" />
          </template>
          <template v-else>
            <ui-btn color="bg-success" small class="mx-2" @click.stop="saveEdit">Save</ui-btn>
            <ui-btn small @click.stop="cancelEdit">Cancel</ui-btn>
          </template>
        </div>
      </template>
    </div>
  </div>
</template>

<script>
export default {
  asyncData({ store, redirect }) {
    if (!store.getters['user/getIsAdminOrUp']) {
      redirect('/')
    }
  },
  data() {
    return {
      newCategory: '',
      editingCategory: null,
      editingValue: ''
    }
  },
  computed: {
    issueCategories() {
      return this.$store.getters['user/getUserSetting']('issueCategories') || []
    }
  },
  methods: {
    normalizeCategory(value) {
      return String(value || '')
        .trim()
        .replace(/^issue:/i, '')
    },
    updateCategories(categories) {
      const normalized = [...new Set(categories.map((c) => this.normalizeCategory(c)).filter((c) => !!c))]
      this.$store.dispatch('user/updateUserSettings', { issueCategories: normalized })
    },
    addCategory() {
      const category = this.normalizeCategory(this.newCategory)
      if (!category) return
      if (this.issueCategories.includes(category)) {
        this.newCategory = ''
        return
      }
      this.updateCategories([...this.issueCategories, category])
      this.newCategory = ''
    },
    removeCategory(category) {
      this.updateCategories(this.issueCategories.filter((c) => c !== category))
    },
    startEdit(category) {
      this.editingCategory = category
      this.editingValue = category
    },
    cancelEdit() {
      this.editingCategory = null
      this.editingValue = ''
    },
    saveEdit() {
      if (!this.editingCategory) return
      const newValue = this.normalizeCategory(this.editingValue)
      if (!newValue) return
      const updated = this.issueCategories.map((c) => (c === this.editingCategory ? newValue : c))
      this.updateCategories(updated)
      this.cancelEdit()
    }
  }
}
</script>
