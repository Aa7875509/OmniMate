<script setup>
import { computed, onMounted, onUnmounted, ref, toRaw } from 'vue';
import { SettingOutlined } from '@ant-design/icons-vue';
import { executeAvatarBehaviorFromReply } from './ai/avatarBehaviorRules.js';
import {
  beginMicCapture,
  finalizeRecordingSession,
} from './utils/stt/voiceRecordingSession.js';
import { blobToPcm16kMono } from './utils/stt/blobToPcm16kMono.js';
import { feedStreamTts, stopStreamTts } from './utils/tts/speechSynthesisTts.js';
import AvatarStage3D from './components/AvatarStage3D.vue';
import ChatDock from './components/ChatDock.vue';
import ModelCenter from './components/ModelCenter.vue';

const isModelCenterOpen = ref(false);
const draftMessage = ref('');
const DEFAULT_LLM_PROVIDER = 'openai';
const DEFAULT_THEME_COLOR = '#2dd4bf';
const DEFAULT_OPENAI_CONFIG = {
  baseURL: 'https://api.openai.com/v1',
  apiKey: '',
  model: 'gpt-4o-mini',
};
const DEFAULT_OLLAMA_CONFIG = {
  baseURL: 'http://127.0.0.1:11434',
  model: 'gemma4:e4b',
};
const DEFAULT_XFYUN_TTS_VCN = 'x4_yezi';
const DEFAULT_XFYUN_CONFIG = {
  appId: '',
  apiKey: '',
  apiSecret: '',
  ttsVcn: DEFAULT_XFYUN_TTS_VCN,
};

const modelSlot = {
  id: 'primary-model',
  label: 'AI 模型',
  subtitle: '预留统一模型配置区域，后续可在这里接入云端或本地模型。',
  model: 'Qwen2.5-7B',
  status: '框架占位',
  tone: 'teal',
};

const llmProvider = ref(DEFAULT_LLM_PROVIDER);
const providerOptions = ref([
  { id: 'openai', displayName: '云端模型（OpenAI 协议）', active: true },
  { id: 'ollama', displayName: '本地模型（Ollama）', active: false },
]);
const openaiConfig = ref({
  ...DEFAULT_OPENAI_CONFIG,
});
const ollamaConfig = ref({
  ...DEFAULT_OLLAMA_CONFIG,
});
/** 讯飞语音听写（主进程 WebSocket，密钥仅存本地 userData） */
const xfyunConfig = ref({
  ...DEFAULT_XFYUN_CONFIG,
});
const llmStatus = ref('');
const llmBusy = ref(false);
const chatBusy = ref(false);
const themeColor = ref(DEFAULT_THEME_COLOR);
const connectionStatus = ref('online');
const avatarStageRef = ref(null);
/** 浏览器 TTS 是否在真实播报（与 3D 嘴型「说话」同步） */
const ttsSpeaking = ref(false);
/** 当前一段录音会话（来自 voiceRecordingSession） */
const micSessionRef = ref(null);
const isVoiceListening = computed(() => Boolean(micSessionRef.value));
const activeStreamRequestId = ref('');
const activePrompt = ref('');
const lastStoppedPrompt = ref('');

const messages = ref([]);
let messageSeed = 0;

function createMessage(role, text) {
  messageSeed += 1;
  return {
    id: messageSeed,
    role,
    name: role === 'assistant' ? 'OmniMate' : '你',
    text,
  };
}

async function syncContextMessages() {
  const llmAPI = globalThis.window?.electronAPI?.llm;
  if (!llmAPI) {
    return;
  }

  try {
    const context = await llmAPI.getContext();
    messages.value = context
      .filter((item) => item.role === 'assistant' || item.role === 'user')
      .map((item) => createMessage(item.role, item.content));
  } catch {
    messages.value = [];
  }
}

function openModelCenter() {
  isModelCenterOpen.value = true;
}

function closeModelCenter() {
  isModelCenterOpen.value = false;
}

async function syncXFyunConfig() {
  const xf = globalThis.window?.electronAPI?.xfyun;
  if (!xf?.getConfig) {
    return;
  }
  try {
    const c = await xf.getConfig();
    const rawVcn = typeof c.ttsVcn === 'string' ? c.ttsVcn.trim() : '';
    xfyunConfig.value = {
      appId: typeof c.appId === 'string' ? c.appId : '',
      apiKey: typeof c.apiKey === 'string' ? c.apiKey : '',
      apiSecret: typeof c.apiSecret === 'string' ? c.apiSecret : '',
      ttsVcn: rawVcn || DEFAULT_XFYUN_TTS_VCN,
    };
  } catch {
    /* noop */
  }
}

