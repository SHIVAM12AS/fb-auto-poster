import { useState, useEffect, useCallback } from 'react';
import './App.css';

const API_BASE = import.meta.env.VITE_API_URL || '';

// Helper: fetch with safe JSON parsing (handles HTML error pages gracefully)
async function safeFetch(url, options = {}) {
  const res = await fetch(url, options);
  const contentType = res.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    throw new Error(res.ok ? 'Server returned non-JSON response' : `Server error (${res.status})`);
  }
  const data = await res.json();
  return { res, data };
}

function App() {
  const [topic, setTopic] = useState('');
  const [interval, setInterval_] = useState(30);
  const [selectedPageId, setSelectedPageId] = useState('');
  const [schedules, setSchedules] = useState([]);
  const [logs, setLogs] = useState([]);
  const [pages, setPages] = useState([]);
  const [loading, setLoading] = useState(false);
  const [health, setHealth] = useState(null);
  const [statusMsg, setStatusMsg] = useState('');

  // Page form
  const [showPageForm, setShowPageForm] = useState(false);
  const [newPageName, setNewPageName] = useState('');
  const [newPageId, setNewPageId] = useState('');
  const [newPageToken, setNewPageToken] = useState('');
  const [pageLoading, setPageLoading] = useState(false);

  const fetchSchedules = useCallback(async () => {
    try {
      const { data } = await safeFetch(`${API_BASE}/api/schedules`);
      setSchedules(data);
    } catch { /* silent */ }
  }, []);

  const fetchLogs = useCallback(async () => {
    try {
      const { data } = await safeFetch(`${API_BASE}/api/logs`);
      setLogs(data);
    } catch { /* silent */ }
  }, []);

  const fetchPages = useCallback(async () => {
    try {
      const { data } = await safeFetch(`${API_BASE}/api/pages`);
      setPages(data);
      if (data.length > 0 && !selectedPageId) {
        setSelectedPageId(data[0].id);
      }
    } catch { /* silent */ }
  }, [selectedPageId]);

  const fetchHealth = useCallback(async () => {
    try {
      const { data } = await safeFetch(`${API_BASE}/api/health`);
      setHealth(data);
    } catch { setHealth(null); }
  }, []);

  useEffect(() => {
    fetchSchedules();
    fetchLogs();
    fetchPages();
    fetchHealth();
    const id = window.setInterval(() => {
      fetchSchedules();
      fetchLogs();
      fetchHealth();
    }, 5000);
    return () => window.clearInterval(id);
  }, [fetchSchedules, fetchLogs, fetchPages, fetchHealth]);

  const handleStart = async () => {
    if (!topic.trim()) {
      setStatusMsg('⚠️ Please enter a topic.');
      return;
    }
    if (!interval || interval < 1) {
      setStatusMsg('⚠️ Interval must be at least 1 minute.');
      return;
    }
    if (!selectedPageId) {
      setStatusMsg('⚠️ Please select a Facebook Page or add one first.');
      return;
    }

    setLoading(true);
    setStatusMsg('');
    try {
      const { res, data } = await safeFetch(`${API_BASE}/api/schedule`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          topic: topic.trim(),
          intervalMinutes: interval,
          savedPageId: selectedPageId,
        }),
      });
      if (res.ok) {
        setStatusMsg(`✅ ${data.message}`);
        setTopic('');
        fetchSchedules();
        setTimeout(fetchLogs, 3000);
      } else {
        setStatusMsg(`❌ ${data.error}`);
      }
    } catch (err) {
      setStatusMsg(`❌ Failed to connect to server: ${err.message}`);
    }
    setLoading(false);
  };

  const handleStop = async (id) => {
    try {
      const { res, data } = await safeFetch(`${API_BASE}/api/schedule/${id}`, { method: 'DELETE' });
      if (res.ok) {
        setStatusMsg(`🛑 ${data.message}`);
        fetchSchedules();
      } else {
        setStatusMsg(`❌ ${data.error}`);
      }
    } catch (err) {
      setStatusMsg(`❌ ${err.message}`);
    }
  };

  const handleAddPage = async () => {
    if (!newPageName.trim() || !newPageId.trim() || !newPageToken.trim()) {
      setStatusMsg('⚠️ All page fields are required.');
      return;
    }
    setPageLoading(true);
    setStatusMsg('');
    try {
      const { res, data } = await safeFetch(`${API_BASE}/api/pages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newPageName.trim(),
          pageId: newPageId.trim(),
          accessToken: newPageToken.trim(),
        }),
      });
      if (res.ok) {
        setStatusMsg(`✅ ${data.message}`);
        setNewPageName('');
        setNewPageId('');
        setNewPageToken('');
        setShowPageForm(false);
        fetchPages();
      } else {
        setStatusMsg(`❌ ${data.error}`);
      }
    } catch (err) {
      setStatusMsg(`❌ ${err.message}`);
    }
    setPageLoading(false);
  };

  const handleRemovePage = async (id) => {
    try {
      const { res, data } = await safeFetch(`${API_BASE}/api/pages/${id}`, { method: 'DELETE' });
      if (res.ok) {
        setStatusMsg(`🗑️ ${data.message}`);
        fetchPages();
        if (selectedPageId === id) setSelectedPageId('');
      } else {
        setStatusMsg(`❌ ${data.error}`);
      }
    } catch (err) {
      setStatusMsg(`❌ ${err.message}`);
    }
  };

  const handleClearLogs = async () => {
    if (!window.confirm('Are you sure you want to clear all logs?')) return;
    try {
      const { res, data } = await safeFetch(`${API_BASE}/api/logs`, { method: 'DELETE' });
      if (res.ok) {
        setStatusMsg(`🧹 ${data.message}`);
        setLogs([]);
      } else {
        setStatusMsg(`❌ ${data.error}`);
      }
    } catch (err) {
      setStatusMsg(`❌ ${err.message}`);
    }
  };

  const formatTime = (iso) => new Date(iso).toLocaleString();

  return (
    <div className="app">
      <div className="bg-orbs">
        <div className="orb orb-1"></div>
        <div className="orb orb-2"></div>
        <div className="orb orb-3"></div>
      </div>

      <header className="header">
        <div className="logo">
          <span className="logo-icon">🤖</span>
          <h1>FB Auto-Poster Agent</h1>
        </div>
        <p className="subtitle">
          AI-powered content generation &amp; automated Facebook posting
        </p>
        {health && (
          <div className="health-bar">
            <span className={`health-dot ${health.status === 'ok' ? 'green' : 'red'}`}></span>
            <span>Server {health.status === 'ok' ? 'Online' : 'Offline'}</span>
            <span className="health-sep">|</span>
            <span>Pages: {health.savedPages || 0}</span>
            <span className="health-sep">|</span>
            <span>Active Jobs: {health.activeJobs}</span>
          </div>
        )}
      </header>

      <main className="main">
        {/* ─── Facebook Pages Management ─── */}
        <section className="card card-pages">
          <h2>
            <span className="card-icon">📄</span> Facebook Pages
            <span className="badge">{pages.length}</span>
            <button
              className="btn btn-add-page"
              onClick={() => setShowPageForm(!showPageForm)}
            >
              {showPageForm ? '✕ Cancel' : '+ Add Page'}
            </button>
          </h2>

          {showPageForm && (
            <div className="page-form">
              <div className="form-group">
                <label htmlFor="pageName">Page Name</label>
                <input
                  id="pageName"
                  type="text"
                  placeholder='e.g., "My Business Page"'
                  value={newPageName}
                  onChange={(e) => setNewPageName(e.target.value)}
                />
              </div>
              <div className="form-group">
                <label htmlFor="fbPageId">Facebook Page ID</label>
                <input
                  id="fbPageId"
                  type="text"
                  placeholder="e.g., 654352501087705"
                  value={newPageId}
                  onChange={(e) => setNewPageId(e.target.value)}
                />
              </div>
              <div className="form-group">
                <label htmlFor="fbToken">Page Access Token</label>
                <input
                  id="fbToken"
                  type="password"
                  placeholder="Paste your page access token here"
                  value={newPageToken}
                  onChange={(e) => setNewPageToken(e.target.value)}
                />
              </div>
              <button
                className="btn btn-save-page"
                onClick={handleAddPage}
                disabled={pageLoading}
              >
                {pageLoading ? <span className="spinner"></span> : '💾 Save Page'}
              </button>
            </div>
          )}

          {pages.length === 0 && !showPageForm ? (
            <div className="empty-state">
              <span className="empty-icon">📭</span>
              <p>No pages added. Click &quot;+ Add Page&quot; to get started.</p>
            </div>
          ) : (
            <div className="pages-list">
              {pages.map((p) => (
                <div key={p.id} className="page-item">
                  <div className="page-info">
                    <span className="page-name">{p.name}</span>
                    <span className="page-meta">ID: {p.pageId} · Token: {p.tokenPreview}</span>
                  </div>
                  <button
                    className="btn btn-remove-page"
                    onClick={() => handleRemovePage(p.id)}
                    title="Remove page"
                  >
                    🗑️
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* ─── Schedule Form ─── */}
        <section className="card card-form">
          <h2>
            <span className="card-icon">🚀</span> New Automation
          </h2>
          <div className="form-group">
            <label htmlFor="selectPage">Facebook Page</label>
            <select
              id="selectPage"
              value={selectedPageId}
              onChange={(e) => setSelectedPageId(e.target.value)}
            >
              <option value="">-- Select a Page --</option>
              {pages.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
          <div className="form-group">
            <label htmlFor="topic">Topic</label>
            <input
              id="topic"
              type="text"
              placeholder='e.g., "Motivational Quotes", "Tech Tips", "Fitness"'
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleStart()}
            />
          </div>
          <div className="form-group">
            <label htmlFor="interval">Interval (minutes)</label>
            <input
              id="interval"
              type="number"
              min="1"
              placeholder="30"
              value={interval}
              onChange={(e) => setInterval_(Number(e.target.value))}
              onKeyDown={(e) => e.key === 'Enter' && handleStart()}
            />
          </div>
          <button
            className="btn btn-start"
            onClick={handleStart}
            disabled={loading}
          >
            {loading ? <span className="spinner"></span> : <>▶ Start Automation</>}
          </button>
          {statusMsg && <p className="status-msg">{statusMsg}</p>}
        </section>

        {/* ─── Active Automations ─── */}
        <section className="card card-automations">
          <h2>
            <span className="card-icon">⚡</span> Active Automations
            <span className="badge">{schedules.length}</span>
          </h2>
          {schedules.length === 0 ? (
            <div className="empty-state">
              <span className="empty-icon">📭</span>
              <p>No active automations. Create one above!</p>
            </div>
          ) : (
            <div className="automations-list">
              {schedules.map((s) => (
                <div key={s.id} className="automation-item">
                  <div className="automation-info">
                    <div className="automation-topic">
                      <span className="pulse-dot"></span>
                      {s.topic}
                    </div>
                    <div className="automation-meta">
                      📄 {s.pageName} · Every {s.intervalMinutes} min · Started {formatTime(s.createdAt)}
                    </div>
                  </div>
                  <button className="btn btn-stop" onClick={() => handleStop(s.id)}>
                    ■ Stop
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* ─── Recent Logs ─── */}
        <section className="card card-logs">
          <h2>
            <span className="card-icon">📋</span> Recent Logs
            <span className="badge">{logs.length}</span>
            {logs.length > 0 && (
              <button
                className="btn btn-clear-logs"
                onClick={handleClearLogs}
                title="Clear all logs"
              >
                🗑️ Clear
              </button>
            )}
          </h2>
          {logs.length === 0 ? (
            <div className="empty-state">
              <span className="empty-icon">📝</span>
              <p>No logs yet. Start an automation to see activity.</p>
            </div>
          ) : (
            <div className="logs-list">
              {logs.map((log) => (
                <div
                  key={log.id}
                  className={`log-item ${log.status === 'success' ? 'log-success' : 'log-error'}`}
                >
                  <div className="log-header">
                    <span className={`log-status ${log.status}`}>
                      {log.status === 'success' ? '✅ Success' : '❌ Error'}
                    </span>
                    <span className="log-topic">{log.topic}</span>
                    {log.pageName && <span className="log-page">📄 {log.pageName}</span>}
                    <span className="log-time">{formatTime(log.timestamp)}</span>
                  </div>
                  {log.message && <pre className="log-message">{log.message}</pre>}
                  {log.error && <p className="log-error-msg">Error: {log.error}</p>}
                  {log.fbPostId && <p className="log-fb-id">FB Post ID: {log.fbPostId}</p>}
                </div>
              ))}
            </div>
          )}
        </section>
      </main>

      <footer className="footer">
        <p>Facebook AI Auto-Poster Agent · Powered by AI &amp; Graph API</p>
      </footer>
    </div>
  );
}

export default App;
