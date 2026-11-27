<script setup lang="ts">
defineOptions({ options: { styleIsolation: 'apply-shared' } })
import MobileAction from '@mobile-core/components/MobileAction.vue'

import MobileIcon from '@mobile-core/components/MobileIcon.vue'
import { FISHING_SKINS } from '@/domain/appearance'
import { useAppearanceStore } from '@/stores/appearance'
const theme = useAppearanceStore()
</script>
<template>
  <view class="stack">
    <view class="section-head"
      ><text class="heading">主题皮肤</text><text class="caption">明暗随系统</text></view
    >
    <view class="skin-options" role="group" aria-label="主题皮肤">
      <MobileAction
        v-for="skin in FISHING_SKINS"
        :key="skin.id"
        class="skin-choice"
        :class="{ 'skin-choice--selected': theme.skin === skin.id }"
        :aria-label="skin.name"
        :aria-pressed="theme.skin === skin.id"
        @click="theme.select(skin.id)"
      >
        <view
          class="skin-preview"
          aria-hidden="true"
          :style="{
            background: skin[theme.dark ? 'dark' : 'light'].mist,
            '--preview-paper': skin[theme.dark ? 'dark' : 'light'].paper,
            '--preview-ink': skin[theme.dark ? 'dark' : 'light'].ink,
            '--preview-accent': skin[theme.dark ? 'dark' : 'light'].lake
          }"
        >
          <view class="skin-preview__heading" />
          <view class="skin-preview__card"><view /><view /></view>
          <view class="skin-preview__button" />
        </view>
        <text class="name">{{ skin.name }}</text>
        <view class="skin-choice__state"
          ><MobileIcon v-if="theme.skin === skin.id" name="check" :size="14" /><text>{{
            theme.skin === skin.id ? '使用中' : skin.description
          }}</text></view
        >
      </MobileAction>
    </view>
    <view v-if="theme.saveFailed" class="row row--between row--wrap skin-save-status"
      ><text class="error" role="alert">皮肤已应用，但未保存。</text
      ><MobileAction class="text-action" @click="theme.select(theme.skin)"
        >重试保存</MobileAction
      ></view
    >
  </view>
</template>
<style scoped>
.skin-options {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 5.75rem), 1fr));
  gap: 12px;
}
.skin-choice.mobile-action {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 8px;
  padding: 8px;
  border: 1px solid var(--line);
  border-radius: 16px;
  white-space: normal;
  text-align: left;
  background: var(--paper);
}
.skin-choice--selected.mobile-action {
  border-color: var(--lake);
  box-shadow: 0 0 0 1px var(--lake);
}
.skin-preview {
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: 4px;
  border-radius: 9px;
  padding: 6px 8px;
  height: 56px;
}
.skin-preview__heading {
  width: 56%;
  height: 5px;
  border-radius: 3px;
  background: var(--preview-ink);
}
.skin-preview__card {
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 4px 8px;
  border-radius: 5px;
  background: var(--preview-paper);
}
.skin-preview__card view {
  height: 3px;
  background: var(--preview-ink);
  opacity: 0.22;
  border-radius: 2px;
}
.skin-preview__card view:last-child {
  width: 65%;
}
.skin-preview__button {
  height: 10px;
  width: 45%;
  background: var(--preview-accent);
  border-radius: 3px;
}
.skin-choice__state {
  display: flex;
  align-items: center;
  gap: 4px;
  color: var(--reed);
  font-size: var(--fishing-small-size);
  line-height: 1.5;
  min-height: 1.5em;
}
.skin-choice--selected .skin-choice__state {
  color: var(--lake);
}
.skin-save-status .error { flex: 1 1 12rem; }
.skin-save-status :deep(.text-action) { margin-inline-start: auto; }
@media (max-width: 350px) {
  .skin-options {
    gap: 8px;
  }
  .skin-choice.mobile-action {
    padding: 6px;
  }
}
</style>
