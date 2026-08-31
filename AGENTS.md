# Agent guide

## リポジトリの目的

- TODO

## 思考と判断のルール

- メタ認知すること。
- 重要または後戻りしにくい判断では、目的、前提、範囲、長期的な影響を見直すこと。
- 結論や完了の前に、見落とし、反例、失敗条件、隠れたコスト、別の有力な解釈を検討すること。
- 事実はリポジトリ内の現行戦略、制作台帳、実ファイル、コマンド結果から確認すること。

## 作業言語

- 思考は英語でよいが、ユーザーへの回答とプロジェクト内Markdownは日本語で記述する。

## AI Skills

用途に合う場合は、次のskillを自動的に使用する。

| Skill | Purpose |
| --- | --- |
| `create-wordpress-article` | WordPress記事の調査、執筆、HTML化、検証、下書き投稿・更新を行う。 |
| `create-wordpress-travel-diagnosis` | 旅行先・泊数・宿泊エリアなどの診断を調査・配点設計し、楽天トラベル導線付きのWordPress旅行診断下書きとして作成・検証する。 |
| `create-affiliate-article-draft` | 指定された提携済み案件からSEO記事タイプと統合方針を判断し、調査、A8リンク生成、約1万字の記事、画像制作、WordPress下書き投稿までを一括で行う。 |
| `create-demand-first-affiliate-article-draft` | Google Trends・Yahoo!などの需要調査からテーマとSEOキーワードを決め、本文完成後にAmazon・楽天の商品を選び、リンク入り記事をWordPress下書きへ保存する。 |
| `create-rakuten-affiliate-link` | 楽天公式画面・APIから楽天アフィリエイトリンクを発行し、規約上の改変、遷移先、Affiliate IDを検証する。 |
| `create-amazon-associate-link` | Amazon公式画面・現行APIから特別リンクを発行し、トラッキングID、ASIN、版、開示を検証する。 |
| `create-multi-store-affiliate-box` | 同一商品のAmazon・楽天・電子版などの購入ボタンを一つの商品ボックスにまとめて検証する。 |
| `write-note-essay` | note向け創作エッセイの調査、合成、執筆、見出し画像、入稿、公開確認を行う。 |
| `write-arisawa-itsuka-essay` | 汎用エッセイスキルを使い、有沢いつかの人格と連作世界を保って記事を制作する。 |


## Git and file operations

- ファイル移動・削除の前に参照を検索する。
- 生成物とcurated assetをファイル名だけで判定しない。
- コミット前に `git diff --check` と関連テストを実行する。
- シークレットや外部サービスの認証情報をコミットしない。

