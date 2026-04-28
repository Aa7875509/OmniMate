<script setup>
import {
  AudioOutlined,
  SendOutlined,
  StopOutlined,
} from '@ant-design/icons-vue';
import DOMPurify from 'dompurify';
import MarkdownIt from 'markdown-it';
import { nextTick, ref, watch } from 'vue';

const props = defineProps({
  messages: {
    type: Array,
    default: () => [],
  },
  draftMessage: {
    type: String,
    default: '',
  },
  chatBusy: {
    type: Boolean,
    default: false,
  },
  voiceListening: {
    type: Boolean,
    default: false,
  },
  canRetry: {
    type: Boolean,
    default: false,
  },
});

const emit = defineEmits([
  'update:draftMessage',
  'submit-message',
  'stop-message',
  'retry-message',
  'voice-click',
]);

const scrollRef = ref(null);
const md = new MarkdownIt({
  breaks: true,
  linkify: true,
});

function submitByEnter() {
  if (props.chatBusy || !props.draftMessage.trim()) {
    return;
  }
  emit('submit-message');
}

function renderMarkdown(text) {
  const source = typeof text === 'string' ? text : '';
  return DOMPurify.sanitize(md.render(source));
}

function isAssistantThinking(item) {
  if (!props.chatBusy || item?.role !== 'assistant') {
    return false;
  }
  const last = props.messages[props.messages.length - 1];
  if (item !== last) {
    return false;
  }
  const t = typeof item.text === 'string' ? item.text : '';
  return !t.trim();
}

function scrollToBottom() {
  nextTick(() => {
    const el = scrollRef.value;
    if (!el) {
      return;
    }
    el.scrollTop = el.scrollHeight;
  });
}

watch(
  () => props.messages,
  () => {
    scrollToBottom();
  },
  { deep: true },
);

watch(
  () => props.chatBusy,
  (busy) => {
    if (busy) {
      return;
    }
    nextTick(() => {
      requestAnimationFrame(() => {
        scrollToBottom();
      });
    });
  },
);
</script>

<template>
  <section class="chat-dock" aria-label="对话与回复">
    <a-card class="chat-dock-panel" :bordered="false">
      <div ref="scrollRef" class="chat-scroll" role="log" aria-live="polite">
        <a-empty v-if="messages.length === 0" class="chat-empty" description="开始一段新对话" />
        <a-list v-else :data-source="messages" item-layout="vertical" :split="false">
          <template #renderItem="{ item }">
            <a-list-item>
              <a-flex :justify="item.role === 'assistant' ? 'start' : 'end'">
                <div class="bubble" :class="item.role === 'assistant' ? 'assistant-bubble' : 'user-bubble'">
                  <!-- <a-space size="small">
                    <a-typography-text strong>{{ item.name }}</a-typography-text>
                  </a-space> -->
                  <div v-if="isAssistantThinking(item)" class="thinking-placeholder">
                    思考中…
                  </div>
                  <div v-else class="bubble-markdown" v-html="renderMarkdown(item.text)"></div>
                </div>
              </a-flex>
            </a-list-item>
          </template>
        </a-list>
      </div>

      <div class="composer-wrap">
        <div class="chat-composer">
          <a-button
            class="composer-side-btn"
            shape="circle"
            aria-label="语音输入"
            :class="{ 'is-voice-listening': voiceListening }"
            :disabled="chatBusy"
            @click="emit('voice-click')"
          >
            <AudioOutlined />
          </a-button>
          <a-input
            :value="draftMessage"
            class="composer-input"
            size="large"
            placeholder="给 OmniMate 发送消息..."
            @update:value="emit('update:draftMessage', $event)"
            @pressEnter="submitByEnter"
          />
          <a-button
            v-if="chatBusy"
            class="composer-stop-btn"
            danger
            shape="circle"
            aria-label="停止生成"
            @click="emit('stop-message')"
          >
            <StopOutlined />
          </a-button>
          <a-button
            class="composer-send-btn"
            type="primary"
            shape="circle"
            aria-label="发送"
            :disabled="chatBusy || !draftMessage.trim()"
            @click="emit('submit-message')"
          >
            <SendOutlined />
          </a-button>
          <a-button v-if="canRetry" class="composer-retry-btn" type="text" @click="emit('retry-message')">
            重试上一条
          </a-button>
        </div>
      </div>
    </a-card>
  </section>
