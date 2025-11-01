import express from 'express';
import cors from 'cors';
import { config } from 'dotenv';
import { MongoClient } from 'mongodb';
import path from 'path';
import { Embedding } from '../src/lib/embedding';

config({ path: path.resolve(__dirname, '..', '.env') });

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3000;
const MONGODB_URI = process.env.MONGODB_URI || '';
const DB_NAME = process.env.MONGODB_DB_NAME || 'webcamNew';
const COLLECTION_NAME = process.env.MONGODB_COLLECTION_NAME || 'imageTest';

let mongoClient: MongoClient | null = null;
let embeddingModel: Embedding;

async function connectMongo() {
  if (!MONGODB_URI) throw new Error('MONGODB_URI is not set in .env');
  mongoClient = new MongoClient(MONGODB_URI);
  await mongoClient.connect();
  console.log('Connected to MongoDB');
}

async function waitForEmbeddingModel(model: Embedding) {
  // wait until model is initialized (similar to index.ts)
  let attempts = 0;
  const maxAttempts = 60;
  while (attempts < maxAttempts) {
    try {
      await model.getTextEmbedding('test');
      console.log('Embedding model ready');
      return;
    } catch (err: any) {
      if (err?.message === 'Model not initialized') {
        attempts++;
        await new Promise(r => setTimeout(r, 1000));
        continue;
      }
      throw err;
    }
  }
  throw new Error('Embedding model init timeout');
}

app.post('/search', async (req, res) => {
  try {
    const { query, topK = 5 } = req.body;
    if (!query) return res.status(400).json({ error: 'query is required' });

    // compute embedding
    const qVec = await embeddingModel.getTextEmbedding(query);
    console.log(`query ${query} vec length: `, qVec.length);
    if (!mongoClient) await connectMongo();
    const db = mongoClient!.db(DB_NAME);
    const coll = db.collection(COLLECTION_NAME);

    // Use $search knnBeta operator for vector similarity search
    const pipeline = [
      {
        $search: {
          index: 'embedding_index',
          knnBeta: {
            vector: qVec,
            path: 'embedding',
            k: topK,
          },
        },
      },
      {
        $project: {
          key: 1,
          url: { $ifNull: ['$url', '$key'] },
          embedding: 1,
          score: { $meta: 'searchScore' },
        },
      },
      { $limit: topK },
    ];

    const docs = await coll.aggregate(pipeline).toArray();
    res.json({ results: docs });
  } catch (error) {
    console.error('search error', error);
    res.status(500).json({ error: String(error) });
  }
});

// serve client
app.use('/', express.static(path.join(__dirname, 'client')));

async function start() {
  try {
    embeddingModel = new Embedding();
    await waitForEmbeddingModel(embeddingModel);
    await connectMongo();

    app.listen(PORT, () => {
      console.log(`Server listening on http://localhost:${PORT}`);
    });
  } catch (error) {
    console.error('Failed to start server', error);
    process.exit(1);
  }
}

start();