async function refreshProviders() {
  const llmAPI = globalThis.window?.electronAPI?.llm;

  if (!llmAPI) {
    llmStatus.value = '当前环境未连接 Electron 主进程。';
    await syncXFyunConfig();
    return;
  }

  try {
    const providers = await llmAPI.listProviders();
    providerOptions.value = providers;
    const activeProvider = providers.find((provider) => provider.active);

    if (activeProvider) {
      llmProvider.value = activeProvider.id;
    }

    llmStatus.value = '已同步 LLMService 提供器状态。';
  } catch (error) {
    llmStatus.value = `刷新失败：${error instanceof Error ? error.message : String(error)}`;
  }
  await syncXFyunConfig();
}

function toPlainLlmConfig(config) {
  const raw = toRaw(config);
  return { ...raw };
}

async function applyLLMSettings() {
  const llmAPI = globalThis.window?.electronAPI?.llm;

  if (!llmAPI) {
    llmStatus.value = '当前环境未连接 Electron 主进程。';
    return;
  }

  const providerId = llmProvider.value;
  const config = toPlainLlmConfig(
    providerId === 'openai' ? openaiConfig.value : ollamaConfig.value,
  );

  llmBusy.value = true;

  try {
    await llmAPI.switchProvider(providerId, config);
    await llmAPI.configureProvider(providerId, config);
    await refreshProviders();
    llmStatus.value = `已应用 ${providerId} 配置。`;
  } catch (error) {
    llmStatus.value = `保存失败：${error instanceof Error ? error.message : String(error)}`;
  } finally {
    llmBusy.value = false;
  }
}

function resetLLMSettings() {
  llmProvider.value = DEFAULT_LLM_PROVIDER;
  openaiConfig.value = { ...DEFAULT_OPENAI_CONFIG };
  ollamaConfig.value = { ...DEFAULT_OLLAMA_CONFIG };
  themeColor.value = DEFAULT_THEME_COLOR;
  llmStatus.value = '已恢复默认配置，请点击“保存并切换”生效。（讯飞配置未改动）';
}

async function applyXFyunSettings() {
  const xf = globalThis.window?.electronAPI?.xfyun;
  if (!xf?.saveConfig) {
    llmStatus.value = '当前环境未连接 Electron，无法保存讯飞配置。';
    return;
  }
  llmBusy.value = true;
  try {
    await xf.saveConfig({
      appId: String(xfyunConfig.value.appId ?? '').trim(),
      apiKey: String(xfyunConfig.value.apiKey ?? '').trim(),
      apiSecret: String(xfyunConfig.value.apiSecret ?? '').trim(),
      ttsVcn: String(xfyunConfig.value.ttsVcn ?? '').trim(),
    });
    await syncXFyunConfig();
    llmStatus.value = '讯飞语音听写配置已保存。';
  } catch (error) {
    llmStatus.value = `讯飞配置保存失败：${error instanceof Error ? error.message : String(error)}`;
  } finally {
    llmBusy.value = false;
  }
}

function createStreamRequestId() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function onStreamTtsSpeakingChange(speaking) {
  ttsSpeaking.value = speaking;
}

function stopMessage() {
  stopStreamTts();
  const llmAPI = globalThis.window?.electronAPI?.llm;
  if (!llmAPI || !activeStreamRequestId.value) {
    return;
  }
  llmAPI.cancelChatStream?.(activeStreamRequestId.value);
}

