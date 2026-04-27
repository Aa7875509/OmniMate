<script setup>
defineProps({
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
      model: 'gemma4:e2b',
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

const emit = defineEmits([
  'close',
  'update:llmProvider',
  'update:openaiConfig',
  'update:ollamaConfig',
  'update:themeColor',
  'apply-llm-settings',
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
            placeholder="gemma4:e2b"
            @update:value="emit('update:ollamaConfig', { ...ollamaConfig, model: $event })"
          />
        </a-form-item>
      </template>

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

      <a-alert v-if="llmStatus" :message="llmStatus" type="info" show-icon style="margin-bottom: 16px;" />

      <a-space>
        <a-button :disabled="llmBusy" @click="emit('reset-llm-settings')">恢复默认</a-button>
        <a-button :disabled="llmBusy" @click="emit('refresh-providers')">刷新状态</a-button>
        <a-button type="primary" :loading="llmBusy" @click="emit('apply-llm-settings')">
          {{ llmBusy ? '保存中...' : '保存并切换' }}
        </a-button>
      </a-space>
    </a-form>
  </a-modal>
</template>
