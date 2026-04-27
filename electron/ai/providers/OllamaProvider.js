import { LLMProvider } from '../LLMProvider.js';

/** 与 App.vue 默认 Ollama 配置保持一致 */
// const DEFAULT_OLLAMA_MODEL = 'llama3.2:3b';
const DEFAULT_OLLAMA_MODEL = 'gemma4:e2b';


export class OllamaProvider extends LLMProvider {
  get id() {
    return 'ollama';
  }

  get displayName() {
    return '本地模型（Ollama）';
  }

  async chat({ messages, prompt, options = {} }) {
    const baseURL = options.baseURL ?? this.config.baseURL ?? 'http://127.0.0.1:11434';
    const model = options.model ?? this.config.model ?? DEFAULT_OLLAMA_MODEL;
    const normalizedBaseURL = baseURL.replace(/\/$/, '');
    const response = await fetch(`${normalizedBaseURL}/api/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages,
        stream: false,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Ollama provider request failed: ${response.status} ${errorText}`);
    }

    const data = await response.json();

    return {
      provider: this.id,
      model,
      content: data.message?.content ?? '',
      raw: data,
      endpoint: normalizedBaseURL,
      prompt,
    };
  }

  async chatStream({ messages, prompt, options = {}, onChunk, signal }) {
    const baseURL = options.baseURL ?? this.config.baseURL ?? 'http://127.0.0.1:11434';
    const model = options.model ?? this.config.model ?? DEFAULT_OLLAMA_MODEL;
    const normalizedBaseURL = baseURL.replace(/\/$/, '');
    const response = await fetch(`${normalizedBaseURL}/api/chat`, {
      method: 'POST',
      signal,
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages,
        stream: true,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Ollama provider request failed: ${response.status} ${errorText}`);
    }

    if (!response.body) {
      throw new Error('Ollama provider stream body is empty.');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let content = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const rawLine of lines) {
        const line = rawLine.replace(/\r$/, '').trim();
        if (!line) {
          continue;
        }

        let parsed;
        try {
          parsed = JSON.parse(line);
        } catch {
          continue;
        }

        // 官方流式：每行 JSON 的 message.content 为增量片段（见 Ollama docs /api/chat）。
        const delta = parsed?.message?.content ?? '';
        if (delta) {
          content += delta;
          onChunk?.(delta);
        }
      }
    }

    return {
      provider: this.id,
      model,
      content,
      raw: null,
      endpoint: normalizedBaseURL,
      prompt,
    };
  }
}
