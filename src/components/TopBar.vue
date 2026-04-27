<script setup>
defineProps({
  modelName: {
    type: String,
    default: 'Qwen2.5-7B',
  },
});

const emit = defineEmits(['open-model-center']);

function openModelCenter() {
  emit('open-model-center');
}
</script>

<template>
  <header class="top-bar glass-panel drag-region">
    <div class="brand-lockup">
      <div class="logo-mark">OM</div>
      <div>
        <strong>OmniMate</strong>
        <span>Aether Glass Interface</span>
      </div>
    </div>

    <a-button class="model-pill no-drag" type="default" @click="openModelCenter">
      <span class="pulse-dot"></span>
      <span>当前模型：{{ modelName }}</span>
    </a-button>

    <div class="top-actions no-drag">
      <a-button class="icon-button" type="primary" @click="openModelCenter">设置</a-button>
    </div>
  </header>
</template>