</template>

<style scoped>
.chat-dock {
  flex: 0 0 clamp(300px, 36vw, 420px);
  min-width: 280px;
  max-width: 420px;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.chat-dock-panel {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  border: 1px solid #e5e7eb;
  border-radius: 12px;
  background: #ffffff;
  box-shadow: none;
}

.chat-dock-panel :deep(.ant-card-body) {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  padding: 12px;
  background: transparent;
}

.chat-scroll {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding-right: 4px;
}

.chat-scroll::-webkit-scrollbar {
  width: 8px;
}

.chat-scroll::-webkit-scrollbar-thumb {
  background: rgba(107, 114, 128, 0.35);
  border-radius: 999px;
}

.chat-empty :deep(.ant-empty-description) {
  color: #6b7280;
}

.chat-empty :deep(.ant-empty-image) {
  opacity: 0.85;
  filter: none;
}

.bubble {
  max-width: min(92%, 760px);
  padding: 12px 14px 11px;
  border: 1px solid #e5e7eb;
  border-radius: 14px;
  color: #111827;
  box-shadow: none;
}

.assistant-bubble {
  background: #ffffff;
}

.user-bubble {
  background: #f3f4f6;
}

.bubble :deep(.ant-typography),
.bubble :deep(.ant-typography strong) {
  color: #111827;
}

.thinking-placeholder {
  color: #6b7280;
  font-size: 14px;
  line-height: 1.5;
  animation: thinking-pulse 1.2s ease-in-out infinite;
}

@keyframes thinking-pulse {
  0%,
  100% {
    opacity: 0.55;
  }
  50% {
    opacity: 1;
  }
}

.bubble-markdown {
  /* margin-top: 8px; */
  color: #111827;
}

.bubble-markdown :deep(p) {
  margin: 0 0 8px;
}

.bubble-markdown :deep(p:last-child) {
  margin-bottom: 0;
}

.bubble-markdown :deep(pre) {
  margin: 8px 0;
  padding: 10px;
  border-radius: 8px;
  overflow: auto;
  background: rgba(243, 244, 246, 0.95);
}

.bubble-markdown :deep(code) {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', monospace;
}

.bubble-markdown :deep(a) {
  color: #1677ff;
}

.composer-wrap {
  flex-shrink: 0;
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px solid #e5e7eb;
}

.chat-composer {
  display: flex;
  align-items: center;
  gap: 10px;
}

.composer-side-btn {
  flex: 0 0 auto;
  color: #6b7280;
  background: #ffffff;
  border: 1px solid #d1d5db;
}

.composer-side-btn.is-voice-listening {
  color: #ffffff;
  background: #ef4444;
  border-color: #dc2626;
}

.composer-input {
  flex: 1;
}

.composer-input :deep(.ant-input) {
  border-radius: 999px;
  background: #ffffff;
  border-color: #d1d5db;
  color: #111827;
}

.composer-input :deep(.ant-input::placeholder) {
  color: #9ca3af;
}

.composer-input :deep(.ant-input:focus),
.composer-input :deep(.ant-input-focused) {
  border-color: rgba(45, 212, 191, 0.52);
  box-shadow: 0 0 0 2px rgba(45, 212, 191, 0.12);
}

.composer-send-btn {
  flex: 0 0 auto;
  box-shadow: none;
}

.composer-stop-btn {
  flex: 0 0 auto;
}

.composer-retry-btn {
  color: #6b7280;
}

@media (max-width: 900px) {
  .chat-dock {
    flex: 0 0 auto;
    max-width: none;
    min-width: 0;
    width: 100%;
    height: min(46vh, 400px);
  }
}
</style>
