import { describe, expect, it } from 'vitest';
import {
  clampTime,
  formatTime,
  matchesSearch,
  PLAYBACK_RATES,
  shelfItems,
  type VideoEntry,
} from './library';
import { PreviewGateway } from '../platform/previewGateway';

describe('再生操作の不変条件', () => {
  it.each([
    [0, '0:00'],
    [9.9, '0:09'],
    [60, '1:00'],
    [3661.9, '1:01:01'],
    [-4, '0:00'],
    [NaN, '0:00'],
  ])('時刻 %s を %s と表示する', (value, expected) => {
    expect(formatTime(value)).toBe(expected);
  });
  it.each([
    [-10, 90, 0],
    [150, 90, 90],
    [30.1, 90, 30.1],
    [NaN, 90, 0],
    [30, Infinity, 0],
    [10, 0, 0],
  ])('時刻を動画内に制限する', (time, duration, expected) => {
    expect(clampTime(time, duration)).toBe(expected);
  });
  it('0.1から2.0まで0.1刻みで選択できる', () => {
    expect(PLAYBACK_RATES).toHaveLength(20);
    expect(PLAYBACK_RATES[0]).toBe(0.1);
    expect(PLAYBACK_RATES.at(-1)).toBe(2);
    expect(PLAYBACK_RATES).toContain(1);
  });
});

describe('しおりの検索', () => {
  it('全角・半角、大文字・小文字、複数キーワードを正規化する', () => {
    expect(matchesSearch(' ＡＢＣ　余白 ', 'abc', '余白の説明')).toBe(true);
    expect(matchesSearch('余白 音声', '余白の説明')).toBe(false);
  });
  it('メモ・動画・時刻の横断検索と色フィルターを組み合わせる', async () => {
    const gateway = new PreviewGateway();
    const video = await gateway.importVideo('demo-0');
    expect(shelfItems([video], '0:14', 'all', 'all', 'newest')).toHaveLength(1);
    expect(shelfItems([video], '余白', video.id, 'sage', 'newest')).toHaveLength(1);
    expect(shelfItems([video], '', video.id, 'rose', 'newest')).toHaveLength(0);
    expect(
      shelfItems([video], '', 'all', 'all', 'timeline').map(
        (item) => item.bookmark.seconds,
      ),
    ).toEqual([14, 42, 71]);
  });
  it('検索中も元の配列・しおりを並べ替えない', async () => {
    const gateway = new PreviewGateway();
    const videos: VideoEntry[] = [
      await gateway.importVideo('demo-0'),
      await gateway.importVideo('demo-1'),
    ];
    const before = structuredClone(videos);
    shelfItems(videos, '', 'all', 'all', 'newest');
    expect(videos).toEqual(before);
  });
});
