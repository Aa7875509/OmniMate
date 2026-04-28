/** @type {AudioContext | null} */
let activePcmAudioContext = null;
/** @type {AudioBufferSourceNode | null} */
let activePcmSource = null;

function stopActivePcmPlayback() {
  try {
    activePcmSource?.stop();
  } catch {
    /* noop */
  }
  activePcmSource = null;
  try {
    void activePcmAudioContext?.close();
  } catch {
    /* noop */
  }
  activePcmAudioContext = null;
}

/**
 * 播放主进程返回的 16kHz mono s16le PCM
 * @param {ArrayBuffer | Uint8Array} pcmBytes
 * @returns {Promise<void>}
 */
function playPcm16kMono(pcmBytes) {
  stopActivePcmPlayback();
  const ab =
    pcmBytes instanceof ArrayBuffer
      ? pcmBytes
      : pcmBytes.buffer.slice(pcmBytes.byteOffset, pcmBytes.byteOffset + pcmBytes.byteLength);
  if (ab.byteLength < 2) {
    return Promise.resolve();
  }
  const sampleCount = ab.byteLength >> 1;
  const ctx = new AudioContext({ sampleRate: 16000 });
  activePcmAudioContext = ctx;
  const int16 = new Int16Array(ab, 0, sampleCount);
  const buffer = ctx.createBuffer(1, sampleCount, 16000);
  const channel = buffer.getChannelData(0);
  for (let i = 0; i < sampleCount; i += 1) {
    channel[i] = int16[i] / 32768;
  }
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.connect(ctx.destination);
  activePcmSource = src;
  return new Promise((resolve) => {
    src.onended = () => {
      stopActivePcmPlayback();
      resolve();
    };
    const start = () => {
      try {
        src.start();
      } catch {
        stopActivePcmPlayback();
        resolve();
      }
    };
    if (ctx.state === 'suspended') {
      void ctx.resume().then(start, () => {
        stopActivePcmPlayback();
        resolve();
      });
    } else {
      start();
    }
  });
}

function useXfyunStreamTts() {
  return Boolean(globalThis.window?.electronAPI?.xfyun?.synthesizeTts);
}

export function stopBrowserTts() {
  try {
    globalThis.speechSynthesis?.cancel();
  } catch {
    /* noop */
  }
  stopActivePcmPlayback();
  if (activeSpeechEnd) {
    const end = activeSpeechEnd;
    activeSpeechEnd = null;
    end();
  }
}

/** 当前一次朗读的结束回调（cancel / 换句 / 自然结束 时只触发一次） */
let activeSpeechEnd = null;

/** 去 Markdown / 代码块与常见噪声，供朗读与 strip 后文本一致 */
export function stripTextForTts(text) {
  if (typeof text !== 'string' || !text) {
    return '';
  }
  let s = text.replace(/```[\s\S]*?```/g, ' ');
  s = s.replace(/`[^`]+`/g, ' ');
  s = s.replace(/!\[[^\]]*]\([^)]+\)/g, ' ');
  s = s.replace(/\[([^\]]+)]\(([^)]+)\)/g, '$1');
  s = s.replace(/[#>*_~|`=]/g, ' ');
  s = s.replace(/\p{Extended_Pictographic}/gu, ' ');
  s = s.replace(/:[a-zA-Z0-9_+-]+:/g, ' ');
  s = s.replace(/[\u200D\uFE0F\uFE00-\uFE0F]+/g, ' ');
  s = s.replace(/[\u2600-\u26FF]/g, ' ');
  s = s.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  s = s
    .split('\n')
    .map((line) => line.replace(/[^\S\n]+/g, ' ').trim())
    .join('\n');
  s = s.replace(/\n{3,}/g, '\n\n');
  return s.trim();
}

function pickZhVoice(list) {
  if (!list?.length) {
    return null;
  }
  return (
    list.find((v) => (v.lang || '').toLowerCase().includes('zh')) ||
    list.find((v) => /(chinese|mandarin|中文)/i.test(`${v.name} ${v.lang || ''}`)) ||
    null
  );
}

/**
 * 朗读文本；与 3D 口型联动时请传入 onStart / onEnd（对应真实播报起止）。
 * 再次调用会先 cancel 当前句并触发上一句的 onEnd。
 *
 * @param {string} text
 * @param {{ onStart?: () => void; onEnd?: () => void }} [options]
 */
