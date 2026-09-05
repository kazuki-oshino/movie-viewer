use std::{fs, path::PathBuf};

use base64::{Engine, engine::general_purpose::STANDARD};
use shiori_core::{Availability, BookmarkColor, CoreError, LibraryService, NewBookmark, Progress};

struct Fixture {
    temporary: tempfile::TempDir,
    service: LibraryService,
    source: PathBuf,
}

impl Fixture {
    fn new() -> Self {
        let temporary = tempfile::tempdir().unwrap();
        let source = temporary.path().join("説明動画 #1 %.MP4");
        fs::write(&source, b"test movie bytes: keep original untouched").unwrap();
        let service = LibraryService::new(temporary.path().join("data")).unwrap();
        Self {
            temporary,
            service,
            source,
        }
    }
    fn imported(&self) -> String {
        self.service.import(&self.source).unwrap().video.id
    }
    fn ready(&self) -> (String, String) {
        let id = self.imported();
        let session = self.service.open(&id).unwrap();
        self.service
            .save_progress(
                &session.session_id,
                1,
                Progress {
                    position: 42.0,
                    duration: 120.0,
                    playback_rate: 1.5,
                    color_adjustments: None,
                },
            )
            .unwrap();
        (id, session.session_id)
    }
    fn record(&self, id: &str) -> PathBuf {
        self.temporary
            .path()
            .join("data/videos")
            .join(format!("{id}.json"))
    }
    fn bookmark(&self, seconds: f64) -> NewBookmark {
        NewBookmark {
            id: uuid::Uuid::new_v4().to_string(),
            seconds,
            end_seconds: None,
            color_adjustments: None,
            note: "  大切な説明\nここを見返す  ".into(),
            color: BookmarkColor::Amber,
            thumbnail_data_url: jpeg(),
        }
    }
}

fn jpeg() -> String {
    let image = image::RgbImage::from_pixel(12, 8, image::Rgb([120, 150, 90]));
    let mut bytes = Vec::new();
    image::codecs::jpeg::JpegEncoder::new(&mut bytes)
        .encode_image(&image)
        .unwrap();
    format!("data:image/jpeg;base64,{}", STANDARD.encode(bytes))
}

#[test]
fn import_is_deduplicated_by_full_content_and_preserves_the_source() {
    let f = Fixture::new();
    let before = fs::read(&f.source).unwrap();
    let first = f.service.import(&f.source).unwrap().video;
    let copy = f.temporary.path().join("copy.mov");
    fs::copy(&f.source, &copy).unwrap();
    assert_eq!(first.id, f.service.import(&copy).unwrap().video.id);
    assert_eq!(f.service.list().unwrap().videos.len(), 1);
    assert_eq!(first.title, "説明動画 #1 %");
    assert_eq!(fs::read(&f.source).unwrap(), before);
}

#[test]
fn relink_keeps_bookmarks_title_position_speed_and_identity() {
    let f = Fixture::new();
    let (id, _) = f.ready();
    f.service.rename(&id, "レッスン").unwrap();
    let before = f.service.add_bookmark(&id, f.bookmark(18.4)).unwrap().video;
    let moved = f.temporary.path().join("moved and renamed.m4v");
    fs::rename(&f.source, &moved).unwrap();
    assert_eq!(
        f.service.list().unwrap().videos[0].availability,
        Availability::Missing
    );
    let after = f.service.relink(&id, &moved).unwrap().video;
    assert_eq!(before.id, after.id);
    assert_eq!(before.bookmarks, after.bookmarks);
    assert_eq!(before.cover_id, after.cover_id);
    assert_eq!(before.title, after.title);
    assert_eq!(after.position, 42.0);
    assert_eq!(after.playback_rate, 1.5);
    assert_eq!(after.path, fs::canonicalize(moved).unwrap());
    assert!(f.service.open(&id).is_ok());
}

#[test]
fn wrong_relink_does_not_modify_any_metadata_even_with_same_size() {
    let f = Fixture::new();
    let (id, _) = f.ready();
    f.service.add_bookmark(&id, f.bookmark(12.0)).unwrap();
    let before = fs::read(f.record(&id)).unwrap();
    let other = f.temporary.path().join("wrong.mp4");
    let mut bytes = fs::read(&f.source).unwrap();
    bytes[17] ^= 1;
    fs::write(&other, bytes).unwrap();
    assert!(matches!(
        f.service.relink(&id, &other),
        Err(CoreError::ContentChanged)
    ));
    assert_eq!(before, fs::read(f.record(&id)).unwrap());
}

