import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Archive, Bell, BellOff, Bot, Check, CheckCircle2, ChevronDown, ChevronRight, CircleAlert,
  Clipboard, Download, Edit3, ExternalLink, FileText, Filter, Inbox, Languages, MessageSquare,
  MoreHorizontal, Paperclip, Plus, Printer, RefreshCw, Search, Send, Settings, Sparkles, Star,
  Sun, Ticket, UserRound, X, Zap,
} from 'lucide-react'

const api = async (path, options = {}) => {
  const response = await fetch(path, { headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }, ...options })
  if (!response.ok) {
    let detail = 'Something went wrong'
    try { detail = (await response.json()).detail || detail } catch { /* non-JSON response */ }
    throw new Error(detail)
  }
  return response.json()
}

const getInitials = (name) => (name || 'NV').split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase()
const relativeTime = (value) => {
  if (!value) return ''
  const minutes = Math.max(1, Math.round((Date.now() - new Date(value)) / 60000))
  return minutes < 60 ? `${minutes}m` : `${Math.round(minutes / 60)}h`
}
const csv = (rows) => rows.map((row) => row.map((cell) => `"${String(cell ?? '').replaceAll('"', '""')}"`).join(',')).join('\n')
const download = (name, content, type = 'text/plain') => {
  const blob = new Blob([content], { type })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url; anchor.download = name; anchor.click(); URL.revokeObjectURL(url)
}

const cannedReplies = [
  'Thanks for reaching out. I’m looking into this for you.',
  'Please share your order number so I can check that for you.',
  'I’m sorry this has been frustrating. I’ve escalated this to our support team.',
  'Please do not share your full payment-card details in chat.',
]

