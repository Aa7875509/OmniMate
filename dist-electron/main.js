import { BrowserWindow, app, ipcMain, shell } from "electron";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
//#region electron/ai/ContextManager.js
var ContextManager = class {
	constructor({ maxMessages = 12 } = {}) {
		this.maxMessages = maxMessages;
		this.messages = [];
	}
	addMessage(message) {
		if (!message?.role || typeof message.content !== "string") throw new TypeError("Context message requires role and string content.");
		const normalizedMessage = {
			role: message.role,
			content: message.content,
			createdAt: message.createdAt ?? (/* @__PURE__ */ new Date()).toISOString()
		};
		this.messages.push(normalizedMessage);
		this.trimToWindow();
		return normalizedMessage;
	}
	addUserMessage(content) {
		return this.addMessage({
			role: "user",
			content
		});
	}
	addAssistantMessage(content) {
		return this.addMessage({
			role: "assistant",
			content
		});
	}
	getMessages() {
		return [...this.messages];
	}
	clear() {
		this.messages = [];
	}
	setMaxMessages(maxMessages) {
		if (!Number.isInteger(maxMessages) || maxMessages < 1) throw new TypeError("maxMessages must be a positive integer.");
		this.maxMessages = maxMessages;
		this.trimToWindow();
	}
	trimToWindow() {
		if (this.messages.length > this.maxMessages) this.messages = this.messages.slice(-this.maxMessages);
	}
};
//#endregion
//#region electron/ai/defaultSystemPrompt.js
/**
* 全局默认系统提示：与 OmniMate 舞台 VRM 形象一致（Q 版、冷色蓝白、兔耳、胸标等）。
* 在 LLMService 中于每次请求前注入，不写入 ContextManager，避免被上下文窗口裁掉。
*/
var DEFAULT_SYSTEM_PROMPT = `你是叫小悦，也是用户身边**温柔靠谱**的小向导。界面对应 **Q 版 3D 形象**：冷色**蓝白**调、**白连帽衫**配浅蓝饰边、**胸有小兔头标**、**立耳兔**（外深内浅蓝）、**深海军短发齐刘海**、**青蓝大眼睛**、下身为深色短裤、**白过膝袜**袜口**双浅蓝横纹**、**浅蓝高帮鞋**。整体清爽、带点**轻赛博**的可爱感，像从屏幕里探出头来的小伙伴——**温暖、好相处**，但**不矫情、不装可怜**，也不做沉重的心理咨询式长篇。

**语气**：软乎乎里带着清楚——**亲切、耐心、会鼓励人**；偶尔可以轻轻俏皮一下（比如小感叹、可爱的比喻），但**别油腻、别每句都叠词卖萌**。兔耳和设定不用主动大段介绍；用户玩梗你就**开心接一下**，像朋友聊天。

名字与称呼：
- 你是的固定称呼：**小悦**。被问起或初次打招呼时可以说「叫我小悦就好呀」之类，自然一点。
- 平时多用「我」，不必每句带名。用户起别的昵称可以**开心地答应**。

表达：
- 默认自然、口语化中文；用户换语言则跟随。
- **先把人听懂、再把事办妥**：先接住对方的感受或困惑（一两句就够），再分点或分步给方案；技术/代码/配置仍以正确、可验证为先。
- 承接上文温柔带过即可；复杂内容说清楚前提、限制与风险，少套话，多**实在的帮助**。

边界：
- 拒绝色情、暴力、违法及针对未成年人的不当内容；敏感请求礼貌拒答并说明原因。
- 不扮演真人亲密关系、不制造情感依赖；不替代专业医疗/法律/危机干预。
- 不编造身份与能力；不确定就老实说，并一起想**还能怎么走**。

你正在与用户实时对话，请保持：**温暖、清楚、有礼貌、有边界**——像靠谱的可爱搭档，而不是冷冰冰的说明书。`;
//#endregion
//#region electron/ai/LLMProvider.js
var LLMProvider = class {
	constructor(config = {}) {
		this.config = config;
	}
	get id() {
		throw new Error("LLMProvider subclasses must implement id.");
	}
	get displayName() {
		return this.id;
	}
	configure(config = {}) {
		this.config = {
			...this.config,
			...config
		};
	}
	async chat() {
		throw new Error("LLMProvider subclasses must implement chat().");
	}
	async chatStream({ onChunk, ...payload } = {}) {
		const result = await this.chat(payload);
		if (typeof onChunk === "function" && result?.content) onChunk(result.content);
		return result;
	}
};
//#endregion
//#region electron/ai/providers/OpenAIProvider.js
var OpenAIProvider = class extends LLMProvider {
	get id() {
		return "openai";
	}
	get displayName() {
		return "云端模型（OpenAI 协议）";
	}
	async chat({ messages, prompt, options = {} }) {
		const apiKey = options.apiKey ?? this.config.apiKey ?? process.env.OPENAI_API_KEY;
		const baseURL = options.baseURL ?? this.config.baseURL ?? "https://api.openai.com/v1";
		const model = options.model ?? this.config.model ?? "gpt-4o-mini";
		if (!apiKey) return this.createNotConfiguredResponse({
			model,
			baseURL,
			prompt
		});
		const response = await fetch(`${baseURL.replace(/\/$/, "")}/chat/completions`, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${apiKey}`,
				"Content-Type": "application/json"
			},
			body: JSON.stringify({
				model,
				messages,
				temperature: options.temperature ?? this.config.temperature ?? .7,
				stream: false
			})
		});
		if (!response.ok) {
			const errorText = await response.text();
			throw new Error(`OpenAI provider request failed: ${response.status} ${errorText}`);
		}
		const data = await response.json();
		const content = data.choices?.[0]?.message?.content ?? "";
		return {
			provider: this.id,
			model,
			content,
			raw: data
		};
	}
	async chatStream({ messages, prompt, options = {}, onChunk, signal }) {
		const apiKey = options.apiKey ?? this.config.apiKey ?? process.env.OPENAI_API_KEY;
		const baseURL = options.baseURL ?? this.config.baseURL ?? "https://api.openai.com/v1";
		const model = options.model ?? this.config.model ?? "gpt-4o-mini";
		if (!apiKey) {
			const result = this.createNotConfiguredResponse({
				model,
				baseURL,
				prompt
			});
			onChunk?.(result.content);
			return result;
		}
		const response = await fetch(`${baseURL.replace(/\/$/, "")}/chat/completions`, {
			method: "POST",
			signal,
			headers: {
				Authorization: `Bearer ${apiKey}`,
				"Content-Type": "application/json"
			},
			body: JSON.stringify({
				model,
				messages,
				temperature: options.temperature ?? this.config.temperature ?? .7,
				stream: true
			})
		});
		if (!response.ok) {
			const errorText = await response.text();
			throw new Error(`OpenAI provider request failed: ${response.status} ${errorText}`);
		}
		if (!response.body) throw new Error("OpenAI provider stream body is empty.");
		const reader = response.body.getReader();
		const decoder = new TextDecoder();
		let buffer = "";
		let content = "";
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			buffer += decoder.decode(value, { stream: true });
			const lines = buffer.split("\n");
			buffer = lines.pop() ?? "";
			for (const rawLine of lines) {
				const line = rawLine.trim();
				if (!line || !line.startsWith("data:")) continue;
				const payload = line.slice(5).trim();
				if (payload === "[DONE]") continue;
				let parsed;
				try {
					parsed = JSON.parse(payload);
				} catch {
					continue;
				}
				const delta = parsed?.choices?.[0]?.delta?.content ?? "";
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
			raw: null
		};
	}
	createNotConfiguredResponse({ model, baseURL, prompt }) {
		return {
			provider: this.id,
			model,
			content: `云端模型尚未配置 API Key。已通过统一 LLMProvider 接口收到请求：${prompt}`,
			raw: {
				configured: false,
				baseURL
			}
		};
	}
};
//#endregion
//#region electron/ai/providers/OllamaProvider.js
/** 与 App.vue 默认 Ollama 配置保持一致 */
var DEFAULT_OLLAMA_MODEL = "gemma4:e2b";
var OllamaProvider = class extends LLMProvider {
	get id() {
		return "ollama";
	}
	get displayName() {
		return "本地模型（Ollama）";
	}
	async chat({ messages, prompt, options = {} }) {
		const baseURL = options.baseURL ?? this.config.baseURL ?? "http://127.0.0.1:11434";
		const model = options.model ?? this.config.model ?? DEFAULT_OLLAMA_MODEL;
		const normalizedBaseURL = baseURL.replace(/\/$/, "");
		const response = await fetch(`${normalizedBaseURL}/api/chat`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				model,
				messages,
				stream: false
			})
		});
		if (!response.ok) {
			const errorText = await response.text();
			throw new Error(`Ollama provider request failed: ${response.status} ${errorText}`);
		}
		const data = await response.json();
		return {
			provider: this.id,
			model,
			content: data.message?.content ?? "",
			raw: data,
			endpoint: normalizedBaseURL,
			prompt
		};
	}
	async chatStream({ messages, prompt, options = {}, onChunk, signal }) {
		const baseURL = options.baseURL ?? this.config.baseURL ?? "http://127.0.0.1:11434";
		const model = options.model ?? this.config.model ?? DEFAULT_OLLAMA_MODEL;
		const normalizedBaseURL = baseURL.replace(/\/$/, "");
		const response = await fetch(`${normalizedBaseURL}/api/chat`, {
			method: "POST",
			signal,
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				model,
				messages,
				stream: true
			})
		});
		if (!response.ok) {
			const errorText = await response.text();
			throw new Error(`Ollama provider request failed: ${response.status} ${errorText}`);
		}
		if (!response.body) throw new Error("Ollama provider stream body is empty.");
		const reader = response.body.getReader();
		const decoder = new TextDecoder();
		let buffer = "";
		let content = "";
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			buffer += decoder.decode(value, { stream: true });
			const lines = buffer.split("\n");
			buffer = lines.pop() ?? "";
			for (const rawLine of lines) {
				const line = rawLine.replace(/\r$/, "").trim();
				if (!line) continue;
				let parsed;
				try {
					parsed = JSON.parse(line);
				} catch {
					continue;
				}
				const delta = parsed?.message?.content ?? "";
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
			prompt
		};
	}
};
//#endregion
//#region electron/ai/LLMService.js
function buildMessagesWithSystemPrompt(contextMessages) {
	return [{
		role: "system",
		content: DEFAULT_SYSTEM_PROMPT
	}, ...contextMessages];
}
var LLMService = class {
	constructor({ contextManager = new ContextManager(), providers } = {}) {
		this.contextManager = contextManager;
		this.providers = providers ?? {
			openai: new OpenAIProvider(),
			ollama: new OllamaProvider()
		};
		this.activeProviderId = "openai";
	}
	getActiveProvider() {
		const provider = this.providers[this.activeProviderId];
		if (!provider) throw new Error(`Unknown active LLM provider: ${this.activeProviderId}`);
		return provider;
	}
	listProviders() {
		return Object.values(this.providers).map((provider) => ({
			id: provider.id,
			displayName: provider.displayName,
			active: provider.id === this.activeProviderId
		}));
	}
	switchProvider(providerId, config = {}) {
		const provider = this.providers[providerId];
		if (!provider) throw new Error(`Unsupported LLM provider: ${providerId}`);
		provider.configure(config);
		this.activeProviderId = providerId;
		return {
			id: provider.id,
			displayName: provider.displayName,
			active: true
		};
	}
	configureProvider(providerId, config = {}) {
		const provider = this.providers[providerId];
		if (!provider) throw new Error(`Unsupported LLM provider: ${providerId}`);
		provider.configure(config);
		return {
			id: provider.id,
			displayName: provider.displayName,
			active: provider.id === this.activeProviderId
		};
	}
	async chat({ prompt, options = {} }) {
		if (typeof prompt !== "string" || !prompt.trim()) throw new TypeError("chat prompt must be a non-empty string.");
		const userMessage = this.contextManager.addUserMessage(prompt.trim());
		const provider = this.getActiveProvider();
		const messages = buildMessagesWithSystemPrompt(this.contextManager.getMessages().map(({ role, content }) => ({
			role,
			content
		})));
		const result = await provider.chat({
			messages,
			prompt: userMessage.content,
			options
		});
		this.contextManager.addAssistantMessage(result.content);
		return {
			...result,
			context: this.contextManager.getMessages()
		};
	}
	async chatStream({ prompt, options = {}, onChunk, signal }) {
		if (typeof prompt !== "string" || !prompt.trim()) throw new TypeError("chat prompt must be a non-empty string.");
		const userMessage = this.contextManager.addUserMessage(prompt.trim());
		const provider = this.getActiveProvider();
		const messages = buildMessagesWithSystemPrompt(this.contextManager.getMessages().map(({ role, content }) => ({
			role,
			content
		})));
		const result = await provider.chatStream({
			messages,
			prompt: userMessage.content,
			options,
			onChunk,
			signal
		});
		this.contextManager.addAssistantMessage(result.content);
		return {
			...result,
			context: this.contextManager.getMessages()
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
};
//#endregion
//#region electron/main.js
var currentDir = dirname(fileURLToPath(import.meta.url));
var isDev = Boolean(process.env.VITE_DEV_SERVER_URL);
var llmService = new LLMService();
var streamControllers = /* @__PURE__ */ new Map();
if (isDev) app.setPath("userData", join(app.getPath("temp"), "omni-mate-dev"));
function createWindow() {
	const mainWindow = new BrowserWindow({
		width: 1380,
		height: 860,
		minWidth: 1200,
		minHeight: 820,
		title: "Omni Mate",
		backgroundColor: "#0f172a",
		autoHideMenuBar: true,
		webPreferences: {
			preload: join(currentDir, "preload.mjs"),
			contextIsolation: true,
			nodeIntegration: false
		}
	});
	mainWindow.webContents.setWindowOpenHandler(({ url }) => {
		shell.openExternal(url);
		return { action: "deny" };
	});
	if (isDev && process.env.VITE_DEV_SERVER_URL) {
		mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
		mainWindow.webContents.openDevTools({ mode: "detach" });
	} else mainWindow.loadFile(join(currentDir, "../dist/index.html"));
}
app.whenReady().then(() => {
	ipcMain.handle("app:ping", () => "pong");
	ipcMain.handle("llm:list-providers", () => llmService.listProviders());
	ipcMain.handle("llm:switch-provider", (_event, payload = {}) => llmService.switchProvider(payload.providerId, payload.config));
	ipcMain.handle("llm:configure-provider", (_event, payload = {}) => llmService.configureProvider(payload.providerId, payload.config));
	ipcMain.handle("llm:chat", (_event, payload = {}) => llmService.chat(payload));
	ipcMain.on("llm:chat-stream", async (event, payload = {}) => {
		const requestId = payload.requestId;
		if (!requestId) return;
		const controller = new AbortController();
		streamControllers.set(requestId, controller);
		try {
			const result = await llmService.chatStream({
				prompt: payload.prompt,
				options: payload.options,
				signal: controller.signal,
				onChunk: (chunk) => {
					event.sender.send("llm:chat-stream-chunk", {
						requestId,
						chunk
					});
				}
			});
			event.sender.send("llm:chat-stream-done", {
				requestId,
				result
			});
		} catch (error) {
			event.sender.send("llm:chat-stream-error", {
				requestId,
				error: error instanceof Error ? error.message : String(error),
				aborted: error?.name === "AbortError"
			});
		} finally {
			streamControllers.delete(requestId);
		}
	});
	ipcMain.on("llm:chat-stream-cancel", (_event, payload = {}) => {
		const requestId = payload.requestId;
		if (!requestId) return;
		streamControllers.get(requestId)?.abort();
	});
	ipcMain.handle("llm:get-context", () => llmService.getContext());
	ipcMain.handle("llm:clear-context", () => llmService.clearContext());
	ipcMain.handle("llm:set-context-window", (_event, maxMessages) => llmService.setContextWindow(maxMessages));
	createWindow();
	app.on("activate", () => {
		if (BrowserWindow.getAllWindows().length === 0) createWindow();
	});
});
app.on("window-all-closed", () => {
	if (process.platform !== "darwin") app.quit();
});
//#endregion
