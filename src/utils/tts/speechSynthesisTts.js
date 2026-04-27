export function stopBrowserTts() {
  try {
    globalThis.speechSynthesis?.cancel();
  } catch {
    /* noop */
  }
}

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

/** 先 cancel 再朗读当前全文（流式场景下每次覆盖上一次） */
export function speakBrowserTts(text) {
  if (typeof globalThis === 'undefined' || !globalThis.speechSynthesis || !globalThis.SpeechSynthesisUtterance) {
    return Promise.resolve();
  }
  const syn = globalThis.speechSynthesis;
  syn.cancel();
  const plain = typeof text === 'string' ? text.trim() : '';
  if (!plain) {
    return Promise.resolve();
  }

  const u = new globalThis.SpeechSynthesisUtterance(plain);
  return new Promise((resolve) => {
    let done = false;
    let timer = null;
    const go = () => {
      if (done) {
        return;
      }
      done = true;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      syn.removeEventListener('voiceschanged', go);
      const list = syn.getVoices();
      const zh = pickZhVoice(list);
      if (zh) {
        u.voice = zh;
      } else if (list[0]) {
        u.voice = list[0];
      }
      u.onend = () => resolve();
      u.onerror = () => resolve();
      syn.speak(u);
    };
    if (syn.getVoices().length) {
      go();
      return;
    }
    syn.addEventListener('voiceschanged', go);
    timer = globalThis.setTimeout(go, 500);
  });
}
