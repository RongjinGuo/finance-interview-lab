(() => {
  'use strict';

  const element = (id) => document.getElementById(id);
  const state = { filters: { q: '', from: '', to: '' }, page: 1, pages: 1, total: 0, busy: false, requestId: 0, controller: null };
  const number = new Intl.NumberFormat('zh-CN');
  const dateTime = new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
  const count = (value) => Math.max(0, Number.isFinite(Number(value)) ? Math.trunc(Number(value)) : 0);

  class ApiError extends Error {
    constructor(status) {
      super(status === 429 ? '登录尝试过于频繁，请稍后再试。' : status === 400 ? '筛选条件有误，请检查日期和搜索内容。' : '暂时无法连接服务，请稍后重试。');
      this.status = status;
    }
  }

  async function request(path, options = {}) {
    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(), 20000);
    try {
      const signal = options.signal ? AbortSignal.any([options.signal, timeout.signal]) : timeout.signal;
      const response = await fetch(path, { ...options, credentials: 'same-origin', cache: 'no-store', signal });
      if (!response.ok) throw new ApiError(response.status);
      return response;
    } finally {
      clearTimeout(timer);
    }
  }

  function message(id, text) {
    const target = element(id);
    target.textContent = text;
    target.hidden = !text;
  }

  function queryString(filters = state.filters, page = state.page) {
    const query = new URLSearchParams({ page: String(page) });
    for (const [key, value] of Object.entries(filters)) if (value) query.set(key, value);
    return query.toString();
  }

  function setBusy(busy) {
    state.busy = busy;
    element('dashboard').setAttribute('aria-busy', String(busy));
    element('records-region').setAttribute('aria-busy', String(busy));
    for (const id of ['refresh-visits', 'apply-filters', 'reset-filters', 'export-visits']) element(id).disabled = busy;
    element('previous-page').disabled = busy || state.page <= 1;
    element('next-page').disabled = busy || state.page >= state.pages;
    element('refresh-visits').textContent = busy ? '正在刷新…' : '刷新记录';
  }

  function showLogin(reason = '', focus = true) {
    state.requestId += 1;
    state.controller?.abort();
    element('session-check').hidden = true;
    element('dashboard').hidden = true;
    element('login-section').hidden = false;
    element('visits-body').replaceChildren();
    element('top-regions').replaceChildren();
    for (const target of document.querySelectorAll('.summary-card strong')) target.textContent = '—';
    element('admin-password').value = '';
    message('login-error', reason);
    message('dashboard-error', '');
    setBusy(false);
    if (focus) element('admin-password').focus();
  }

  function showDashboard() {
    element('session-check').hidden = true;
    element('login-section').hidden = true;
    element('dashboard').hidden = false;
    element('admin-password').value = '';
    element('dashboard-title').focus();
  }

  function handleError(error) {
    if (error.status === 401) {
      showLogin('登录已过期，请重新登录。');
      return;
    }
    message('dashboard-error', `${error instanceof ApiError ? error.message : '请求未完成，请检查网络后重试。'} 当前显示的记录尚未更新。`);
  }

  function cell(text, className = '') {
    const target = document.createElement('td');
    target.textContent = String(text || '—');
    if (className) target.className = className;
    return target;
  }

  function render(data) {
    state.page = Math.max(1, count(data.page));
    state.pages = Math.max(1, count(data.pages));
    state.total = count(data.total);
    const summary = data.summary || {};
    for (const [id, value] of [['summary-visits', summary.visits], ['summary-unique-ips', summary.uniqueIps], ['summary-today', summary.todayVisits]]) {
      const target = document.querySelector(`[data-testid="${id}"]`);
      target.textContent = number.format(count(value));
      target.classList.toggle('compact', target.textContent.length > 5);
    }

    const regions = element('top-regions');
    regions.replaceChildren();
    const topRegions = Array.isArray(summary.topRegions) ? summary.topRegions.slice(0, 5) : [];
    const maximum = Math.max(1, ...topRegions.map((region) => count(region.count)));
    for (const region of topRegions) {
      const row = document.createElement('li');
      const bar = document.createElement('span');
      bar.className = 'region-bar';
      bar.setAttribute('aria-hidden', 'true');
      bar.style.width = `${Math.max(3, count(region.count) / maximum * 100)}%`;
      const name = document.createElement('span');
      name.className = 'region-name';
      name.textContent = String(region.region || '未知地区');
      const amount = document.createElement('span');
      amount.className = 'region-count';
      amount.textContent = number.format(count(region.count));
      row.append(bar, name, amount);
      regions.append(row);
    }
    if (!topRegions.length) {
      const empty = document.createElement('li');
      empty.className = 'region-empty';
      empty.textContent = '暂无地区数据';
      regions.append(empty);
    }

    const rows = document.createDocumentFragment();
    const items = Array.isArray(data.items) ? data.items : [];
    for (const visit of items) {
      const row = document.createElement('tr');
      row.dataset.testid = 'visit-row';
      const date = new Date(visit.time);
      const time = cell(Number.isNaN(date.getTime()) ? '未知时间' : dateTime.format(date));
      const location = cell(visit.location || [visit.country, visit.region, visit.city].filter(Boolean).join(' · ') || '未知地区');
      const device = cell(visit.browser || '未知浏览器');
      const system = document.createElement('span');
      system.className = 'cell-secondary';
      system.textContent = String(visit.os || '未知系统');
      device.append(system);
      row.append(time, cell(visit.ip, 'ip-cell'), location, device, cell(visit.path, 'path-cell'));
      rows.append(row);
    }
    element('visits-body').replaceChildren(rows);
    element('records-empty').hidden = items.length > 0;
    const hasFilters = Object.values(state.filters).some(Boolean);
    element('records-empty').querySelector('h3').textContent = hasFilters ? '没有符合条件的访问' : '暂无访问记录';
    element('records-empty').querySelector('p').textContent = hasFilters ? '试试其他关键词，或重置筛选条件。' : '网站有新访问后，点击“刷新记录”即可查看。';
    const first = items.length ? (state.page - 1) * Math.max(1, count(data.pageSize)) + 1 : 0;
    element('records-count').textContent = items.length ? `共 ${number.format(state.total)} 条 · 显示 ${number.format(first)}–${number.format(first + items.length - 1)} 条` : '共 0 条记录';
    element('page-label').textContent = `第 ${state.page} / ${state.pages} 页`;
    element('retention-note').textContent = `保留最近 ${count(data.retentionDays) || 90} 天，最多 100,000 条记录；统计随筛选条件更新。`;
    element('last-updated').textContent = `更新于 ${dateTime.format(new Date())}`;
    element('dashboard-status').textContent = `已更新，共 ${number.format(state.total)} 条访问记录，第 ${state.page} 页。`;
  }

  async function loadVisits(page = state.page, filters = state.filters) {
    const requestId = ++state.requestId;
    state.controller?.abort();
    state.controller = new AbortController();
    setBusy(true);
    message('dashboard-error', '');
    element('dashboard-status').textContent = '正在加载访问记录。';
    try {
      const response = await request(`/api/admin/visits?${queryString(filters, page)}`, { signal: state.controller.signal });
      const data = await response.json();
      if (requestId !== state.requestId) return;
      state.filters = { ...filters };
      render(data);
    } catch (error) {
      if (requestId !== state.requestId) return;
      handleError(error);
      element('dashboard-status').textContent = '加载未完成。';
    } finally {
      if (requestId === state.requestId) setBusy(false);
    }
  }

  element('login-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = element('login-submit');
    button.disabled = true;
    button.textContent = '正在登录…';
    message('login-error', '');
    try {
      await request('/api/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: element('admin-password').value }) });
      showDashboard();
      await loadVisits(1);
    } catch (error) {
      message('login-error', error.status === 401 ? '密码不正确，请重新输入。' : error instanceof ApiError ? error.message : '暂时无法连接服务，请检查网络后重试。');
      element('admin-password').focus();
    } finally {
      button.disabled = false;
      button.textContent = '登录后台 →';
    }
  });

  element('filters-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const filters = { q: element('filter-q').value.trim(), from: element('filter-from').value, to: element('filter-to').value };
    if (filters.from && filters.to && filters.from > filters.to) {
      message('dashboard-error', '开始日期不能晚于结束日期。');
      element('filter-from').focus();
      return;
    }
    loadVisits(1, filters);
  });
  element('reset-filters').addEventListener('click', () => {
    element('filters-form').reset();
    loadVisits(1, { q: '', from: '', to: '' });
  });
  element('refresh-visits').addEventListener('click', () => loadVisits());
  element('previous-page').addEventListener('click', () => loadVisits(state.page - 1));
  element('next-page').addEventListener('click', () => loadVisits(state.page + 1));

  element('export-visits').addEventListener('click', async () => {
    const button = element('export-visits');
    button.disabled = true;
    button.textContent = '正在导出…';
    message('dashboard-error', '');
    try {
      const response = await request(`/api/admin/export?${queryString()}`);
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement('a');
      link.href = url;
      link.download = `访问记录-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      element('dashboard-status').textContent = '已导出当前筛选条件下的全部访问记录。';
    } catch (error) {
      handleError(error);
    } finally {
      button.disabled = state.busy;
      button.textContent = '导出 CSV';
    }
  });

  element('logout').addEventListener('click', async () => {
    const button = element('logout');
    button.disabled = true;
    try {
      await request('/api/admin/logout', { method: 'POST' });
      showLogin();
    } catch (error) {
      if (error.status === 401) showLogin();
      else handleError(error);
    } finally {
      button.disabled = false;
    }
  });

  async function initialize() {
    try {
      await request('/api/admin/session');
      showDashboard();
      await loadVisits(1);
    } catch (error) {
      showLogin(error.status === 401 ? '' : '暂时无法检查登录状态，请尝试登录。', false);
    }
  }

  initialize();
})();
