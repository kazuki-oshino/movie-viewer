#[derive(Debug, thiserror::Error)]
pub enum CoreError {
    #[error("記録が見つかりません。ライブラリを読み直してください。")]
    NotFound,
    #[error("動画が見つからないか、読み取れません。移動後のファイルを指定してください。")]
    SourceUnavailable,
    #[error(
        "動画の内容が登録時と異なります。元の動画を指定してください。しおりは変更していません。"
    )]
    ContentChanged,
    #[error("MP4・MOV・M4V形式の動画を選択してください。")]
    UnsupportedFile,
    #[error("この保存データは新しいバージョンのShioriで作成されています。")]
    UnsupportedVersion,
    #[error("保存する内容を確認してください: {0}")]
    Invalid(String),
    #[error("再生セッションが変わりました。動画を開き直してください。")]
    StaleSession,
    #[error("サムネイルを保存できません: {0}")]
    Thumbnail(String),
    #[error("保存先へのアクセスに失敗しました: {0}")]
    Io(#[from] std::io::Error),
    #[error("保存データを読み取れません: {0}")]
    Json(#[from] serde_json::Error),
    #[error("処理を続けられません。アプリを再起動してください。")]
    Lock,
    #[error("このライブラリは別のShioriで使用中です。先にそちらを終了してください。")]
    LibraryInUse,
}

pub type Result<T> = std::result::Result<T, CoreError>;
