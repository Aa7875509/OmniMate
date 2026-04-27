/**
 * 使用 Web Speech API（Chromium / Electron 内置），与系统已安装的 TTS 音色配合。
 * @see https://developer.mozilla.org/en-US/docs/Web/API/SpeechSynthesis
 */

export function isSpeechSynthesisAvailable() {
  if (typeof globalThis === 'undefined') {
    return false;
  }
  return (
    typeof globalThis.speechSynthesis !== 'undefined' &&
    typeof globalThis.SpeechSynthesisUtterance !== 'undefined'
  );
}

export function stopBrowserTts() {
  try {
    globalThis.speechSynthesis?.cancel();
  } catch {
    // ignore
  }
}

/**
 * 去 Markdown/代码，不朗读图片、Emoji/绘文字与常见 :shortcode:。
 * @param {string} text
 * @returns {string}
 */
export function stripTextForTts(text) {
  if (typeof text !== 'string' || !text) {
    return '';
  }
  let s = text.replace(/```[\s\S]*?```/g, ' ');
  s = s.replace(/`[^`]+`/g, ' ');
  s = s.replace(/!\[[^\]]*]\([^)]+\)/g, ' ');
  s = s.replace(/\[([^\]]+)]\(([^)]+)\)/g, '$1');
  s = s.replace(/[#>*_~|`=]/g, ' ');
  // Emoji / 绘文字（不朗读）
  s = s.replace(/\p{Extended_Pictographic}/gu, ' ');
  s = s.replace(/:[a-z0-9_+-]+:/gi, ' ');
  s = s.replace(/[\u200D\uFE0F\uFE00-\uFE0F]+/g, ' ');
  s = s.replace(/[\u2600-\u26FF]/g, ' ');
  s = s.replace(/\s+/g, ' ').trim();
  return s;
}

function pickChineseVoice(/** @type {SpeechSynthesisVoice[]} */ list) {
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
 * @param {string} text
 * @param {{
 *   rate?: number;
 *   pitch?: number;
 *   volume?: number;
 *   onStart?: () => void;
 *   onBoundary?: (e: { charIndex: number; charLength: number; name: string }) => void;
 *   cancelBefore?: boolean; 流式多段为 false
 * }} [options]
 * @returns {Promise<void>}
 */
export function speakBrowserTts(text, options = {}) {
  if (!isSpeechSynthesisAvailable()) {
    return Promise.resolve();
  }

  const s = globalThis.speechSynthesis;
  if (options.cancelBefore !== false) {
    s.cancel();
  }
  const plain = typeof text === 'string' ? text.trim() : '';
  if (!plain) {
    return Promise.resolve();
  }

  const u = new globalThis.SpeechSynthesisUtterance(plain);
  u.rate = options.rate != null ? options.rate : 1;
  u.pitch = options.pitch != null ? options.pitch : 1;
  u.volume = options.volume != null ? options.volume : 1;

  const { onStart, onBoundary } = options;

  return new Promise((resolve) => {
    let didFire = false;
    let /** @type {ReturnType<typeof setTimeout> | null} */ voicesTimer = null;
    function onVoices() {
      fire();
    }
    const fire = () => {
      if (didFire) {
        return;
      }
      didFire = true;
      if (voicesTimer) {
        clearTimeout(voicesTimer);
        voicesTimer = null;
      }
      s.removeEventListener('voiceschanged', onVoices);
      const list = s.getVoices();
      const zh = pickChineseVoice(list);
      if (zh) {
        u.voice = zh;
      } else if (list[0]) {
        u.voice = list[0];
      }
      u.onstart = () => {
        onStart?.();
      };
      u.onboundary = (ev) => {
        onBoundary?.({
          charIndex: ev.charIndex ?? 0,
          charLength: ev.charLength ?? 0,
          name: ev.name != null ? String(ev.name) : '',
        });
      };
      u.onend = () => resolve();
      u.onerror = () => resolve();
      s.speak(u);
    };

    if (s.getVoices().length) {
      fire();
      return;
    }
    s.addEventListener('voiceschanged', onVoices);
    voicesTimer = globalThis.setTimeout(() => fire(), 500);
  });
}
