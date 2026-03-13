require('dotenv').config();

const express = require('express');
const cors = require('cors');
const cron = require('node-cron');
const { v4: uuidv4 } = require('uuid');
const axios = require('axios');
const mongoose = require('mongoose');

const app = express();

// CORS: allow frontend origin (Netlify URL in production, localhost in dev)
const allowedOrigins = [
  'http://localhost:5173',
  'http://localhost:3000',
  process.env.CLIENT_URL,
].filter(Boolean);

app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (like curl/Postman) or from allowed origins
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(null, true); // Allow all in case of custom domains
    }
  }
}));
app.use(express.json());

// ─── Environment Variables ──────────────────────────────────────
const {
  FB_PAGE_ID,
  FB_ACCESS_TOKEN,
  MONGODB_URI,
  PORT = 5000,
} = process.env;

// ─── MongoDB Connection ────────────────────────────────────────
if (MONGODB_URI) {
  mongoose.connect(MONGODB_URI, { dbName: 'fb-auto-poster' })
    .then(() => console.log('✅ Connected to MongoDB'))
    .catch(err => console.error('❌ MongoDB connection error:', err.message));
} else {
  console.warn('⚠️ MONGODB_URI not set — using in-memory storage (data will be lost on restart)');
}

// ─── Mongoose Schemas ──────────────────────────────────────────
const pageSchema = new mongoose.Schema({
  _id: { type: String, default: uuidv4 },
  name: String,
  pageId: String,
  accessToken: String,
  createdAt: { type: Date, default: Date.now },
});
const Page = mongoose.model('Page', pageSchema);

const logSchema = new mongoose.Schema({
  jobId: String,
  topic: String,
  pageName: String,
  message: String,
  status: String,
  error: String,
  fbPostId: String,
  timestamp: { type: Date, default: Date.now },
});
logSchema.index({ timestamp: -1 });
const Log = mongoose.model('Log', logSchema);

const automationSchema = new mongoose.Schema({
  _id: { type: String, default: uuidv4 },
  topic: String,
  intervalMinutes: Number,
  savedPageId: String,
  pageName: String,
  pageId: String,
  accessToken: String,
  createdAt: { type: Date, default: Date.now },
});
const Automation = mongoose.model('Automation', automationSchema);

// ─── In-Memory Stores (timers can't persist, only config does) ─
const activeJobs = new Map();
const MAX_LOGS = 50;

// ─── Helper: Get all saved pages (DB + .env default) ───────────
async function getAllPages() {
  const dbPages = MONGODB_URI ? await Page.find().lean() : [];
  const pages = dbPages.map(p => ({
    id: p._id,
    name: p.name,
    pageId: p.pageId,
    accessToken: p.accessToken,
  }));
  // Add .env default if configured and not already in DB
  if (FB_PAGE_ID && FB_ACCESS_TOKEN) {
    const envExists = pages.some(p => p.pageId === FB_PAGE_ID);
    if (!envExists) {
      pages.unshift({
        id: 'env-default',
        name: 'Default Page (from .env)',
        pageId: FB_PAGE_ID,
        accessToken: FB_ACCESS_TOKEN,
      });
    }
  }
  return pages;
}

async function findPageById(id) {
  if (id === 'env-default' && FB_PAGE_ID && FB_ACCESS_TOKEN) {
    return { id: 'env-default', name: 'Default Page (from .env)', pageId: FB_PAGE_ID, accessToken: FB_ACCESS_TOKEN };
  }
  if (!MONGODB_URI) return null;
  const p = await Page.findById(id).lean();
  return p ? { id: p._id, name: p.name, pageId: p.pageId, accessToken: p.accessToken } : null;
}

// ─── Helper: Start a job (reusable for new + restart) ──────────
function startJob(jobId, topic, mins, pageId, accessToken, pageName, triggerFirst = true) {
  const intervalMs = mins * 60 * 1000;

  const timer = setInterval(() => {
    runCycle(jobId, topic, pageId, accessToken, pageName);
  }, intervalMs);

  activeJobs.set(jobId, {
    timer,
    topic,
    intervalMinutes: mins,
    pageName,
    pageId,
    createdAt: new Date().toISOString(),
  });

  console.log(`[${new Date().toISOString()}] 📅 Job "${jobId}" started: "${topic}" on "${pageName}" every ${mins} min`);

  if (triggerFirst) {
    runCycle(jobId, topic, pageId, accessToken, pageName);
  }

  return jobId;
}

