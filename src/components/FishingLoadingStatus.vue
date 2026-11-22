<script setup lang="ts">
defineOptions({ options: { virtualHost: true, styleIsolation: 'apply-shared' } })
withDefaults(defineProps<{ label: string; block?: boolean; media?: boolean; bare?: boolean }>(), { block: true })
</script>

<template>
  <view
    class="fishing-skeleton"
    :class="{ panel: block && !media && !bare, 'fishing-skeleton--media': media }"
    role="status"
    :aria-label="label"
  >
    <view v-if="block && !media" class="fishing-skeleton__card" aria-hidden="true">
      <view class="fishing-skeleton__header">
        <view class="fishing-skeleton__shape fishing-skeleton__avatar" />
        <view class="fishing-skeleton__lines">
          <view class="fishing-skeleton__shape fishing-skeleton__line fishing-skeleton__line--title" />
          <view class="fishing-skeleton__shape fishing-skeleton__line fishing-skeleton__line--short" />
        </view>
      </view>
      <view class="fishing-skeleton__shape fishing-skeleton__line" />
      <view class="fishing-skeleton__shape fishing-skeleton__line fishing-skeleton__line--title" />
    </view>
    <view v-else class="fishing-skeleton__shape fishing-skeleton__placeholder" aria-hidden="true" />
  </view>
</template>

<style scoped>
.fishing-skeleton {
  width: 100%;
}
.fishing-skeleton__card,
.fishing-skeleton__lines {
  display: grid;
  gap: 10px;
  min-width: 0;
}
.fishing-skeleton__header {
  display: grid;
  grid-template-columns: 44px minmax(0, 1fr);
  align-items: center;
  gap: 12px;
  margin-bottom: 6px;
}
.fishing-skeleton__shape {
  background: var(--inset);
}
.fishing-skeleton__avatar {
  aspect-ratio: 1;
  border-radius: 50%;
}
.fishing-skeleton__line {
  height: 0.75rem;
  border-radius: 6px;
}
.fishing-skeleton__line--title {
  width: 66%;
}
.fishing-skeleton__line--short {
  width: 40%;
}
.fishing-skeleton__placeholder {
  width: min(35%, 120px);
  height: 0.75rem;
  margin: 12px auto;
  border-radius: 6px;
}
.fishing-skeleton--media .fishing-skeleton__placeholder {
  width: 100%;
  height: auto;
  aspect-ratio: 16 / 9;
  margin: 0;
  border-radius: 12px;
}
</style>
