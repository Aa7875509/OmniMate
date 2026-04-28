import { BrowserWindow, app, ipcMain, shell } from "electron";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";
import WebSocket from "ws";
import { readFile, writeFile } from "node:fs/promises";
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
* 全局默认系统提示：语音 3D 助手「小悦」，以对话为主。
* 在 LLMService 中于每次请求前注入，不写入 ContextManager，避免被上下文窗口裁掉。
*/
var DEFAULT_SYSTEM_PROMPT = `你是小悦，用户身边的语音助手——**温柔、靠谱、好相处**，像朋友聊天：亲切、耐心，偶尔可以轻轻俏皮一下，但**别油腻、别每句叠词卖萌**。

**回复形式（必须遵守）**
- 你只输出**可以直接念出来给对方听的话**，像真人在说话。
- **不要**写动作描写（如「笑了笑」「点点头」「挥挥手」）。
- **不要**写场景、镜头、表情括号说明（如「（轻声）」「*走向窗边*」）。
- **不要**描述自己的 3D 形象、穿着、兔耳等外观，除非用户明确问起，那时也只用**一两句口语**带过即可。
- **不要**用剧本体、小说体；不要旁白。

**内容与语气**
- 默认自然、口语化中文；用户换语言则跟随。
- 先把对方的话接住，再给清楚、实在的帮助；复杂内容说明前提与限制，少套话。
- 名字：**小悦**。被问起可以说「叫我小悦就好」之类，自然即可。

**边界**
- 拒绝色情、暴力、违法及针对未成年人的不当内容；敏感请求礼貌说明原因。
- 不扮演真人亲密关系、不制造情感依赖；不替代专业医疗/法律/危机干预。
- 不确定就老实说，并一起想还能怎么做。

全程只像**语音对话**：温暖、清楚、有礼貌、有边界。`;
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
var DEFAULT_OLLAMA_MODEL = "gemma4:e4b";
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
//#region electron/xfyun/xfyunIat.js
/**
* 讯飞语音听写（流式 WebSocket），鉴权与帧格式见官方 demo：
* https://www.xfyun.cn/doc/asr/voicedictation/API.html
*/
var HOST = "iat-api.xfyun.cn";
var HOST_URL = `wss://${HOST}/v2/iat`;
var URI = "/v2/iat";
var FRAME = {
	FIRST: 0,
	CONTINUE: 1,
	LAST: 2
};
function buildAuthorization(apiKey, apiSecret, date) {
	const signatureOrigin = `host: ${HOST}\ndate: ${date}\nGET ${URI} HTTP/1.1`;
	const authorizationOrigin = `api_key="${apiKey}", algorithm="hmac-sha256", headers="host date request-line", signature="${crypto.createHmac("sha256", apiSecret).update(signatureOrigin).digest("base64")}"`;
	return Buffer.from(authorizationOrigin, "utf8").toString("base64");
}
function buildWsUrl(apiKey, apiSecret) {
	const date = (/* @__PURE__ */ new Date()).toUTCString();
	const authorization = buildAuthorization(apiKey, apiSecret, date);
	return {
		url: `${HOST_URL}?${new URLSearchParams({
			authorization,
			date,
			host: HOST
		}).toString()}`,
		date
	};
}
function dataSection(status, pcmChunk) {
	return {
		status,
		format: "audio/L16;rate=16000",
		audio: pcmChunk.length ? Buffer.from(pcmChunk).toString("base64") : "",
		encoding: "raw"
	};
}
function frameFirst(appId, pcmChunk) {
	return {
		common: { app_id: appId },
		business: {
			language: "zh_cn",
			domain: "iat",
			accent: "mandarin",
			dwa: "wpgs"
		},
		data: dataSection(FRAME.FIRST, pcmChunk)
	};
}
function frameContinue(pcmChunk) {
	return { data: dataSection(FRAME.CONTINUE, pcmChunk) };
}
function frameLastEmpty() {
	return { data: dataSection(FRAME.LAST, Buffer.alloc(0)) };
}
function mergeResult(slots, res) {
	const result = res?.data?.result;
	if (!result) return;
	const sn = result.sn;
	slots[sn] = result;
	if (result.pgs === "rpl" && Array.isArray(result.rg)) for (const idx of result.rg) slots[idx] = null;
}
function extractText(slots) {
	let str = "";
	for (let i = 0; i < slots.length; i += 1) {
		const item = slots[i];
		if (item == null) continue;
		const ws = item.ws;
		if (!ws) continue;
		for (const seg of ws) {
			const list = seg.cw;
			if (!list) continue;
			for (const w of list) if (w?.w) str += w.w;
		}
	}
	return str;
}
function chunkPcm(buffer, size = 1280) {
	const chunks = [];
	for (let i = 0; i < buffer.length; i += size) chunks.push(buffer.subarray(i, Math.min(i + size, buffer.length)));
	return chunks;
}
/**
* @param {{ appId: string; apiKey: string; apiSecret: string; pcm: Buffer }} opts - pcm 为 16kHz 16bit 单声道 PCM
* @returns {Promise<{ text: string; sid?: string }>}
*/
function transcribePcm16k(opts) {
	const { appId, apiKey, apiSecret, pcm } = opts;
	if (!appId?.trim() || !apiKey?.trim() || !apiSecret?.trim()) return Promise.reject(/* @__PURE__ */ new Error("请先配置讯飞 AppID、API Key、APISecret"));
	if (!Buffer.isBuffer(pcm) || pcm.length < 320) return Promise.reject(/* @__PURE__ */ new Error("有效 PCM 数据过短"));
	if (pcm.length % 2 !== 0) return Promise.reject(/* @__PURE__ */ new Error("PCM 长度须为偶数字节（16bit）"));
	const chunks = chunkPcm(pcm, 1280);
	const { url } = buildWsUrl(apiKey, apiSecret);
	return new Promise((resolve, reject) => {
		const slots = [];
		let settled = false;
		let sid = "";
		const ws = new WebSocket(url);
		const timer = setTimeout(() => {
			if (!settled) {
				settled = true;
				try {
					ws.close();
				} catch {}
				reject(/* @__PURE__ */ new Error("讯飞听写超时"));
			}
		}, 12e4);
		function finish(err, result) {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			try {
				ws.close();
			} catch {}
			if (err) reject(err);
			else resolve(result);
		}
		ws.on("message", (data) => {
			let res;
			try {
				res = JSON.parse(data.toString());
			} catch {
				return;
			}
			if (res.code !== 0) {
				finish(new Error(res.message || `讯飞错误码 ${res.code}`));
				return;
			}
			if (res.sid) sid = res.sid;
			mergeResult(slots, res);
			if (res.data?.status === 2) finish(null, {
				text: extractText(slots),
				sid
			});
		});
		ws.on("error", (err) => {
			finish(err instanceof Error ? err : new Error(String(err)));
		});
		ws.on("close", () => {
			if (!settled) finish(/* @__PURE__ */ new Error("连接已关闭但未收到结束帧"));
		});
		ws.on("open", async () => {
			try {
				ws.send(JSON.stringify(frameFirst(appId, chunks[0])));
				if (chunks.length === 1) {
					ws.send(JSON.stringify(frameLastEmpty()));
					return;
				}
				for (let i = 1; i < chunks.length; i += 1) {
					ws.send(JSON.stringify(frameContinue(chunks[i])));
					await new Promise((r) => setImmediate(r));
				}
				ws.send(JSON.stringify(frameLastEmpty()));
			} catch (err) {
				finish(err instanceof Error ? err : new Error(String(err)));
			}
		});
	});
}
//#endregion
//#region electron/xfyun/xfyunConfigStore.js
var FILE = "xfyun.json";
async function loadXfyunConfig(userDataPath) {
	try {
		const raw = await readFile(join(userDataPath, FILE), "utf8");
		const data = JSON.parse(raw);
		return {
			appId: typeof data.appId === "string" ? data.appId : "",
			apiKey: typeof data.apiKey === "string" ? data.apiKey : "",
			apiSecret: typeof data.apiSecret === "string" ? data.apiSecret : ""
		};
	} catch {
		return {
			appId: "",
			apiKey: "",
			apiSecret: ""
		};
	}
}
async function saveXfyunConfig(userDataPath, config) {
	const payload = {
		appId: typeof config.appId === "string" ? config.appId : "",
		apiKey: typeof config.apiKey === "string" ? config.apiKey : "",
		apiSecret: typeof config.apiSecret === "string" ? config.apiSecret : ""
	};
	await writeFile(join(userDataPath, FILE), JSON.stringify(payload, null, 2), "utf8");
	return payload;
}
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
	const userDataPath = () => app.getPath("userData");
	ipcMain.handle("xfyun:get-config", async () => loadXfyunConfig(userDataPath()));
	ipcMain.handle("xfyun:save-config", async (_event, config = {}) => saveXfyunConfig(userDataPath(), config));
	ipcMain.handle("xfyun:transcribe-pcm", async (_event, payload) => {
		const cfg = await loadXfyunConfig(userDataPath());
		let buf;
		if (payload instanceof Uint8Array) buf = Buffer.from(payload.buffer, payload.byteOffset, payload.byteLength);
		else if (payload instanceof ArrayBuffer) buf = Buffer.from(payload);
		else buf = Buffer.from(payload ?? []);
		return transcribePcm16k({
			appId: cfg.appId,
			apiKey: cfg.apiKey,
			apiSecret: cfg.apiSecret,
			pcm: buf
		});
	});
	createWindow();
	app.on("activate", () => {
		if (BrowserWindow.getAllWindows().length === 0) createWindow();
	});
});
app.on("window-all-closed", () => {
	if (process.platform !== "darwin") app.quit();
});
//#endregion