// ─── Auto-restart saved automations on server boot ─────────────
async function restartSavedAutomations() {
  if (!MONGODB_URI) return;
  try {
    const saved = await Automation.find().lean();
    if (saved.length === 0) {
      console.log('   No saved automations to restart.');
      return;
    }
    console.log(`   🔄 Restarting ${saved.length} saved automation(s)...`);
    for (const auto of saved) {
      startJob(auto._id, auto.topic, auto.intervalMinutes, auto.pageId, auto.accessToken, auto.pageName, false);
    }
    console.log(`   ✅ ${saved.length} automation(s) restarted successfully!`);
  } catch (err) {
    console.error('   ❌ Error restarting automations:', err.message);
  }
}

// ─── AI Content Generation (Pico LLM API) ─────────────────────
const PICO_LLM_URL = 'https://backend.buildpicoapps.com/aero/run/llm-api?pk=v1-Z0FBQUFBQnBzRTYwVjlNU3dGOXl2VGdGNnNGVy0wT0RIM0RBRnAtY3BlVTZLbzhJWVMxb0lGR1VyYm56bHdOUTdFTFpPZGN0LVJTX0pBa0YzVmxoR1U3SWlMSk9BcEc0WUE9PQ==';

// Random style & angle variations for unique content
const STYLES = [
  'Use a storytelling approach with a personal anecdote.',
  'Write it as a bold, controversial hot take that sparks debate.',
  'Use a listicle format with numbered tips.',
  'Write it as an inspiring motivational message.',
  'Use humor and wit to make the point.',
  'Write it as a "Did you know?" educational post.',
  'Frame it as a question-driven post that challenges assumptions.',
  'Write it like a mini case study or success story.',
  'Use a "before vs after" comparison angle.',
  'Write it as practical advice from an expert friend.',
];

const TONES = [
  'confident and bold',
  'warm and friendly',
  'witty and humorous',
  'inspiring and uplifting',
  'casual and relatable',
  'thought-provoking and deep',
  'energetic and exciting',
  'calm and wise',
];

async function generatePost(topic) {
  const style = STYLES[Math.floor(Math.random() * STYLES.length)];
  const tone = TONES[Math.floor(Math.random() * TONES.length)];
  const randomSeed = Math.floor(Math.random() * 100000);
  const now = new Date();
  const timeContext = now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

  const prompt = `You are a viral social media content creator who writes in fluent, natural American English. 
Create a high-engagement Facebook post on the topic: "${topic}".

IMPORTANT UNIQUENESS INSTRUCTIONS:
- Style: ${style}
- Tone: ${tone}
- Today is ${timeContext} — weave in timely relevance if appropriate.
- Random seed for creativity: #${randomSeed} — use this to inspire a completely fresh angle.
- This post MUST be completely different from any previous post. Use a fresh hook, new examples, and different hashtags.

Structure:
1. Hook – A bold, attention-grabbing opening line (1-2 lines) that stops the scroll.
2. Body – 3-5 short, punchy lines that deliver value, insights, or a story.
3. CTA (Call to Action) – A question or prompt that encourages comments, shares, or reactions.
4. Hashtags – 5-7 relevant trending hashtags.

Rules:
- Write in clear, conversational American English.
- Make it relatable for a US-based audience.
- Use emojis strategically (don't overdo it).
- Keep it under 300 words.
- Make it feel authentic, engaging, and NOT robotic.
- Do NOT include labels like "Hook:", "Body:", "CTA:" in the output — just write it naturally as one flowing post.`;

  const response = await axios.post(PICO_LLM_URL, { prompt }, {
    headers: { 'Content-Type': 'application/json' },
    timeout: 30000,
  });

  const data = response.data;
  if (data.status === 'success' && data.text) {
    return data.text;
  } else {
    throw new Error(data.message || 'Failed to generate content from Pico API');
  }
}

