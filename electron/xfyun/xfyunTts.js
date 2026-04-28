/**
 * 讯飞在线语音合成（流式版 WebSocket），鉴权与帧格式见官方 demo：
 * https://www.xfyun.cn/doc/tts/online_tts/API.html
 */
import crypto from 'node:crypto';
import WebSocket from 'ws';

const HOST = 'tts-api.xfyun.cn';
const HOST_URL = `wss://${HOST}/v2/tts`;
const URI = '/v2/tts';

/** 未在配置中填写发音人时的默认 vcn（须与控制台已开通音色一致） */
const DEFAULT_TTS_VCN = 'x4_yezi';

const DEFAULT_BUSINESS = {
  aue: 'raw',
  auf: 'audio/L16;rate=16000',
  vcn: DEFAULT_TTS_VCN,
  tte: 'UTF8',
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
  return `${HOST_URL}?${q.toString()}`;
}

/**
 * @param {{ appId: string; apiKey: string; apiSecret: string; text: string; vcn?: string; signal?: AbortSignal }} opts
 * @returns {Promise<Buffer>} 拼接后的 PCM（16kHz 16bit mono）
 */
export function synthesizePcm16k(opts) {
  const { appId, apiKey, apiSecret, text, vcn, signal } = opts;
  const vcnResolved = (typeof vcn === 'string' && vcn.trim()) ? vcn.trim() : DEFAULT_TTS_VCN;
  const plain = typeof text === 'string' ? text.trim() : '';
  if (!appId?.trim() || !apiKey?.trim() || !apiSecret?.trim()) {
    return Promise.reject(new Error('请先配置讯飞 AppID、API Key、APISecret'));
  }
  if (!plain) {
    return Promise.reject(new Error('合成文本为空'));
  }

  const url = buildWsUrl(apiKey, apiSecret);

  return new Promise((resolve, reject) => {
    const chunks = [];
    let settled = false;
    let ws;

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        try {
          ws?.close();
        } catch {
          /* noop */
        }
        reject(new Error('讯飞语音合成超时'));
      }
    }, 120000);

    let onAbort = null;

    function finish(err, buf) {
      if (settled) {
        return;
      }
      settled = true;
      if (signal && onAbort) {
        signal.removeEventListener('abort', onAbort);
        onAbort = null;
      }
      clearTimeout(timer);
      try {
        ws?.close();
      } catch {
        /* noop */
      }
      if (err) {
        reject(err);
      } else {
        resolve(buf ?? Buffer.alloc(0));
      }
    }

    if (signal) {
      if (signal.aborted) {
        finish(Object.assign(new Error('aborted'), { name: 'AbortError' }));
        return;
      }
      onAbort = () => {
        finish(Object.assign(new Error('aborted'), { name: 'AbortError' }));
      };
      signal.addEventListener('abort', onAbort);
    }

    ws = new WebSocket(url);

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
      const audioB64 = res.data?.audio;
      if (audioB64) {
        chunks.push(Buffer.from(audioB64, 'base64'));
      }
      if (res.data?.status === 2) {
        finish(null, Buffer.concat(chunks));
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

    ws.on('open', () => {
      if (settled) {
        return;
      }
      const frame = {
        common: { app_id: appId.trim() },
        business: { ...DEFAULT_BUSINESS, vcn: vcnResolved },
        data: {
          text: Buffer.from(plain, 'utf8').toString('base64'),
          status: 2,
        },
      };
      try {
        ws.send(JSON.stringify(frame));
      } catch (err) {
        finish(err instanceof Error ? err : new Error(String(err)));
      }
    });
  });
}
