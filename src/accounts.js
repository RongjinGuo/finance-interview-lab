(function (root) {
  'use strict';

  const clone = value => JSON.parse(JSON.stringify(value));
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const keyFor = (username, tabId) => `finance-interview-account-v1:${username}:${tabId}`;

  function createSync({ request, storage, onState, onStatus = () => {}, defaultState, delay = 2000, maxWait = 30000, tabId = 'default', recoveryTabId = null }) {
    const memoryDrafts = new Map();
    let user = null, cache = null, kind = 'locked', epoch = 0, saving = null, controller = null;
    let debounce = null, maximum = null, retry = null, localError = false;
    let serverSnapshot = null;
    const status = () => ({ kind: localError && !['expired', 'conflict'].includes(kind) ? 'local-error' : kind, localError, user, dirty: !!cache?.dirty, updatedAt: cache?.updatedAt || null, conflict: cache?.conflict || null });
    const emit = next => { if (next) kind = next; onStatus(status()); };
    function stopTimers() { clearTimeout(debounce); clearTimeout(maximum); clearTimeout(retry); debounce = maximum = retry = null; }
    function store() {
      if (!cache || !user) return;
      memoryDrafts.set(user.username, clone(cache));
      try { storage.setItem(keyFor(user.username, tabId), JSON.stringify(cache)); localError = false; }
      catch { localError = true; }
    }
    function schedule() {
      if (!cache?.dirty || cache.conflict || kind === 'expired') return;
      clearTimeout(debounce);
      debounce = setTimeout(() => flush(), delay);
      if (!maximum) maximum = setTimeout(() => flush(), maxWait);
    }
    function disconnect() {
      stopTimers(); epoch++; controller?.abort(); controller = null; saving = null;
      user = null; cache = null; serverSnapshot = null; localError = false; emit('locked');
    }
    function connect(nextUser, remote) {
      disconnect(); user = clone(nextUser);
      serverSnapshot = clone(remote);
      let local;
      try {
        local = JSON.parse(storage.getItem(keyFor(user.username, tabId)) || 'null');
        if (!local && recoveryTabId) local = JSON.parse(storage.getItem(keyFor(user.username, recoveryTabId)) || 'null');
      } catch { local = null; }
      if (memoryDrafts.get(user.username)?.dirty) local = clone(memoryDrafts.get(user.username));
      if (local?.username === user.username && local.dirty && local.state && Number.isInteger(local.revision)) {
        cache = local;
        if (!cache.pending && cache.revision !== remote.revision) cache.conflict = clone(remote);
      } else {
        cache = { username: user.username, revision: remote.revision, updatedAt: remote.updatedAt || null, state: clone(remote.state || defaultState()), dirty: false, version: 0, pending: null, conflict: null };
      }
      store(); onState(clone(cache.state)); emit(cache.conflict ? 'conflict' : cache.dirty ? 'pending' : 'saved');
      if (cache.dirty && !cache.conflict) schedule();
    }
    function save(state) {
      if (!user || !cache || same(state, cache.state)) return;
      cache.state = clone(state); cache.version = (cache.version || 0) + 1; cache.dirty = true; cache.draftUpdatedAt = new Date().toISOString();
      store(); emit(cache.conflict ? 'conflict' : saving ? 'saving' : 'pending'); schedule();
    }
    function flush() {
      stopTimers();
      if (saving) return saving;
      if (!user || !cache?.dirty || cache.conflict || kind === 'expired') return Promise.resolve(!cache?.dirty);
      const generation = epoch;
      const expectedAccount = user.username;
      const record = cache;
      controller = new AbortController();
      saving = (async () => {
        while (generation === epoch && record.dirty && !record.conflict) {
          if (!record.pending) record.pending = { revision: record.revision, mutationId: root.crypto?.randomUUID?.() || `m-${Date.now()}-${Math.random().toString(36).slice(2)}`, state: clone(record.state), version: record.version };
          const pending = record.pending;
          store(); emit('saving');
          try {
            const result = await request('/api/state', { method: 'PUT', signal: controller.signal, headers: { 'X-Finance-Account': expectedAccount }, body: { revision: pending.revision, mutationId: pending.mutationId, state: pending.state } });
            if (generation !== epoch) return false;
            serverSnapshot = clone(result);
            // A replay may return a later device's state; preserve this draft as a conflict.
            if (!same(result.state, pending.state)) { record.conflict = clone(result); record.pending = null; store(); emit('conflict'); return false; }
            record.revision = result.revision; record.updatedAt = result.updatedAt || null; record.pending = null;
            record.dirty = record.version !== pending.version || !same(record.state, pending.state);
            store(); emit(record.dirty ? 'pending' : 'saved');
          } catch (error) {
            if (generation !== epoch) return false;
            if (error.status === 409) { record.conflict = error.current || { revision: record.revision, state: null }; serverSnapshot = clone(record.conflict); record.pending = null; store(); emit('conflict'); }
            else if (error.status === 401) emit('expired');
            else { emit(error.status ? 'error' : 'offline'); retry = setTimeout(() => flush(), 15000); }
            return false;
          }
        }
        return !record.dirty;
      })().finally(() => { if (generation === epoch) { saving = null; controller = null; } });
      return saving;
    }
    async function keepLocal() {
      if (!cache?.conflict) return;
      cache.revision = cache.conflict.revision; cache.updatedAt = cache.conflict.updatedAt || null;
      cache.conflict = null; cache.pending = null; cache.dirty = true; store(); emit('pending');
      return flush();
    }
    function useServer() {
      if (!cache?.conflict) return;
      const remote = cache.conflict;
      cache.revision = remote.revision; cache.updatedAt = remote.updatedAt || null;
      cache.state = clone(remote.state || defaultState()); cache.conflict = null; cache.pending = null; cache.dirty = false; cache.version++;
      stopTimers(); store(); onState(clone(cache.state)); emit('saved');
    }
    function availableDrafts() {
      if (!user) return [];
      const drafts = [];
      const seen = new Set();
      try {
        const prefix = `finance-interview-account-v1:${user.username}`;
        for (let i = 0; i < storage.length; i++) {
          const key = storage.key(i);
          if (key === keyFor(user.username, tabId) || (key !== prefix && !key?.startsWith(`${prefix}:`))) continue;
          const saved = JSON.parse(storage.getItem(key) || 'null');
          if (saved?.username === user.username && saved.dirty && saved.state && Number.isInteger(saved.revision)) {
            const fingerprint = JSON.stringify(saved.state);
            if (!seen.has(fingerprint)) { drafts.push({ key, state: saved.state, updatedAt: saved.draftUpdatedAt || saved.updatedAt || null }); seen.add(fingerprint); }
          }
        }
      } catch { /* The current in-memory draft remains available if storage is inaccessible. */ }
      return drafts.sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
    }
    function restoreDraft(key) {
      if (!user || saving || !availableDrafts().some(draft => draft.key === key)) return false;
      let recovered; try { recovered = JSON.parse(storage.getItem(key)); } catch { return false; }
      if (cache.dirty) {
        try { storage.setItem(`${keyFor(user.username, tabId)}:backup:${Date.now()}-${Math.random().toString(36).slice(2)}`, JSON.stringify(cache)); }
        catch { localError = true; emit(); return false; }
      }
      cache = clone(recovered); cache.conflict = null;
      if (!cache.pending && cache.revision !== serverSnapshot.revision) cache.conflict = clone(serverSnapshot);
      stopTimers(); store(); onState(clone(cache.state)); emit(cache.conflict ? 'conflict' : 'pending');
      schedule(); return true;
    }
    return { connect, disconnect, save, flush, keepLocal, useServer, availableDrafts, restoreDraft, status, snapshot: () => cache ? clone(cache) : null };
  }

  if (typeof module === 'object' && module.exports) { module.exports = { createSync }; return; }
  if (!root.FinanceAccountConfig?.enabled) return;

  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const $ = id => document.getElementById(id);
  let sync, adapter, user = null, managerReturn = null, adminGeneration = 0;
  let adminSelected = null, adminEnvelope = null;
  const statusLabels = { saved: '已同步到云端', pending: '草稿已存本机 · 等待同步', saving: '正在保存到云端…', offline: '连接中断 · 草稿待同步', error: '云端保存失败 · 点击重试', conflict: '发现另一设备的更新', expired: '登录已过期 · 草稿已保留', 'local-error': '本机存储不可用 · 请立即保存或下载', locked: '请先登录' };
  async function api(path, options = {}) {
    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(), 60000);
    const abortFromCaller = () => timeout.abort();
    options.signal?.addEventListener('abort', abortFromCaller, { once: true });
    if (options.signal?.aborted) timeout.abort();
    try {
      const response = await fetch(path, { credentials: 'same-origin', cache: 'no-store', ...options, signal: timeout.signal, headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers }, ...(options.body ? { body: JSON.stringify(options.body) } : {}) });
      let body; try { body = await response.json(); } catch { body = {}; }
      if (!response.ok) throw Object.assign(new Error(typeof body.error === 'string' ? body.error : '请求未完成，请稍后重试。'), { status: response.status, current: body.current });
      return body;
    } finally { clearTimeout(timer); options.signal?.removeEventListener('abort', abortFromCaller); }
  }
  function notice(id, text) { const target = $(id); if (!target) return; target.textContent = text; target.hidden = !text; }
  function download(value, name, type = 'application/json') {
    const url = URL.createObjectURL(new Blob([typeof value === 'string' ? value : JSON.stringify(value, null, 2)], { type: `${type};charset=utf-8` }));
    const link = document.createElement('a'); link.href = url; link.download = name; document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function downloadDraft() { const draft = sync.snapshot(); if (draft) download(draft, `面试草稿-${draft.username}-${new Date().toISOString().slice(0, 10)}.json`); }
  function lock(reason = '') {
    user = null; closeManager(); sync?.disconnect(); adapter?.onLock?.();
    $('app').hidden = true; $('account-toolbar').hidden = true; $('account-conflict').hidden = true; $('account-other-drafts').hidden = true; $('account-gate').hidden = false;
    $('account-invite-code').disabled = false;
    $('account-invite-code').value = ''; $('account-login-submit').disabled = false; $('account-login-submit').textContent = '登录并继续练习 →';
    notice('account-login-error', reason); $('account-invite-code').focus();
  }
  async function enter(nextUser) {
    const remote = await api('/api/state', { headers: { 'X-Finance-Account': nextUser.username } });
    user = nextUser;
    $('account-gate').hidden = true; $('account-toolbar').hidden = false; $('app').hidden = false;
    $('account-current-user').textContent = `${user.displayName || user.username} · ${user.username}`;
    $('account-admin').hidden = user.role !== 'admin';
    sync.connect(user, remote); renderOtherDrafts(); $('account-invite-code').value = '';
  }
  function updateStatus(status) {
    $('account-sync-status').textContent = status.kind === 'saved' && !status.updatedAt ? '账号已连接 · 尚无云端记录' : statusLabels[status.kind] || '等待同步';
    $('account-sync-status').dataset.status = status.kind;
    $('account-save').disabled = status.kind === 'saving' || status.kind === 'conflict' || status.kind === 'locked';
    $('account-conflict').hidden = status.kind !== 'conflict';
    $('account-backup').hidden = !status.dirty;
    if (status.updatedAt && status.kind === 'saved') $('account-sync-status').title = new Date(status.updatedAt).toLocaleString('zh-CN');
    else $('account-sync-status').removeAttribute('title');
    if (status.kind === 'expired') queueMicrotask(() => lock('登录已过期，请使用原邀请码登录以继续同步本机草稿。'));
  }
  function renderOtherDrafts() {
    const drafts = sync?.availableDrafts() || [];
    $('account-other-drafts').hidden = !user || !drafts.length;
    $('account-draft-summary').textContent = `此浏览器还有 ${drafts.length} 份待同步草稿`;
    $('account-draft-list').innerHTML = drafts.map(draft => {
      const answers = Object.values(draft.state?.active?.answers || {});
      const excerpt = answers.find(answer => answer.text)?.text.slice(0, 90) || '包含练习设置、收藏或历史记录';
      return `<article class="account-stored-draft"><div><strong>${esc(draft.updatedAt ? new Date(draft.updatedAt).toLocaleString('zh-CN') : '之前保留的草稿')}</strong><p>${esc(excerpt)}</p></div><button type="button" class="button secondary small" data-account-draft="${esc(draft.key)}">载入这份草稿</button></article>`;
    }).join('');
  }
  function createChrome() {
    const host = document.createElement('div'); host.id = 'account-ui';
    host.innerHTML = `<section id="account-gate" class="account-gate" aria-labelledby="account-login-title"><div class="account-login-intro"><p class="eyebrow">FINANCE INTERVIEW LAB</p><h1 id="account-login-title">把每一次准备，<br>接着写下去。</h1><p>输入邀请码，保存回答与复盘，<br>在下一台设备继续上次的进度。</p><span class="account-login-leaf" aria-hidden="true">✳</span></div><section class="panel account-login-card"><span class="eyebrow">YOUR PRACTICE SPACE</span><h2>欢迎回来</h2><p class="muted">输入管理员提供的邀请码，即可继续。</p><form id="account-login-form"><label for="account-invite-code">邀请码</label><input id="account-invite-code" name="inviteCode" disabled type="text" inputmode="numeric" autocomplete="off" pattern="[0-9]{4,12}" minlength="4" maxlength="12" required aria-describedby="account-login-error"><p id="account-login-error" class="account-error" role="alert" hidden></p><button id="account-login-submit" class="button" type="submit" disabled>正在检查登录状态…</button></form><p class="account-login-note">需要邀请码？请联系管理员。</p></section></section>
      <header id="account-toolbar" class="account-toolbar" hidden><span id="account-current-user"></span><span id="account-sync-status" role="status" aria-live="polite"></span><div class="account-toolbar-actions"><button id="account-save" class="button secondary small" type="button">立即保存</button><button id="account-backup" class="link-button" type="button" hidden>下载草稿</button><button id="account-admin" class="link-button" type="button" hidden>用户与记录</button><button id="account-logout" class="link-button" type="button">退出登录</button></div></header>
      <section id="account-conflict" class="account-conflict" role="alert" hidden><div><strong>另一台设备已更新这份练习</strong><p>当前草稿已保留。请先下载备份，再选择以本机草稿覆盖云端，或载入云端记录。</p></div><div class="account-conflict-actions"><button id="account-download-draft" class="button secondary small" type="button">下载本机草稿</button><button id="account-keep-local" class="button small" type="button">保留本机并覆盖云端</button><button id="account-use-server" class="button secondary small" type="button">载入云端记录</button></div></section>`;
    host.insertAdjacentHTML('beforeend', '<details id="account-other-drafts" class="account-other-drafts" hidden><summary id="account-draft-summary"></summary><p>这些草稿来自其他页面。载入后可继续练习和同步，原草稿备份会保留。</p><div id="account-draft-list"></div><p id="account-draft-error" class="account-error" role="alert" hidden></p></details>');
    document.body.prepend(host); $('app').hidden = true;
    $('account-login-form').addEventListener('submit', async event => {
      event.preventDefault(); const button = $('account-login-submit'); button.disabled = true; button.textContent = '正在登录…'; notice('account-login-error', '');
      try { const result = await api('/api/login', { method: 'POST', body: { inviteCode: $('account-invite-code').value } }); await enter(result.user); }
      catch (error) { notice('account-login-error', error.status === 401 ? '邀请码不正确，请重新输入。' : error.status === 429 ? '登录尝试过于频繁，请稍后再试。' : error.message || '暂时无法连接，请稍后重试。'); }
      finally { button.disabled = false; button.textContent = '登录并继续练习 →'; }
    });
    $('account-save').addEventListener('click', () => { adapter.capture(); sync.flush(); });
    $('account-backup').addEventListener('click', () => { adapter.capture(); downloadDraft(); });
    $('account-draft-list').addEventListener('click', event => {
      const button = event.target.closest('[data-account-draft]');
      if (!button) return;
      adapter.capture();
      if (sync.status().kind === 'saving') { notice('account-draft-error', '请等待当前保存完成后再载入草稿。'); return; }
      if (!confirm('载入这份草稿继续练习？当前未同步草稿会另存为备份。')) return;
      notice('account-draft-error', sync.restoreDraft(button.dataset.accountDraft) ? '' : '草稿未能载入，请先下载当前草稿并重试。');
      renderOtherDrafts();
    });
    $('account-download-draft').addEventListener('click', downloadDraft);
    $('account-keep-local').addEventListener('click', () => { adapter.capture(); if (confirm('以当前本机草稿覆盖最新云端记录？建议先下载草稿备份。')) sync.keepLocal(); });
    $('account-use-server').addEventListener('click', () => { if (confirm('载入云端记录将替换当前本机草稿。已下载需要保留的草稿吗？')) sync.useServer(); });
    $('account-logout').addEventListener('click', async () => {
      adapter.capture(); const button = $('account-logout'); button.disabled = true;
      try {
        await sync.flush();
        if (sync.status().dirty && !confirm('还有未同步的草稿，已保存在此浏览器。退出后需要用同一邀请码登录才能继续同步。仍然退出？')) return;
        await api('/api/logout', { method: 'POST' }); lock();
      } catch (error) { if (error.status === 401) lock(); else { notice('account-toolbar-error', '退出失败，请检查网络后重试。'); root.alert('退出失败，请检查网络后重试。'); } }
      finally { button.disabled = false; }
    });
    $('account-admin').addEventListener('click', openManager);
    root.addEventListener('online', () => sync.flush());
    root.addEventListener('storage', event => { if (user && event.key?.startsWith(`finance-interview-account-v1:${user.username}:`)) renderOtherDrafts(); });
    root.addEventListener('beforeunload', event => { if (sync.status().dirty) { event.preventDefault(); event.returnValue = ''; } });
  }

  function closeManager() {
    adminGeneration++; $('account-manager')?.remove(); adminSelected = null; adminEnvelope = null; document.body.style.overflow = '';
    if (managerReturn?.isConnected) managerReturn.focus();
  }
  async function loadUsers() {
    const generation = adminGeneration;
    try {
      const { users } = await api('/api/admin/users');
      if (generation !== adminGeneration || !$('account-user-list')) return;
      $('account-user-list').innerHTML = users.map(item => `<button type="button" class="account-user-button" data-account-user="${esc(item.username)}"><strong>${esc(item.displayName || item.username)}</strong><small>${esc(item.username)}${item.role === 'admin' ? ' · 管理员' : ''}</small></button>`).join('');
      $('account-user-total').textContent = `${users.length} 个账号`;
    } catch (error) { if (generation === adminGeneration) { if (error.status === 401) lock('请重新登录。'); else notice('account-manager-error', error.message); } }
  }
  async function readUser(username) {
    const generation = ++adminGeneration; adminSelected = username; adminEnvelope = null;
    $('account-user-records').innerHTML = '<p class="muted">正在读取练习记录…</p>';
    try {
      const envelope = await api(`/api/admin/users/${encodeURIComponent(username)}/state`);
      if (generation !== adminGeneration || !$('account-user-records')) return;
      adminEnvelope = envelope;
      for (const button of document.querySelectorAll('[data-account-user]')) button.classList.toggle('selected', button.dataset.accountUser === username);
      const sessions = [envelope.state?.active, ...(envelope.state?.history || [])].filter(Boolean);
      const bank = new Map(root.FinanceQuestions.questions.map(q => [q.id, q]));
      $('account-user-records').innerHTML = `<div class="account-record-heading"><div><h3>${esc(username)} 的练习记录</h3><p class="muted">${envelope.updatedAt ? `最近同步 ${esc(new Date(envelope.updatedAt).toLocaleString('zh-CN'))}` : '尚未保存云端练习'}</p></div>${envelope.state ? '<button id="account-export-user" type="button" class="button secondary small">导出全部记录 JSON</button>' : ''}</div>${sessions.length ? sessions.map((session, index) => `<details class="account-session" ${index === 0 ? 'open' : ''}><summary>${esc(root.FinanceQuestions.roles.find(role => role.id === session.role)?.name || session.role)} · ${session.phase === 'finished' ? '已完成' : '练习中'} · ${esc(new Date(session.createdAt).toLocaleDateString('zh-CN'))} · ${session.questionIds.length} 题</summary>${session.questionIds.map((id, i) => { const question = bank.get(id), answer = session.answers[id]; return `<article class="account-answer"><h4>${i + 1}. ${esc(question?.title || id)}</h4><p class="account-answer-prompt">${esc(question?.prompt || '')}</p><div class="account-answer-text">${esc(answer?.text || (answer?.skipped ? '本题已跳过。' : '尚未作答。'))}</div><small>${answer?.reviewed ? `已自评 · ${answer.checked.filter(Boolean).length}/${answer.checked.length} 个要点` : '尚未自评'} · ${Math.round(answer?.seconds || 0)} 秒</small></article>`; }).join('')}</details>`).join('') : '<div class="account-record-empty">这个账号还没有练习回答。</div>'}`;
      $('account-export-user')?.addEventListener('click', () => download(adminEnvelope, `面试记录-${adminSelected}.json`));
    } catch (error) { if (generation === adminGeneration) { if (error.status === 401) lock('请重新登录。'); else notice('account-manager-error', error.message); } }
  }
  function openManager() {
    if (user?.role !== 'admin') return;
    adapter.capture(); sync.flush(); managerReturn = document.activeElement; adminGeneration++;
    const modal = document.createElement('div'); modal.id = 'account-manager'; modal.className = 'account-manager-backdrop';
    modal.innerHTML = `<section class="account-manager" role="dialog" aria-modal="true" aria-labelledby="account-manager-title"><header class="account-manager-header"><div><span class="eyebrow">PRACTICE MANAGEMENT</span><h2 id="account-manager-title">用户与练习记录</h2></div><button id="account-manager-close" class="button secondary small" type="button">关闭</button></header><p id="account-manager-error" class="account-error" role="alert" hidden></p><div class="account-manager-grid"><aside><details class="account-create"><summary>创建练习账号</summary><form id="account-create-user"><label for="new-username">用户名</label><input id="new-username" name="username" required pattern="[a-z0-9][a-z0-9_-]{2,31}" minlength="3" maxlength="32" autocomplete="off" placeholder="3–32 位小写字母、数字、_ 或 -"><label for="new-display-name">显示名称</label><input id="new-display-name" name="displayName" required maxlength="80" autocomplete="off"><label for="new-invite-code">邀请码</label><input id="new-invite-code" name="inviteCode" type="text" inputmode="numeric" autocomplete="off" pattern="[0-9]{4,12}" required minlength="4" maxlength="12"><small>设置 4–12 位数字邀请码，请单独告知使用者。</small><button class="button" type="submit">创建账号</button><p id="account-create-status" role="status" hidden></p></form></details><div class="account-user-heading"><h3>全部账号</h3><span id="account-user-total"></span></div><div id="account-user-list"><p class="muted">正在加载…</p></div></aside><section id="account-user-records" class="account-user-records"><div class="account-record-empty">选择一个账号，查看每一道题的回答与自评。</div></section></div></section>`;
    document.body.append(modal); document.body.style.overflow = 'hidden'; $('account-manager-close').focus();
    $('account-manager-close').addEventListener('click', closeManager);
    $('account-user-list').addEventListener('click', event => { const button = event.target.closest('[data-account-user]'); if (button) readUser(button.dataset.accountUser); });
    $('account-create-user').addEventListener('submit', async event => {
      event.preventDefault(); const button = event.target.querySelector('button'); button.disabled = true; notice('account-manager-error', '');
      const username = $('new-username').value.trim();
      try { await api('/api/admin/users', { method: 'POST', body: { username, displayName: $('new-display-name').value.trim(), inviteCode: $('new-invite-code').value } }); event.target.reset(); notice('account-create-status', `账号 ${username} 已创建。`); await loadUsers(); }
      catch (error) { if (error.status === 401) lock('请重新登录。'); else notice('account-manager-error', error.message); }
      finally { button.disabled = false; }
    });
    modal.addEventListener('keydown', event => {
      if (event.key === 'Escape') { event.stopPropagation(); closeManager(); }
      if (event.key === 'Tab') {
        const nodes = [...modal.querySelectorAll('button:not(:disabled), input, summary')].filter(node => node.getClientRects().length);
        if (event.shiftKey && document.activeElement === nodes[0]) { event.preventDefault(); nodes.at(-1)?.focus(); }
        else if (!event.shiftKey && document.activeElement === nodes.at(-1)) { event.preventDefault(); nodes[0]?.focus(); }
      }
    });
    loadUsers();
  }
  root.FinanceAccounts = {
    enabled: true,
    start(nextAdapter) {
      adapter = nextAdapter; createChrome();
      let browserStorage; try { browserStorage = root.localStorage; } catch { browserStorage = { getItem: () => null, setItem: () => { throw new Error('Storage unavailable'); } }; }
      const tabId = root.crypto.randomUUID();
      let recoveryTabId = null;
      try {
        recoveryTabId = root.sessionStorage.getItem('finance-interview-tab-id');
        root.sessionStorage.setItem('finance-interview-tab-id', tabId);
      } catch { /* Recovery remains available through the per-account draft list. */ }
      sync = createSync({ request: api, storage: browserStorage, tabId, recoveryTabId, defaultState: adapter.defaultState, onState: adapter.onState, onStatus: updateStatus });
      api('/api/session').then(result => enter(result.user)).catch(error => lock(error.status === 401 ? '' : '暂时无法连接，请稍后登录。'));
    },
    save: state => sync?.save(state), flush: () => sync?.flush(),
    isReady: () => !!user,
    isOverlayOpen: () => !!$('account-manager'),
    captureStatus: () => sync?.status()
  };
})(typeof window === 'undefined' ? globalThis : window);
