export class LLMProvider {
  constructor(config = {}) {
    this.config = config;
  }

  get id() {
    throw new Error('LLMProvider subclasses must implement id.');
  }

  get displayName() {
    return this.id;
  }

  configure(config = {}) {
    this.config = { ...this.config, ...config };
  }

  async chat() {
    throw new Error('LLMProvider subclasses must implement chat().');
  }

  async chatStream({ onChunk, ...payload } = {}) {
    const result = await this.chat(payload);
    if (typeof onChunk === 'function' && result?.content) {
      onChunk(result.content);
    }
    return result;
  }
}