export function speakBrowserTts(text, options = {}) {
  if (typeof globalThis === 'undefined' || !globalThis.speechSynthesis || !globalThis.SpeechSynthesisUtterance) {
    options.onEnd?.();
    return Promise.resolve();
  }

  const { onStart, onEnd } = options;
  stopBrowserTts();

  const syn = globalThis.speechSynthesis;
  const plain = typeof text === 'string' ? text.trim() : '';
  if (!plain) {
    onEnd?.();
    return Promise.resolve();
  }

  const u = new globalThis.SpeechSynthesisUtterance(plain);

  return new Promise((resolve) => {
    let voicesTimer = null;
    let utteranceDone = false;

    const finish = () => {
      if (utteranceDone) {
        return;
      }
      utteranceDone = true;
      if (activeSpeechEnd === finish) {
        activeSpeechEnd = null;
      }
      onEnd?.();
      resolve();
    };

    activeSpeechEnd = finish;

    let voicesArmed = false;
    const go = () => {
      if (voicesArmed) {
        return;
      }
      voicesArmed = true;
      if (voicesTimer) {
        clearTimeout(voicesTimer);
        voicesTimer = null;
      }
      syn.removeEventListener('voiceschanged', go);

      const list = syn.getVoices();
      const zh = pickZhVoice(list);
      if (zh) {
        u.voice = zh;
      } else if (list[0]) {
        u.voice = list[0];
      }
      u.onstart = () => {
        onStart?.();
      };
      u.onend = () => finish();
      u.onerror = () => finish();
      syn.speak(u);
    };

    if (syn.getVoices().length) {
      go();
      return;
    }
    syn.addEventListener('voiceschanged', go);
    voicesTimer = globalThis.setTimeout(go, 500);
  });
}

// --- 流式朗读：按句 / 软切分排队，无需等全文结束 ---

let streamQueue = [];
/** 已在 strip 后纯文本中消费掉的字符数 */
let streamSpokenPlainEnd = 0;
let streamTtsSpeakingActive = false;
let streamOnSpeakingChange = null;
let xfyunStreamDrainRunning = false;
/** 递增以打断正在进行的讯飞朗读循环 */
let streamTtsGeneration = 0;

function notifyStreamSpeaking(speaking) {
  if (streamTtsSpeakingActive === speaking) {
    return;
  }
  streamTtsSpeakingActive = speaking;
  streamOnSpeakingChange?.(speaking);
}

function findSentenceConsumeLength(pending) {
  for (let i = 0; i < pending.length; i += 1) {
    const c = pending[i];
    if ('。！？.!?'.includes(c)) {
      let j = i + 1;
      while (j < pending.length && /\s/.test(pending[j])) {
        j += 1;
      }
      const seg = pending.slice(0, j).trim();
      if (seg.length > 0) {
        return { segment: seg, consumed: j };
      }
    }
  }
  return null;
}

const SOFT_MIN = 20;
const SOFT_CAP = 72;

function findSoftBreakConsumeLength(pending) {
  if (pending.length < SOFT_MIN) {
    return null;
  }
  const windowEnd = Math.min(pending.length, 200);
  for (let i = SOFT_MIN; i < windowEnd; i += 1) {
    if ('，,；;'.includes(pending[i])) {
      const j = i + 1;
      const seg = pending.slice(0, j).trim();
      if (seg.length > 0) {
        return { segment: seg, consumed: j };
      }
    }
  }
  for (let i = SOFT_MIN; i < windowEnd; i += 1) {
    if (/\s/.test(pending[i])) {
      const j = i + 1;
      const seg = pending.slice(0, j).trim();
      if (seg.length > 0) {
        return { segment: seg, consumed: j };
      }
    }
  }
  if (pending.length >= SOFT_CAP) {
    const j = SOFT_CAP;
    const seg = pending.slice(0, j).trim();
    if (seg.length > 0) {
      return { segment: seg, consumed: j };
    }
  }
  return null;
}

function pullNextSegment(pending, flush) {
  if (!pending?.length) {
    return null;
  }
  const sent = findSentenceConsumeLength(pending);
  if (sent) {
    return sent;
  }
  if (!flush) {
    return findSoftBreakConsumeLength(pending);
  }
  const t = pending.trim();
  if (!t) {
    return null;
  }
  return { segment: t, consumed: pending.length };
}

async function speakNextQueuedXfyun() {
  if (xfyunStreamDrainRunning) {
    return;
  }
  xfyunStreamDrainRunning = true;
  const gen = streamTtsGeneration;
  const api = globalThis.window?.electronAPI?.xfyun;
  try {
    while (streamQueue.length > 0 && gen === streamTtsGeneration) {
      const raw = streamQueue.shift();
      const text = typeof raw === 'string' ? raw.trim() : '';
      if (!text) {
        continue;
      }
      notifyStreamSpeaking(true);
      try {
        const pcm = await api.synthesizeTts(text);
        if (gen !== streamTtsGeneration) {
          break;
        }
        await playPcm16kMono(pcm);
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') {
          break;
        }
        console.warn('[TTS] 讯飞合成失败', err);
      }
    }
  } finally {
    xfyunStreamDrainRunning = false;
    if (streamQueue.length > 0 && gen === streamTtsGeneration && useXfyunStreamTts()) {
      void speakNextQueuedXfyun();
    } else if (streamQueue.length === 0) {
      notifyStreamSpeaking(false);
    }
  }
}

