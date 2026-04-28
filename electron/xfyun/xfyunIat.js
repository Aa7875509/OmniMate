/**
 * 讯飞语音听写（流式 WebSocket），鉴权与帧格式见官方 demo：
 * https://www.xfyun.cn/doc/asr/voicedictation/API.html
 */
import crypto from 'node:crypto';
import WebSocket from 'ws';

const HOST = 'iat-api.xfyun.cn';
const HOST_URL = `wss://${HOST}/v2/iat`;
const URI = '/v2/iat';

const FRAME = {
  FIRST: 0,
  CONTINUE: 1,
  LAST: 2,
};

function buildAuthorization(apiKey, apiSecret, date) {
  const signatureOrigin = `host: ${HOST}\ndate: ${date}\nGET ${URI} HTTP/1.1`;
  const signature = crypto.createHmac('sha256', apiSecret).update(signatureOrigin).digest('base64');
  const authorizationOrigin = `api_key="${apiKey}", algorithm="hmac-sha256", headers="host date request-line", signature="${signature}"`;
  return Buffer.from(authorizationOrigin, 'utf8').toString('base64');
}

function buildWsUrl(apiKey, apiSecret) {
  const date = new Date().toUTCString();
  const authorization = buildAuthorization(apiKey, apiSecret, date);
  const q = new URLSearchParams({
    authorization,
    date,
    host: HOST,
  });
  return { url: `${HOST_URL}?${q.toString()}`, date };
}

function dataSection(status, pcmChunk) {
  return {
    status,
    format: 'audio/L16;rate=16000',
    audio: pcmChunk.length ? Buffer.from(pcmChunk).toString('base64') : '',
    encoding: 'raw',
  };
}

function frameFirst(appId, pcmChunk) {
  return {
    common: { app_id: appId },
    business: {
      language: 'zh_cn',
      domain: 'iat',
      accent: 'mandarin',
      dwa: 'wpgs',
    },
    data: dataSection(FRAME.FIRST, pcmChunk),
  };
}

function frameContinue(pcmChunk) {
  return {
    data: dataSection(FRAME.CONTINUE, pcmChunk),
  };
}

function frameLastEmpty() {
  return {
    data: dataSection(FRAME.LAST, Buffer.alloc(0)),
  };
}

function mergeResult(slots, res) {
  const result = res?.data?.result;
  if (!result) {
    return;
  }
  const sn = result.sn;
  slots[sn] = result;
  if (result.pgs === 'rpl' && Array.isArray(result.rg)) {
    for (const idx of result.rg) {
      slots[idx] = null;
    }
  }
}

function extractText(slots) {
  let str = '';
  for (let i = 0; i < slots.length; i += 1) {
    const item = slots[i];
    if (item == null) {
      continue;
    }
    const ws = item.ws;
    if (!ws) {
      continue;
    }
    for (const seg of ws) {
      const list = seg.cw;
      if (!list) {
        continue;
      }
      for (const w of list) {
        if (w?.w) {
          str += w.w;
        }
      }
    }
  }
  return str;
}

function chunkPcm(buffer, size = 1280) {
  const chunks = [];
  for (let i = 0; i < buffer.length; i += size) {
    chunks.push(buffer.subarray(i, Math.min(i + size, buffer.length)));
  }
  return chunks;
}

/**
 * @param {{ appId: string; apiKey: string; apiSecret: string; pcm: Buffer }} opts - pcm 为 16kHz 16bit 单声道 PCM
 * @returns {Promise<{ text: string; sid?: string }>}
 */
export function transcribePcm16k(opts) {
  const { appId, apiKey, apiSecret, pcm } = opts;
  if (!appId?.trim() || !apiKey?.trim() || !apiSecret?.trim()) {
    return Promise.reject(new Error('请先配置讯飞 AppID、API Key、APISecret'));
  }
  if (!Buffer.isBuffer(pcm) || pcm.length < 320) {
    return Promise.reject(new Error('有效 PCM 数据过短'));
  }
  if (pcm.length % 2 !== 0) {
    return Promise.reject(new Error('PCM 长度须为偶数字节（16bit）'));
  }

  const chunks = chunkPcm(pcm, 1280);
  const { url } = buildWsUrl(apiKey, apiSecret);

  return new Promise((resolve, reject) => {
    const slots = [];
    let settled = false;
    let sid = '';

    const ws = new WebSocket(url);
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        try {
          ws.close();
        } catch {
          /* noop */
        }
        reject(new Error('讯飞听写超时'));
      }
    }, 120000);

    function finish(err, result) {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      try {
        ws.close();
      } catch {
        /* noop */
      }
      if (err) {
        reject(err);
      } else {
        resolve(result);
      }
    }

    ws.on('message', (data) => {
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
      if (res.sid) {
        sid = res.sid;
      }
      mergeResult(slots, res);
      if (res.data?.status === 2) {
        finish(null, { text: extractText(slots), sid });
      }
    });

    ws.on('error', (err) => {
      finish(err instanceof Error ? err : new Error(String(err)));
    });

    ws.on('close', () => {
      if (!settled) {
        finish(new Error('连接已关闭但未收到结束帧'));
      }
    });

    ws.on('open', async () => {
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
