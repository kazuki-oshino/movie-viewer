use std::{
    collections::HashSet,
    fs::{self, File},
    io::{Read, Write},
    path::{Path, PathBuf},
};

use base64::{Engine, engine::general_purpose::STANDARD};
use image::{ImageFormat, ImageReader};

use crate::{CoreError, Result, Video, validate_id};

const MAX_DOCUMENT_BYTES: u64 = 64 * 1024 * 1024;
const MAX_THUMBNAIL_BYTES: usize = 768 * 1024;

pub struct Store {
    pub root: PathBuf,
    _process_lock: File,
}

impl Store {
    pub fn new(root: PathBuf) -> Result<Self> {
        if !root.is_absolute() {
            return Err(CoreError::Invalid(
                "保存先は絶対パスで指定してください".into(),
            ));
        }
        fs::create_dir_all(root.join("videos"))?;
        fs::create_dir_all(root.join("thumbnails"))?;
        let process_lock = fs::OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .truncate(false)
            .open(root.join("library.lock"))?;
        process_lock
            .try_lock()
            .map_err(|_| CoreError::LibraryInUse)?;
        Ok(Self {
            root,
            _process_lock: process_lock,
        })
    }

    fn record_path(&self, id: &str) -> Result<PathBuf> {
        validate_id(id)?;
        Ok(self.root.join("videos").join(format!("{id}.json")))
    }

    pub fn thumbnail_path(&self, id: &str) -> Result<PathBuf> {
        validate_id(id)?;
        Ok(self.root.join("thumbnails").join(format!("{id}.jpg")))
    }

    pub fn load(&self, id: &str) -> Result<Video> {
        let path = self.record_path(id)?;
        let metadata = fs::symlink_metadata(&path).map_err(|error| {
            if error.kind() == std::io::ErrorKind::NotFound {
                CoreError::NotFound
            } else {
                CoreError::Io(error)
            }
        })?;
        if !metadata.is_file() || metadata.len() > MAX_DOCUMENT_BYTES {
            return Err(CoreError::Invalid("保存ファイルの形式またはサイズ".into()));
        }
        let mut bytes = Vec::new();
        File::open(path)?
            .take(MAX_DOCUMENT_BYTES + 1)
            .read_to_end(&mut bytes)?;
        if bytes.len() as u64 > MAX_DOCUMENT_BYTES {
            return Err(CoreError::Invalid("保存ファイルが大きすぎます".into()));
        }
        let video: Video = serde_json::from_slice(&bytes)?;
        video.validate()?;
        if video.id != id {
            return Err(CoreError::Invalid("保存ファイルのID".into()));
        }
        Ok(video)
    }

    pub fn list(&self) -> Result<(Vec<Video>, Vec<String>)> {
        let mut videos = Vec::new();
        let mut warnings = Vec::new();
        for entry in fs::read_dir(self.root.join("videos"))? {
            let entry = entry?;
            let path = entry.path();
            if path.extension().and_then(|s| s.to_str()) != Some("json") {
                continue;
            }
            let Some(id) = path.file_stem().and_then(|s| s.to_str()) else {
                continue;
            };
            match self.load(id) {
                Ok(video) => videos.push(video),
                Err(error) => {
                    warnings.push(format!("{}: {error}", entry.file_name().to_string_lossy()))
                }
            }
        }
        videos.sort_by(|a, b| {
            b.created_at_ms
                .cmp(&a.created_at_ms)
                .then_with(|| a.id.cmp(&b.id))
        });
        Ok((videos, warnings))
    }

    pub fn save(&self, video: &Video) -> Result<()> {
        video.validate()?;
        let bytes = serde_json::to_vec_pretty(video)?;
        if bytes.len() as u64 > MAX_DOCUMENT_BYTES {
            return Err(CoreError::Invalid(
                "この動画の保存データが容量上限に達しました".into(),
            ));
        }
        atomic_write(&self.record_path(&video.id)?, &bytes)
    }

    pub fn remove(&self, id: &str) -> Result<()> {
        let path = self.record_path(id)?;
        match fs::remove_file(&path) {
            Ok(()) => {
                File::open(path.parent().ok_or(CoreError::NotFound)?)?.sync_all()?;
                Ok(())
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(error) => Err(error.into()),
        }
    }

    pub fn save_thumbnail(&self, id: &str, data_url: &str) -> Result<()> {
        let path = self.thumbnail_path(id)?;
        if data_url.len() > MAX_THUMBNAIL_BYTES * 4 / 3 + 32 {
            return Err(CoreError::Thumbnail("画像が大きすぎます".into()));
        }
        let data = data_url
            .strip_prefix("data:image/jpeg;base64,")
            .ok_or_else(|| CoreError::Thumbnail("JPEG形式が必要です".into()))?;
        let bytes = STANDARD
            .decode(data)
            .map_err(|_| CoreError::Thumbnail("画像の形式".into()))?;
        if bytes.len() > MAX_THUMBNAIL_BYTES {
            return Err(CoreError::Thumbnail("画像が大きすぎます".into()));
        }
        let reader = ImageReader::with_format(std::io::Cursor::new(&bytes), ImageFormat::Jpeg);
        let (width, height) = reader
            .into_dimensions()
            .map_err(|e| CoreError::Thumbnail(e.to_string()))?;
        if width == 0
            || height == 0
            || width > 1280
            || height > 1280
            || u64::from(width) * u64::from(height) > 921_600
        {
            return Err(CoreError::Thumbnail("画像の解像度が大きすぎます".into()));
        }
        image::load_from_memory_with_format(&bytes, ImageFormat::Jpeg)
            .map_err(|e| CoreError::Thumbnail(e.to_string()))?;
        atomic_write(&path, &bytes)
    }

    /// Delete only generated UUID JPEGs that no healthy record references.
    /// A damaged record may still reference an image, so do not prune in that case.
    pub fn prune_thumbnails(&self) -> Result<()> {
        let (videos, warnings) = self.list()?;
        if !warnings.is_empty() {
            return Ok(());
        }
        let mut referenced = HashSet::new();
        for video in videos {
            if let Some(id) = video.cover_id {
                referenced.insert(id);
            }
            for bookmark in video.bookmarks {
                referenced.insert(bookmark.thumbnail_id);
            }
        }
        for entry in fs::read_dir(self.root.join("thumbnails"))? {
            let entry = entry?;
            let path = entry.path();
            if !entry.file_type()?.is_file()
                || path.extension().and_then(|s| s.to_str()) != Some("jpg")
            {
                continue;
            }
            let Some(id) = path.file_stem().and_then(|s| s.to_str()) else {
                continue;
            };
            if validate_id(id).is_ok() && !referenced.contains(id) {
                fs::remove_file(path)?;
            }
        }
        Ok(())
    }
}

pub fn atomic_write(path: &Path, bytes: &[u8]) -> Result<()> {
    let parent = path
        .parent()
        .ok_or_else(|| CoreError::Invalid("保存先".into()))?;
    let mut temporary = tempfile::NamedTempFile::new_in(parent)?;
    temporary.write_all(bytes)?;
    temporary.as_file().sync_all()?;
    temporary
        .persist(path)
        .map_err(|error| CoreError::Io(error.error))?;
    File::open(parent)?.sync_all()?;
    Ok(())
}
