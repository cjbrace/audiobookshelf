<template>
  <div class="bg-bg rounded-md shadow-lg border border-white/5 p-4 mb-8 relative" style="min-height: 200px">
    <div class="flex items-center mb-4">
      <nuxt-link to="/config/item-metadata-utils" class="w-8 h-8 flex items-center justify-center rounded-full cursor-pointer hover:bg-white/10 text-center">
        <span class="material-symbols text-2xl">arrow_back</span>
      </nuxt-link>
      <h1 class="text-xl mx-2">Manage Spec Catagories</h1>
    </div>

    <div class="flex items-center gap-2 mb-4">
      <ui-text-input v-model="newCategory" placeholder="New spec category (example: Star Wars)" />
      <ui-btn color="bg-success" small @click="addCategory">Add</ui-btn>
    </div>

    <p class="text-xs text-gray-400 mb-4">These are shown in Library Filter - Spec Catagories. They filter against matching book tags.</p>

    <p v-if="!specCategories.length" class="text-center py-8 text-lg text-gray-300">No spec catagories configured</p>

    <div class="border border-white/10">
      <template v-for="(category, index) in specCategories">
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
const DEFAULT_SPEC_CATEGORIES = ['dramatised_variant', 'exception_policy', 'graphic_audio_catalog', 'none', 'star_wars_catalog']

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
    specCategories() {
      const configured = this.$store.getters['user/getUserSetting']('specCategories')
      const configuredList = Array.isArray(configured) ? configured : []
      const merged = [...configuredList, ...DEFAULT_SPEC_CATEGORIES]
      return [...new Set(merged.map((c) => this.normalizeCategory(c)).filter((c) => !!c))]
    }
  },
  methods: {
    normalizeCategory(value) {
      return String(value || '').trim()
    },
    updateCategories(categories) {
      const normalized = [...new Set([...DEFAULT_SPEC_CATEGORIES, ...categories].map((c) => this.normalizeCategory(c)).filter((c) => !!c))]
      this.$store.dispatch('user/updateUserSettings', { specCategories: normalized })
    },
    addCategory() {
      const category = this.normalizeCategory(this.newCategory)
      if (!category) return
      if (this.specCategories.includes(category)) {
        this.newCategory = ''
        return
      }
      this.updateCategories([...this.specCategories, category])
      this.newCategory = ''
    },
    removeCategory(category) {
      this.updateCategories(this.specCategories.filter((c) => c !== category))
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
      const updated = this.specCategories.map((c) => (c === this.editingCategory ? newValue : c))
      this.updateCategories(updated)
      this.cancelEdit()
    }
  }
}
</script>
