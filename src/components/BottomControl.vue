<script setup>
import { computed } from 'vue';

const props = defineProps({
  modelValue: {
    type: String,
    default: '',
  },
  isListening: {
    type: Boolean,
    default: false,
  },
});

const emit = defineEmits(['update:modelValue', 'toggle-listening', 'submit-message']);

const sendButtonText = computed(() => (props.modelValue.trim() ? '发送' : '待输入'));

function submitMessage() {
  emit('submit-message');
}
</script>

<template>
  <section class="bottom-control glass-panel" aria-label="底部控制栏">
    <a-button
      class="voice-button"
      :class="{ 'is-listening': isListening }"
      type="primary"
      shape="circle"
      @click="$emit('toggle-listening')"
    >
      <span v-if="!isListening">麦克风</span>
      <span v-else class="waveform"><i></i><i></i><i></i><i></i></span>
    </a-button>

    <form class="input-dock" @submit.prevent="submitMessage">
      <label for="message-input">文本输入</label>
      <a-input
        id="message-input"
        :value="modelValue"
        placeholder="输入文字，或点击麦克风开始对话..."
        @update:value="emit('update:modelValue', $event)"
      />
      <a-button html-type="submit" class="send-button" type="primary">{{ sendButtonText }}</a-button>
    </form>
  </section>
</template>
