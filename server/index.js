require('dotenv').config();

const express = require('express');
const cors = require('cors');
const cron = require('node-cron');
const { v4: uuidv4 } = require('uuid');
const axios = require('axios');

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
  PORT = 5000,
} = process.env;

// ─── In-Memory Stores ──────────────────────────────────────────
const activeJobs = new Map();   // id -> { task, topic, intervalMinutes, pageId, pageName, createdAt }
const postLogs = [];            // { id, topic, message, status, timestamp, error?, pageName? }
const MAX_LOGS = 50;

// ─── Saved Pages Store ─────────────────────────────────────────
const savedPages = new Map();   // id -> { id, name, pageId, accessToken }

// Add default page from .env if configured
if (FB_PAGE_ID && FB_ACCESS_TOKEN) {
  const defaultId = uuidv4();
  savedPages.set(defaultId, {
    id: defaultId,
    name: 'Default Page (from .env)',
    pageId: FB_PAGE_ID,
    accessToken: FB_ACCESS_TOKEN,
  });
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
function addLog(entry) {
  postLogs.unshift(entry);
  if (postLogs.length > MAX_LOGS) postLogs.pop();
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

// ─── Helper: Convert minutes to cron expression ────────────────
function minutesToCron(minutes) {
  if (minutes < 1) minutes = 1;

  if (minutes < 60) {
    return `*/${minutes} * * * *`;
  }

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;

  if (remainingMinutes === 0) {
    return `0 */${hours} * * *`;
  }

  return `*/${minutes} * * * *`;
}

// ─── API Routes: Pages ─────────────────────────────────────────

// GET /api/pages — List all saved pages
app.get('/api/pages', (req, res) => {
  const pages = [];
  for (const [id, page] of savedPages) {
    pages.push({
      id,
      name: page.name,
      pageId: page.pageId,
      // Don't expose full access token
      tokenPreview: page.accessToken ? `...${page.accessToken.slice(-8)}` : '',
    });
  }
  res.json(pages);
});

// POST /api/pages — Add a new Facebook Page
app.post('/api/pages', (req, res) => {
  const { name, pageId, accessToken } = req.body;

  if (!name || !pageId || !accessToken) {
    return res.status(400).json({ error: 'name, pageId, and accessToken are all required.' });
  }

  const id = uuidv4();
  savedPages.set(id, { id, name, pageId, accessToken });

  console.log(`[${new Date().toISOString()}] 📄 Added page "${name}" (${pageId})`);
  res.json({ id, name, pageId, message: `Page "${name}" added successfully.` });
});

// DELETE /api/pages/:id — Remove a saved page
app.delete('/api/pages/:id', (req, res) => {
  const { id } = req.params;
  const page = savedPages.get(id);

  if (!page) {
    return res.status(404).json({ error: 'Page not found.' });
  }

  savedPages.delete(id);
  console.log(`[${new Date().toISOString()}] 🗑️ Removed page "${page.name}"`);
  res.json({ message: `Page "${page.name}" removed.`, id });
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

    const page = savedPages.get(savedPageId);
    if (!page) {
      return res.status(400).json({ error: 'Selected page not found. Please add a page first.' });
    }

    const mins = parseInt(intervalMinutes, 10);
    if (isNaN(mins) || mins < 1) {
      return res.status(400).json({ error: '"intervalMinutes" must be a positive integer.' });
    }

    const jobId = uuidv4();
    const intervalMs = mins * 60 * 1000;

    // Use setInterval for EXACT interval timing relative to start time
    const timer = setInterval(() => {
      runCycle(jobId, topic, page.pageId, page.accessToken, page.name);
    }, intervalMs);

    activeJobs.set(jobId, {
      timer,
      topic,
      intervalMinutes: mins,
      pageName: page.name,
      pageId: page.pageId,
      createdAt: new Date().toISOString(),
    });

    console.log(`[${new Date().toISOString()}] 📅 Scheduled job "${jobId}" for topic "${topic}" on page "${page.name}" every ${mins} min (Exact interval)`);

    // Trigger the first post immediately
    runCycle(jobId, topic, page.pageId, page.accessToken, page.name);

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
app.delete('/api/schedule/:id', (req, res) => {
  const { id } = req.params;
  const job = activeJobs.get(id);

  if (!job) {
    return res.status(404).json({ error: 'Automation not found.' });
  }

  if (job.timer) clearInterval(job.timer);
  if (job.task) job.task.stop(); // Backup safety in case some older job still uses task
  activeJobs.delete(id);
  console.log(`[${new Date().toISOString()}] 🛑 Stopped job "${id}"`);

  res.json({ message: 'Automation stopped successfully.', id });
});

// GET /api/logs — Get recent post logs
app.get('/api/logs', (req, res) => {
  res.json(postLogs);
});

// GET /api/health — Health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    activeJobs: activeJobs.size,
    savedPages: savedPages.size,
    facebookConfigured: savedPages.size > 0,
  });
});

// ─── Start Server ──────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🚀 Facebook AI Auto-Poster Server running on http://localhost:${PORT}`);
  console.log(`   Saved Pages: ${savedPages.size}`);
  console.log(`   Facebook:    ${savedPages.size > 0 ? '✅ Configured' : '❌ No pages added'}`);
  console.log('');
});
