import mongoose from 'mongoose';
import process from 'node:process';

const cached = {
  conn: null,
  promise: null
};

const resultSchema = new mongoose.Schema(
  {
    file: String,
    type: String,
    text: String,
    error: String,
    context: String
  },
  { _id: false }
);

const conversationSchema = new mongoose.Schema(
  {
    question: String,
    answer: String,
    createdAt: { type: Date, default: Date.now }
  },
  { _id: false }
);

const runSchema = new mongoose.Schema(
  {
    source: {
      url: String,
      path: String
    },
    mode: String,
    style: String,
    ocrModel: String,
    agentProvider: String,
    agentModel: String,
    whisperModel: String,
    mediaResolution: String,
    thinkingLevel: String,
    promptName: String,
    title: String,
    reflection: String,
    actionPlan: String,
    finalResponse: String,
    xml: String,
    results: [resultSchema],
    metadata: mongoose.Schema.Types.Mixed,
    // Favoritos
    isFavorite: { type: Boolean, default: false },
    favoriteNote: String,
    favoritedAt: Date,
    // Conversaciones de follow-up
    conversations: [conversationSchema]
  },
  {
    timestamps: { createdAt: 'createdAt', updatedAt: 'updatedAt' },
    versionKey: false
  }
);

let RunModel = null;

export async function connectToDatabase() {
  if (cached.conn) return cached.conn;
  if (!cached.promise) {
    const mongoUri =
      process.env.MONGODB_URL ||
      process.env.MONGO_URL ||
      process.env.MONGO_URI ||
      'mongodb://localhost:27017/twx_history';
    cached.promise = mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 5000 });
  }
  cached.conn = await cached.promise;
  if (!RunModel) {
    RunModel = cached.conn.model('Run', runSchema, 'runs');
  }
  return cached.conn;
}

export async function saveRun(payload) {
  await connectToDatabase();
  const doc = new RunModel(payload);
  await doc.save();
  return doc.toObject();
}

export async function listRuns({ limit = 10 } = {}) {
  await connectToDatabase();
  const runs = await RunModel.find({})
    .sort({ updatedAt: -1 })
    .limit(Math.max(1, Math.min(limit, 100)))
    .lean()
    .exec();
  return runs;
}

export async function getRunById(id) {
  await connectToDatabase();
  try {
    const run = await RunModel.findById(id).lean().exec();
    return run || null;
  } catch {
    return null;
  }
}

export function buildAutoTitle({ results = [], fallback }) {
  const pick = results.find((r) => r.text) || results[0];
  const raw = pick?.text || fallback || '';
  const title = raw.split('\n').find((line) => line.trim()) || raw.slice(0, 140);
  return (title || 'Sin título').trim().slice(0, 140);
}

// ============ FAVORITOS ============

/**
 * Toggle favorito de un insight
 * @param {string} id - ID del insight
 * @param {string} note - Nota opcional
 * @returns {object} - { isFavorite: boolean }
 */
export async function toggleFavorite(id, note = null) {
  await connectToDatabase();
  const run = await RunModel.findById(id);
  if (!run) return null;

  const wasF = run.isFavorite;
  run.isFavorite = !wasF;

  if (run.isFavorite) {
    run.favoritedAt = new Date();
    if (note) run.favoriteNote = note;
  } else {
    run.favoritedAt = null;
    run.favoriteNote = null;
  }

  await run.save();
  return { isFavorite: run.isFavorite };
}

/**
 * Obtener solo favoritos
 */
export async function listFavorites({ limit = 50 } = {}) {
  await connectToDatabase();
  const runs = await RunModel.find({ isFavorite: true })
    .sort({ updatedAt: -1 })
    .limit(Math.max(1, Math.min(limit, 100)))
    .lean()
    .exec();
  return runs;
}

/**
 * Agregar una conversación a un insight
 */
export async function addConversation(id, question, answer) {
  await connectToDatabase();
  const run = await RunModel.findById(id);
  if (!run) return null;

  if (!run.conversations) run.conversations = [];
  run.conversations.push({ question, answer, createdAt: new Date() });
  await run.save();
  return run.toObject();
}
