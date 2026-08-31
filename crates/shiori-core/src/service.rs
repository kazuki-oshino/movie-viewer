use std::{
    fs::{self, File, Metadata},
    io::Read,
    path::{Path, PathBuf},
    sync::{Mutex, MutexGuard},
    time::{SystemTime, UNIX_EPOCH},
};

use crate::{
    Availability, Bookmark, BookmarkColor, CoreError, LibraryListing, MAX_BOOKMARKS, NewBookmark,
    PlaybackSession, Progress, Result, SCHEMA_VERSION, Video, VideoEntry, storage::Store,
    validate_id, validate_note, validate_rate, validate_seconds,
};

struct Session {
    id: String,
    video_id: String,
    revision: u64,
}

/// Metadata changes are serialized. Every command patches the latest record;
/// a progress save can never overwrite a bookmark or a relink.
pub struct LibraryService {
    store: Store,
    session: Mutex<Option<Session>>,
}

impl LibraryService {
    pub fn new(root: PathBuf) -> Result<Self> {
        Ok(Self {
            store: Store::new(root)?,
            session: Mutex::new(None),
        })
    }

    fn lock(&self) -> Result<MutexGuard<'_, Option<Session>>> {
        self.session.lock().map_err(|_| CoreError::Lock)
    }

    pub fn thumbnail_directory(&self) -> PathBuf {
        self.store.root.join("thumbnails")
    }

    pub fn list(&self) -> Result<LibraryListing> {
        let _lock = self.lock()?;
        let (videos, warnings) = self.store.list()?;
        Ok(LibraryListing {
            videos: videos.into_iter().map(entry).collect(),
            warnings,
        })
    }

    pub fn import(&self, path: &Path) -> Result<VideoEntry> {
        // Full streaming hash happens outside the metadata lock and off the UI thread.
        let source = inspect_source(path)?;
        let _lock = self.lock()?;
        let (videos, _) = self.store.list()?;
        if let Some(mut existing) = videos
            .into_iter()
            .find(|v| v.fingerprint == source.fingerprint)
        {
            if entry(existing.clone()).availability != Availability::Available {
                existing.path = source.path;
                existing.modified_at_ms = source.modified_at_ms;
                existing.updated_at_ms = now();
                self.store.save(&existing)?;
            }
            return Ok(entry(existing));
        }
        let stamp = now();
        let video = Video {
            schema_version: SCHEMA_VERSION,
            id: uuid::Uuid::new_v4().to_string(),
            title: source
                .path
                .file_stem()
                .map(|s| s.to_string_lossy().chars().take(400).collect())
                .unwrap_or_else(|| "名称未設定".into()),
            path: source.path,
            fingerprint: source.fingerprint,
            byte_len: source.byte_len,
            modified_at_ms: source.modified_at_ms,
            duration: 0.0,
            position: 0.0,
            playback_rate: 1.0,
            cover_id: None,
            bookmarks: Vec::new(),
            created_at_ms: stamp,
            updated_at_ms: stamp,
            last_opened_at_ms: None,
        };
        self.store.save(&video)?;
        Ok(entry(video))
    }

    pub fn open(&self, id: &str) -> Result<PlaybackSession> {
        let mut session = self.lock()?;
        let mut video = self.store.load(id)?;
        let metadata = fs::metadata(&video.path).map_err(|_| CoreError::SourceUnavailable)?;
        if !metadata.is_file() {
            return Err(CoreError::SourceUnavailable);
        }
        // Normal reopening is O(1). A changed size or mtime triggers a full comparison.
        if metadata.len() != video.byte_len || modified_ms(&metadata) != video.modified_at_ms {
            let source = inspect_source(&video.path)?;
            if source.fingerprint != video.fingerprint {
                return Err(CoreError::ContentChanged);
            }
            video.modified_at_ms = source.modified_at_ms;
        }
        File::open(&video.path).map_err(|_| CoreError::SourceUnavailable)?;
        video.last_opened_at_ms = Some(now());
        self.store.save(&video)?;
        let session_id = uuid::Uuid::new_v4().to_string();
        *session = Some(Session {
            id: session_id.clone(),
            video_id: id.into(),
            revision: 0,
        });
        Ok(PlaybackSession {
            video: entry(video),
            session_id,
        })
    }

    pub fn relink(&self, id: &str, path: &Path) -> Result<VideoEntry> {
        let source = inspect_source(path)?;
        let _lock = self.lock()?;
        let mut video = self.store.load(id)?;
        if video.fingerprint != source.fingerprint || video.byte_len != source.byte_len {
            return Err(CoreError::ContentChanged);
        }
        video.path = source.path;
        video.modified_at_ms = source.modified_at_ms;
        video.updated_at_ms = now();
        self.store.save(&video)?;
        Ok(entry(video))
    }

    pub fn save_progress(&self, session_id: &str, revision: u64, progress: Progress) -> Result<()> {
        validate_seconds(progress.position)?;
        validate_seconds(progress.duration)?;
        validate_rate(progress.playback_rate)?;
        if progress.duration <= 0.0 {
            return Err(CoreError::Invalid("動画の長さが不明です".into()));
        }
        let mut lock = self.lock()?;
        let session = lock
            .as_mut()
            .filter(|s| s.id == session_id)
            .ok_or(CoreError::StaleSession)?;
        if revision <= session.revision {
            return Ok(());
        }
        let mut video = self.store.load(&session.video_id)?;
        video.duration = progress.duration;
        video.position = progress.position.min(progress.duration);
        video.playback_rate = progress.playback_rate;
        self.store.save(&video)?;
        session.revision = revision;
        Ok(())
    }

    pub fn add_bookmark(&self, id: &str, input: NewBookmark) -> Result<VideoEntry> {
        validate_id(&input.id)?;
        validate_note(&input.note)?;
        validate_seconds(input.seconds)?;
        let _lock = self.lock()?;
        let mut video = self.store.load(id)?;
        if let Some(existing) = video.bookmarks.iter_mut().find(|b| b.id == input.id) {
            if (existing.seconds - input.seconds).abs() > 0.1 {
                return Err(CoreError::Invalid(
                    "同じしおりIDで時刻を変更できません".into(),
                ));
            }
            // A retry after an uncertain response must not duplicate the bookmark
            // or silently discard a note edited before that retry.
            existing.note = input.note.trim().into();
            existing.color = input.color;
            video.updated_at_ms = now();
            self.store.save(&video)?;
            return Ok(entry(video));
        }
        if video.bookmarks.len() >= MAX_BOOKMARKS
            || video.duration <= 0.0
            || input.seconds > video.duration + 0.1
        {
            return Err(CoreError::Invalid("しおりの数または時刻".into()));
        }
        self.store
            .save_thumbnail(&input.id, &input.thumbnail_data_url)?;
        video.cover_id.get_or_insert_with(|| input.id.clone());
        video.bookmarks.push(Bookmark {
            id: input.id.clone(),
            seconds: input.seconds.min(video.duration),
            note: input.note.trim().into(),
            color: input.color,
            thumbnail_id: input.id,
            created_at_ms: now(),
        });
        video.updated_at_ms = now();
        self.store.save(&video)?;
        Ok(entry(video))
    }

    pub fn edit_bookmark(
        &self,
        id: &str,
        bookmark_id: &str,
        note: &str,
        color: BookmarkColor,
    ) -> Result<VideoEntry> {
        validate_note(note)?;
        let _lock = self.lock()?;
        let mut video = self.store.load(id)?;
        let bookmark = video
            .bookmarks
            .iter_mut()
            .find(|b| b.id == bookmark_id)
            .ok_or(CoreError::NotFound)?;
        bookmark.note = note.trim().into();
        bookmark.color = color;
        video.updated_at_ms = now();
        self.store.save(&video)?;
        Ok(entry(video))
    }

    pub fn remove_bookmark(&self, id: &str, bookmark_id: &str) -> Result<VideoEntry> {
        validate_id(bookmark_id)?;
        let _lock = self.lock()?;
        let mut video = self.store.load(id)?;
        video.bookmarks.retain(|b| b.id != bookmark_id);
        video.updated_at_ms = now();
        self.store.save(&video)?;
        let _ = self.store.prune_thumbnails();
        Ok(entry(video))
    }

    pub fn save_cover(&self, id: &str, data_url: &str) -> Result<VideoEntry> {
        let _lock = self.lock()?;
        let mut video = self.store.load(id)?;
        if video.cover_id.is_none() {
            let thumbnail_id = uuid::Uuid::new_v4().to_string();
            self.store.save_thumbnail(&thumbnail_id, data_url)?;
            video.cover_id = Some(thumbnail_id);
            self.store.save(&video)?;
        }
        Ok(entry(video))
    }

    pub fn rename(&self, id: &str, title: &str) -> Result<VideoEntry> {
        let _lock = self.lock()?;
        let mut video = self.store.load(id)?;
        video.title = title.trim().into();
        video.updated_at_ms = now();
        self.store.save(&video)?;
        Ok(entry(video))
    }

    pub fn remove(&self, id: &str) -> Result<()> {
        let mut session = self.lock()?;
        self.store.remove(id)?;
        if session.as_ref().is_some_and(|s| s.video_id == id) {
            *session = None;
        }
        // A cleanup failure cannot roll back a successfully removed registration.
        // No source path is ever used by a write or deletion operation.
        let _ = self.store.prune_thumbnails();
        Ok(())
    }
}

