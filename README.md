# S3 File Downloader

AWS S3 バケットから指定した数のファイルをダウンロードする TypeScript プログラムです。

## 機能

- AWS S3 バケットからファイル一覧を取得
- 指定した最大数のファイルをダウンロード
- 並行ダウンロードによる高速処理
- 環境変数による設定管理

## セットアップ

### 1. 依存関係のインストール

```bash
npm install
```

### 2. 環境変数の設定

`.env`ファイルを編集して、AWS 認証情報と S3 バケット情報を設定してください：

```env
# AWS認証情報
AWS_ACCESS_KEY_ID=your_access_key_here
AWS_SECRET_ACCESS_KEY=your_secret_key_here
AWS_REGION=ap-northeast-1

# S3設定
S3_BUCKET_NAME=your_bucket_name_here

# ダウンロード設定
DOWNLOAD_DIR=./downloads
MAX_FILES=100
```

**設定項目の説明:**

- `AWS_ACCESS_KEY_ID`: AWS アクセスキー ID
- `AWS_SECRET_ACCESS_KEY`: AWS シークレットアクセスキー
- `AWS_REGION`: AWS リージョン（デフォルト: ap-northeast-1）
- `S3_BUCKET_NAME`: ダウンロード元の S3 バケット名
- `DOWNLOAD_DIR`: ダウンロード先ディレクトリ（デフォルト: ./downloads）
- `MAX_FILES`: ダウンロードする最大ファイル数（デフォルト: 100）

## 使用方法

### 開発モードで実行

```bash
npm run dev
```

### ビルドして実行

```bash
npm run build
npm start
```

## AWS 認証情報の取得方法

1. AWS IAM コンソールにアクセス
2. ユーザーを作成または既存ユーザーを選択
3. プログラムによるアクセス用のアクセスキーを生成
4. S3 バケットへの読み取り権限（`s3:GetObject`, `s3:ListBucket`）を付与

## 必要な権限

IAM ユーザーまたはロールに以下の権限が必要です：

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["s3:GetObject", "s3:ListBucket"],
      "Resource": ["arn:aws:s3:::your-bucket-name", "arn:aws:s3:::your-bucket-name/*"]
    }
  ]
}
```

## プロジェクト構成

```
.
├── src/
│   └── index.ts          # メインプログラム
├── dist/                 # ビルド済みファイル
├── downloads/            # ダウンロードファイル保存先
├── .env                  # 環境変数設定
├── package.json          # パッケージ設定
├── tsconfig.json         # TypeScript設定
└── README.md            # このファイル
```

## 特徴

- **エラーハンドリング**: ファイルダウンロード時のエラーを適切に処理
- **並行処理**: 複数ファイルを同時にダウンロードして効率化
- **進捗表示**: ダウンロード進捗をコンソールに表示
- **ディレクトリ自動作成**: ダウンロード先ディレクトリが存在しない場合は自動作成
- **設定検証**: 必須設定項目の存在確認

## 注意事項

- 大量のファイルをダウンロードする場合は、AWS 料金（データ転送料）にご注意ください
- ダウンロード先のディスク容量を事前に確認してください
- AWS 認証情報は適切に管理し、リポジトリにコミットしないでください
