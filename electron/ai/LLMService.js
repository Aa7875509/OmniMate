import { ContextManager } from './ContextManager.js';
import { DEFAULT_SYSTEM_PROMPT } from './defaultSystemPrompt.js';
import { OpenAIProvider } from './providers/OpenAIProvider.js';
import { OllamaProvider } from './providers/OllamaProvider.js';

function buildMessagesWithSystemPrompt(contextMessages) {
  return [{ role: 'system', content: DEFAULT_SYSTEM_PROMPT }, ...contextMessages];
}

export class LLMService {
  constructor({ contextManager = new ContextManager(), providers } = {}) {
    this.contextManager = contextManager;
    this.providers = providers ?? {
      openai: new OpenAIProvider(),
      ollama: new OllamaProvider(),
    };
    this.activeProviderId = 'openai';
  }

  getActiveProvider() {
    const provider = this.providers[this.activeProviderId];

    if (!provider) {
      throw new Error(`Unknown active LLM provider: ${this.activeProviderId}`);
    }

    return provider;
  }

  listProviders() {
    return Object.values(this.providers).map((provider) => ({
      id: provider.id,
      displayName: provider.displayName,
      active: provider.id === this.activeProviderId,
    }));
  }

  switchProvider(providerId, config = {}) {
    const provider = this.providers[providerId];

    if (!provider) {
      throw new Error(`Unsupported LLM provider: ${providerId}`);
    }

    provider.configure(config);
    this.activeProviderId = providerId;

    return {
      id: provider.id,
      displayName: provider.displayName,
      active: true,
    };
  }

  configureProvider(providerId, config = {}) {
    const provider = this.providers[providerId];

    if (!provider) {
      throw new Error(`Unsupported LLM provider: ${providerId}`);
    }

    provider.configure(config);

    return {
      id: provider.id,
      displayName: provider.displayName,
      active: provider.id === this.activeProviderId,
    };
  }

  async chat({ prompt, options = {} }) {
    if (typeof prompt !== 'string' || !prompt.trim()) {
      throw new TypeError('chat prompt must be a non-empty string.');
    }

    const userMessage = this.contextManager.addUserMessage(prompt.trim());
    const provider = this.getActiveProvider();
    const contextRows = this.contextManager.getMessages().map(({ role, content }) => ({ role, content }));
    const messages = buildMessagesWithSystemPrompt(contextRows);
    const result = await provider.chat({ messages, prompt: userMessage.content, options });

    this.contextManager.addAssistantMessage(result.content);

    return {
      ...result,
      context: this.contextManager.getMessages(),
    };
  }

  async chatStream({ prompt, options = {}, onChunk, signal }) {
    if (typeof prompt !== 'string' || !prompt.trim()) {
      throw new TypeError('chat prompt must be a non-empty string.');
    }

    const userMessage = this.contextManager.addUserMessage(prompt.trim());
    const provider = this.getActiveProvider();
    const contextRows = this.contextManager.getMessages().map(({ role, content }) => ({ role, content }));
    const messages = buildMessagesWithSystemPrompt(contextRows);
    const result = await provider.chatStream({
      messages,
      prompt: userMessage.content,
      options,
      onChunk,
      signal,
    });

    this.contextManager.addAssistantMessage(result.content);

    return {
      ...result,
      context: this.contextManager.getMessages(),
    };
  }

  getContext() {
    return this.contextManager.getMessages();
  }

  clearContext() {
    this.contextManager.clear();
    return this.getContext();
  }

  setContextWindow(maxMessages) {
    this.contextManager.setMaxMessages(maxMessages);
    return this.getContext();
  }
}
