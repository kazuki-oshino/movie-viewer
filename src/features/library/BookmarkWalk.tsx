import { useState } from 'react';
import { ArrowLeft, ArrowRight, Film, Play, Shuffle } from 'lucide-react';
import { Button } from '../../components/Button';
import { Modal } from '../../components/Modal';
import { Thumbnail } from '../../components/Thumbnail';
import { bookmarkTime, type ShelfItem } from '../../domain/library';
import type { LibraryGateway } from '../../platform/gateway';

/** Shuffle a copy; the shelf's saved order is never changed. */
export function shuffledItems(items: ShelfItem[]): ShelfItem[] {
  const shuffled = [...items];
  for (let index = shuffled.length - 1; index > 0; index--) {
    const other = Math.floor(Math.random() * (index + 1));
    [shuffled[index], shuffled[other]] = [shuffled[other], shuffled[index]];
  }
  return shuffled;
}

export function BookmarkWalk({
  items,
  gateway,
  onOpen,
  onClose,
}: {
  items: ShelfItem[];
  gateway: LibraryGateway;
  onOpen(item: ShelfItem): void;
  onClose(): void;
}) {
  const [deck, setDeck] = useState(() => shuffledItems(items));
  const [index, setIndex] = useState(0);
  const item = deck[index];

  function reshuffle() {
    const next = shuffledItems(items);
    // The first card of a new round should not repeat the last card just seen.
    if (next.length > 1 && next[0].bookmark.id === item?.bookmark.id) {
      [next[0], next[1]] = [next[1], next[0]];
    }
    setDeck(next);
    setIndex(0);
  }

  return (
    <Modal title="しおり散歩" onClose={onClose} className="bookmark-walk">
      <p className="walk-intro">
        探していなかった、あの気づきに。絞り込み中のしおりから、ひとつずつ。
      </p>
      {item ? (
        <>
          <div className="walk-image">
            <Thumbnail src={gateway.thumbnailUrl(item.bookmark.thumbnailId)} />
            <span className={`bookmark-time color-${item.bookmark.color}`}>
              {bookmarkTime(item.bookmark)}
              {item.bookmark.endSeconds != null && ' ↻'}
            </span>
          </div>
          <div className="walk-copy" aria-live="polite" aria-atomic="true">
            <p className="walk-note">{item.bookmark.note}</p>
            <p className="walk-source">
              <Film size={14} />
              <span>{item.video.title}</span>
            </p>
            <span className="walk-count">
              {index + 1} / {deck.length} 枚
            </span>
          </div>
          <div className="walk-navigation">
            <Button
              onClick={() => setIndex((current) => current - 1)}
              disabled={index === 0}
            >
              <ArrowLeft size={15} />
              戻る
            </Button>
            {index < deck.length - 1 ? (
              <Button onClick={() => setIndex((current) => current + 1)}>
                次のしおり
                <ArrowRight size={15} />
              </Button>
            ) : deck.length > 1 ? (
              <Button onClick={reshuffle}>
                <Shuffle size={15} />
                もう一巡する
              </Button>
            ) : (
              <span className="walk-end">今の絞り込みでは、この1枚です。</span>
            )}
          </div>
          <Button variant="primary" className="walk-play" onClick={() => onOpen(item)}>
            <Play size={16} />
            {item.bookmark.endSeconds == null ? 'この瞬間から再生' : 'この区間をリピート'}
          </Button>
          <p className="walk-footnote">
            一巡するまで重複しません。動画が見つからないしおりは除いています。
          </p>
        </>
      ) : (
        <p className="walk-intro">再生できる動画のしおりがありません。</p>
      )}
    </Modal>
  );
}
