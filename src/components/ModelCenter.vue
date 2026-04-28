<script setup>
import { ref, watch } from 'vue';

const activeTab = ref('llm');

const props = defineProps({
  open: {
    type: Boolean,
    default: false,
  },
  modelSlot: {
    type: Object,
    default: () => ({
      label: 'AI 模型',
      model: 'Model Slot',
      subtitle: '预留统一模型配置区域。',
      status: '框架占位',
      tone: 'teal',
    }),
  },
  llmProvider: {
    type: String,
    default: 'openai',
  },
  providerOptions: {
    type: Array,
    default: () => [],
  },
  openaiConfig: {
    type: Object,
    default: () => ({
      baseURL: 'https://api.openai.com/v1',
      apiKey: '',
      model: 'gpt-4o-mini',
    }),
  },
  ollamaConfig: {
    type: Object,
    default: () => ({
      baseURL: 'http://127.0.0.1:11434',
      model: 'gemma4:e4b',
    }),
  },
  xfyunConfig: {
    type: Object,
    default: () => ({
      appId: '',
      apiKey: '',
      apiSecret: '',
    }),
  },
  llmStatus: {
    type: String,
    default: '',
  },
  themeColor: {
    type: String,
    default: '#1677ff',
  },
  llmBusy: {
    type: Boolean,
    default: false,
  },
});

watch(
  () => props.open,
  (opened) => {
    if (opened) {
      activeTab.value = 'llm';
    }
  },
);

const emit = defineEmits([
  'close',
  'update:llmProvider',
  'update:openaiConfig',
  'update:ollamaConfig',
  'update:xfyunConfig',
  'update:themeColor',
  'apply-llm-settings',
  'apply-xfyun-settings',
  'refresh-providers',
  'reset-llm-settings',
]);

function closeModelCenter() {
  emit('close');
}

function updateThemeColor(value) {
  const nextColor = typeof value === 'string' ? value : value?.toHexString?.();
  if (nextColor) {
    emit('update:themeColor', nextColor);
  }
}
</script>

<template>
  <a-modal
    :open="open"
    title="模型管理中心"
    width="720px"
    :footer="null"
    @cancel="closeModelCenter"
  >
    <a-alert
      v-if="llmStatus"
      :message="llmStatus"
      type="info"
      show-icon
      style="margin-bottom: 16px;"
    />

    <a-tabs v-model:active-key="activeTab">
      <a-tab-pane key="llm" tab="对话模型">
        <a-form layout="vertical">
          <a-form-item label="模型类型">
            <a-select
              :value="llmProvider"
              :options="
                providerOptions.map((provider) => ({
                  value: provider.id,
                  label: `${provider.displayName}${provider.active ? '（当前）' : ''}`,
                }))
              "
              @change="emit('update:llmProvider', $event)"
            />
          </a-form-item>

          <template v-if="llmProvider === 'openai'">
            <a-form-item label="Base URL">
              <a-input
                :value="openaiConfig.baseURL"
                placeholder="https://api.openai.com/v1"
                @update:value="emit('update:openaiConfig', { ...openaiConfig, baseURL: $event })"
              />
            </a-form-item>
            <a-form-item label="API Key">
              <a-input-password
                :value="openaiConfig.apiKey"
                placeholder="sk-..."
                @update:value="emit('update:openaiConfig', { ...openaiConfig, apiKey: $event })"
              />
            </a-form-item>
            <a-form-item label="模型名称">
              <a-input
                :value="openaiConfig.model"
                placeholder="gpt-4o-mini"
                @update:value="emit('update:openaiConfig', { ...openaiConfig, model: $event })"
              />
            </a-form-item>
          </template>

          <template v-else-if="llmProvider === 'ollama'">
            <a-form-item label="本地地址">
              <a-input
                :value="ollamaConfig.baseURL"
                placeholder="http://127.0.0.1:11434"
                @update:value="emit('update:ollamaConfig', { ...ollamaConfig, baseURL: $event })"
              />
            </a-form-item>
            <a-form-item label="模型名称">
              <a-input
                :value="ollamaConfig.model"
                placeholder="gemma4:e4b"
                @update:value="emit('update:ollamaConfig', { ...ollamaConfig, model: $event })"
              />
            </a-form-item>
          </template>

          <a-space>
            <a-button :disabled="llmBusy" @click="emit('reset-llm-settings')">恢复默认</a-button>
            <a-button :disabled="llmBusy" @click="emit('refresh-providers')">刷新状态</a-button>
            <a-button type="primary" :loading="llmBusy" @click="emit('apply-llm-settings')">
              {{ llmBusy ? '保存中...' : '保存并切换' }}
            </a-button>
          </a-space>
        </a-form>
      </a-tab-pane>

      <a-tab-pane key="xfyun" tab="讯飞听写">
        <a-typography-text type="secondary" style="display: block; margin-bottom: 16px;">
          在讯飞开放平台创建「语音听写」应用并开通流式听写，填写下方三项；录音结束后由主进程按官方 WebSocket 协议转写并填入输入框。
        </a-typography-text>
        <a-form layout="vertical">
          <a-form-item label="AppID">
            <a-input
              :value="xfyunConfig.appId"
              placeholder="控制台应用 AppID"
              @update:value="emit('update:xfyunConfig', { ...xfyunConfig, appId: $event })"
            />
          </a-form-item>
          <a-form-item label="API Key">
            <a-input-password
              :value="xfyunConfig.apiKey"
              placeholder="语音听写服务的 API Key"
              @update:value="emit('update:xfyunConfig', { ...xfyunConfig, apiKey: $event })"
            />
          </a-form-item>
          <a-form-item label="API Secret">
            <a-input-password
              :value="xfyunConfig.apiSecret"
              placeholder="语音听写服务的 API Secret"
              @update:value="emit('update:xfyunConfig', { ...xfyunConfig, apiSecret: $event })"
            />
          </a-form-item>
          <a-form-item>
            <a-button type="primary" :disabled="llmBusy" @click="emit('apply-xfyun-settings')">
              保存讯飞配置
            </a-button>
          </a-form-item>
        </a-form>
      </a-tab-pane>

      <a-tab-pane key="theme" tab="外观">
        <a-form layout="vertical">
          <a-form-item label="主题颜色">
            <a-space>
              <input
                :value="themeColor"
                type="color"
                style="width: 40px; height: 32px; padding: 0; border: none; background: transparent; cursor: pointer;"
                @input="updateThemeColor($event.target.value)"
              />
              <a-input
                :value="themeColor"
                placeholder="#1677ff"
                style="width: 120px;"
                @update:value="updateThemeColor($event)"
              />
            </a-space>
          </a-form-item>
          <a-typography-text type="secondary">
            修改后立即生效；「恢复默认」在「对话模型」标签页中操作。
          </a-typography-text>
        </a-form>
      </a-tab-pane>
    </a-tabs>
  </a-modal>
</template>