#[test]
fn full_hash_detects_a_change_in_the_middle_of_a_large_video() {
    let f = Fixture::new();
    let large = f.temporary.path().join("large.mp4");
    let mut bytes = vec![0_u8; 5 * 1024 * 1024];
    fs::write(&large, &bytes).unwrap();
    let id = f.service.import(&large).unwrap().video.id;
    bytes[2 * 1024 * 1024 + 71] = 1;
    let replacement = f.temporary.path().join("replacement.mp4");
    fs::write(&replacement, bytes).unwrap();
    assert!(matches!(
        f.service.relink(&id, &replacement),
        Err(CoreError::ContentChanged)
    ));
}

#[test]
fn missing_video_keeps_bookmarks_readable_and_editable() {
    let f = Fixture::new();
    let (id, _) = f.ready();
    let input = f.bookmark(24.0);
    f.service.add_bookmark(&id, input.clone()).unwrap();
    fs::rename(&f.source, f.temporary.path().join("moved.mp4")).unwrap();
    assert!(matches!(
        f.service.open(&id),
        Err(CoreError::SourceUnavailable)
    ));
    let entry = f
        .service
        .edit_bookmark(
            &id,
            &input.id,
            "移動してもメモは残る",
            BookmarkColor::Blue,
            None,
            None,
        )
        .unwrap();
    assert_eq!(entry.availability, Availability::Missing);
    assert_eq!(entry.video.bookmarks[0].note, "移動してもメモは残る");
}

#[test]
fn reimporting_moved_content_reconnects_the_original_record() {
    let f = Fixture::new();
    let (id, _) = f.ready();
    let moved = f.temporary.path().join("new.mp4");
    fs::rename(&f.source, &moved).unwrap();
    let result = f.service.import(&moved).unwrap();
    assert_eq!(result.video.id, id);
    assert_eq!(result.video.position, 42.0);
    assert_eq!(result.availability, Availability::Available);
}

#[test]
fn changed_source_is_rejected_without_losing_the_saved_record() {
    let f = Fixture::new();
    let id = f.imported();
    let before = fs::read(f.record(&id)).unwrap();
    fs::write(&f.source, b"different length and content").unwrap();
    assert!(matches!(
        f.service.open(&id),
        Err(CoreError::ContentChanged)
    ));
    assert_eq!(before, fs::read(f.record(&id)).unwrap());
}

#[test]
fn bookmark_creation_is_idempotent_and_stores_a_real_jpeg_separately() {
    let f = Fixture::new();
    let (id, _) = f.ready();
    let input = f.bookmark(42.7);
    f.service.add_bookmark(&id, input.clone()).unwrap();
    let video = f.service.add_bookmark(&id, input).unwrap().video;
    assert_eq!(video.bookmarks.len(), 1);
    assert_eq!(video.bookmarks[0].seconds, 42.7);
    assert_eq!(video.bookmarks[0].note, "大切な説明\nここを見返す");
    let thumbnail = f
        .service
        .thumbnail_directory()
        .join(format!("{}.jpg", video.bookmarks[0].thumbnail_id));
    assert_eq!(&fs::read(thumbnail).unwrap()[..2], &[0xff, 0xd8]);
    assert!(
        !fs::read_to_string(f.record(&id))
            .unwrap()
            .contains("base64")
    );
}

#[test]
fn progress_never_overwrites_a_bookmark_or_rename() {
    let f = Fixture::new();
    let (id, session) = f.ready();
    let input = f.bookmark(15.0);
    f.service.add_bookmark(&id, input.clone()).unwrap();
    f.service.rename(&id, "新しい表示名").unwrap();
    f.service
        .save_progress(
            &session,
            2,
            Progress {
                position: 81.0,
                duration: 120.0,
                playback_rate: 0.1,
                color_adjustments: None,
            },
        )
        .unwrap();
    let video = f.service.list().unwrap().videos.remove(0).video;
    assert_eq!(video.title, "新しい表示名");
    assert_eq!(video.bookmarks[0].id, input.id);
    assert_eq!(video.playback_rate, 0.1);
}

