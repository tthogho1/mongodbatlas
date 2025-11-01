import { S3Client, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { config } from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import { Embedding } from './lib/embedding';
import { MongoClient, Db, Collection } from 'mongodb';

// .envファイルを読み込み
config();

interface S3Config {
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  bucketName: string;
  imageServerUrl: string;
  modelId: string;
  outputDir: string;
  maxFiles: number;
  mongodbUri: string;
  mongodbDbName: string;
  mongodbCollectionName: string;
}

interface ImageEmbeddingResult {
  key: string;
  url: string;
  embedding: number[];
  timestamp: string;
}

class S3ImageEmbeddingProcessor {
  private s3Client: S3Client;
  private config: S3Config;
  private embeddingModel: Embedding;

  private mongoClient: MongoClient | null = null;
  private mongodb: Db | null = null;
  private collection: Collection | null = null;

  constructor() {
    // 環境変数から設定を読み込み
    this.config = {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
      region: process.env.AWS_REGION || 'ap-northeast-1',
      bucketName: process.env.S3_BUCKET_NAME || '',
      imageServerUrl: process.env.IMAGE_SERVER_URL || '',
      modelId: process.env.MODEL_ID || 'Xenova/clip-vit-base-patch32',
      outputDir: process.env.OUTPUT_DIR || './embeddings',
      maxFiles: parseInt(process.env.MAX_FILES || '100'),
      mongodbUri: process.env.MONGODB_URI || '',
      mongodbDbName: process.env.MONGODB_DB_NAME || 'webcamNew',
      mongodbCollectionName: process.env.MONGODB_COLLECTION_NAME || 'imageTest',
    };

    // 必須設定の検証
    this.validateConfig();

    // S3クライアントの初期化
    this.s3Client = new S3Client({
      region: this.config.region,
      credentials: {
        accessKeyId: this.config.accessKeyId,
        secretAccessKey: this.config.secretAccessKey,
      },
    });

    // Embeddingモデルの初期化
    this.embeddingModel = new Embedding();
  }

  private validateConfig(): void {
    const requiredFields = ['accessKeyId', 'secretAccessKey', 'bucketName', 'imageServerUrl'];
    const missingFields = requiredFields.filter(field => !this.config[field as keyof S3Config]);

    if (missingFields.length > 0) {
      throw new Error(`必須設定が不足しています: ${missingFields.join(', ')}`);
    }
  }

  /**
   * Embeddingモデルの初期化を待つ
   */
  private async waitForModelInitialization(): Promise<void> {
    // モデルが初期化されるまで待機
    let attempts = 0;
    const maxAttempts = 60; // 最大60秒待機

    while (attempts < maxAttempts) {
      try {
        // テスト用のテキストでモデルが使用可能かチェック
        await this.embeddingModel.getTextEmbedding('test');
        console.log('モデルの初期化が完了しました。');
        return;
      } catch (error: any) {
        if (error?.message === 'Model not initialized') {
          attempts++;
          await new Promise(resolve => setTimeout(resolve, 1000)); // 1秒待機
          if (attempts % 10 === 0) {
            console.log(`モデル初期化待機中... (${attempts}/${maxAttempts}秒)`);
          }
        } else {
          throw error;
        }
      }
    }

    throw new Error('モデルの初期化がタイムアウトしました。');
  }

  /**
   * MongoDB Atlasに接続
   */
  private async connectToMongoDB(): Promise<void> {
    try {
      if (!this.config.mongodbUri) {
        console.log('MongoDB接続文字列が設定されていません。MongoDB保存をスキップします。');
        return;
      }

      console.log('MongoDB Atlasに接続中...');
      this.mongoClient = new MongoClient(this.config.mongodbUri);
      await this.mongoClient.connect();

      this.mongodb = this.mongoClient.db(this.config.mongodbDbName);
      this.collection = this.mongodb.collection(this.config.mongodbCollectionName);

      console.log(
        `MongoDB接続成功: ${this.config.mongodbDbName}.${this.config.mongodbCollectionName}`
      );

      // コレクションを空にする
      const deleteResult = await this.collection.deleteMany({});
      console.log(`コレクションを空にしました: 削除件数 ${deleteResult.deletedCount}`);
    } catch (error) {
      console.error('MongoDB接続エラー:', error);
      throw error;
    }
  }

  /**
   * MongoDBへの接続を切断
   */
  private async disconnectFromMongoDB(): Promise<void> {
    if (this.mongoClient) {
      await this.mongoClient.close();
      console.log('MongoDBから切断しました。');
    }
  }

  /**
   * Embeddingをmongodbに保存
   */
  private async saveToMongoDB(result: ImageEmbeddingResult): Promise<void> {
    if (!this.collection) {
      return; // MongoDB接続がない場合はスキップ
    }

    try {
      const document = {
        key: result.key,
        embedding: result.embedding,
        url: result.url,
        timestamp: result.timestamp,
        createdAt: new Date(),
      };

      await this.collection.insertOne(document);
      console.log(`MongoDBに保存完了: ${result.key}`);
    } catch (error) {
      console.error(`MongoDBへの保存に失敗 (${result.key}):`, error);
      // エラーが発生しても処理を継続
    }
  }

  /**
   * S3バケットからファイル一覧を取得
   */
  private async listFiles(): Promise<string[]> {
    try {
      const command = new ListObjectsV2Command({
        Bucket: this.config.bucketName,
        MaxKeys: this.config.maxFiles,
      });

      const response = await this.s3Client.send(command);

      if (!response.Contents) {
        console.log('バケットにファイルが見つかりませんでした。');
        return [];
      }

      return response.Contents.filter(object => object.Key) // Keyが存在するもののみ
        .map(object => object.Key!)
        .filter(key => this.isImageFile(key)) // 画像ファイルのみ
        .slice(0, this.config.maxFiles); // 最大件数まで制限
    } catch (error) {
      console.error('ファイル一覧の取得に失敗しました:', error);
      throw error;
    }
  }

  /**
   * ファイルが画像かどうかを判定
   */
  private isImageFile(key: string): boolean {
    const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp'];
    const ext = path.extname(key).toLowerCase();
    return imageExtensions.includes(ext);
  }

  /**
   * 単一画像のEmbeddingを生成
   */
  private async processImageEmbedding(key: string): Promise<ImageEmbeddingResult> {
    try {
      // URLを作成
      const imageUrl = this.config.imageServerUrl + key;

      console.log(`画像Embedding生成中: ${key}`);

      // Embeddingを生成
      const embedding = await this.embeddingModel.getImageEmbedding(imageUrl);

      const result: ImageEmbeddingResult = {
        key,
        url: imageUrl,
        embedding,
        timestamp: new Date().toISOString(),
      };

      console.log(`Embedding生成完了: ${key} (次元数: ${embedding.length})`);
      return result;
    } catch (error) {
      console.error(`画像Embeddingの生成に失敗しました (${key}):`, error);
      throw error;
    }
  }

  /**
   * 複数画像を順番に処理
   */
  private async processImagesSequential(keys: string[]): Promise<ImageEmbeddingResult[]> {
    console.log(`${keys.length}件の画像を順番にEmbedding生成開始...`);
    const results: ImageEmbeddingResult[] = [];

    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      try {
        const result = await this.processImageEmbedding(key);
        results.push(result);

        // MongoDBに保存
        await this.saveToMongoDB(result);

        console.log(`(${i + 1}/${keys.length}) 完了: ${key}`);
      } catch (error) {
        console.error(`(${i + 1}/${keys.length}) エラー: ${key}`, error);
        // エラーが発生しても残りを続行
      }
    }

    return results;
  }

  /**
   * 結果をJSONファイルに保存（1ファイルごと）
   */
  private async saveResults(results: ImageEmbeddingResult[]): Promise<void> {
    try {
      // 出力ディレクトリを作成
      if (!fs.existsSync(this.config.outputDir)) {
        fs.mkdirSync(this.config.outputDir, { recursive: true });
        console.log(`出力ディレクトリを作成しました: ${this.config.outputDir}`);
      }

      // 各画像のEmbeddingを個別ファイルで保存
      for (const result of results) {
        const fileName = path.parse(result.key).name; // 拡張子を除いたファイル名
        const outputFile = path.join(this.config.outputDir, `${fileName}_embedding.json`);

        const output = {
          metadata: {
            bucketName: this.config.bucketName,
            imageServerUrl: this.config.imageServerUrl,
            modelId: this.config.modelId,
            processedAt: result.timestamp,
          },
          result,
        };

        fs.writeFileSync(outputFile, JSON.stringify(output, null, 2));
        console.log(`ファイルを保存しました: ${outputFile}`);
      }

      // 全体のサマリーファイルも作成
      const summaryFile = path.join(this.config.outputDir, `summary_${Date.now()}.json`);
      const summary = {
        metadata: {
          bucketName: this.config.bucketName,
          imageServerUrl: this.config.imageServerUrl,
          modelId: this.config.modelId,
          processedAt: new Date().toISOString(),
          totalImages: results.length,
        },
        results: results.map(r => ({
          key: r.key,
          url: r.url,
          timestamp: r.timestamp,
          embeddingDimensions: r.embedding.length,
        })),
      };

      fs.writeFileSync(summaryFile, JSON.stringify(summary, null, 2));
      console.log(`サマリーファイルを保存しました: ${summaryFile}`);
    } catch (error) {
      console.error('結果の保存に失敗しました:', error);
      throw error;
    }
  }

  /**
   * メイン実行メソッド
   */
  public async run(): Promise<void> {
    try {
      console.log('=== S3 画像Embedding生成器 ===');
      console.log(`バケット: ${this.config.bucketName}`);
      console.log(`画像サーバーURL: ${this.config.imageServerUrl}`);
      console.log(`モデルID: ${this.config.modelId}`);
      console.log(`最大ファイル数: ${this.config.maxFiles}`);
      console.log(`出力先: ${this.config.outputDir}`);
      console.log('');

      // モデルの初期化を待つ
      console.log('モデルの初期化を待機中...');
      await this.waitForModelInitialization();

      // MongoDBに接続
      await this.connectToMongoDB();

      // ファイル一覧を取得
      console.log('画像ファイル一覧を取得中...');
      const imageKeys = await this.listFiles();

      if (imageKeys.length === 0) {
        console.log('処理する画像ファイルがありません。');
        return;
      }

      console.log(`${imageKeys.length}件の画像ファイルが見つかりました。`);
      console.log('画像ファイル一覧:');
      imageKeys.forEach((key, index) => {
        console.log(`  ${index + 1}. ${key}`);
      });
      console.log('');

      // 画像Embeddingを生成（順番に処理）
      const results = await this.processImagesSequential(imageKeys);

      // 結果を保存
      await this.saveResults(results);

      console.log('');
      console.log('=== Embedding生成完了 ===');
      console.log(`合計 ${results.length} 画像のEmbeddingを生成しました。`);

      // 統計情報を表示
      if (results.length > 0) {
        const embeddingDimensions = results[0].embedding.length;
        console.log(`Embedding次元数: ${embeddingDimensions}`);
      }
    } catch (error) {
      console.error('エラーが発生しました:', error);
      process.exit(1);
    } finally {
      // MongoDB接続を切断
      await this.disconnectFromMongoDB();
    }
  }
}

// プログラム実行
async function main() {
  const processor = new S3ImageEmbeddingProcessor();
  await processor.run();
}

// スクリプトが直接実行された場合のみmain関数を呼び出し
if (require.main === module) {
  main().catch(console.error);
}

export default S3ImageEmbeddingProcessor;