function App() {
  const [conversations, setConversations] = useState([])
  const [stats, setStats] = useState({ total: 0, open: 0, escalated: 0, resolved: 0, at_risk: 0 })
  const [activeId, setActiveId] = useState(null)
  const [draft, setDraft] = useState('')
  const [drafts, setDrafts] = useState(() => JSON.parse(localStorage.getItem('soham-drafts') || '{}'))
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [sentimentFilter, setSentimentFilter] = useState('all')
  const [viewFilter, setViewFilter] = useState('all')
  const [sortMode, setSortMode] = useState('newest')
  const [loading, setLoading] = useState(false)
  const [online, setOnline] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [modal, setModal] = useState(null)
  const [profile, setProfile] = useState({ customer_name: '', customer_email: '' })
  const [theme, setTheme] = useState(() => localStorage.getItem('soham-theme') || 'light')
  const [compact, setCompact] = useState(() => localStorage.getItem('soham-compact') === 'true')
  const [starred, setStarred] = useState(() => JSON.parse(localStorage.getItem('soham-starred') || '[]'))
  const [muted, setMuted] = useState(() => JSON.parse(localStorage.getItem('soham-muted') || '[]'))
  const [unread, setUnread] = useState(() => JSON.parse(localStorage.getItem('soham-unread') || '[]'))
  const [notes, setNotes] = useState(() => JSON.parse(localStorage.getItem('soham-notes') || '{}'))
  const [showTicket, setShowTicket] = useState(false)
  const [copied, setCopied] = useState('')
  const messagesRef = useRef(null)
  const searchRef = useRef(null)
  const composerRef = useRef(null)

  const refresh = async () => {
    try {
      const [items, summary] = await Promise.all([api('/api/conversations'), api('/api/stats')])
      setConversations(items); setStats(summary); setOnline(true); setNotice('Synced just now')
      if (!activeId && items[0]) setActiveId(items[0].id)
      if (activeId && !items.some((item) => item.id === activeId)) setActiveId(items[0]?.id || null)
    } catch (err) { setOnline(false); setError(err.message) }
  }
  useEffect(() => { refresh() }, [])
  useEffect(() => { localStorage.setItem('soham-drafts', JSON.stringify(drafts)) }, [drafts])
  useEffect(() => { localStorage.setItem('soham-theme', theme); document.body.dataset.theme = theme }, [theme])
  useEffect(() => { localStorage.setItem('soham-compact', compact); document.body.dataset.compact = compact }, [compact])
  useEffect(() => { localStorage.setItem('soham-starred', JSON.stringify(starred)) }, [starred])
  useEffect(() => { localStorage.setItem('soham-muted', JSON.stringify(muted)) }, [muted])
  useEffect(() => { localStorage.setItem('soham-unread', JSON.stringify(unread)) }, [unread])
  useEffect(() => { localStorage.setItem('soham-notes', JSON.stringify(notes)) }, [notes])

  const active = conversations.find((item) => item.id === activeId)
  useEffect(() => {
    setDraft(active ? drafts[active.id] || '' : '')
    if (active) setUnread((items) => items.filter((id) => id !== active.id))
    setTimeout(() => messagesRef.current?.scrollTo({ top: messagesRef.current.scrollHeight, behavior: 'smooth' }), 50)
  }, [activeId])
  useEffect(() => {
    const onKey = (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); searchRef.current?.focus() }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'n') { event.preventDefault(); setModal('new') }
      if (event.key === 'Escape') { setModal(null); setShowTicket(false); if (search) setSearch('') }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [search])

  const filtered = useMemo(() => {
    const query = search.toLowerCase().trim()
    return conversations.filter((item) => {
      const haystack = `${item.customer_name || 'New visitor'} ${item.customer_email || ''} ${(item.messages || []).map((message) => message.content).join(' ')}`.toLowerCase()
      const matchesSearch = !query || haystack.includes(query)
      const matchesStatus = statusFilter === 'all' || item.status === statusFilter
      const matchesSentiment = sentimentFilter === 'all' || item.sentiment === sentimentFilter
      const matchesView = viewFilter === 'all' || (viewFilter === 'mine' && item.customer_email) || (viewFilter === 'unassigned' && !item.customer_email)
      return matchesSearch && matchesStatus && matchesSentiment && matchesView
    }).sort((a, b) => sortMode === 'oldest' ? new Date(a.updated_at) - new Date(b.updated_at) : new Date(b.updated_at) - new Date(a.updated_at))
  }, [conversations, search, statusFilter, sentimentFilter, viewFilter, sortMode])

  const selectConversation = (id) => { setActiveId(id); setShowTicket(false) }
  const createConversation = async () => {
    try {
      const created = await api('/api/conversations', { method: 'POST', body: JSON.stringify(profile) })
      setConversations((items) => [created, ...items]); setActiveId(created.id); setProfile({ customer_name: '', customer_email: '' }); setModal(null); setNotice('Conversation created')
    } catch (err) { setError(err.message) }
  }
  const updateProfile = async () => {
    if (!active) return
    try {
      const updated = await api(`/api/conversations/${active.id}`, { method: 'PATCH', body: JSON.stringify(profile) })
      setConversations((items) => items.map((item) => item.id === active.id ? updated : item)); setModal(null); setNotice('Customer details updated')
    } catch (err) { setError(err.message) }
  }
  const sendMessage = async (event) => {
    event?.preventDefault()
    if (!draft.trim() || !active || loading) return
    setLoading(true); setError('')
    try {
      await api('/api/chat', { method: 'POST', body: JSON.stringify({ conversation_id: active.id, message: draft.trim() }) })
      setDraft(''); setDrafts((items) => ({ ...items, [active.id]: '' })); await refresh()
    } catch (err) { setError(err.message) } finally { setLoading(false) }
  }
  const changeStatus = async (next) => {
    if (!active) return
    try { await api(`/api/conversations/${active.id}/${next}`, { method: 'PATCH' }); await refresh(); setNotice(next === 'resolve' ? 'Conversation resolved' : 'Conversation reopened') }
    catch (err) { setError(err.message) }
  }
  const setDraftValue = (value) => { setDraft(value); if (active) setDrafts((items) => ({ ...items, [active.id]: value })) }
  const copyText = async (value, label) => { await navigator.clipboard?.writeText(value); setCopied(label); setTimeout(() => setCopied(''), 1400) }
  const toggleList = (setter, id) => setter((items) => items.includes(id) ? items.filter((item) => item !== id) : [...items, id])
  const exportConversations = () => download('soham-conversations.csv', csv([['Customer', 'Email', 'Status', 'Language', 'Sentiment', 'Last message'], ...conversations.map((item) => [item.customer_name, item.customer_email, item.status, item.language, item.sentiment, item.messages?.at(-1)?.content])]), 'text/csv')
  const exportTranscript = () => active && download(`conversation-${active.id.slice(0, 8)}.txt`, `${active.customer_name || 'Customer'}\n${active.messages.map((message) => `${message.role}: ${message.content}`).join('\n\n')}`)
  const printTranscript = () => window.print()

  return <div className={`app-shell ${compact ? 'compact-mode' : ''}`}>
    <aside className="sidebar">
      <div className="brand"><div className="brand-mark"><Sparkles size={17} /></div><span className="brand-name">Soham's <span className="brand-ai">Chatbot</span></span></div>
      <div className="workspace-switch"><div className="workspace-avatar">SC</div><div><strong>Soham support</strong><small>Workspace · {online ? 'Connected' : 'Offline'}</small></div><ChevronRight size={15} className="muted-icon" /></div>
      <div className="nav-label">WORKSPACE</div>
      <nav><button className="nav-item active"><Inbox size={17} /> Inbox <span className="nav-count">{stats.open}</span></button><button className="nav-item" onClick={() => setStatusFilter('escalated')}><Ticket size={17} /> Tickets <span className="nav-count quiet">{stats.escalated}</span></button><button className="nav-item" onClick={() => setStatusFilter('resolved')}><Archive size={17} /> Resolved</button></nav>
      <div className="sidebar-shortcuts"><small>SHORTCUTS</small><button onClick={() => setModal('new')}><Plus size={14} /> New conversation <kbd>⌘N</kbd></button><button onClick={() => setModal('settings')}><Settings size={14} /> Preferences</button></div>
      <div className="sidebar-bottom"><div className="agent-row"><div className="agent-avatar">SS</div><div><strong>Soham Solanki</strong><small>Admin · Online <i /></small></div><button className="icon-button" title="Agent menu"><MoreHorizontal size={17} /></button></div></div>
    </aside>

    <section className="inbox-panel">
      <div className="panel-heading"><div><p className="eyebrow">CUSTOMER SUPPORT</p><h1>Inbox <span>{stats.open}</span></h1></div><div className="heading-tools"><button className="icon-button" title="Refresh inbox" onClick={refresh}><RefreshCw size={15} /></button><button onClick={() => { setProfile({ customer_name: '', customer_email: '' }); setModal('new') }} className="primary compact"><Plus size={16} /> New chat</button></div></div>
      <div className="search-box"><Search size={16} /><input ref={searchRef} value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search conversations" /><kbd>⌘K</kbd>{search && <button className="clear-search" onClick={() => setSearch('')}><X size={13} /></button>}</div>
      <div className="filter-row"><button className={`filter ${viewFilter === 'all' ? 'active' : ''}`} onClick={() => setViewFilter('all')}>All <span>{stats.total}</span></button><button className={`filter ${viewFilter === 'mine' ? 'active' : ''}`} onClick={() => setViewFilter('mine')}>Mine</button><button className={`filter ${viewFilter === 'unassigned' ? 'active' : ''}`} onClick={() => setViewFilter('unassigned')}>Unassigned</button></div>
      <div className="advanced-filters"><Filter size={13} /><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="all">All statuses</option><option value="open">Open</option><option value="escalated">Escalated</option><option value="resolved">Resolved</option></select><select value={sentimentFilter} onChange={(event) => setSentimentFilter(event.target.value)}><option value="all">All sentiment</option><option value="satisfied">Positive</option><option value="neutral">Neutral</option><option value="angry">Angry</option><option value="critical">Critical</option></select><select value={sortMode} onChange={(event) => setSortMode(event.target.value)}><option value="newest">Newest</option><option value="oldest">Oldest</option></select></div>
      <div className="conversation-list">{filtered.length === 0 ? <div className="empty-list"><MessageSquare size={25} /><p>No matching conversations</p><button onClick={() => { setSearch(''); setStatusFilter('all'); setSentimentFilter('all'); setViewFilter('all') }}>Clear filters</button></div> : filtered.map((item) => <button key={item.id} onClick={() => selectConversation(item.id)} className={`conversation-card ${item.id === activeId ? 'selected' : ''} ${unread.includes(item.id) ? 'unread' : ''}`}>
        <div className={`conversation-avatar ${item.sentiment === 'critical' ? 'danger' : ''}`}>{getInitials(item.customer_name)}</div><div className="conversation-copy"><div className="conversation-title"><strong>{item.customer_name || 'New visitor'}</strong><time>{relativeTime(item.updated_at)}</time></div><p>{item.messages?.at(-1)?.content || 'New conversation'}</p><div className="card-meta"><span className={`status-dot ${item.status}`} />{item.status === 'escalated' ? 'Escalated' : item.status === 'resolved' ? 'Resolved' : 'Open'}{starred.includes(item.id) && <Star size={11} fill="currentColor" />}{item.ticket && <span className="mini-ticket"><Ticket size={11} /> {item.ticket.external_id}</span>}</div></div>
      </button>)}</div>
    </section>

    <main className="chat-panel">
      <div className="chat-header">{active ? <><div className="customer-profile"><div className="large-avatar">{getInitials(active.customer_name)}</div><div><h2>{active.customer_name || 'New visitor'}</h2><p>{active.customer_email || 'No email captured'} <span className="online-pill">● Online</span></p></div><button className="edit-profile" title="Edit customer" onClick={() => { setProfile({ customer_name: active.customer_name || '', customer_email: active.customer_email || '' }); setModal('profile') }}><Edit3 size={13} /></button></div><div className="header-actions"><button className={`icon-button ${starred.includes(active.id) ? 'starred' : ''}`} title="Star conversation" onClick={() => toggleList(setStarred, active.id)}><Star size={16} fill={starred.includes(active.id) ? 'currentColor' : 'none'} /></button><button className="icon-button" title={muted.includes(active.id) ? 'Unmute' : 'Mute'} onClick={() => toggleList(setMuted, active.id)}>{muted.includes(active.id) ? <BellOff size={16} /> : <Bell size={16} />}</button><span className={`sentiment-pill ${active.sentiment}`}><span /> {active.sentiment || 'neutral'}</span>{active.status === 'resolved' ? <button className="resolve-button" onClick={() => changeStatus('reopen')}><Zap size={15} /> Reopen</button> : <button className="resolve-button" onClick={() => changeStatus('resolve')}><CheckCircle2 size={15} /> Resolve</button>}<button className="icon-button" title="More actions" onClick={() => setModal('actions')}><MoreHorizontal size={17} /></button></div></> : <div className="blank-header">Select a conversation to begin</div>}</div>
      {active ? <><div className="conversation-context"><span><Languages size={14} /> {active.language || 'en'} detected</span><span><Bot size={14} /> Automation active</span>{active.ticket && <button className="context-ticket" onClick={() => setShowTicket(!showTicket)}><Ticket size={14} /> {active.ticket.external_id}</button>}<span className={`connection ${online ? 'connected' : ''}`}><span /> {online ? 'Live' : 'Offline'}</span></div>{showTicket && active.ticket && <div className="ticket-strip"><Ticket size={15} /><strong>{active.ticket.subject}</strong><span className="ticket-priority">{active.ticket.priority}</span><button onClick={() => copyText(active.ticket.external_id, 'ticket')}><Clipboard size={13} /> {copied === 'ticket' ? 'Copied' : 'Copy ID'}</button></div>}<div className="messages" ref={messagesRef}>{active.messages?.length ? active.messages.map((message) => <div className={`message-row ${message.role}`} key={message.id}><div className={`message-avatar ${message.role}`}>{message.role === 'assistant' ? <Sparkles size={14} /> : getInitials(active.customer_name)}</div><div className="message-body"><div className="message-meta"><strong>{message.role === 'assistant' ? "Soham's Chatbot" : active.customer_name || 'Customer'}</strong><time>{new Date(message.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time>{message.role === 'assistant' && <span className="ai-tag">AI</span>}<button className="copy-message" title="Copy message" onClick={() => copyText(message.content, message.id)}>{copied === message.id ? <Check size={11} /> : <Clipboard size={11} />}</button></div><div className="bubble">{message.content}</div>{message.intent && <div className="analysis-tags"><span>{message.intent.replaceAll('_', ' ')}</span>{message.sentiment && <span className={message.sentiment}>{message.sentiment}</span>}</div>}</div></div>) : <div className="welcome"><div className="welcome-icon"><Sparkles size={25} /></div><h3>How can we help today?</h3><p>Send a message to test intent recognition, sentiment analysis, and automatic escalation.</p></div>}</div><div className="quick-replies">{cannedReplies.slice(0, 3).map((reply) => <button key={reply} onClick={() => setDraftValue(reply)}><Zap size={11} /> {reply.slice(0, 29)}…</button>)}</div><form className="composer" onSubmit={sendMessage}><textarea ref={composerRef} value={draft} onChange={(event) => setDraftValue(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); sendMessage(event) } }} placeholder="Write a reply… (Enter to send)" rows="2" maxLength="4000" /><div className="composer-footer"><span><Bot size={14} /> Suggested reply available <b>{draft.length}/4000</b></span><div className="composer-actions"><button type="button" className="composer-icon" title="Attach file"><Paperclip size={14} /></button><button className="send-button" disabled={loading || !draft.trim()}>{loading ? 'Sending…' : <><Send size={15} /> Send</>}</button></div></div></form></> : <div className="empty-chat"><MessageSquare size={30} /><h3>Your inbox, made intelligent</h3><p>Select a conversation or start a new one to get started.</p><button className="primary" onClick={() => setModal('new')}><Plus size={16} /> New conversation</button></div>}
      {error && <div className="toast"><CircleAlert size={16} /> {error}<button onClick={() => setError('')}><X size={14} /></button></div>}{notice && <div className="notice"><Check size={14} /> {notice}<button onClick={() => setNotice('')}><X size={12} /></button></div>}
    </main>

    <aside className="insights-panel"><div className="insights-heading"><p className="eyebrow">LIVE OVERVIEW</p><h2>Team pulse</h2></div><div className="metric-grid"><div className="metric"><span className="metric-icon purple"><MessageSquare size={16} /></span><strong>{stats.total}</strong><small>Total chats</small></div><div className="metric"><span className="metric-icon orange"><CircleAlert size={16} /></span><strong>{stats.at_risk}</strong><small>At risk</small></div><div className="metric"><span className="metric-icon green"><CheckCircle2 size={16} /></span><strong>{stats.resolved}</strong><small>Resolved</small></div><div className="metric"><span className="metric-icon blue"><Ticket size={16} /></span><strong>{stats.escalated}</strong><small>Escalated</small></div></div><div className="insight-card"><div className="card-heading"><h3>Automation rate</h3><span>Today</span></div><div className="rate"><strong>{stats.total ? Math.round(((stats.resolved + stats.open) / stats.total) * 100) : 0}%</strong><small>handled by AI</small></div><div className="progress"><span style={{ width: `${stats.total ? Math.round(((stats.resolved + stats.open) / stats.total) * 100) : 0}%` }} /></div><p>Automation is helping your team respond faster.</p></div><div className="insight-card sentiment-card"><div className="card-heading"><h3>Sentiment</h3><span>Live</span></div><div className="sentiment-bars"><div><span className="bar-label">Positive</span><span className="bar"><i style={{ width: '72%' }} /></span><b>72%</b></div><div><span className="bar-label">Neutral</span><span className="bar"><i className="neutral-bar" style={{ width: '20%' }} /></span><b>20%</b></div><div><span className="bar-label">At risk</span><span className="bar"><i className="risk-bar" style={{ width: `${stats.total ? Math.min(100, Math.round((stats.at_risk / stats.total) * 100)) : 8}%` }} /></span><b>{stats.total ? Math.round((stats.at_risk / stats.total) * 100) : 8}%</b></div></div></div><div className="tip"><Sparkles size={16} /><div><strong>Pro tip</strong><p>Customers with negative sentiment are escalated automatically.</p></div></div><div className="insight-actions"><button onClick={exportConversations}><Download size={14} /> Export inbox</button><button onClick={exportTranscript} disabled={!active}><FileText size={14} /> Download transcript</button><button onClick={printTranscript} disabled={!active}><Printer size={14} /> Print conversation</button></div></aside>

    {modal && <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setModal(null)}><div className="modal-card">{modal === 'settings' && <><div className="modal-title"><div><p className="eyebrow">PREFERENCES</p><h2>Workspace settings</h2></div><button onClick={() => setModal(null)}><X size={17} /></button></div><label className="setting-row"><span><Sun size={16} /><b>Light interface</b><small>Keep the workspace bright and focused.</small></span><input type="checkbox" checked={theme === 'dim'} onChange={() => setTheme(theme === 'dim' ? 'light' : 'dim')} /></label><label className="setting-row"><span><Filter size={16} /><b>Compact density</b><small>Fit more conversations on screen.</small></span><input type="checkbox" checked={compact} onChange={(event) => setCompact(event.target.checked)} /></label><button className="primary modal-close" onClick={() => setModal(null)}>Done</button></>}{modal === 'new' && <><div className="modal-title"><div><p className="eyebrow">NEW CHAT</p><h2>Start a conversation</h2></div><button onClick={() => setModal(null)}><X size={17} /></button></div><label className="field-label">Customer name<input autoFocus value={profile.customer_name} onChange={(event) => setProfile({ ...profile, customer_name: event.target.value })} placeholder="e.g. Asha Mehta" /></label><label className="field-label">Email address<input value={profile.customer_email} onChange={(event) => setProfile({ ...profile, customer_email: event.target.value })} placeholder="customer@example.com" type="email" /></label><button className="primary modal-close" onClick={createConversation}><Plus size={16} /> Create conversation</button></>}{modal === 'profile' && <><div className="modal-title"><div><p className="eyebrow">CUSTOMER PROFILE</p><h2>Edit customer</h2></div><button onClick={() => setModal(null)}><X size={17} /></button></div><label className="field-label">Customer name<input autoFocus value={profile.customer_name} onChange={(event) => setProfile({ ...profile, customer_name: event.target.value })} /></label><label className="field-label">Email address<input value={profile.customer_email} onChange={(event) => setProfile({ ...profile, customer_email: event.target.value })} type="email" /></label><button className="primary modal-close" onClick={updateProfile}><Check size={16} /> Save details</button></>}{modal === 'actions' && <><div className="modal-title"><div><p className="eyebrow">CONVERSATION TOOLS</p><h2>Quick actions</h2></div><button onClick={() => setModal(null)}><X size={17} /></button></div><button className="action-row" onClick={() => { setModal(null); toggleList(setStarred, active.id) }}><Star size={16} /> {starred.includes(active?.id) ? 'Remove star' : 'Star conversation'}</button><button className="action-row" onClick={() => { setModal(null); toggleList(setUnread, active.id) }}><Bell size={16} /> Mark as unread</button><label className="field-label">Private note<textarea rows="3" value={notes[active?.id] || ''} onChange={(event) => setNotes({ ...notes, [active.id]: event.target.value })} placeholder="Add a note for your team…" /></label><button className="primary modal-close" onClick={() => setModal(null)}>Save note</button></>}{modal === 'settings' ? null : null}</div></div>}
  </div>
}

export default App