#[test]
fn old_revisions_and_previous_sessions_cannot_overwrite_newer_progress() {
    let f = Fixture::new();
    let (id, session) = f.ready();
    f.service
        .save_progress(
            &session,
            3,
            Progress {
                position: 81.0,
                duration: 120.0,
                playback_rate: 2.0,
                color_adjustments: None,
            },
        )
        .unwrap();
    f.service
        .save_progress(
            &session,
            2,
            Progress {
                position: 11.0,
                duration: 120.0,
                playback_rate: 0.1,
                color_adjustments: None,
            },
        )
        .unwrap();
    assert_eq!(f.service.list().unwrap().videos[0].video.position, 81.0);
    f.service.open(&id).unwrap();
    assert!(matches!(
        f.service.save_progress(
            &session,
            4,
            Progress {
                position: 11.0,
                duration: 120.0,
                playback_rate: 1.0,
                color_adjustments: None,
            }
        ),
        Err(CoreError::StaleSession)
    ));
}

#[test]
fn invalid_times_rates_notes_and_images_never_replace_saved_metadata() {
    let f = Fixture::new();
    let (id, session) = f.ready();
    let before = fs::read(f.record(&id)).unwrap();
    for rate in [0.0, 0.09, 2.01, f64::NAN, f64::INFINITY] {
        assert!(
            f.service
                .save_progress(
                    &session,
                    2,
                    Progress {
                        position: 0.0,
                        duration: 120.0,
                        playback_rate: rate,
                        color_adjustments: None,
                    }
                )
                .is_err()
        );
    }
    for seconds in [-1.0, 120.5, f64::NAN, f64::INFINITY] {
        assert!(f.service.add_bookmark(&id, f.bookmark(seconds)).is_err());
    }
    for note in ["   ".to_string(), "あ".repeat(4001)] {
        let mut input = f.bookmark(2.0);
        input.note = note;
        assert!(f.service.add_bookmark(&id, input).is_err());
    }
    let mut input = f.bookmark(2.0);
    input.thumbnail_data_url = "data:image/jpeg;base64,aGVsbG8=".into();
    assert!(f.service.add_bookmark(&id, input).is_err());
    assert_eq!(before, fs::read(f.record(&id)).unwrap());
}

#[test]
fn metadata_survives_a_full_service_restart() {
    let f = Fixture::new();
    let (id, _) = f.ready();
    f.service.add_bookmark(&id, f.bookmark(11.3)).unwrap();
    let root = f.temporary.path().join("data");
    drop(f.service);
    let reopened = LibraryService::new(root).unwrap();
    let video = reopened.open(&id).unwrap().video.video;
    assert_eq!(video.position, 42.0);
    assert_eq!(video.playback_rate, 1.5);
    assert_eq!(video.bookmarks[0].seconds, 11.3);
}

#[test]
fn a_corrupt_or_future_record_does_not_hide_healthy_videos() {
    let f = Fixture::new();
    let id = f.imported();
    let corrupt = uuid::Uuid::new_v4().to_string();
    fs::write(f.record(&corrupt), "broken").unwrap();
    let mut future: serde_json::Value =
        serde_json::from_slice(&fs::read(f.record(&id)).unwrap()).unwrap();
    let future_id = uuid::Uuid::new_v4().to_string();
    future["schemaVersion"] = 9.into();
    future["id"] = future_id.clone().into();
    fs::write(f.record(&future_id), serde_json::to_vec(&future).unwrap()).unwrap();
    let listing = f.service.list().unwrap();
    assert_eq!(listing.videos.len(), 1);
    assert_eq!(listing.warnings.len(), 2);
    assert!(f.record(&corrupt).exists());
    assert!(f.record(&future_id).exists());
}

#[test]
fn deleting_registration_or_bookmark_never_touches_original_media() {
    let f = Fixture::new();
    let bytes = fs::read(&f.source).unwrap();
    let (id, _) = f.ready();
    let input = f.bookmark(0.0);
    f.service.add_bookmark(&id, input.clone()).unwrap();
    assert!(
        f.service
            .remove_bookmark(&id, &input.id)
            .unwrap()
            .video
            .bookmarks
            .is_empty()
    );
    f.service.remove(&id).unwrap();
    f.service.remove(&id).unwrap();
    assert_eq!(fs::read(&f.source).unwrap(), bytes);
    assert!(f.service.list().unwrap().videos.is_empty());
}

