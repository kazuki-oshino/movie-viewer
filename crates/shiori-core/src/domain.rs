use std::{collections::HashSet, path::PathBuf};

use serde::{Deserialize, Serialize};

use crate::{CoreError, Result};

pub const SCHEMA_VERSION: u32 = 1;
pub const MAX_NOTE_LENGTH: usize = 4_000;
pub const MAX_BOOKMARKS: usize = 10_000;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum BookmarkColor {
    Sage,
    Amber,
    Blue,
    Rose,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Bookmark {
    pub id: String,
    pub seconds: f64,
    pub note: String,
    pub color: BookmarkColor,
    pub thumbnail_id: String,
    pub created_at_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Video {
    pub schema_version: u32,
    pub id: String,
    pub title: String,
    pub path: PathBuf,
    pub fingerprint: String,
    pub byte_len: u64,
    pub modified_at_ms: Option<u64>,
    pub duration: f64,
    pub position: f64,
    pub playback_rate: f64,
    pub cover_id: Option<String>,
    pub bookmarks: Vec<Bookmark>,
    pub created_at_ms: u64,
    pub updated_at_ms: u64,
    pub last_opened_at_ms: Option<u64>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum Availability {
    Available,
    Missing,
    Changed,
    Inaccessible,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoEntry {
    #[serde(flatten)]
    pub video: Video,
    pub availability: Availability,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryListing {
    pub videos: Vec<VideoEntry>,
    pub warnings: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaybackSession {
    pub video: VideoEntry,
    pub session_id: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewBookmark {
    pub id: String,
    pub seconds: f64,
    pub note: String,
    pub color: BookmarkColor,
    pub thumbnail_data_url: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Progress {
    pub position: f64,
    pub duration: f64,
    pub playback_rate: f64,
}

pub fn validate_id(id: &str) -> Result<()> {
    match uuid::Uuid::parse_str(id) {
        Ok(value) if value.to_string() == id => Ok(()),
        _ => Err(CoreError::NotFound),
    }
}

pub fn validate_seconds(seconds: f64) -> Result<()> {
    if !seconds.is_finite() || !(0.0..=31_536_000.0).contains(&seconds) {
        return Err(CoreError::Invalid("再生時刻".into()));
    }
    Ok(())
}

pub fn validate_rate(rate: f64) -> Result<()> {
    if !rate.is_finite() || !(0.1..=2.0).contains(&rate) {
        return Err(CoreError::Invalid("再生速度は0.1〜2.0倍です".into()));
    }
    Ok(())
}

pub fn validate_note(note: &str) -> Result<()> {
    if note.trim().is_empty() || note.chars().count() > MAX_NOTE_LENGTH {
        return Err(CoreError::Invalid("メモは1〜4,000文字です".into()));
    }
    Ok(())
}

impl Video {
    pub fn validate(&self) -> Result<()> {
        if self.schema_version != SCHEMA_VERSION {
            return Err(CoreError::UnsupportedVersion);
        }
        validate_id(&self.id)?;
        if !self.path.is_absolute()
            || self.title.trim().is_empty()
            || self.title.chars().count() > 400
            || self.fingerprint.len() != 64
            || !self.fingerprint.bytes().all(|c| c.is_ascii_hexdigit())
            || self.byte_len == 0
            || self.bookmarks.len() > MAX_BOOKMARKS
        {
            return Err(CoreError::Invalid("動画の基本情報".into()));
        }
        validate_seconds(self.duration)?;
        validate_seconds(self.position)?;
        validate_rate(self.playback_rate)?;
        if self.duration > 0.0 && self.position > self.duration + 0.1 {
            return Err(CoreError::Invalid("動画の長さを超える再生位置".into()));
        }
        if let Some(id) = &self.cover_id {
            validate_id(id)?;
        }
        let mut ids = HashSet::new();
        for bookmark in &self.bookmarks {
            validate_id(&bookmark.id)?;
            validate_id(&bookmark.thumbnail_id)?;
            validate_seconds(bookmark.seconds)?;
            validate_note(&bookmark.note)?;
            if !ids.insert(&bookmark.id)
                || (self.duration > 0.0 && bookmark.seconds > self.duration + 0.1)
            {
                return Err(CoreError::Invalid("しおりの時刻またはID".into()));
            }
        }
        Ok(())
    }
}
