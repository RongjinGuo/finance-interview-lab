(function () {
  'use strict';

  const { roles, questions } = window.FinanceQuestions;
  const engine = window.FinanceEngine;
  const byId = new Map(questions.map(q => [q.id, q]));
  const STORAGE = 'finance-interview-v1';
  const app = document.getElementById('app');
  const stageNames = { opening: '开场与经历', professional: '专业能力', scenario: '工作情景', closing: '面试反问' };
  const paths = {
    book: '<path d="M4 4h6a3 3 0 0 1 3 3v14a4 4 0 0 0-4-3H4z"/><path d="M20 4h-4a3 3 0 0 0-3 3v14a4 4 0 0 1 4-3h3z"/>',
    home: '<rect x="4" y="4" width="6" height="6" rx="1"/><rect x="14" y="4" width="6" height="6" rx="1"/><rect x="4" y="14" width="6" height="6" rx="1"/><rect x="14" y="14" width="6" height="6" rx="1"/>',
    clock: '<circle cx="12" cy="12" r="8"/><path d="M12 7v5l3 2"/>',
    star: '<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9z"/>',
    chart: '<path d="M4 3v17h17M8 16v-4m5 4V8m5 8V5"/>',
    calculator: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M8 7h8M8 11h1m3 0h1m3 0h.1M8 15h1m3 0h1m3 0h.1M8 18h1m3 0h1m3 0h.1"/>',
    wallet: '<path d="M4 7V5a2 2 0 0 1 2-2h12v4M4 7h16v13H6a2 2 0 0 1-2-2z"/><path d="M20 11h-6v5h6m-3-2.5h.1"/>',
    target: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4"/><path d="M12 12 21 3m-4 0h4v4"/>',
    shield: '<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6z"/><path d="m8 12 3 3 5-6"/>',
    arrow: '<path d="M4 12h15m-5-5 5 5-5 5"/>',
    back: '<path d="M20 12H5m5-5-5 5 5 5"/>',
    check: '<path d="m5 12 4 4L19 6"/>',
    sound: '<path d="m11 4-6 5H2v6h3l6 5zM15 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/>',
    pause: '<path d="M8 5v14M16 5v14"/>',
    play: '<path d="m7 4 13 8-13 8z"/>',
    close: '<path d="m6 6 12 12M18 6 6 18"/>',
    download: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
    leaf: '<path d="M5 19c-4-15 12-15 15-15 0 6-1 18-13 14m-3 3L16 8"/>',
    message: '<path d="M4 4h16v13H9l-5 4zM8 9h8m-8 4h5"/>',
    file: '<path d="M5 3h9l5 5v13H5zM14 3v6h5M8 13h8m-8 4h5"/>',
    refresh: '<path d="M20 8a8 8 0 1 0 0 8M20 3v5h-5"/>',
    trash: '<path d="M3 6h18M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7m4-7v7"/>'
  };
  const roleIcons = { accounting: 'calculator', analysis: 'chart', budget: 'target', treasury: 'wallet', audit: 'shield' };
  const icon = (name, size = 18) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.file}</svg>`;
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const clock = seconds => `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
  const date = value => new Date(value).toLocaleString('zh-CN', { month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  const roleName = id => roles.find(r => r.id === id)?.name || '财务岗位';
  let storageOK = true;
  let lastStoredRaw = null;
  function readState(raw) {
    const state = { settings: { role: 'accounting', mode: 'practice', count: 6 }, active: null, history: [], favorites: [] };
    const stored = JSON.parse(raw || 'null');
    if (stored && typeof stored === 'object') {
      if (roles.some(r => r.id === stored.settings?.role)) state.settings.role = stored.settings.role;
      if (['practice', 'mock'].includes(stored.settings?.mode)) state.settings.mode = stored.settings.mode;
      if ([6, 10].includes(stored.settings?.count)) state.settings.count = stored.settings.count;
      if (engine.validateSession(stored.active, questions) && stored.active.phase !== 'finished') state.active = stored.active;
      state.history = Array.isArray(stored.history) ? stored.history.filter(s => engine.validateSession(s, questions) && s.phase === 'finished').slice(0, 30) : [];
      state.favorites = Array.isArray(stored.favorites) ? [...new Set(stored.favorites.filter(id => byId.has(id)))] : [];
    }
    return state;
  }
  let state = readState(null);
  try {
    lastStoredRaw = localStorage.getItem(STORAGE);
    state = readState(lastStoredRaw);
  } catch { storageOK = false; }

  let view = 'home';
  let reportId = null;
  let library = { search: '', role: 'all', stage: 'all' };
  let paused = false;
  let timerStamp = Date.now();
  let toastTimeout;
  let modal = null;
  let modalReturnFocus = null;

  function syncFromStorage() {
    try {
      const raw = localStorage.getItem(STORAGE);
      if (raw === lastStoredRaw) return false;
      const latest = readState(raw);
      const previousAnswer = modal?.report ? state.history.find(s => s.id === reportId)?.answers[modal.qid] : null;
      const latestAnswer = modal?.report ? latest.history.find(s => s.id === reportId)?.answers[modal.qid] : null;
      const invalidModal = modal && (modal.confirm || (modal.report && (!latestAnswer || JSON.stringify(previousAnswer) !== JSON.stringify(latestAnswer))));
      lastStoredRaw = raw;
      state = latest;
      if (invalidModal) { closeModal(); toast('另一页面已更新这份记录，请重新打开复盘后继续。'); }
      if (view === 'interview' && !state.active) view = 'home';
      timerStamp = Date.now();
      render({ keepScroll: true });
      return true;
    } catch { return false; }
  }
  window.addEventListener('storage', event => {
    if (event.key === STORAGE || event.key === null) syncFromStorage();
  });
  function persist() {
    try {
      // A stale tab must read the newer snapshot before it can write again.
      if (syncFromStorage()) return;
      const raw = JSON.stringify(state);
      localStorage.setItem(STORAGE, raw);
      lastStoredRaw = raw;
      storageOK = true;
    }
    catch { if (storageOK) toast('浏览器存储空间不可用，请及时导出复盘。'); storageOK = false; }
  }
  function toast(message) {
    const el = document.getElementById('toast');
    el.textContent = message;
    el.classList.add('show');
    clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => el.classList.remove('show'), 3500);
  }
  function answerFor(session, qid) {
    if (!session.answers[qid]) session.answers[qid] = { text: '', seconds: 0, skipped: false, checked: byId.get(qid).points.map(() => false), reviewed: false };
    return session.answers[qid];
  }
  function saveDraft() {
    const field = document.getElementById('answer-input');
    if (field && state.active && view === 'interview' && state.active.phase === 'answer') {
      answerFor(state.active, state.active.questionIds[state.active.current]).text = field.value;
    }
  }
  function tick() {
    const now = Date.now();
    if (state.active && view === 'interview' && state.active.phase === 'answer' && !paused && !document.hidden && !modal) {
      const q = byId.get(state.active.questionIds[state.active.current]);
      const answer = answerFor(state.active, q.id);
      answer.seconds += Math.min((now - timerStamp) / 1000, 2);
      const el = document.getElementById('timer-value');
      if (el) { el.textContent = clock(answer.seconds); el.classList.toggle('over', answer.seconds > q.minutes * 60); }
    }
    timerStamp = now;
  }
  setInterval(tick, 1000);
  setInterval(() => { if (state.active && view === 'interview') { saveDraft(); persist(); } }, 5000);
  document.addEventListener('visibilitychange', () => { timerStamp = Date.now(); saveDraft(); persist(); });
  window.addEventListener('pagehide', () => { saveDraft(); persist(); });

  function navButton(id, label, glyph, count) {
    return `<button data-action="navigate" data-view="${id}" class="${view === id ? 'active' : ''}" ${view === id ? 'aria-current="page"' : ''}>${icon(glyph, 17)}<span>${label}</span>${count ? `<span class="nav-count">${count}</span>` : ''}</button>`;
  }
  function shell(content) {
    const names = { home: '开始练习', library: '面试题库', favorites: '我的收藏', history: '练习记录', interview: '模拟面试', report: '面试复盘' };
    return `<div class="layout">
      <aside class="sidebar"><a href="#" class="brand" data-action="navigate" data-view="home" aria-label="财务面试练习室首页"><span class="brand-mark">${icon('chart', 24)}</span><span class="brand-name">财务面试练习室<span class="brand-sub">FINANCE INTERVIEW LAB</span></span></a>
      <div class="nav-caption">你的求职准备站</div><nav class="nav" aria-label="主导航">${navButton('home', '开始练习', 'home')}${navButton('library', '面试题库', 'book', questions.length)}${navButton('favorites', '我的收藏', 'star', state.favorites.length)}${navButton('history', '练习记录', 'clock', state.history.length)}</nav>
      <div class="sidebar-note">${icon('leaf', 23)}<p>每一次练习，<br>都离从容更近一步。</p><small><i class="dot"></i>为财务管理求职者准备</small></div></aside>
      <div class="workspace"><header class="topbar"><div class="breadcrumb">求职准备 <span>/</span> ${names[view]}</div><div class="local-label">${icon('shield', 14)}${storageOK ? '作答内容保存在本机浏览器' : '存储不可用 · 请及时导出'}</div></header>
      <main class="main" id="main-content">${content}<footer class="footer"><span>FINANCE INTERVIEW LAB · 把准备变成底气</span><span>专业积累 / 清晰表达 / 从容应答</span></footer></main></div></div>`;
  }
  function heroArt() {
    return '<div class="hero-art" aria-hidden="true"><div class="orbit"></div><div class="art-paper"><b>FINANCE.</b><span class="art-line"></span><span class="art-line" style="width:52%"></span><div class="art-bars"><i style="height:16px"></i><i style="height:26px"></i><i style="height:33px"></i><i style="height:43px"></i></div></div><span class="art-check">' + icon('check', 23) + '</span><span class="art-star">✳</span></div>';
  }
  function homeView() {
    const settings = state.settings;
    const count = settings.count;
    return `${state.active ? `<div class="resume-banner">${icon('clock')}<div>你有一场未完成的 ${esc(roleName(state.active.role))} 面试 · 第 ${state.active.current + 1}/${state.active.questionIds.length} 题</div><button class="button small" data-action="resume">继续练习 ${icon('arrow', 14)}</button></div>` : ''}
      <section class="hero fade-in"><div><div class="eyebrow">YOUR NEXT CHAPTER STARTS HERE</div><h1>面试前，<br>给自己一次<em>从容的练习。</em></h1><p class="hero-desc">从“我学过”到“我能讲清楚”。<br>围绕真实财务工作场景，练专业判断，也练表达底气。</p></div>${heroArt()}</section>
      <section aria-labelledby="role-title"><div class="section-heading"><span class="step-no">01</span><h2 id="role-title">选择你的求职方向</h2><small>还没确定？可以逐个体验</small></div>
      <div class="roles">${roles.map(r => `<button class="role-card fade-in ${settings.role === r.id ? 'selected' : ''}" data-action="select-role" data-role="${r.id}" aria-pressed="${settings.role === r.id}"><span class="role-icon">${icon(roleIcons[r.id], 21)}</span>${settings.role === r.id ? '<span class="selected-tick">✓</span>' : ''}<strong>${esc(r.name)}</strong><small>${esc(r.subtitle)}</small></button>`).join('')}</div></section>
      <div class="setup-grid"><section class="panel setup-panel"><div class="section-heading"><span class="step-no">02</span><h2>按你的节奏，开始一场面试</h2></div><div class="mode-grid">
      <button data-action="select-mode" data-mode="practice" class="mode-card ${settings.mode === 'practice' ? 'selected' : ''}" aria-pressed="${settings.mode === 'practice'}"><span class="radio"></span><span><strong>边练边复盘</strong><small>每题回答后查看思路与追问<br>适合积累经验，打磨回答</small></span></button>
      <button data-action="select-mode" data-mode="mock" class="mode-card ${settings.mode === 'mock' ? 'selected' : ''}" aria-pressed="${settings.mode === 'mock'}"><span class="radio"></span><span><strong>完整模拟面试</strong><small>连续作答，结束后统一复盘<br>适合面试前，找找状态</small></span></button></div>
      <div class="quantity-row"><span class="quantity-label">本场题量</span><div class="quantity">${[6, 10].map(n => `<button data-action="select-count" data-count="${n}" class="${count === n ? 'selected' : ''}" aria-pressed="${count === n}">${n} 题</button>`).join('')}</div><span class="time-estimate">约 ${count === 6 ? '15–20' : '25–35'} 分钟</span></div>
      <div class="start-row"><button class="button" data-action="start">开始我的面试 ${icon('arrow', 18)}</button><span class="start-note">无需注册，随时暂停<br>准备好了，就从第一题开始</span></div></section>
      <aside class="tip-card"><div class="eyebrow">面试官想听见的</div><h3>别只给结论，<br>也讲清你的判断。</h3><p>“利润增长了”之后，再说一层：<br>增长来自哪里？现金流跟上了吗？<br>用一个具体例子，让能力被看见。</p><div class="tip-footer"><span>先结论 → 再依据 → 给行动</span>${icon('message', 20)}</div></aside></div>
      <section class="bottom-strip"><div class="strip-item"><span class="strip-icon">${icon('book', 20)}</span><div><strong>${questions.length} 道精选面试题</strong><small>专业基础、实务情景与求职表达</small></div></div><div class="strip-item"><span class="strip-icon">${icon('target', 20)}</span><div><strong>每一道题，都有复盘方向</strong><small>对照回答要点，勾选自评掌握情况</small></div></div><div class="strip-item"><span class="strip-icon">${icon('file', 20)}</span><div><strong>留下自己的进步轨迹</strong><small>保存练习记录，导出完整面试复盘</small></div></div></section>`;
  }
  function startSession(ids) {
    const launch = () => {
      const now = new Date().toISOString();
      const questionIds = ids || engine.buildSession(questions, state.settings).map(q => q.id);
      const first = byId.get(questionIds[0]);
      const role = ids && !first.roles.includes('all') && !first.roles.includes(state.settings.role) ? first.roles[0] : state.settings.role;
      state.active = { id: `s-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`, role, mode: ids ? 'practice' : state.settings.mode, questionIds, current: 0, phase: 'answer', answers: {}, createdAt: now, finishedAt: null };
      paused = false; timerStamp = Date.now(); view = 'interview'; persist(); render();
    };
    if (state.active) confirmDialog('开始新的一场练习？', '当前未完成的面试会被替换。你也可以先返回首页继续完成它。', '开始新练习', launch);
    else launch();
  }
  function interviewView() {
    const session = state.active;
    if (!session) { view = 'home'; return homeView(); }
    const q = byId.get(session.questionIds[session.current]);
    const answer = answerFor(session, q.id);
    const isReview = session.phase === 'review';
    const last = session.current === session.questionIds.length - 1;
    return `<div class="page-head"><div><div class="eyebrow">ONE QUESTION AT A TIME</div><h1 class="page-title">${isReview ? '把这一题，练得更好。' : '就从这一题，开始。'}</h1><p class="page-subtitle">${esc(roleName(session.role))} · ${session.mode === 'practice' ? '边练边复盘' : '完整模拟面试'} · 第 ${session.current + 1} / ${session.questionIds.length} 题</p></div><button class="button secondary small" data-action="save-exit">保存并退出</button></div>
      <div class="interview-grid"><section class="panel interview-card fade-in"><div class="question-meta"><span class="badge">${esc(stageNames[q.stage])}</span><span class="badge orange">${esc(q.difficulty)}</span><span class="muted small-text">建议回答 ${q.minutes} 分钟</span></div><h2 class="question-title">${esc(q.title)}</h2><p class="question-prompt">${esc(q.prompt)}</p>
      <div class="question-tools"><button class="link-button" data-action="speak" data-id="${q.id}">${icon('sound', 16)}朗读题目</button><button class="link-button" data-action="favorite" data-id="${q.id}" aria-pressed="${state.favorites.includes(q.id)}">${icon('star', 16)}${state.favorites.includes(q.id) ? '已收藏' : '收藏此题'}</button></div>
      ${isReview ? `<h3 class="small-text">你的回答</h3><div class="own-answer">${esc(answer.text) || '本题已跳过，可在复盘后重新练习。'}</div>${reviewBody(q, answer, 'active')}<div class="action-row"><button class="button secondary" data-action="retry-current">重新回答</button><button class="button" data-action="next">${last ? '完成并查看复盘' : '下一题'} ${icon('arrow', 17)}</button></div>` : `
      <label for="answer-input" class="answer-label">你的回答 <small>先说结论，再补充依据和例子</small></label><textarea id="answer-input" maxlength="20000" placeholder="把这里当成真实的面试现场。\n可以先写关键思路，也可以完整写下你会说的话。" ${paused ? 'disabled' : ''}>${esc(answer.text)}</textarea><div class="answer-bottom"><span id="save-status">${paused ? '已暂停，继续后即可作答' : '内容自动保存在当前浏览器'}</span><span><span id="char-count">${answer.text.length}</span> 字</span></div>
      <div class="action-row"><button class="link-button" data-action="skip">暂时不会，跳过</button><button class="button" data-action="submit-answer" id="submit-answer" ${paused ? 'disabled' : ''}>${session.mode === 'practice' ? '提交并复盘' : (last ? '完成面试' : '提交，下一题')} ${icon('arrow', 17)}</button></div>`}</section>
      <aside class="interview-aside"><section class="panel timer-panel"><span class="small-text muted">本题用时</span><div class="timer ${answer.seconds > q.minutes * 60 ? 'over' : ''}" id="timer-value">${clock(answer.seconds)}</div><p class="timer-description small-text muted">建议 ${q.minutes} 分钟 · 超时仍可继续</p><div class="timer-actions">${!isReview ? `<button class="link-button" data-action="pause">${icon(paused ? 'play' : 'pause', 13)}${paused ? '继续作答' : '暂停一下'}</button>` : '<span class="small-text muted">复盘中 · 计时已暂停</span>'}</div><div class="progress-track"><i style="width:${(session.current / session.questionIds.length) * 100}%"></i></div><span class="timer-description small-text muted">已完成 ${session.current} / ${session.questionIds.length} 题</span></section>
      <section class="panel question-path"><h3>这场面试的路线</h3>${session.questionIds.map((id, i) => `<div class="path-item ${i === session.current ? 'current' : (i < session.current ? 'done' : '')}"><span class="path-index">${i < session.current ? '✓' : i + 1}</span><span>${esc(stageNames[byId.get(id).stage])}</span></div>`).join('')}<div class="soft-note" style="margin-top:16px">${session.mode === 'practice' ? '回答后对照要点，再勾选自己确实讲清楚的部分。' : '像真实面试一样连续作答。参考思路将在面试结束后呈现。'}</div></section></aside></div>`;
  }
  function reviewBody(q, answer, source) {
    const hints = engine.answerHints(answer.text);
    return `<div class="review-section"><h3>回答要点 · 自评检查</h3><p class="small-text muted">对照你刚才的回答，勾选已经讲清楚的部分。${answer.skipped ? '本题已跳过，不计入自评覆盖率。' : '自评用于整理练习方向。'}</p>${q.points.map((p, i) => `<label class="self-check"><input type="checkbox" data-action="check-point" data-source="${source}" data-id="${q.id}" data-index="${i}" ${answer.checked[i] ? 'checked' : ''} ${answer.skipped ? 'disabled' : ''}><span><strong>${esc(p.label)}</strong><small>${esc(p.detail)}</small></span></label>`).join('')}</div>
      <div class="review-section"><h3>参考回答思路</h3><div class="sample">${esc(q.sample)}</div><div class="pitfall">容易忽略：${esc(q.pitfall)}</div></div>
      <div class="review-section"><h3>面试官可能追问</h3><p class="sample">${esc(q.followUp)}</p><div class="soft-note">${answer.skipped ? '先对照参考思路梳理一遍，再尝试用自己的话回答。' : hints.map(esc).join('<br>')}</div></div>`;
  }
  function submitAnswer(skip = false) {
    const s = state.active;
    if (!s || s.phase !== 'answer') return;
    saveDraft();
    const answer = answerFor(s, s.questionIds[s.current]);
    if (!skip && paused) { toast('请先继续作答。'); return; }
    if (!skip && !answer.text.trim()) { toast('先写下你的回答，或者选择“暂时不会，跳过”。'); document.getElementById('answer-input').focus(); return; }
    answer.skipped = skip;
    answer.reviewed = false;
    answer.checked = answer.checked.map(() => false);
    stopSpeech(); paused = false;
    if (s.mode === 'practice') { s.phase = 'review'; persist(); render(); }
    else advance();
  }
  function advance() {
    const s = state.active;
    if (!s) return;
    const answer = answerFor(s, s.questionIds[s.current]);
    if (s.phase === 'review' && !answer.skipped) answer.reviewed = true;
    if (s.current < s.questionIds.length - 1) { s.current++; s.phase = 'answer'; paused = false; timerStamp = Date.now(); persist(); render(); }
    else {
      s.phase = 'finished'; s.finishedAt = new Date().toISOString();
      state.history.unshift(s); state.history = state.history.slice(0, 30); reportId = s.id; state.active = null;
      view = 'report'; persist(); render();
    }
  }
  function reportSession() { return state.history.find(s => s.id === reportId); }
  function reportView() {
    const s = reportSession();
    if (!s) { view = 'history'; return historyView(); }
    const summary = engine.summarize(s, questions);
    const totalSeconds = Object.values(s.answers).reduce((sum, a) => sum + a.seconds, 0);
    return `<div class="page-head"><div><div class="eyebrow">REFLECT. REFINE. REPEAT.</div><h1 class="page-title">你的面试复盘</h1><p class="page-subtitle">${esc(roleName(s.role))} · ${s.mode === 'practice' ? '边练边复盘' : '完整模拟面试'} · ${date(s.finishedAt)}</p></div><button class="button secondary" data-action="export-report">${icon('download', 16)}导出复盘</button></div>
      <div class="report-intro"><div><h2>又练了一次，也更靠近一步。</h2><p>${summary.reviewed < summary.answered ? `已完成 ${summary.answered} 道回答。点击下方“逐题复盘”，对照思路完成自评。` : '把还没讲清楚的地方，变成下一次练习的重点。'}</p></div><div class="seal">${icon('check', 30)}</div></div>
      <div class="stats"><div class="panel stat"><span>已回答 / 总题量</span><strong>${summary.answered}<small> / ${summary.total}</small></strong></div><div class="panel stat"><span>累计作答用时</span><strong>${clock(totalSeconds)}</strong></div><div class="panel stat"><span>已完成自评</span><strong>${summary.reviewed}<small> 题</small></strong></div><div class="panel stat"><span>自评要点覆盖率</span><strong>${summary.coverage === null ? '—' : `${summary.coverage}<small>%</small>`}</strong></div></div>
      <div class="report-grid"><section class="panel report-panel"><h3>各类题目，自评掌握情况</h3><p class="small-text muted">仅统计已自评回答；跳过和未自评题目不计入比例。</p>${summary.categories.map(c => `<div class="category-row"><div class="label"><span>${esc(c.name)}</span><span class="muted">${c.total ? `${c.mastered} / ${c.total} 个要点` : '尚未自评'}</span></div><div class="progress-track"><i style="width:${c.total ? c.mastered / c.total * 100 : 0}%"></i></div></div>`).join('')}</section>
      <section class="panel report-panel"><h3>下一次，重点练这些</h3>${summary.weakPoints.length ? summary.weakPoints.slice(0, 4).map(p => `<div class="weak-item"><strong>${esc(p.label)}</strong><span>${esc(p.detail)}</span></div>`).join('') : `<div class="soft-note">${summary.reviewed ? '已自评的要点都已勾选。试着脱离参考思路，再用 2 分钟完整说一次。' : '完成逐题自评后，这里会整理你尚未勾选的回答要点。'}</div>`}${summary.skipped ? `<p class="small-text muted">另有 ${summary.skipped} 道跳过题，建议优先重练。</p>` : ''}</section></div>
      <div class="section-heading"><h2>逐题复盘</h2><small>保留自己的回答，回看每一次思考</small></div><div class="review-list">${s.questionIds.map((id, i) => { const q = byId.get(id); const a = answerFor(s, id); return `<article class="panel review-row"><span class="number">${String(i + 1).padStart(2, '0')}</span><div><h3>${esc(q.title)}</h3><small>${esc(q.category)} · ${a.skipped ? '已跳过' : a.reviewed ? `自评 ${a.checked.filter(Boolean).length}/${q.points.length} 个要点` : '待自评'} · ${clock(a.seconds)}</small></div><button class="button secondary small" data-action="review-question" data-id="${id}">${a.reviewed || a.skipped ? '查看复盘' : '开始自评'}</button></article>`; }).join('')}</div>
      <div class="action-row"><button class="button secondary" data-action="navigate" data-view="home">${icon('back', 16)}返回练习首页</button><button class="button" data-action="practice-again">再练一场 ${icon('refresh', 16)}</button></div>`;
  }
  function libraryView(favorites = false) {
    const filtered = questions.filter(q => (!favorites || state.favorites.includes(q.id)) && (library.role === 'all' || q.roles.includes('all') || q.roles.includes(library.role)) && (library.stage === 'all' || q.stage === library.stage) && `${q.title} ${q.prompt} ${q.category}`.toLowerCase().includes(library.search.toLowerCase().trim()));
    return `<div class="page-head"><div><div class="eyebrow">BUILD YOUR FINANCE TOOLKIT</div><h1 class="page-title">${favorites ? '留给下一次练习的题。' : '把常见问题，练成拿手题。'}</h1><p class="page-subtitle">${favorites ? '收藏值得再练的题目，慢慢补齐自己的准备清单。' : `${questions.length} 道题 · 每题附参考思路、追问和易错点。`}</p></div></div>
      <div class="filters"><label class="search-label"><span class="visually-hidden">搜索面试题</span><input id="search-input" type="search" placeholder="搜索题目，例如：现金流、Excel、自我介绍" value="${esc(library.search)}"></label><label><span class="visually-hidden">按岗位筛选</span><select id="filter-role"><option value="all">全部岗位</option>${roles.map(r => `<option value="${r.id}" ${library.role === r.id ? 'selected' : ''}>${esc(r.name)}</option>`).join('')}</select></label><label><span class="visually-hidden">按题型筛选</span><select id="filter-stage"><option value="all">全部题型</option>${Object.entries(stageNames).map(([id, label]) => `<option value="${id}" ${library.stage === id ? 'selected' : ''}>${label}</option>`).join('')}</select></label></div>
      <div class="section-heading"><h2>共 ${filtered.length} 道题目</h2><small>按岗位与题型自由筛选</small></div>${filtered.length ? `<div class="library-grid">${filtered.map(q => `<article class="panel library-card"><div class="question-meta" style="margin:0"><span class="badge">${esc(q.category)}</span><span class="badge orange">${esc(q.difficulty)}</span></div><h3>${esc(q.title)}</h3><p>${esc(q.prompt)}</p><div class="action-row"><button class="link-button" data-action="favorite" data-id="${q.id}" aria-pressed="${state.favorites.includes(q.id)}">${icon('star', 15)}${state.favorites.includes(q.id) ? '已收藏' : '收藏'}</button><div class="action-group"><button class="link-button" data-action="preview-question" data-id="${q.id}">查看思路</button><button class="button secondary small" data-action="practice-one" data-id="${q.id}">练这一题 ${icon('arrow', 13)}</button></div></div></article>`).join('')}</div>` : `<section class="panel empty">${icon(favorites ? 'star' : 'book', 35)}<h3>${favorites && !state.favorites.length ? '你的收藏夹，还在等待第一道题。' : '暂时没有匹配的题目。'}</h3><p>${favorites && !state.favorites.length ? '在题库或练习中点击“收藏”，就能在这里找到它。' : '试试其他关键词，或者切换到全部岗位。'}</p><button class="button secondary" data-action="${favorites && !state.favorites.length ? 'navigate' : 'reset-filters'}" data-view="library">${favorites && !state.favorites.length ? '去题库看看' : '清除筛选'}</button></section>`}`;
  }
  function historyView() {
    return `<div class="page-head"><div><div class="eyebrow">EVERY PRACTICE COUNTS</div><h1 class="page-title">把进步，留在这里。</h1><p class="page-subtitle">保留最近 30 场已完成面试 · 浏览器更换或清理数据后不会同步</p></div>${state.history.length ? `<button class="link-button" data-action="clear-history">${icon('trash', 15)}清空记录</button>` : ''}</div>
      ${state.history.length ? state.history.map(s => { const summary = engine.summarize(s, questions); return `<article class="panel history-row"><span class="role-icon" style="margin:0">${icon(roleIcons[s.role], 22)}</span><div class="history-info"><h3>${esc(roleName(s.role))} <span class="badge">${s.mode === 'practice' ? '练习' : '模拟'}</span></h3><small>${date(s.finishedAt)} · ${summary.answered}/${summary.total} 题已回答 · ${summary.reviewed} 题已自评</small></div><button class="button secondary small" data-action="open-report" data-id="${s.id}">查看复盘 ${icon('arrow', 14)}</button></article>`; }).join('') : `<section class="panel empty">${icon('clock', 38)}<h3>第一场练习，从今天开始。</h3><p>完成一场面试后，回答和复盘会自动保存在这里。</p><button class="button" data-action="navigate" data-view="home">开始第一场练习 ${icon('arrow', 16)}</button></section>`}`;
  }
  function render({ keepScroll = false, focusSearch = false } = {}) {
    const scroll = window.scrollY;
    const focused = document.activeElement;
    const focusId = focused?.id;
    const focusData = focused?.dataset ? { ...focused.dataset } : {};
    const selectionStart = focusSearch ? focused?.selectionStart : null;
    const selectionEnd = focusSearch ? focused?.selectionEnd : null;
    const content = view === 'home' ? homeView() : view === 'interview' ? interviewView() : view === 'report' ? reportView() : view === 'library' || view === 'favorites' ? libraryView(view === 'favorites') : historyView();
    app.innerHTML = shell(content);
    if (keepScroll) window.scrollTo(0, scroll); else window.scrollTo(0, 0);
    if (focusSearch) {
      const field = document.getElementById('search-input');
      field.focus({ preventScroll: true });
      field.setSelectionRange(selectionStart, selectionEnd);
    } else if (keepScroll) {
      const replacement = (focusId && document.getElementById(focusId)) || [...app.querySelectorAll('[data-action]')].find(el => focusData.action && Object.entries(focusData).every(([key, value]) => el.dataset[key] === value));
      replacement?.focus({ preventScroll: true });
    } else {
      const heading = app.querySelector('.question-title') || app.querySelector('h1');
      if (heading) { heading.tabIndex = -1; heading.focus({ preventScroll: true }); }
    }
  }
  function navigate(next) {
    saveDraft(); stopSpeech(); persist(); view = next; paused = false; render();
  }
  function stopSpeech() { if ('speechSynthesis' in window) window.speechSynthesis.cancel(); }
  function speak(qid) {
    if (!('speechSynthesis' in window)) { toast('当前浏览器不支持朗读，可以直接阅读题目。'); return; }
    if (window.speechSynthesis.speaking) { stopSpeech(); return; }
    const q = byId.get(qid);
    const utterance = new SpeechSynthesisUtterance(`${q.title}。${q.prompt}`);
    utterance.lang = 'zh-CN'; utterance.rate = 0.92;
    const voice = window.speechSynthesis.getVoices().find(v => v.lang.startsWith('zh'));
    if (voice) utterance.voice = voice;
    utterance.onerror = event => { if (!['interrupted', 'canceled'].includes(event.error)) toast('此设备暂时无法朗读，可以继续文字作答。'); };
    window.speechSynthesis.speak(utterance);
  }
  function downloadReport() {
    const s = reportSession();
    if (!s) return;
    const text = engine.exportReport(s, questions, roles);
    const url = URL.createObjectURL(new Blob(['\ufeff' + text], { type: 'text/plain;charset=utf-8' }));
    const a = document.createElement('a'); a.href = url; a.download = `财务面试复盘-${roleName(s.role)}-${s.finishedAt.slice(0, 10)}.md`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast('复盘已导出，包含你的回答与参考思路。');
  }
  function showModal(html, data = {}) {
    modalReturnFocus = document.activeElement;
    modal = data;
    const backdrop = document.createElement('div'); backdrop.className = 'modal-backdrop'; backdrop.id = 'modal-backdrop';
    backdrop.innerHTML = `<section class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">${html}</section>`;
    document.body.append(backdrop);
    document.body.style.overflow = 'hidden';
    backdrop.querySelector('button, input, summary')?.focus();
  }
  function closeModal() {
    document.getElementById('modal-backdrop')?.remove(); modal = null; document.body.style.overflow = ''; timerStamp = Date.now();
    if (modalReturnFocus?.isConnected) modalReturnFocus.focus();
  }
  function confirmDialog(title, description, label, action) {
    showModal(`<div class="modal-head"><h2 id="modal-title">${esc(title)}</h2><button class="icon-button" aria-label="关闭" data-action="close-modal">${icon('close')}</button></div><p class="small-text muted">${esc(description)}</p><div class="action-row"><button class="button secondary" data-action="close-modal">取消</button><button class="button" data-action="confirm">${esc(label)}</button></div>`, { confirm: action });
  }
  function previewQuestion(qid) {
    const q = byId.get(qid);
    showModal(`<div class="modal-head"><div><span class="badge">${esc(q.category)}</span><h2 id="modal-title">${esc(q.title)}</h2></div><button class="icon-button" aria-label="关闭" data-action="close-modal">${icon('close')}</button></div><p class="question-prompt">${esc(q.prompt)}</p><div class="review-section"><h3>回答要点</h3>${q.points.map(p => `<p class="sample"><strong>${esc(p.label)}</strong><br>${esc(p.detail)}</p>`).join('')}</div><div class="review-section"><h3>参考思路</h3><p class="sample">${esc(q.sample)}</p><div class="pitfall">容易忽略：${esc(q.pitfall)}</div></div><div class="review-section"><h3>面试官可能追问</h3><p class="sample">${esc(q.followUp)}</p></div><div class="action-row"><button class="button secondary" data-action="close-modal">关闭</button><button class="button" data-action="modal-practice" data-id="${q.id}">练这一题 ${icon('arrow', 16)}</button></div>`, { qid });
  }
  function reviewQuestion(qid) {
    const s = reportSession();
    const q = byId.get(qid); const a = answerFor(s, qid);
    showModal(`<div class="modal-head"><div><span class="badge">逐题复盘</span><h2 id="modal-title">${esc(q.title)}</h2></div><button class="icon-button" aria-label="关闭" data-action="close-modal">${icon('close')}</button></div><p class="sample">${esc(q.prompt)}</p><h3 class="small-text">你的回答</h3><div class="own-answer">${esc(a.text) || '本题已跳过。'}</div>${reviewBody(q, a, 'report')}<div class="action-row"><button class="button secondary" data-action="modal-practice" data-id="${qid}">重新练习此题</button><button class="button" data-action="save-review" data-id="${qid}">${a.skipped ? '完成查看' : '保存自评'} ${icon('check', 16)}</button></div>`, { qid, checks: [...a.checked], report: true });
  }

  document.addEventListener('click', event => {
    const button = event.target.closest('[data-action]');
    if (!button || button.disabled || button.type === 'checkbox') return;
    event.preventDefault();
    if (syncFromStorage()) { toast('另一个页面更新了练习，已同步最新进度。请继续操作。'); return; }
    const { action, id } = button.dataset;
    if (action === 'navigate') navigate(button.dataset.view);
    else if (action === 'select-role') { state.settings.role = button.dataset.role; persist(); render({ keepScroll: true }); }
    else if (action === 'select-mode') { state.settings.mode = button.dataset.mode; persist(); render({ keepScroll: true }); }
    else if (action === 'select-count') { state.settings.count = Number(button.dataset.count); persist(); render({ keepScroll: true }); }
    else if (action === 'start') startSession();
    else if (action === 'resume') { view = 'interview'; paused = false; timerStamp = Date.now(); render(); }
    else if (action === 'save-exit') { navigate('home'); toast('已保存，下次可以接着练。'); }
    else if (action === 'pause') { saveDraft(); tick(); paused = !paused; timerStamp = Date.now(); persist(); render({ keepScroll: true }); }
    else if (action === 'submit-answer') submitAnswer();
    else if (action === 'skip') { saveDraft(); const a = answerFor(state.active, state.active.questionIds[state.active.current]); if (a.text.trim()) confirmDialog('跳过这一题？', '已写的草稿会保留，但本题将标记为跳过，不计入已回答题数。', '跳过此题', () => submitAnswer(true)); else submitAnswer(true); }
    else if (action === 'next') advance();
    else if (action === 'retry-current') { const s = state.active; const a = answerFor(s, s.questionIds[s.current]); a.reviewed = false; a.skipped = false; a.checked.fill(false); s.phase = 'answer'; paused = false; timerStamp = Date.now(); persist(); render(); }
    else if (action === 'favorite') { saveDraft(); state.favorites = state.favorites.includes(id) ? state.favorites.filter(q => q !== id) : [...state.favorites, id]; persist(); render({ keepScroll: true }); toast(state.favorites.includes(id) ? '已加入收藏，留给下一次练习。' : '已取消收藏。'); }
    else if (action === 'speak') speak(id);
    else if (action === 'open-report') { reportId = id; view = 'report'; render(); }
    else if (action === 'export-report') downloadReport();
    else if (action === 'practice-again') { const s = reportSession(); state.settings.role = s.role; state.settings.mode = s.mode; startSession(); }
    else if (action === 'practice-one') startSession([id]);
    else if (action === 'preview-question') previewQuestion(id);
    else if (action === 'review-question') reviewQuestion(id);
    else if (action === 'close-modal') closeModal();
    else if (action === 'confirm') { const callback = modal.confirm; closeModal(); callback(); }
    else if (action === 'modal-practice') { closeModal(); startSession([id]); }
    else if (action === 'save-review') { const a = answerFor(reportSession(), id); if (!a.skipped) { a.checked = [...modal.checks]; a.reviewed = true; } closeModal(); persist(); render({ keepScroll: true }); toast('复盘已保存。'); }
    else if (action === 'reset-filters') { library = { search: '', role: 'all', stage: 'all' }; render(); }
    else if (action === 'clear-history') confirmDialog('清空所有已完成的练习记录？', '此操作只清除本浏览器的历史面试。需要保留的回答，请先打开对应复盘并导出。', '清空记录', () => { state.history = []; persist(); render(); toast('练习记录已清空。'); });
  });
  document.addEventListener('input', event => {
    if (syncFromStorage()) { toast('已同步另一页面的最新进度，请继续作答。'); return; }
    if (event.target.id === 'answer-input') { saveDraft(); persist(); document.getElementById('char-count').textContent = event.target.value.length; }
    else if (event.target.id === 'search-input' && !event.isComposing) { library.search = event.target.value; render({ keepScroll: true, focusSearch: true }); }
  });
  document.addEventListener('compositionend', event => { if (event.target.id === 'search-input') { library.search = event.target.value; render({ keepScroll: true, focusSearch: true }); } });
  document.addEventListener('change', event => {
    if (syncFromStorage()) return;
    if (event.target.id === 'filter-role') { library.role = event.target.value; render({ keepScroll: true }); }
    else if (event.target.id === 'filter-stage') { library.stage = event.target.value; render({ keepScroll: true }); }
    else if (event.target.dataset.action === 'check-point') {
      const { source, id, index } = event.target.dataset;
      if (source === 'active') { const answer = answerFor(state.active, id); answer.checked[Number(index)] = event.target.checked; persist(); }
      else if (modal?.report) modal.checks[Number(index)] = event.target.checked;
    }
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') { stopSpeech(); if (modal) closeModal(); }
    if (event.key === 'Tab' && modal) {
      const nodes = [...document.querySelectorAll('#modal-backdrop button, #modal-backdrop input:not(:disabled), #modal-backdrop summary')];
      const first = nodes[0]; const last = nodes[nodes.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
  });
  render();
})();