#[test]
fn uuid_validation_prevents_arbitrary_file_access_or_deletion() {
    let f = Fixture::new();
    for id in [
        "../movie",
        "../../source.mp4",
        "/tmp/source",
        "",
        "not-a-uuid",
    ] {
        assert!(f.service.remove(id).is_err());
        assert!(f.service.open(id).is_err());
    }
    assert!(f.source.exists());
}

#[cfg(unix)]
#[test]
fn metadata_symlinks_are_not_loaded_and_removal_never_follows_them() {
    let f = Fixture::new();
    let id = uuid::Uuid::new_v4().to_string();
    std::os::unix::fs::symlink(&f.source, f.record(&id)).unwrap();
    assert_eq!(f.service.list().unwrap().warnings.len(), 1);
    f.service.remove(&id).unwrap();
    assert!(f.source.exists());
}

#[test]
fn only_one_process_can_write_the_library() {
    let f = Fixture::new();
    assert!(matches!(
        LibraryService::new(f.temporary.path().join("data")),
        Err(CoreError::LibraryInUse)
    ));
}

#[test]
fn unsupported_files_and_directories_are_rejected() {
    let f = Fixture::new();
    let wrong = f.temporary.path().join("video.mkv");
    fs::write(&wrong, b"not supported").unwrap();
    assert!(matches!(
        f.service.import(&wrong),
        Err(CoreError::UnsupportedFile)
    ));
    let directory = f.temporary.path().join("directory.mp4");
    fs::create_dir(&directory).unwrap();
    assert!(f.service.import(&directory).is_err());
    let empty = f.temporary.path().join("empty.mp4");
    fs::write(&empty, []).unwrap();
    assert!(f.service.import(&empty).is_err());
}

#[test]
fn rename_changes_only_metadata_and_rejects_empty_titles() {
    let f = Fixture::new();
    let id = f.imported();
    assert!(f.service.rename(&id, " ").is_err());
    let updated = f.service.rename(&id, "  学習動画  ").unwrap();
    assert_eq!(updated.video.title, "学習動画");
    assert!(f.source.exists());
    assert_eq!(updated.video.path, fs::canonicalize(&f.source).unwrap());
}

#[test]
fn retry_keeps_the_latest_note_without_duplicating_a_bookmark() {
    let f = Fixture::new();
    let (id, _) = f.ready();
    let mut input = f.bookmark(14.0);
    f.service.add_bookmark(&id, input.clone()).unwrap();
    input.note = "再試行前に追記したメモ".into();
    let result = f.service.add_bookmark(&id, input).unwrap();
    assert_eq!(result.video.bookmarks.len(), 1);
    assert_eq!(result.video.bookmarks[0].note, "再試行前に追記したメモ");
}

#[test]
fn deletion_prunes_only_unreferenced_generated_thumbnails() {
    let f = Fixture::new();
    let (id, _) = f.ready();
    let cover = f.bookmark(1.0);
    let other = f.bookmark(2.0);
    f.service.add_bookmark(&id, cover.clone()).unwrap();
    f.service.add_bookmark(&id, other.clone()).unwrap();
    let cover_file = f
        .service
        .thumbnail_directory()
        .join(format!("{}.jpg", cover.id));
    let other_file = f
        .service
        .thumbnail_directory()
        .join(format!("{}.jpg", other.id));
    let untouched = f.service.thumbnail_directory().join("not-generated.jpg");
    fs::write(&untouched, b"not a generated thumbnail").unwrap();
    f.service.remove_bookmark(&id, &other.id).unwrap();
    assert!(cover_file.exists());
    assert!(!other_file.exists());
    f.service.remove(&id).unwrap();
    assert!(!cover_file.exists());
    assert!(untouched.exists());
    assert!(f.source.exists());
}

