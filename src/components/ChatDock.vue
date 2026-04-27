<script setup>
import {
  AudioOutlined,
  HistoryOutlined,
  MessageOutlined,
  SendOutlined,
  StopOutlined,
} from '@ant-design/icons-vue';
import DOMPurify from 'dompurify';
import MarkdownIt from 'markdown-it';
import { nextTick, ref, watch } from 'vue';

const props = defineProps({
  /** 是否展开左侧实时对话消息列表，默认 false 以字幕为主 */
  dialogExpanded: {
    type: Boolean,
    default: false,
  },
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
  canRetry: {
    type: Boolean,
    default: false,
  },
});

const emit = defineEmits([
  'update:dialogExpanded',
  'update:draftMessage',
  'submit-message',
  'stop-message',
  'retry-message',
  'history-click',
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
  () => props.dialogExpanded,
  (open) => {
    if (open) {
      nextTick(() => {
        scrollToBottom();
      });
    }
  },
);

/** 流式结束后再滚一次：列表/Markdown 高度在 chatBusy 置 false 后可能才稳定 */
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
  <section>
    <a-button
      v-if="!dialogExpanded"
      class="chat-expand-btn"
      type="default"
      @click="emit('update:dialogExpanded', true)"
    >
      <MessageOutlined />
      展开对话
    </a-button>
    <a-card v-show="dialogExpanded" class="chat-card" :bordered="false">
      <template #title>
        <span>实时对话</span>
      </template>
      <template #extra>
        <a-button type="text" size="small" @click="emit('update:dialogExpanded', false)">收起</a-button>
      </template>
      <div ref="scrollRef" class="chat-scroll">
        <a-empty v-if="messages.length === 0" class="chat-empty" description="开始一段新对话" />
        <a-list :data-source="messages" item-layout="vertical" :split="false">
          <template #renderItem="{ item }">
            <a-list-item>
              <a-flex :justify="item.role === 'assistant' ? 'start' : 'end'">
                <div class="bubble" :class="item.role === 'assistant' ? 'assistant-bubble' : 'user-bubble'">
                  <a-space size="small">
                    <a-typography-text strong>{{ item.name }}</a-typography-text>
                  </a-space>
                  <div class="bubble-markdown" v-html="renderMarkdown(item.text)"></div>
                </div>
              </a-flex>
            </a-list-item>
          </template>
        </a-list>
      </div>
    </a-card>

    <a-card class="bottom-bar" :bordered="false">
      <div class="chat-composer">
        <a-button class="composer-side-btn" shape="circle" aria-label="语音输入" @click="emit('voice-click')">
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
        <a-button class="composer-history-btn" type="text" @click="emit('history-click')">
          <HistoryOutlined />
          历史记录
        </a-button>
      </div>
    </a-card>
  </section>
</template>

<style scoped>
/* 不设置 position: relative，使绝对定位的卡片相对 .main-content，叠在 3D 区左侧 */

.chat-expand-btn {
  position: absolute;
  z-index: 3;
  left: 16px;
  top: 14px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 36px;
  padding: 0 12px;
  border: 1px solid #e5e7eb;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.98);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
  color: #374151;
}

.chat-card {
  position: absolute;
  z-index: 3;
  left: 16px;
  top: 14px;
  width: min(360px, calc(100vw - 48px));
  height: calc(100% - 134px);
  border: 1px solid #e5e7eb;
  background: rgba(255, 255, 255, 0.52);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.06);
}

.chat-card :deep(.ant-card-head-title) {
  color: #111827;
}

.chat-card :deep(.ant-card-head) {
  background: transparent;
}

.chat-card :deep(.ant-card-body) {
  height: calc(100% - 57px);
  background: transparent;
}

.chat-scroll {
  height: 100%;
  overflow: auto;
  padding-right: 6px;
}

.chat-scroll::-webkit-scrollbar {
  width: 8px;
}

.chat-scroll::-webkit-scrollbar-thumb {
  background: #d1d5db;
  border-radius: 999px;
}

.chat-empty :deep(.ant-empty-description) {
  color: #6b7280;
}

.chat-empty :deep(.ant-empty-image) {
  opacity: 0.9;
  filter: none;
}

.bubble {
  max-width: min(72%, 760px);
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

.bubble-markdown {
  margin-top: 8px;
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
  background: #f3f4f6;
}

.bubble-markdown :deep(code) {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', monospace;
}

.bubble-markdown :deep(a) {
  color: #1677ff;
}

.bottom-bar {
  flex: 0 0 auto;
  border: 1px solid #e5e7eb;
  background: #ffffff;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.06);
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

.composer-retry-btn,
.composer-history-btn {
  color: #6b7280;
}

@media (max-width: 900px) {
  .chat-card {
    position: static;
    width: 100%;
    height: 42%;
  }
}
</style>