struct Source {
    path: PathBuf,
    fingerprint: String,
    byte_len: u64,
    modified_at_ms: Option<u64>,
}

fn inspect_source(path: &Path) -> Result<Source> {
    let path = fs::canonicalize(path).map_err(|_| CoreError::SourceUnavailable)?;
    let extension = path
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    if !["mp4", "mov", "m4v"].contains(&extension.as_str()) {
        return Err(CoreError::UnsupportedFile);
    }
    let mut file = File::open(&path).map_err(|_| CoreError::SourceUnavailable)?;
    let metadata = file.metadata()?;
    if !metadata.is_file() || metadata.len() == 0 {
        return Err(CoreError::UnsupportedFile);
    }
    let mut hasher = blake3::Hasher::new();
    let mut buffer = vec![0; 1024 * 1024];
    let mut read_len = 0_u64;
    loop {
        let count = file.read(&mut buffer)?;
        if count == 0 {
            break;
        }
        read_len += count as u64;
        hasher.update(&buffer[..count]);
    }
    let after = file.metadata()?;
    let current = fs::metadata(&path).map_err(|_| CoreError::SourceUnavailable)?;
    if read_len != metadata.len()
        || after.len() != metadata.len()
        || modified_ms(&after) != modified_ms(&metadata)
        || current.len() != metadata.len()
        || modified_ms(&current) != modified_ms(&metadata)
    {
        return Err(CoreError::Invalid(
            "読み込み中に動画が変更されました。もう一度お試しください".into(),
        ));
    }
    Ok(Source {
        path,
        fingerprint: hasher.finalize().to_hex().to_string(),
        byte_len: metadata.len(),
        modified_at_ms: modified_ms(&metadata),
    })
}

fn entry(video: Video) -> VideoEntry {
    let availability = match fs::metadata(&video.path) {
        Ok(meta) if !meta.is_file() => Availability::Missing,
        Ok(meta) if meta.len() != video.byte_len || modified_ms(&meta) != video.modified_at_ms => {
            Availability::Changed
        }
        Ok(_) => Availability::Available,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Availability::Missing,
        Err(_) => Availability::Inaccessible,
    };
    VideoEntry {
        video,
        availability,
    }
}

fn modified_ms(metadata: &Metadata) -> Option<u64> {
    metadata
        .modified()
        .ok()?
        .duration_since(UNIX_EPOCH)
        .ok()
        .map(|d| d.as_millis() as u64)
}

fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}
