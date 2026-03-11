# 🤖 Facebook AI Auto-Poster Agent

An AI-powered full-stack application that automatically generates high-engagement Facebook posts using **Google Gemini** and publishes them to your Facebook Page on a schedule.

![Tech Stack](https://img.shields.io/badge/Node.js-Express-green) ![AI](https://img.shields.io/badge/AI-Google%20Gemini-blue) ![Frontend](https://img.shields.io/badge/Frontend-React%20%2B%20Vite-purple) ![Scheduler](https://img.shields.io/badge/Scheduler-node--cron-orange)

---

## ✨ Features

- **AI Content Generation** — Generates viral Hinglish (Hindi + English) Facebook posts using Google Gemini with a structured format: Hook → Body → CTA → Hashtags
- **Auto Facebook Posting** — Posts generated content directly to your Facebook Page via Graph API
- **Dynamic Scheduling** — Create multiple schedules with different topics and intervals using `node-cron`
- **Premium Dashboard** — Beautiful dark-themed React UI to manage automations and view logs
- **Health Monitoring** — Real-time server status, API configuration checks
- **Activity Logs** — Track all generated and posted content with success/error status

---

## 📁 Project Structure

```
agent/
├── server/
│   ├── index.js          # Express backend (AI + Facebook + Scheduling)
│   └── package.json
├── client/
│   ├── src/
│   │   ├── App.jsx       # React dashboard
│   │   ├── App.css       # Premium styling
│   │   ├── index.css     # Global reset
│   │   └── main.jsx      # Entry point
│   ├── index.html
│   └── package.json
├── .env.example
└── README.md
```

---

## 🚀 Setup Instructions

### Prerequisites

- **Node.js** v18 or later
- A **Google Gemini API Key** (free tier) — [Get one here](https://aistudio.google.com/apikey)
- A **Facebook Page Access Token** and **Page ID** — [Facebook Developer Portal](https://developers.facebook.com/)

### 1. Clone / Download

```bash
cd agent
```

### 2. Configure Environment Variables

Copy the example env file and fill in your keys:

```bash
cp .env.example .env
```

Edit `.env`:

```env
GEMINI_API_KEY=your_gemini_api_key_here
FB_PAGE_ID=your_facebook_page_id_here
FB_ACCESS_TOKEN=your_facebook_page_access_token_here
PORT=5000
```

### 3. Install & Start Backend

```bash
cd server
npm install
npm start
```

The server will start on `http://localhost:5000`.

### 4. Install & Start Frontend

Open a new terminal:

```bash
cd client
npm install
npm run dev
```

The dashboard will open at `http://localhost:5173`.

---

## 🎮 Usage

1. Open the dashboard at `http://localhost:5173`
2. Enter a **Topic** (e.g., "Motivational Quotes", "Tech Tips", "Fitness")
3. Set the **Interval** in minutes (e.g., 30)
4. Click **▶ Start Automation**
5. The first post is generated and published immediately, then repeats at the set interval
6. View active automations and stop them anytime
7. Check the **Recent Logs** panel to see generated content and post status

---

## 🔌 API Endpoints

| Method   | Endpoint            | Description                       |
|----------|---------------------|-----------------------------------|
| `POST`   | `/api/schedule`     | Create a new automation           |
| `GET`    | `/api/schedules`    | List all active automations       |
| `DELETE` | `/api/schedule/:id` | Stop and remove an automation     |
| `GET`    | `/api/logs`         | Get recent post logs              |
| `GET`    | `/api/health`       | Server health & config status     |

### Example: Create Schedule

```bash
curl -X POST http://localhost:5000/api/schedule \
  -H "Content-Type: application/json" \
  -d '{"topic": "Motivation", "intervalMinutes": 30}'
```

---

## 🔑 Getting Facebook Credentials

1. Go to [Facebook Developers](https://developers.facebook.com/) and create an app
2. Add the **Facebook Login** and **Pages API** products
3. Generate a **Page Access Token** with `pages_manage_posts` and `pages_read_engagement` permissions
4. Find your **Page ID** from your Facebook Page's "About" section or Graph API Explorer
5. For a long-lived token, exchange your short-lived token via the [Token Debugger](https://developers.facebook.com/tools/debug/accesstoken/)

---

## 🛠 Tech Stack

| Component        | Technology                  |
|------------------|-----------------------------|
| Backend          | Node.js + Express           |
| AI Engine        | Google Gemini 1.5 Flash     |
| Social API       | Facebook Graph API v19.0    |
| Scheduler        | node-cron                   |
| Frontend         | React + Vite                |
| Styling          | Vanilla CSS (Glassmorphism) |

---

## 📝 License

MIT