#[test]
fn pruning_stops_when_a_corrupt_record_might_still_reference_images() {
    let f = Fixture::new();
    let (id, _) = f.ready();
    let mark = f.bookmark(1.0);
    f.service.add_bookmark(&id, mark.clone()).unwrap();
    fs::write(f.record(&uuid::Uuid::new_v4().to_string()), b"damaged").unwrap();
    f.service.remove(&id).unwrap();
    assert!(
        f.service
            .thumbnail_directory()
            .join(format!("{}.jpg", mark.id))
            .exists()
    );
}

#[test]
fn legacy_point_bookmarks_stay_readable_and_range_bookmarks_survive_restart() {
    let f = Fixture::new();
    let original = fs::read(&f.source).unwrap();
    let (id, _) = f.ready();
    let point = f.bookmark(9.0);
    f.service.add_bookmark(&id, point.clone()).unwrap();
    let mut legacy: serde_json::Value =
        serde_json::from_slice(&fs::read(f.record(&id)).unwrap()).unwrap();
    legacy["schemaVersion"] = 1.into();
    legacy["bookmarks"][0]
        .as_object_mut()
        .unwrap()
        .remove("endSeconds");
    fs::write(f.record(&id), serde_json::to_vec(&legacy).unwrap()).unwrap();
    let before = fs::read(f.record(&id)).unwrap();
    assert_eq!(
        f.service.list().unwrap().videos[0].video.bookmarks[0].end_seconds,
        None
    );
    assert_eq!(fs::read(f.record(&id)).unwrap(), before);
    let mut range = f.bookmark(10.2);
    range.end_seconds = Some(20.7);
    let saved = f.service.add_bookmark(&id, range.clone()).unwrap().video;
    assert_eq!(saved.schema_version, 3);
    assert_eq!(saved.bookmarks[0].id, point.id);
    f.service.add_bookmark(&id, range.clone()).unwrap();
    drop(f.service);
    let reopened = LibraryService::new(f.temporary.path().join("data")).unwrap();
    let restored = reopened.list().unwrap().videos.remove(0).video;
    assert_eq!(restored.bookmarks, saved.bookmarks);
    assert_eq!(restored.bookmarks[1].end_seconds, Some(20.7));
    let converted = reopened
        .edit_bookmark(
            &id,
            &range.id,
            "地点へ変更",
            BookmarkColor::Sage,
            None,
            None,
        )
        .unwrap()
        .video;
    assert_eq!(converted.bookmarks[1].seconds, 10.2);
    assert_eq!(converted.bookmarks[1].end_seconds, None);
    assert_eq!(converted.bookmarks[1].thumbnail_id, range.id);
    let changed = reopened
        .edit_bookmark(
            &id,
            &point.id,
            "区間へ変更",
            BookmarkColor::Blue,
            Some(12.0),
            None,
        )
        .unwrap()
        .video;
    assert_eq!(changed.bookmarks[0].end_seconds, Some(12.0));
    assert_eq!(fs::read(&f.source).unwrap(), original);
}

#[test]
fn invalid_repeat_endpoints_never_change_saved_bookmarks() {
    let f = Fixture::new();
    let (id, _) = f.ready();
    let mut range = f.bookmark(10.2);
    range.end_seconds = Some(10.7);
    f.service.add_bookmark(&id, range.clone()).unwrap();
    let before = fs::read(f.record(&id)).unwrap();
    for end in [f64::NAN, f64::INFINITY, -1.0, 9.0, 10.2, 10.69, 120.1] {
        let mut invalid = f.bookmark(10.2);
        invalid.end_seconds = Some(end);
        assert!(f.service.add_bookmark(&id, invalid).is_err());
        assert!(
            f.service
                .edit_bookmark(&id, &range.id, "変更", BookmarkColor::Blue, Some(end), None)
                .is_err()
        );
        assert_eq!(fs::read(f.record(&id)).unwrap(), before);
    }
    range.end_seconds = Some(11.0);
    assert!(f.service.add_bookmark(&id, range.clone()).is_err());
    assert_eq!(fs::read(f.record(&id)).unwrap(), before);
    f.service
        .edit_bookmark(
            &id,
            &range.id,
            "末尾まで",
            BookmarkColor::Sage,
            Some(120.0),
            None,
        )
        .unwrap();
}

