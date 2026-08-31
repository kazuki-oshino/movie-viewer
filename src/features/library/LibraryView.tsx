import { useEffect, useRef, useState } from 'react';
import {
  ArrowDownWideNarrow,
  ArrowUpRight,
  Bookmark,
  Check,
  Clock3,
  Film,
  FolderOpen,
  LayoutGrid,
  List,
  MoreHorizontal,
  Pencil,
  Play,
  Plus,
  Search,
  Trash2,
} from 'lucide-react';
import {
  COLORS,
  formatTime,
  matchesSearch,
  shelfItems,
  type BookmarkColor,
  type ShelfItem,
  type VideoEntry,
} from '../../domain/library';
import type { LibraryGateway } from '../../platform/gateway';
import { Button, IconButton } from '../../components/Button';
import { Thumbnail } from '../../components/Thumbnail';

interface Props {
  view: 'shelf' | 'videos' | 'recent';
  videos: VideoEntry[];
  gateway: LibraryGateway;
  query: string;
  onOpen(video: VideoEntry, seconds?: number): void;
  onEdit(item: ShelfItem): void;
  onDelete(item: ShelfItem): void;
  onInfo(video: VideoEntry): void;
  onImport(): void;
  onClearSearch(): void;
}

export function LibraryView({
  view,
  videos,
  gateway,
  query,
  onOpen,
  onEdit,
  onDelete,
  onInfo,
  onImport,
  onClearSearch,
}: Props) {
  const [filter, setFilter] = useState('all');
  const [color, setColor] = useState<BookmarkColor | 'all'>('all');
  const [sort, setSort] = useState<'newest' | 'timeline'>('newest');
  const [layout, setLayout] = useState<'grid' | 'list'>('grid');
  const [limit, setLimit] = useState(36);
  const scroller = useRef<HTMLElement>(null);
  useEffect(() => {
    setLimit(36);
    if (scroller.current) scroller.current.scrollTop = 0;
  }, [query, filter, color, sort, view, videos.length]);
  const validFilter = videos.some((video) => video.id === filter) ? filter : 'all';
  const allMarks = videos.reduce((count, video) => count + video.bookmarks.length, 0);
  const items = shelfItems(videos, query, validFilter, color, sort);
  const shownVideos = videos
    .filter(
      (video) =>
        (view !== 'recent' || video.lastOpenedAtMs !== null) &&
        matchesSearch(query, video.title, video.path),
    )
    .sort((a, b) =>
      view === 'recent'
        ? (b.lastOpenedAtMs ?? 0) - (a.lastOpenedAtMs ?? 0)
        : b.createdAtMs - a.createdAtMs,
    );
  const shelf = view === 'shelf';

  return (
    <section ref={scroller} className="library-view">
      <header className="library-heading">
        <div>
          <div className="eyebrow">
            {shelf ? 'A PLACE FOR YOUR MOMENTS' : 'YOUR PERSONAL VIDEO LIBRARY'}
          </div>
          <h1>
            {shelf ? 'しおり棚' : view === 'recent' ? '最近見た動画' : 'すべての動画'}
            <span>{shelf ? allMarks : shownVideos.length}</span>
          </h1>
          <p>
            {shelf
              ? 'あの説明も、ひらめきも。見たい瞬間に、すぐ戻れる。'
              : '動画はそのままの場所に。記録だけを、このライブラリに。'}
          </p>
        </div>
        <div className="library-heading-decoration" aria-hidden="true">
          <Bookmark size={38} strokeWidth={0.9} />
          <span>
            Keep a little
            <br />
            of what you find.
          </span>
        </div>
      </header>
      {videos.length > 0 && (
        <div className="library-toolbar">
          <div className="library-filters">
            {shelf ? (
              <>
                <label className="filter-select">
                  <Film size={15} />
                  <select
                    aria-label="動画で絞り込み"
                    value={validFilter}
                    onChange={(event) => setFilter(event.target.value)}
                  >
                    <option value="all">すべての動画</option>
                    {videos.map((video) => (
                      <option key={video.id} value={video.id}>
                        {video.title}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="color-filters" aria-label="しおりの色で絞り込み">
                  <button
                    className={color === 'all' ? 'is-selected' : ''}
                    aria-pressed={color === 'all'}
                    onClick={() => setColor('all')}
                  >
                    すべて
                  </button>
                  {COLORS.map((item) => (
                    <button
                      key={item.value}
                      className={`color-filter ${color === item.value ? 'is-selected' : ''}`}
                      aria-label={`${item.label}のしおり`}
                      aria-pressed={color === item.value}
                      title={item.label}
                      onClick={() => setColor(color === item.value ? 'all' : item.value)}
                    >
                      <i className={`dot-${item.value}`} />
                      {color === item.value && <Check size={11} />}
                    </button>
                  ))}
                </div>
              </>
            ) : (
              <span className="collection-count">
                <Film size={15} />
                {shownVideos.length}本の動画
              </span>
            )}
          </div>
          <div className="library-view-options">
            {shelf && (
              <label className="sort-select">
                <ArrowDownWideNarrow size={14} />
                <select
                  aria-label="しおりの並び順"
                  value={sort}
                  onChange={(event) => setSort(event.target.value as 'newest' | 'timeline')}
                >
                  <option value="newest">追加した順</option>
                  <option value="timeline">動画・時刻順</option>
                </select>
              </label>
            )}
            <div className="segmented">
              <IconButton
                label="グリッド表示"
                aria-pressed={layout === 'grid'}
                className={layout === 'grid' ? 'is-selected' : ''}
                onClick={() => setLayout('grid')}
              >
                <LayoutGrid size={16} />
              </IconButton>
              <IconButton
                label="リスト表示"
                aria-pressed={layout === 'list'}
                className={layout === 'list' ? 'is-selected' : ''}
                onClick={() => setLayout('list')}
              >
                <List size={17} />
              </IconButton>
            </div>
          </div>
        </div>
      )}
      {videos.length === 0 ? (
        <EmptyLibrary isNative={gateway.isNative} onImport={onImport} />
      ) : shelf ? (
        <>
          {items.length === 0 ? (
            <div className="empty-results">
              {allMarks === 0 ? (
                <Bookmark size={35} strokeWidth={1.1} />
              ) : (
                <Search size={32} strokeWidth={1.2} />
              )}
              <h2>
                {allMarks === 0
                  ? '最初のしおりを、つけてみよう。'
                  : 'しおりが見つかりませんでした'}
              </h2>
              <p>
                {allMarks === 0
                  ? '動画を開いて、残したい瞬間に「しおりを追加」を押してください。'
                  : 'キーワードや絞り込みを変えて、もう一度探してみてください。'}
              </p>
              {allMarks === 0 ? (
                <Button onClick={() => onOpen(videos[0])}>
                  <Play size={15} />
                  動画を開く
                </Button>
              ) : (
                <Button
                  onClick={() => {
                    setFilter('all');
                    setColor('all');
                    onClearSearch();
                  }}
                >
                  絞り込みをリセット
                </Button>
              )}
            </div>
          ) : (
            <div className={`bookmark-grid ${layout === 'list' ? 'is-list' : ''}`}>
              {items.slice(0, limit).map((item) => (
                <article className="shelf-card" key={item.bookmark.id}>
                  <button
                    className="shelf-card-open"
                    onClick={() => onOpen(item.video, item.bookmark.seconds)}
                    aria-label={`${formatTime(item.bookmark.seconds)}から再生: ${item.bookmark.note}`}
                  >
                    <div className="shelf-image">
                      <Thumbnail src={gateway.thumbnailUrl(item.bookmark.thumbnailId)} />
                      <span className="thumbnail-time">
                        <Play size={11} fill="currentColor" />
                        {formatTime(item.bookmark.seconds)}
                      </span>
                      <span className={`bookmark-ribbon ribbon-${item.bookmark.color}`}>
                        <Bookmark size={14} fill="currentColor" strokeWidth={0} />
                      </span>
                      <span className="thumbnail-play">
                        <Play size={23} fill="currentColor" />
                      </span>
                    </div>
                    <div className="shelf-card-copy">
                      <p>{item.bookmark.note}</p>
                      <span className="shelf-source">
                        <Film size={12} />
                        <span>{item.video.title}</span>
                      </span>
                    </div>
                  </button>
                  <div className="shelf-card-footer">
                    <span
                      className={
                        item.video.availability === 'available'
                          ? 'shelf-save-date'
                          : 'missing-label'
                      }
                    >
                      {item.video.availability === 'available'
                        ? new Date(item.bookmark.createdAtMs).toLocaleDateString('ja-JP', {
                            month: 'short',
                            day: 'numeric',
                          })
                        : 'ファイルの場所を確認'}
                    </span>
                    <div>
                      <IconButton
                        label={`メモを編集: ${item.bookmark.note}`}
                        onClick={() => onEdit(item)}
                      >
                        <Pencil size={14} />
                      </IconButton>
                      <IconButton
                        label={`しおりを削除: ${item.bookmark.note}`}
                        onClick={() => onDelete(item)}
                      >
                        <Trash2 size={14} />
                      </IconButton>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
          {items.length > limit && (
            <Button className="load-more" onClick={() => setLimit((value) => value + 36)}>
              さらに表示 ({items.length - limit}件)
            </Button>
          )}
        </>
      ) : (
        <>
          {shownVideos.length ? (
            <div className={`video-grid ${layout === 'list' ? 'is-list' : ''}`}>
              {shownVideos.slice(0, limit).map((video) => (
                <article className="video-card" key={video.id}>
                  <button
                    className="video-card-open"
                    onClick={() => onOpen(video)}
                    aria-label={`動画を開く: ${video.title}`}
                  >
                    <div className="shelf-image">
                      <Thumbnail
                        src={
                          video.coverId ? gateway.thumbnailUrl(video.coverId) : undefined
                        }
                      />
                      <span className="thumbnail-time">
                        {video.duration > 0 ? formatTime(video.duration) : '未再生'}
                      </span>
                      <span className="thumbnail-play">
                        <Play size={23} fill="currentColor" />
                      </span>
                    </div>
                    <div className="video-card-copy">
                      <h2>{video.title}</h2>
                      <p>
                        <Bookmark size={12} />
                        {video.bookmarks.length}か所のしおり
                        {video.availability !== 'available' && (
                          <span className="missing-label">場所を確認</span>
                        )}
                      </p>
                    </div>
                  </button>
                  <div className="video-card-footer">
                    <span>
                      <Clock3 size={12} />
                      {video.position > 0
                        ? `${formatTime(video.position)} から再開`
                        : 'いつでも、ここから'}
                    </span>
                    <IconButton
                      label={`動画の情報: ${video.title}`}
                      onClick={() => onInfo(video)}
                    >
                      <MoreHorizontal size={19} />
                    </IconButton>
                  </div>
                  <div className="video-progress" aria-hidden="true">
                    <i
                      style={{
                        width: `${video.duration > 0 ? (video.position / video.duration) * 100 : 0}%`,
                      }}
                    />
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="empty-results">
              <Film size={32} strokeWidth={1.2} />
              <h2>
                {query ? '動画が見つかりませんでした' : '最近見た動画はまだありません'}
              </h2>
              <p>
                {query
                  ? '別のキーワードで探してみてください。'
                  : '動画を開くと、この場所に表示されます。'}
              </p>
            </div>
          )}
          {shownVideos.length > limit && (
            <Button className="load-more" onClick={() => setLimit((value) => value + 36)}>
              さらに表示
            </Button>
          )}
        </>
      )}
      <footer className="library-bottom">
        <span>
          <span className="tiny-dot" />
          あなたのMacだけに保存
        </span>
        <span>大切な瞬間に、しおりを。</span>
      </footer>
    </section>
  );
}

function EmptyLibrary({ isNative, onImport }: { isNative: boolean; onImport(): void }) {
  return (
    <div className="empty-library">
      <div className="empty-illustration" aria-hidden="true">
        <div className="illustration-back" />
        <div className="illustration-screen">
          <span className="illustration-label">A MOMENT WORTH KEEPING</span>
          <div className="illustration-landscape">
            <i />
            <i />
            <i />
          </div>
          <Play size={23} fill="currentColor" />
          <div className="illustration-timeline">
            <i />
          </div>
          <span className="illustration-time">02:48</span>
        </div>
        <div className="illustration-note">
          <Bookmark size={14} fill="currentColor" />
          <span>この瞬間を、もう一度。</span>
          <i />
          <i />
        </div>
        <span className="illustration-spark">✳</span>
      </div>
      <span className="eyebrow">LESS SEARCHING, MORE FINDING.</span>
      <h2>
        見たい瞬間に、
        <br />
        しおりを。
      </h2>
      <p>
        「あの説明、何分だったっけ？」を、なくそう。
        <br />
        ローカル動画にメモとサムネイルを添えて、
        <br />
        いつでも、その瞬間から。
      </p>
      <Button variant="primary" onClick={onImport}>
        <Plus size={17} />
        {isNative ? '最初の動画を追加' : 'デモ動画で試す'}
        <ArrowUpRight size={15} />
      </Button>
      <span className="empty-file-hint">
        {isNative
          ? 'または、このウィンドウに動画をドロップ'
          : 'ブラウザ用のサンプルです。実ファイルにはアクセスしません。'}
      </span>
      <div className="getting-started">
        <div>
          <span>01</span>
          <FolderOpen size={19} strokeWidth={1.4} />
          <h3>動画をひらく</h3>
          <p>元のファイルは、そのままに。</p>
        </div>
        <div>
          <span>02</span>
          <Bookmark size={19} strokeWidth={1.4} />
          <h3>瞬間にメモを残す</h3>
          <p>サムネイルも一緒に保存。</p>
        </div>
        <div>
          <span>03</span>
          <Play size={19} strokeWidth={1.4} />
          <h3>しおりから見返す</h3>
          <p>探す時間を、あなたの時間に。</p>
        </div>
      </div>
    </div>
  );
}
