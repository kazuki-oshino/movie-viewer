export interface CapturedFrame {
  seconds: number;
  dataUrl: string;
}

function waitForFrame(video: HTMLVideoElement): Promise<void> {
  if (!video.seeking && video.readyState >= 2) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const finish = () => {
      if (!video.seeking && video.readyState >= 2) {
        cleanup();
        resolve();
      }
    };
    const fail = () => {
      cleanup();
      reject(new Error('映像の読み込みを待ってから、もう一度しおりを追加してください。'));
    };
    const cleanup = () => {
      window.clearTimeout(timer);
      video.removeEventListener('seeked', finish);
      video.removeEventListener('loadeddata', finish);
      video.removeEventListener('error', fail);
    };
    const timer = window.setTimeout(fail, 6_000);
    video.addEventListener('seeked', finish);
    video.addEventListener('loadeddata', finish);
    video.addEventListener('error', fail);
  });
}

/** Pause first so the captured frame and bookmark timestamp cannot drift apart. */
export async function captureFrame(
  video: HTMLVideoElement,
  pause = true,
): Promise<CapturedFrame> {
  if (pause) video.pause();
  await waitForFrame(video);
  if (!video.videoWidth || !video.videoHeight)
    throw new Error('この動画のサムネイルを取得できません。');
  const canvas = document.createElement('canvas');
  const scale = Math.min(1, 640 / video.videoWidth, 640 / video.videoHeight);
  canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
  canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
  const context = canvas.getContext('2d');
  if (!context) throw new Error('サムネイルを作成できません。');
  const seconds = video.currentTime;
  context.drawImage(video, 0, 0, canvas.width, canvas.height);
  const dataUrl = canvas.toDataURL('image/jpeg', 0.82);
  if (!dataUrl.startsWith('data:image/jpeg;base64,'))
    throw new Error('サムネイルを作成できません。');
  return { seconds, dataUrl };
}
