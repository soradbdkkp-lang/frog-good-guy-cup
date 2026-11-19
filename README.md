# ふろぐ Good Guy Cup

2027年1月11日開催。公式サイトは GitHub Pages、応募画面と API は専用 Cloudflare Worker、保存は Apps Script と非公開 Google スプレッドシートを使用する。

## ローカル確認

```sh
node --test tests/entry.test.cjs
node scripts/build.cjs
```

`dist/pages` は大会サイト、`dist/worker` は応募フォーム。両方に装飾ボタンなしのデザインを適用する。ローカルビルドで公式サイトの応募ボタンが指す先は `http://127.0.0.1:8787/`。Worker の起動は `wrangler dev`。

自動試験では、5形式、機種、保護者同意、クリップ利用同意、再送、受付停止、Worker から保存ハンドラーへの転送を架空データで確認する。ローカルの Google サービスはテスト用の代替実装を使う。

## 本番反映

1. 主催者の確認後、大会専用 Apps Script の `Code.gs` を更新し、従来の所有者限定バージョンとは別の Web アプリ配備を作成する。実行ユーザーは所有者。Worker が Google ログインなしで POST できるアクセス設定を選ぶ。新配備は認証済み POST のみ受付処理を行う。
2. Apps Script の `WORKER_SHARED_KEY` と、Worker のシークレット `GGC_WORKER_SHARED_KEY` に同じ十分な長さのランダム値を設定する。Worker のシークレット `GGC_APPS_SCRIPT_URL` には新しい `/exec` URL を設定する。値はブラウザ用ファイルや Git に置かない。
3. 既存の非公開の `TEST_SHEET_ID` と `LIVE_SHEET_ID` を使う。新規環境の場合は、一時的にエディタで `function initializeForOwner() { setupSheets_(); }` を追加・実行し、両シートが作成されたことを確認して関数を取り除く。既存の試験行は保持する。
4. 非公開またはローカルの Worker 経由で試験する。Apps Script の `ENTRY_MODE=test` で架空の応募を送り、完了画面の `TEST-` 受付番号を試験用シートで照合する。本番用シートの行が増えていないことを確認し、`ENTRY_MODE=closed` に戻す。
5. Worker を配備し、応募フォーム URL と受付停止表示を確認する。GitHub の Pages 設定で GitHub Actions を選び、リポジトリ変数 `GGC_FORM_URL` に実際の応募フォーム URL を登録して Pages ワークフローを実行する。公開サイトの応募ボタンから Worker のフォームに遷移することを確認する。
6. 本番受付開始時は `ENTRY_MODE=live`、停止時は `ENTRY_MODE=closed`。本番応募は本番用シートに `GGC-` の受付番号で保存される。

ルール資料 [暫定大会ルール・応募要項（2026年11月20日版）](https://docs.google.com/document/d/1YeT5bVpeFp-IeOENKu3qh1-HgWedz9jY_9OcVynhZb0/edit)