// ─── Facebook Posting (supports per-page credentials) ──────────
async function postToFacebook(message, pageId, accessToken) {
  if (!pageId || !accessToken) {
    throw new Error('Page ID or Access Token is missing');
  }

  const url = `https://graph.facebook.com/v21.0/${pageId}/feed`;
  try {
    const res = await axios.post(url, {
      message,
      access_token: accessToken,
    });
    return res.data;
  } catch (err) {
    // Extract detailed Facebook error message
    if (err.response && err.response.data && err.response.data.error) {
      const fbErr = err.response.data.error;
      throw new Error(`Facebook API Error: ${fbErr.message} (Code: ${fbErr.code}, Type: ${fbErr.type})`);
    }
    throw err;
  }
}

// ─── Helper: Add Log Entry ─────────────────────────────────────
async function addLog(entry) {
  if (MONGODB_URI) {
    await Log.create(entry);
    // Keep only last MAX_LOGS
    const count = await Log.countDocuments();
    if (count > MAX_LOGS) {
      const oldest = await Log.find().sort({ timestamp: 1 }).limit(count - MAX_LOGS);
      await Log.deleteMany({ _id: { $in: oldest.map(l => l._id) } });
    }
  }
}

// ─── Helper: Run one cycle (generate + post) ──────────────────
async function runCycle(jobId, topic, pageId, accessToken, pageName) {
  const logEntry = {
    id: uuidv4(),
    jobId,
    topic,
    pageName: pageName || 'Unknown',
    timestamp: new Date().toISOString(),
  };

  try {
    console.log(`[${new Date().toISOString()}] 🤖 Generating post for topic: "${topic}" → Page: "${pageName}"`);
    const message = await generatePost(topic);
    logEntry.message = message;

    console.log(`[${new Date().toISOString()}] 📤 Posting to Facebook Page "${pageName}"...`);
    const fbResponse = await postToFacebook(message, pageId, accessToken);
    logEntry.status = 'success';
    logEntry.fbPostId = fbResponse.id;
    console.log(`[${new Date().toISOString()}] ✅ Posted successfully! Post ID: ${fbResponse.id}`);
  } catch (err) {
    logEntry.status = 'error';
    logEntry.error = err.message;
    console.error(`[${new Date().toISOString()}] ❌ Error:`, err.message);
  }

  addLog(logEntry);
  return logEntry;
}

// ─── API Routes: Pages ─────────────────────────────────────────

