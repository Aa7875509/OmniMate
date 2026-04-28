/**
 * MediaRecorder 采集麦克风（不依赖 Google 在线语音识别）。
 */

function pickRecordingMimeType() {
  const types = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'];
  for (const t of types) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(t)) {
      return t;
    }
  }
  return '';
}

/**
 * @returns {Promise<{ mimeType: string, stop: () => Promise<Blob> }>}
 */
export async function beginMicCapture() {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
      sampleRate: { ideal: 48000 },
    },
  });

  const preferred = pickRecordingMimeType();
  let recorder;
  try {
    const o = { audioBitsPerSecond: 128000 };
    if (preferred) {
      o.mimeType = preferred;
    }
    recorder = new MediaRecorder(stream, o);
  } catch {
    try {
      recorder = preferred ? new MediaRecorder(stream, { mimeType: preferred }) : new MediaRecorder(stream);
    } catch {
      recorder = new MediaRecorder(stream);
    }
  }

  const chunks = [];
  recorder.addEventListener('dataavailable', (e) => {
    if (e.data && e.data.size > 0) {
      chunks.push(e.data);
    }
  });

  recorder.start(250);

  const mimeType = recorder.mimeType || preferred || 'audio/webm';

  return {
    mimeType,
    stop: () =>
      new Promise((resolve, reject) => {
        recorder.addEventListener(
          'stop',
          () => {
            stream.getTracks().forEach((t) => t.stop());
            const finalType = recorder.mimeType || mimeType || 'audio/webm';
            resolve(new Blob(chunks, { type: finalType }));
          },
          { once: true },
        );
        recorder.addEventListener(
          'error',
          () => {
            stream.getTracks().forEach((t) => t.stop());
            reject(new Error('录音失败'));
          },
          { once: true },
        );
        (async () => {
          try {
            if (recorder.state === 'recording') {
              recorder.requestData?.();
            }
            recorder.stop();
          } catch (err) {
            stream.getTracks().forEach((t) => t.stop());
            reject(err instanceof Error ? err : new Error(String(err)));
          }
        })();
      }),
  };
}
