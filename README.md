# claude-statusline

[Claude Code](https://code.claude.com/docs/en/statusline) 用のカスタムステータスラインです。

Node.js 単一ファイル・依存パッケージなしで動作します(Node.js 18 以上)。

## 表示内容

2行構成で表示します。

```
📁 repo名 🌿 branch* [wt:worktree] #42 +156 -23 | [Fable 5] max
120k/200k 60% | $1.23 | ⏱ 2m30s/45m0s | 5h: 24%→14:00 7d: 81%→14:00
```

**1行目(ロケーション / モデル)**

- リポジトリ名(GitHub へのクリック可能リンク。Cmd+クリックで開く)
- git ブランチ名(25文字超は中間省略)+ dirty マーク `*`
- worktree 名(worktree セッション時のみ)
- オープン PR へのリンク `#42`
- セッション中の行差分 `+追加 -削除`
- モデル名 + effort レベル(`low/med/hi/xhi/max`)

**2行目(メトリクス)**

- コンテキストウィンドウの使用量/上限(`120k/200k` など。入力+キャッシュトークンの合計)と使用率(薄字。緑 <70% / 黄 70–89% / 赤 ≥90%)
- 累積コスト(USD)
- 経過時間(API待ち時間 / 実時間)
- レート制限の消費率とリセット時刻(Claude Pro/Max のみ。黄 ≥80% / 赤 ≥95%)

欠落しているデータのセグメントは自動的に非表示になります。

## インストール

このリポジトリを clone し、`~/.claude/settings.json` に以下を追記します:

```json
{
  "statusLine": {
    "type": "command",
    "command": "node /path/to/claude-statusline/index.js"
  }
}
```

設定は自動リロードされ、次のやり取りからステータスラインが表示されます。

## 動作確認

モック入力でテストできます:

```sh
cat test/fixtures/full.json | node index.js      # 全フィールドあり
cat test/fixtures/minimal.json | node index.js   # セッション初期(context が null)
cat test/fixtures/no-git.json | node index.js    # git リポジトリ外・コンテキスト 92%
```

## 実装メモ

- ステータスライン情報は Claude Code から stdin の JSON で渡されます([全スキーマ](https://code.claude.com/docs/en/statusline#available-data))
- git の branch / dirty 判定は `os.tmpdir()` 配下に session_id 単位で 5 秒キャッシュしています
- PR 情報は stdin の `pr` フィールドを使うため `gh` CLI は不要です

## License

MIT