// GET /api/pages — List all saved pages
app.get('/api/pages', async (req, res) => {
  try {
    const pages = await getAllPages();
    res.json(pages.map(p => ({
      id: p.id,
      name: p.name,
      pageId: p.pageId,
      tokenPreview: p.accessToken ? `...${p.accessToken.slice(-8)}` : '',
    })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/pages — Add a new Facebook Page
app.post('/api/pages', async (req, res) => {
  const { name, pageId, accessToken } = req.body;

  if (!name || !pageId || !accessToken) {
    return res.status(400).json({ error: 'name, pageId, and accessToken are all required.' });
  }

  try {
    if (MONGODB_URI) {
      const page = await Page.create({ name, pageId, accessToken });
      console.log(`[${new Date().toISOString()}] 📄 Added page "${name}" (${pageId})`);
      res.json({ id: page._id, name, pageId, message: `Page "${name}" added successfully.` });
    } else {
      const id = uuidv4();
      console.log(`[${new Date().toISOString()}] 📄 Added page "${name}" (${pageId}) [in-memory]`);
      res.json({ id, name, pageId, message: `Page "${name}" added (in-memory only).` });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/pages/:id — Remove a saved page
app.delete('/api/pages/:id', async (req, res) => {
  const { id } = req.params;

  if (id === 'env-default') {
    return res.status(400).json({ error: 'Cannot delete the default .env page.' });
  }

  try {
    if (MONGODB_URI) {
      const page = await Page.findByIdAndDelete(id);
      if (!page) return res.status(404).json({ error: 'Page not found.' });
      console.log(`[${new Date().toISOString()}] 🗑️ Removed page "${page.name}"`);
      res.json({ message: `Page "${page.name}" removed.`, id });
    } else {
      res.status(404).json({ error: 'Page not found.' });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── API Routes: Scheduling ────────────────────────────────────

// POST /api/schedule — Create a new automation
app.post('/api/schedule', async (req, res) => {
  try {
    const { topic, intervalMinutes, savedPageId } = req.body;

    if (!topic || !intervalMinutes) {
      return res.status(400).json({ error: 'Both "topic" and "intervalMinutes" are required.' });
    }

    if (!savedPageId) {
      return res.status(400).json({ error: 'Please select a Facebook Page.' });
    }

    const page = await findPageById(savedPageId);
    if (!page) {
      return res.status(400).json({ error: 'Selected page not found. Please add a page first.' });
    }

    const mins = parseInt(intervalMinutes, 10);
    if (isNaN(mins) || mins < 1) {
      return res.status(400).json({ error: '"intervalMinutes" must be a positive integer.' });
    }

    const jobId = uuidv4();

    // Save automation config to MongoDB for restart persistence
    if (MONGODB_URI) {
      await Automation.create({
        _id: jobId,
        topic,
        intervalMinutes: mins,
        savedPageId,
        pageName: page.name,
        pageId: page.pageId,
        accessToken: page.accessToken,
      });
    }

    // Start the timer + trigger first post immediately
    startJob(jobId, topic, mins, page.pageId, page.accessToken, page.name, true);

    res.json({
      id: jobId,
      topic,
      intervalMinutes: mins,
      pageName: page.name,
      message: `Automation started on "${page.name}"! First post triggered, then every exactly ${mins} minute(s).`,
    });
  } catch (err) {
    console.error('Schedule error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/schedules — List all active automations
app.get('/api/schedules', (req, res) => {
  const jobs = [];
  for (const [id, job] of activeJobs) {
    jobs.push({
      id,
      topic: job.topic,
      intervalMinutes: job.intervalMinutes,
      pageName: job.pageName,
      createdAt: job.createdAt,
    });
  }
  res.json(jobs);
});

// DELETE /api/schedule/:id — Stop and remove an automation
app.delete('/api/schedule/:id', async (req, res) => {
  const { id } = req.params;
  const job = activeJobs.get(id);

  if (!job) {
    return res.status(404).json({ error: 'Automation not found.' });
  }

  if (job.timer) clearInterval(job.timer);
  activeJobs.delete(id);

  // Remove from MongoDB so it doesn't restart
  if (MONGODB_URI) {
    await Automation.findByIdAndDelete(id).catch(() => {});
  }

  console.log(`[${new Date().toISOString()}] 🛑 Stopped job "${id}"`);
  res.json({ message: 'Automation stopped successfully.', id });
});

// GET /api/logs — Get recent post logs
app.get('/api/logs', async (req, res) => {
  try {
    if (MONGODB_URI) {
      const logs = await Log.find().sort({ timestamp: -1 }).limit(MAX_LOGS).lean();
      res.json(logs.map(l => ({ id: l._id, ...l })));
    } else {
      res.json([]);
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/logs — Clear all logs
app.delete('/api/logs', async (req, res) => {
  try {
    if (MONGODB_URI) {
      await Log.deleteMany({});
    }
    console.log(`[${new Date().toISOString()}] 🧹 Logs cleared by user`);
    res.json({ message: 'Logs cleared successfully.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/health — Health check
app.get('/api/health', async (req, res) => {
  const pages = await getAllPages().catch(() => []);
  res.json({
    status: 'ok',
    activeJobs: activeJobs.size,
    savedPages: pages.length,
    facebookConfigured: pages.length > 0,
    database: MONGODB_URI ? (mongoose.connection.readyState === 1 ? 'connected' : 'disconnected') : 'not configured',
  });
});

// ─── Start Server ──────────────────────────────────────────────
app.listen(PORT, async () => {
  const pages = await getAllPages().catch(() => []);
  console.log(`\n🚀 Facebook AI Auto-Poster Server running on http://localhost:${PORT}`);
  console.log(`   Database:    ${MONGODB_URI ? '✅ MongoDB Connected' : '⚠️ In-Memory Only'}`);
  console.log(`   Saved Pages: ${pages.length}`);
  console.log(`   Facebook:    ${pages.length > 0 ? '✅ Configured' : '❌ No pages added'}`);

  // Auto-restart saved automations after a short delay to ensure DB is ready
  setTimeout(() => restartSavedAutomations(), 3000);
});
