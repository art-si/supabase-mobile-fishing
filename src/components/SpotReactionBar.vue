<script setup lang="ts">
import DiscussionActions from './DiscussionActions.vue'
import type { SpotCommunitySummary, SpotReaction } from '@/services/spot-community'
defineOptions({ options: { styleIsolation: 'apply-shared' } })
defineProps<{ community?: SpotCommunitySummary; title: string; busy?: boolean; saved?: boolean }>()
defineEmits<{ react: [kind: SpotReaction]; comments: [] }>()
</script>
<template>
  <DiscussionActions :title="title" :likes="community?.likes" :comments="community?.comments" :liked="community?.liked"
    :saved="community?.saved ?? saved" :busy="busy" @react="$emit('react',$event)" @comments="$emit('comments')" />
</template>
