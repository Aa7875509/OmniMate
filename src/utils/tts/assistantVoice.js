/**
 * 流式口播：换引擎时只改本文件 + speechSynthesisTts.js
 */
import { isSpeechSynthesisAvailable, speakBrowserTts, stopBrowserTts, stripTextForTts } from './speechSynthesisTts.js';

export { stripTextForTts } from './speechSynthesisTts.js';

export function stopAssistantVoice() {
  stopBrowserTts();
}

/** 从 from 起切下一段；isFinal 时无句末标点则把剩余全并入 */
function nextSegmentEnd(plain, from, isFinal) {
  if (from >= plain.length) {
    return isFinal ? from : -1;
  }
  const rest = plain.slice(from);
  for (let i = 0; i < rest.length; i += 1) {
    if (rest[i] === '\n' || /[。！？!?；;]/.test(rest[i])) {
      return from + i + 1;
    }
  }
  if (isFinal) {
    return plain.length;
  }
  return rest.length >= 40 ? from + 40 : -1;
}

/**
 * onChunk: ingest(plain, false) · 流结束: ingest(plain, true)
 */
export function createStreamAssistantVoice(hooks) {
  const { getPlain, setSpeechHold, setDisplayEnd } = hooks;
  let from = 0;
  let pending = 0;
  let closed = false;
  let firstUtt = true;

  function doneIfIdle() {
    if (pending > 0 || !closed) {
      return;
    }
    if (from < getPlain().length) {
      return;
    }
    setDisplayEnd(null);
    setSpeechHold(false);
  }

  function speakSeg(seg, g0, g1) {
    if (!seg.trim()) {
      return;
    }
    pending += 1;
    setSpeechHold(true);
    const cancelBefore = firstUtt;
    firstUtt = false;
    void speakBrowserTts(seg, {
      cancelBefore,
      onStart: () => setDisplayEnd(g0),
      onBoundary: (e) => {
        const t = g0 + e.charIndex + (e.charLength || 0);
        const p = getPlain();
        setDisplayEnd(Math.min(t, p.length));
      },
    }).then(() => {
      setDisplayEnd(Math.min(g1, getPlain().length));
      pending -= 1;
      doneIfIdle();
    });
  }

  return {
    ingest(plain, isFinal) {
      if (!isSpeechSynthesisAvailable()) {
        if (isFinal) {
          closed = true;
        }
        return;
      }
      if (isFinal) {
        closed = true;
      }
      for (let n = 0; n < 200; n += 1) {
        const end = nextSegmentEnd(plain, from, isFinal);
        if (end < 0 || end <= from) {
          break;
        }
        const g0 = from;
        from = end;
        speakSeg(plain.slice(g0, end), g0, end);
      }
      if (pending === 0) {
        doneIfIdle();
      }
    },
  };
}
