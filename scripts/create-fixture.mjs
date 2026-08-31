import { mkdir, access } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// 自作の検証用動画だけを生成する。既存ファイルは上書きしない。
const destination = fileURLToPath(new URL('../public/demo/', import.meta.url));
await mkdir(destination, { recursive: true });
const font = '/System/Library/Fonts/Supplemental/Georgia.ttf';
const sans = '/System/Library/Fonts/Supplemental/Arial.ttf';

function run(args) {
  const result = spawnSync(
    'ffmpeg',
    ['-hide_banner', '-loglevel', 'error', '-n', ...args],
    { stdio: 'inherit' },
  );
  if (result.status !== 0) throw new Error('ffmpegによる検証用動画の生成に失敗しました。');
}
async function exists(file) {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

for (const index of [0, 1]) {
  const video = path.join(destination, `demo-${index}.mp4`);
  if (!(await exists(video))) {
    const paper = index === 0 ? '0xE8E9DE' : '0xD9E4DF';
    const ink = index === 0 ? '0x354B3E' : '0x234D49';
    const accent = index === 0 ? '0xB3BE91' : '0xAEC8BD';
    const title = index === 0 ? 'Make space.' : 'Look closer.';
    const subtitle =
      index === 0
        ? 'A quiet guide to thoughtful design'
        : 'Finding little stories in everyday life';
    const section = index === 0 ? 'THE ART OF LESS' : 'FIELD NOTES / 001';
    const filters = [
      `drawbox=x=40:y=40:w=880:h=460:color=${ink}@0.2:t=1`,
      `drawbox=x=674:y=108:w=190:h=270:color=${accent}:t=fill`,
      `drawbox=x=717:y=175:w=99:h=146:color=${paper}:t=fill`,
      `drawbox=x=670:y=418:w=198:h=2:color=${ink}@0.4:t=fill`,
      `drawtext=fontfile=${sans}:text='${section}':x=88:y=102:fontsize=14:fontcolor=${ink}`,
      `drawtext=fontfile=${font}:text='${title}':x=82:y=199:fontsize=78:fontcolor=${ink}`,
      `drawtext=fontfile=${sans}:text='${subtitle}':x=88:y=311:fontsize=19:fontcolor=${ink}`,
      `drawtext=fontfile=${sans}:text='SHIORI  /  ORIGINAL DEMO':x=88:y=423:fontsize=12:fontcolor=${ink}@0.7`,
      `drawtext=fontfile=${sans}:text='%{pts\\:hms}':x=733:y=441:fontsize=13:fontcolor=${ink}@0.7`,
      `drawbox=x=40:y=497:w=880:h=3:color=${accent}:t=fill`,
    ];
    run([
      '-f',
      'lavfi',
      '-i',
      `color=c=${paper}:s=960x540:r=12:d=90`,
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=220:sample_rate=44100:duration=90',
      '-vf',
      filters.join(','),
      '-af',
      'volume=0.02',
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-crf',
      '29',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      '-b:a',
      '32k',
      '-movflags',
      '+faststart',
      '-shortest',
      video,
    ]);
  }
  for (const [mark, seconds] of [14, 42, 71].entries()) {
    const thumbnail = path.join(destination, `demo-${index}-${mark}.jpg`);
    if (!(await exists(thumbnail)))
      run([
        '-ss',
        String(seconds),
        '-i',
        video,
        '-frames:v',
        '1',
        '-vf',
        'scale=640:-1',
        '-q:v',
        '3',
        '-update',
        '1',
        thumbnail,
      ]);
  }
}
console.log(`検証用動画を用意しました: ${destination}`);
