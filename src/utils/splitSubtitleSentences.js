/**
 * 将一段文字按句末标点拆成卡拉 OK 短句（单段内换行视作空格）。
 * @param {string} paragraph
 * @returns {string[]}
 */
function splitParagraphSentences(paragraph) {
  const s = paragraph.replace(/\s+/g, ' ').trim();
  if (!s) {
    return [];
  }

  const sentences = [];
  let buf = '';
  let i = 0;

  while (i < s.length) {
    const ch = s[i];

    if (ch === '.' && s[i + 1] === '.' && s[i + 2] === '.') {
      buf += '...';
      i += 3;
      while (i < s.length && /[」'"')\]]/.test(s[i])) {
        buf += s[i];
        i += 1;
      }
      const t = buf.trim();
      if (t) {
        sentences.push(t);
      }
      buf = '';
      continue;
    }

    buf += ch;

    let isBoundary = /[。！？!?；;…]/.test(ch);

    if (ch === '.') {
      const next = s[i + 1] ?? '';
      const prev = buf.length >= 2 ? buf[buf.length - 2] : '';
      if (/[0-9]/.test(prev) && /[0-9]/.test(next)) {
        isBoundary = false;
      } else if (/[a-zA-Z]/.test(next)) {
        isBoundary = false;
      } else {
        isBoundary = true;
      }
    }

    i += 1;

    if (!isBoundary) {
      continue;
    }

    while (i < s.length && /[」'"')\]]/.test(s[i])) {
      buf += s[i];
      i += 1;
    }

    const t = buf.trim();
    if (t) {
      sentences.push(t);
    }
    buf = '';
  }

  const rest = buf.trim();
  if (rest) {
    sentences.push(rest);
  }
  return sentences;
}

/**
 * 字幕拆句：段落之间（空行）保留为段落间距标记。
 * @param {string} text
 * @returns {{ text: string, paragraphBreakAfter: boolean }[]}
 */
export function splitSubtitleSentences(text) {
  const items = [];
  if (typeof text !== 'string' || !text.trim()) {
    return items;
  }

  const normalized = text.replace(/\r\n/g, '\n');
  const paragraphs = normalized.split(/\n{2,}/);

  for (let pi = 0; pi < paragraphs.length; pi += 1) {
    const para = paragraphs[pi].replace(/[ \t]*\n[ \t]*/g, ' ').trim();
    if (!para) {
      continue;
    }
    const sents = splitParagraphSentences(para);
    const lastPi = pi === paragraphs.length - 1;
    for (let si = 0; si < sents.length; si += 1) {
      const lastInPara = si === sents.length - 1;
      items.push({
        text: sents[si],
        paragraphBreakAfter: lastInPara && !lastPi,
      });
    }
  }

  return items;
}
