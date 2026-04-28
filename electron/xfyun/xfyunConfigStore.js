import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const FILE = 'xfyun.json';

export async function loadXfyunConfig(userDataPath) {
  try {
    const raw = await readFile(join(userDataPath, FILE), 'utf8');
    const data = JSON.parse(raw);
    return {
      appId: typeof data.appId === 'string' ? data.appId : '',
      apiKey: typeof data.apiKey === 'string' ? data.apiKey : '',
      apiSecret: typeof data.apiSecret === 'string' ? data.apiSecret : '',
      ttsVcn: typeof data.ttsVcn === 'string' ? data.ttsVcn : '',
    };
  } catch {
    return { appId: '', apiKey: '', apiSecret: '', ttsVcn: '' };
  }
}

export async function saveXfyunConfig(userDataPath, config) {
  const payload = {
    appId: typeof config.appId === 'string' ? config.appId : '',
    apiKey: typeof config.apiKey === 'string' ? config.apiKey : '',
    apiSecret: typeof config.apiSecret === 'string' ? config.apiSecret : '',
    ttsVcn: typeof config.ttsVcn === 'string' ? config.ttsVcn.trim() : '',
  };
  await writeFile(join(userDataPath, FILE), JSON.stringify(payload, null, 2), 'utf8');
  return payload;
}