async function submitMessage(inputPrompt = '') {
  if (chatBusy.value) {
    return;
  }

  const llmAPI = globalThis.window?.electronAPI?.llm;
  if (!llmAPI) {
    llmStatus.value = '当前环境未连接 Electron 主进程。';
    return;
  }

  const hasCustomPrompt = typeof inputPrompt === 'string' && inputPrompt.trim().length > 0;
  const prompt = hasCustomPrompt ? inputPrompt.trim() : draftMessage.value.trim();
  if (!prompt) {
    return;
  }

  stopVoiceInput();

  messages.value.push(createMessage('user', prompt));
  if (!hasCustomPrompt) {
    draftMessage.value = '';
  }
  chatBusy.value = true;
  stopStreamTts();
  connectionStatus.value = 'thinking';
  activePrompt.value = prompt;
  lastStoppedPrompt.value = '';
  avatarStageRef.value?.setAvatarExpression?.('focus', { duration: 3, intensity: 1.05 });
  messages.value.push(createMessage('assistant', ''));
  const assistantIndex = messages.value.length - 1;
  const requestId = createStreamRequestId();
  activeStreamRequestId.value = requestId;

  try {
    let result;
    if (typeof llmAPI.chatStream === 'function') {
      result = await llmAPI.chatStream(prompt, { requestId }, {
        onChunk: (chunk) => {
          if (typeof chunk === 'string' && chunk) {
            const row = messages.value[assistantIndex];
            if (row?.role === 'assistant') {
              row.text += chunk;
              feedStreamTts(row.text, {
                endOfStream: false,
                onSpeakingChange: onStreamTtsSpeakingChange,
              });
            }
          }
        },
      });
    } else {
      result = await llmAPI.chat(prompt);
      const fallbackContent = typeof result?.content === 'string' ? result.content : '';
      const row = messages.value[assistantIndex];
      if (row?.role === 'assistant') {
        row.text = fallbackContent;
      }
    }

    const row = messages.value[assistantIndex];
    const content = (row?.text ?? '').trim() || String(result?.content ?? '').trim();
    if (row?.role === 'assistant') {
      row.text = content || '模型未返回文本内容。';
    }
    feedStreamTts(row.text, { endOfStream: true, onSpeakingChange: onStreamTtsSpeakingChange });
    executeAvatarBehaviorFromReply({ avatar: avatarStageRef.value, text: content });
    connectionStatus.value = 'online';
    llmStatus.value = '';
  } catch (error) {
    stopStreamTts();
    const row = messages.value[assistantIndex];
    if (error instanceof Error && error.name === 'AbortError') {
      if (row?.role === 'assistant' && !row.text.trim()) {
        row.text = '已停止生成。';
      }
      lastStoppedPrompt.value = activePrompt.value;
      llmStatus.value = '已停止当前回复。';
      connectionStatus.value = 'online';
    } else {
      if (row?.role === 'assistant') {
        row.text = `请求失败：${error instanceof Error ? error.message : String(error)}`;
      }
      avatarStageRef.value?.setAvatarExpression?.('calm', { duration: 1.8, intensity: 0.9 });
      llmStatus.value = '对话请求失败，请检查模型配置。';
      connectionStatus.value = 'error';
    }
  } finally {
    activeStreamRequestId.value = '';
    activePrompt.value = '';
    chatBusy.value = false;
  }
}

function retryLastStoppedMessage() {
  if (!lastStoppedPrompt.value || chatBusy.value) {
    return;
  }
  submitMessage(lastStoppedPrompt.value);
}

function stopVoiceInput() {
  const mic = micSessionRef.value;
  if (mic) {
    micSessionRef.value = null;
    mic.stop().catch(() => {});
  }
}

async function toggleVoiceInput() {
  if (chatBusy.value) {
    return;
  }

  if (micSessionRef.value) {
    const session = micSessionRef.value;
    micSessionRef.value = null;
    try {
      const { blob, ok } = await finalizeRecordingSession(session);
      if (!ok) {
        llmStatus.value = '录音过短，请说话后再结束。';
        return;
      }
      const kb = Math.max(1, Math.round(blob.size / 1024));
      const xfApi = globalThis.window?.electronAPI?.xfyun;
      if (xfApi?.transcribePcm) {
        llmStatus.value = '正在讯飞听写转文字…';
        try {
          const pcm = await blobToPcm16kMono(blob);
          const u8 = new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength);
          const result = await xfApi.transcribePcm(u8);
          const text = typeof result?.text === 'string' ? result.text.trim() : '';
          if (text) {
            const prev = draftMessage.value.trim();
            draftMessage.value = prev ? `${prev} ${text}` : text;
            llmStatus.value = `讯飞转写完成（约 ${kb} KB）。`;
          } else {
            llmStatus.value = `未识别到文本（约 ${kb} KB）。请检查麦克风或讯飞控制台权限。`;
          }
        } catch (err) {
          llmStatus.value = `讯飞转写失败：${err instanceof Error ? err.message : String(err)}`;
        }
      } else {
        llmStatus.value = `录音已保存（约 ${kb} KB）。浏览器预览未接入讯飞，请使用 Electron 应用并配置开放平台密钥。`;
      }
    } catch (error) {
      llmStatus.value = `结束录音失败：${error instanceof Error ? error.message : String(error)}`;
    }
    return;
  }

  try {
    const session = await beginMicCapture();
    micSessionRef.value = session;
    llmStatus.value = globalThis.window?.electronAPI?.xfyun
      ? '录制中…结束录音后将通过讯飞转为文字（需在设置中填写密钥）。'
      : '录制中…再次点击结束录音。';
  } catch (error) {
    micSessionRef.value = null;
    llmStatus.value = `无法开启麦克风：${error instanceof Error ? error.message : String(error)}`;
  }
}

const statusLabel = computed(() => {
  if (connectionStatus.value === 'online') {
    return '在线';
  }
  if (connectionStatus.value === 'thinking') {
    return '思考中';
  }
  return '离线';
});

const statusColor = computed(() => {
  if (connectionStatus.value === 'online') {
    return 'success';
  }
  if (connectionStatus.value === 'thinking') {
    return 'warning';
  }
  return 'error';
});

