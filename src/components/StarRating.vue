<script setup lang="ts">
// Display-only when readonly; otherwise emits update:modelValue on click.
// See PRD.md "Core entities" — 1-5 stars, per visit.
withDefaults(
  defineProps<{
    modelValue: number | null
    readonly?: boolean
  }>(),
  { readonly: false },
)

const emit = defineEmits<{ 'update:modelValue': [value: number] }>()
</script>

<template>
  <span class="inline-flex gap-0.5" :aria-label="`${modelValue ?? 0} out of 5 stars`">
    <button
      v-for="n in 5"
      :key="n"
      type="button"
      :disabled="readonly"
      class="text-lg leading-none"
      :class="[
        n <= (modelValue ?? 0) ? 'text-amber-400' : 'text-zinc-300 dark:text-zinc-600',
        readonly ? 'cursor-default' : 'cursor-pointer hover:text-amber-400',
      ]"
      @click="!readonly && emit('update:modelValue', n)"
    >
      ★
    </button>
  </span>
</template>