#[test]
fn color_settings_survive_restart_and_bookmark_edits_without_touching_source() {
    use shiori_core::ColorAdjustments;
    let f = Fixture::new();
    let original = fs::read(&f.source).unwrap();
    let (id, session) = f.ready();
    let colors = ColorAdjustments {
        brightness: 1.2,
        contrast: 1.1,
        saturation: 0.75,
    };
    f.service
        .save_progress(
            &session,
            2,
            Progress {
                position: 20.0,
                duration: 120.0,
                playback_rate: 1.0,
                color_adjustments: Some(colors),
            },
        )
        .unwrap();
    let mut point = f.bookmark(20.0);
    point.color_adjustments = Some(colors);
    f.service.add_bookmark(&id, point.clone()).unwrap();
    let mut range = f.bookmark(30.0);
    range.end_seconds = Some(40.0);
    range.color_adjustments = Some(ColorAdjustments {
        brightness: 1.5,
        ..colors
    });
    f.service.add_bookmark(&id, range.clone()).unwrap();
    f.service
        .edit_bookmark(
            &id,
            &range.id,
            "色調を変更",
            BookmarkColor::Blue,
            Some(40.0),
            Some(colors),
        )
        .unwrap();
    drop(f.service);
    let service = LibraryService::new(f.temporary.path().join("data")).unwrap();
    let video = service.list().unwrap().videos.remove(0).video;
    assert_eq!(video.color_adjustments, Some(colors));
    assert_eq!(video.schema_version, 3);
    assert!(
        video
            .bookmarks
            .iter()
            .all(|b| b.color_adjustments == Some(colors))
    );
    assert_eq!(video.bookmarks[1].end_seconds, Some(40.0));
    assert_eq!(fs::read(&f.source).unwrap(), original);
}

#[test]
fn old_colorless_records_stay_readable_and_invalid_colors_do_not_write() {
    use shiori_core::ColorAdjustments;
    let f = Fixture::new();
    let (id, session) = f.ready();
    let point = f.bookmark(20.0);
    f.service.add_bookmark(&id, point.clone()).unwrap();
    let mut record: serde_json::Value =
        serde_json::from_slice(&fs::read(f.record(&id)).unwrap()).unwrap();
    for version in [1, 2] {
        record["schemaVersion"] = version.into();
        fs::write(f.record(&id), serde_json::to_vec(&record).unwrap()).unwrap();
        let before = fs::read(f.record(&id)).unwrap();
        let video = f.service.list().unwrap().videos.remove(0).video;
        assert_eq!(video.color_adjustments, None);
        assert_eq!(video.bookmarks[0].color_adjustments, None);
        assert_eq!(fs::read(f.record(&id)).unwrap(), before);
    }
    let before = fs::read(f.record(&id)).unwrap();
    for value in [f64::NAN, f64::INFINITY, -1.0, 2.01] {
        let bad = ColorAdjustments {
            brightness: value,
            contrast: 1.0,
            saturation: 1.0,
        };
        let mut input = f.bookmark(21.0);
        input.color_adjustments = Some(bad);
        assert!(f.service.add_bookmark(&id, input).is_err());
        assert!(
            f.service
                .edit_bookmark(
                    &id,
                    &point.id,
                    "invalid",
                    BookmarkColor::Sage,
                    None,
                    Some(bad)
                )
                .is_err()
        );
        assert!(
            f.service
                .save_progress(
                    &session,
                    2,
                    Progress {
                        position: 0.0,
                        duration: 120.0,
                        playback_rate: 1.0,
                        color_adjustments: Some(bad)
                    }
                )
                .is_err()
        );
        assert_eq!(fs::read(f.record(&id)).unwrap(), before);
    }
    for bad in [
        ColorAdjustments {
            brightness: 0.49,
            contrast: 1.0,
            saturation: 1.0,
        },
        ColorAdjustments {
            brightness: 1.0,
            contrast: 0.49,
            saturation: 1.0,
        },
        ColorAdjustments {
            brightness: 1.0,
            contrast: 1.0,
            saturation: -0.01,
        },
    ] {
        assert!(bad.validate().is_err());
    }
    ColorAdjustments {
        brightness: 0.5,
        contrast: 2.0,
        saturation: 0.0,
    }
    .validate()
    .unwrap();
}