const currentModelName = computed(() => {
  if (llmProvider.value === 'ollama') {
    return ollamaConfig.value?.model || '未设置';
  }
  return openaiConfig.value?.model || '未设置';
});

const stageAvatarStatus = computed(() => {
  if (ttsSpeaking.value) {
    return 'speaking';
  }
  if (chatBusy.value) {
    return 'thinking';
  }
  return 'idle';
});

onMounted(() => {
  refreshProviders();
  syncContextMessages();
});

onUnmounted(() => {
  stopVoiceInput();
});
</script>

<template>
  <a-config-provider :theme="{ token: { colorPrimary: themeColor, borderRadius: 10 } }">
    <a-layout class="aether-layout">
      <div class="aether-bg"></div>

      <a-layout-header class="top-bar">
        <a-space align="center" :size="14">
          <a-avatar shape="square" class="brand-avatar">OM</a-avatar>
          <a-typography-title :level="4" style="margin: 0;">OmniMate</a-typography-title>
        </a-space>

        <a-space align="center">
          <a-tag color="cyan">模型：{{ currentModelName }}</a-tag>
          <a-badge :status="statusColor" :text="statusLabel" />
        </a-space>

        <a-space align="center" :size="12">
          <a-button type="primary" shape="circle" aria-label="设置" @click="openModelCenter">
            <SettingOutlined />
          </a-button>
        </a-space>
      </a-layout-header>

      <a-layout-content class="main-content">
        <div class="avatar-stage">
          <a-card class="avatar-card" :bordered="false">
            <AvatarStage3D
              ref="avatarStageRef"
              model-url="/models/avatar.vrm"
              :avatar-status="stageAvatarStatus"
            />
          </a-card>
        </div>

        <ChatDock
          :messages="messages"
          :draft-message="draftMessage"
          :chat-busy="chatBusy"
          :voice-listening="isVoiceListening"
          :can-retry="Boolean(lastStoppedPrompt) && !chatBusy"
          @update:draft-message="draftMessage = $event"
          @submit-message="submitMessage"
          @stop-message="stopMessage"
          @retry-message="retryLastStoppedMessage"
          @voice-click="toggleVoiceInput"
        />
      </a-layout-content>
    </a-layout>

    <ModelCenter
      :open="isModelCenterOpen"
      :model-slot="modelSlot"
      :llm-provider="llmProvider"
      :provider-options="providerOptions"
      :openai-config="openaiConfig"
      :ollama-config="ollamaConfig"
      :xfyun-config="xfyunConfig"
      :theme-color="themeColor"
      :llm-status="llmStatus"
      :llm-busy="llmBusy"
      @close="closeModelCenter"
      @update:llm-provider="llmProvider = $event"
      @update:openai-config="openaiConfig = $event"
      @update:ollama-config="ollamaConfig = $event"
      @update:xfyun-config="xfyunConfig = $event"
      @update:theme-color="themeColor = $event"
      @apply-llm-settings="applyLLMSettings"
      @apply-xfyun-settings="applyXFyunSettings"
      @refresh-providers="refreshProviders"
      @reset-llm-settings="resetLLMSettings"
    />
  </a-config-provider>
</template>

<style scoped>
.aether-layout {
  height: 100vh;
  overflow: hidden;
  position: relative;
  background: #f7f7f8;
}

.aether-bg {
  position: absolute;
  inset: 0;
  background: #f7f7f8;
}

.top-bar {
  position: relative;
  z-index: 2;
  margin: 14px 16px 0;
  height: 64px;
  padding: 0 14px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  border: 1px solid #e5e7eb;
  border-radius: 12px;
  background: #ffffff;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.06);
}

.brand-avatar,
.stage-avatar {
  color: #0f172a;
  background: #e5e7eb;
}

.main-content {
  position: relative;
  z-index: 1;
  height: calc(100vh - 78px);
  padding: 14px 16px 16px;
  display: flex;
  flex-direction: row;
  align-items: stretch;
  gap: 12px;
  min-height: 0;
  overflow: hidden;
}

.avatar-stage {
  flex: 1 1 55%;
  min-width: 0;
  min-height: 200px;
}

.avatar-card {
  height: 100%;
  border: 1px solid #e5e7eb;
  background: #ffffff;
  box-shadow: none;
}

.avatar-card :deep(.ant-card-body) {
  height: 100%;
  padding: 10px;
}

.top-bar :deep(.ant-badge-status-text) {
  color: #374151;
}

@media (max-width: 900px) {
  .main-content {
    flex-direction: column;
  }

  .avatar-stage {
    flex: 1 1 auto;
    min-height: 160px;
  }
}
</style>