function speakNextQueued() {
  if (useXfyunStreamTts()) {
    if (streamQueue.length === 0) {
      notifyStreamSpeaking(false);
      return;
    }
    void speakNextQueuedXfyun();
    return;
  }

  const syn = globalThis.speechSynthesis;
  if (typeof globalThis === 'undefined' || !syn?.speak || !globalThis.SpeechSynthesisUtterance) {
    notifyStreamSpeaking(false);
    return;
  }
  if (streamQueue.length === 0) {
    notifyStreamSpeaking(false);
    return;
  }
  const raw = streamQueue.shift();
  const text = typeof raw === 'string' ? raw.trim() : '';
  if (!text) {
    speakNextQueued();
    return;
  }
  const u = new globalThis.SpeechSynthesisUtterance(text);
  let voicesTimer = null;
  let voicesArmed = false;
  const runSpeak = () => {
    if (voicesArmed) {
      return;
    }
    voicesArmed = true;
    if (voicesTimer) {
      clearTimeout(voicesTimer);
      voicesTimer = null;
    }
    syn.removeEventListener('voiceschanged', runSpeak);
    const list = syn.getVoices();
    const zh = pickZhVoice(list);
    if (zh) {
      u.voice = zh;
    } else if (list[0]) {
      u.voice = list[0];
    }
    u.onstart = () => {
      notifyStreamSpeaking(true);
    };
    u.onend = () => {
      speakNextQueued();
    };
    u.onerror = () => {
      speakNextQueued();
    };
    syn.speak(u);
  };
  if (syn.getVoices().length) {
    runSpeak();
  } else {
    syn.addEventListener('voiceschanged', runSpeak);
    voicesTimer = globalThis.setTimeout(runSpeak, 500);
  }
}

function tryDrainStreamQueue() {
  if (useXfyunStreamTts()) {
    if (streamQueue.length === 0 || xfyunStreamDrainRunning) {
      return;
    }
    speakNextQueued();
    return;
  }
  const syn = globalThis.speechSynthesis;
  if (!syn?.speak) {
    return;
  }
  if (streamQueue.length === 0) {
    return;
  }
  if (!syn.speaking && !syn.pending) {
    speakNextQueued();
  }
}

function enqueueStreamSegment(segment) {
  const t = stripTextForTts(segment);
  if (!t) {
    return;
  }
  streamQueue.push(t);
  tryDrainStreamQueue();
}

/**
 * 停止流式朗读并清空队列（新开对话、用户停止时请调用）。
 */
export function stopStreamTts() {
  streamQueue = [];
  streamSpokenPlainEnd = 0;
  streamTtsGeneration += 1;
  globalThis.window?.electronAPI?.xfyun?.cancelTts?.();
  stopBrowserTts();
  notifyStreamSpeaking(false);
}

/**
 * 根据当前助手全文（可不断增长）喂入流式 TTS：一有可读片段就入队，不必等流结束。
 *
 * @param {string} fullRawText 当前助手消息完整 raw 文本
 * @param {{ endOfStream?: boolean; onSpeakingChange?: (speaking: boolean) => void }} [options]
 */
export function feedStreamTts(fullRawText, options = {}) {
  const { endOfStream = false, onSpeakingChange } = options;
  if (typeof onSpeakingChange === 'function') {
    streamOnSpeakingChange = onSpeakingChange;
  }

  if (typeof globalThis === 'undefined') {
    return;
  }
  if (!useXfyunStreamTts() && !globalThis.speechSynthesis) {
    return;
  }

  const plain = stripTextForTts(typeof fullRawText === 'string' ? fullRawText : '');
  if (plain.length < streamSpokenPlainEnd) {
    streamSpokenPlainEnd = plain.length;
  }

  while (true) {
    const pending = plain.slice(streamSpokenPlainEnd);
    if (!pending.length) {
      break;
    }
    const pulled = pullNextSegment(pending, endOfStream);
    if (!pulled) {
      break;
    }
    enqueueStreamSegment(pulled.segment);
    streamSpokenPlainEnd += pulled.consumed;
  }

  tryDrainStreamQueue();
}
