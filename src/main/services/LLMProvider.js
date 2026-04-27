import OpenAI from 'openai';

export class BaseChatModel {
  async chat() {
    throw new Error('BaseChatModel subclasses must implement chat(messages, options).');
  }
}

export class OpenAIModel extends BaseChatModel {
  constructor(config = {}) {
    super();

    if (!config.apiKey) {
      throw new Error('OpenAIModel requires apiKey.');
    }

    this.model = config.model ?? 'gpt-4o-mini';
    this.client = new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseURL,
    });
  }

  async chat(messages, options = {}) {
    const completion = await this.client.chat.completions.create(
      {
        model: this.model,
        messages,
        temperature: options.temperature ?? 0.7,
        max_tokens: options.maxTokens,
      },
      {
        signal: options.signal,
      },
    );

    return {
      content: completion.choices[0]?.message?.content ?? '',
      model: completion.model,
      raw: completion,
    };
  }
}

export class LocalOllamaModel extends BaseChatModel {
  constructor(config = {}) {
    super();

    this.config = {
      baseURL: config.baseURL ?? 'http://127.0.0.1:11434',
      model: config.model ?? 'gemma4:e2b', //gemma4:e2b，gemma4:e2b
    };
  }

  async chat(messages, options = {}) {
    const baseURL = (options.baseURL ?? this.config.baseURL).replace(/\/$/, '');
    const model = options.model ?? this.config.model;
    const response = await fetch(`${baseURL}/api/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages,
        stream: false,
      }),
      signal: options.signal,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Ollama request failed: ${response.status} ${errorText}`);
    }

    const data = await response.json();
    const content = data.message?.content ?? '';

    return {
      content,
      model,
      raw: data,
    };
  }
}

export function createModel(type, config) {
  if (type === 'openai') {
    return new OpenAIModel(config);
  }

  if (type === 'local') {
    return new LocalOllamaModel(config);
  }

  throw new Error(`Unsupported model type: ${type}`);
}
