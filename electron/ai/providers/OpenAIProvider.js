import { LLMProvider } from '../LLMProvider.js';

export class OpenAIProvider extends LLMProvider {
  get id() {
    return 'openai';
  }

  get displayName() {
    return '云端模型（OpenAI 协议）';
  }

  async chat({ messages, prompt, options = {} }) {
    const apiKey = options.apiKey ?? this.config.apiKey ?? process.env.OPENAI_API_KEY;
    const baseURL = options.baseURL ?? this.config.baseURL ?? 'https://api.openai.com/v1';
    const model = options.model ?? this.config.model ?? 'gpt-4o-mini';

    if (!apiKey) {
      return this.createNotConfiguredResponse({ model, baseURL, prompt });
    }

    const response = await fetch(`${baseURL.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: options.temperature ?? this.config.temperature ?? 0.7,
        stream: false,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OpenAI provider request failed: ${response.status} ${errorText}`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content ?? '';

    return {
      provider: this.id,
      model,
      content,
      raw: data,
    };
  }

  async chatStream({ messages, prompt, options = {}, onChunk, signal }) {
    const apiKey = options.apiKey ?? this.config.apiKey ?? process.env.OPENAI_API_KEY;
    const baseURL = options.baseURL ?? this.config.baseURL ?? 'https://api.openai.com/v1';
    const model = options.model ?? this.config.model ?? 'gpt-4o-mini';

    if (!apiKey) {
      const result = this.createNotConfiguredResponse({ model, baseURL, prompt });
      onChunk?.(result.content);
      return result;
    }

    const response = await fetch(`${baseURL.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: options.temperature ?? this.config.temperature ?? 0.7,
        stream: true,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OpenAI provider request failed: ${response.status} ${errorText}`);
    }

    if (!response.body) {
      throw new Error('OpenAI provider stream body is empty.');
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
        const line = rawLine.trim();
        if (!line || !line.startsWith('data:')) {
          continue;
        }
        const payload = line.slice(5).trim();
        if (payload === '[DONE]') {
          continue;
        }

        let parsed;
        try {
          parsed = JSON.parse(payload);
        } catch {
          continue;
        }

        const delta = parsed?.choices?.[0]?.delta?.content ?? '';
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
    };
  }

  createNotConfiguredResponse({ model, baseURL, prompt }) {
    return {
      provider: this.id,
      model,
      content: `云端模型尚未配置 API Key。已通过统一 LLMProvider 接口收到请求：${prompt}`,
      raw: {
        configured: false,
        baseURL,
      },
    };
  }
}
