/**
 * 将录音 Blob（如 webm/opus）解码并重采样为讯飞听写所需的 16kHz、16bit、单声道 PCM。
 */
export async function blobToPcm16kMono(blob) {
  if (!(blob instanceof Blob) || blob.size < 1) {
    throw new TypeError('无效的录音数据');
  }

  const ctx = new AudioContext();
  try {
    const raw = await blob.arrayBuffer();
    const decoded = await ctx.decodeAudioData(raw.slice(0));
    const frames = Math.max(1, Math.ceil(decoded.duration * 16000));
    const offline = new OfflineAudioContext(1, frames, 16000);
    const src = offline.createBufferSource();
    src.buffer = decoded;
    src.connect(offline.destination);
    src.start(0);
    const rendered = await offline.startRendering();
    const ch = rendered.getChannelData(0);
    const out = new Int16Array(ch.length);
    for (let i = 0; i < ch.length; i += 1) {
      const s = Math.max(-1, Math.min(1, ch[i]));
      out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    return out;
  } finally {
    await ctx.close().catch(() => {});
  }
}
