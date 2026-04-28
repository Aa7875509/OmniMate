/**
 * 语音录音会话：仅负责麦克风采集得到 Blob。
 * 与主进程转写、Whisper API 无关；后续接入转写时请在此模块外编排。
 */

import { beginMicCapture } from './micRecorder.js';

export { beginMicCapture };

/** 小于该大小的录音视为无效/过短（避免误触） */
export const VOICE_RECORDING_MIN_BYTES = 400;

export function isUsableRecordingBlob(blob) {
  return Boolean(blob && blob.size >= VOICE_RECORDING_MIN_BYTES);
}

/**
 * @param {{ stop: () => Promise<Blob>, mimeType?: string }} session - beginMicCapture 的返回值
 * @returns {Promise<{ blob: Blob, mime: string, ok: boolean }>}
 */
export async function finalizeRecordingSession(session) {
  const blob = await session.stop();
  const mime = blob?.type || session.mimeType || 'audio/webm';
  const ok = isUsableRecordingBlob(blob);
  return { blob, mime, ok };
}
