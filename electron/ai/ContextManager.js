export class ContextManager {
  constructor({ maxMessages = 12 } = {}) {
    this.maxMessages = maxMessages;
    this.messages = [];
  }

  addMessage(message) {
    if (!message?.role || typeof message.content !== 'string') {
      throw new TypeError('Context message requires role and string content.');
    }

    const normalizedMessage = {
      role: message.role,
      content: message.content,
      createdAt: message.createdAt ?? new Date().toISOString(),
    };

    this.messages.push(normalizedMessage);
    this.trimToWindow();

    return normalizedMessage;
  }

  addUserMessage(content) {
    return this.addMessage({ role: 'user', content });
  }

  addAssistantMessage(content) {
    return this.addMessage({ role: 'assistant', content });
  }

  getMessages() {
    return [...this.messages];
  }

  clear() {
    this.messages = [];
  }

  setMaxMessages(maxMessages) {
    if (!Number.isInteger(maxMessages) || maxMessages < 1) {
      throw new TypeError('maxMessages must be a positive integer.');
    }

    this.maxMessages = maxMessages;
    this.trimToWindow();
  }

  trimToWindow() {
    if (this.messages.length > this.maxMessages) {
      this.messages = this.messages.slice(-this.maxMessages);
    }
  }
}
