const element = (tag, cls, text) => {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
};

function command(icon, label, action) {
  const button = element('button', 'collaboration-command');
  button.type = 'button';
  button.title = label;
  button.setAttribute('aria-label', label);
  const image = element('img');
  image.src = `/static/workspace/icons/${icon}.svg`;
  image.alt = '';
  button.append(image);
  button.onclick = action;
  return button;
}

export function createCollaboration(host) {
  let conversation = null, records = [], before = null, selected = null, detail = null;
  let request = 0, pageRequest = 0, detailVersion = null, loadingMore = false, paged = false, tab = 'result';
  const strip = element('div', 'collaboration-strip');
  strip.id = 'collaboration-status';
  strip.hidden = true;
  const opener = element('button', 'collaboration-open');
  opener.type = 'button';
  opener.title = '查看独立的 Agent 协作记录';
  opener.setAttribute('aria-controls', 'view-collaboration');
  strip.append(opener);
  document.querySelector('#messages').before(strip);

  const view = element('section', 'view collaboration-view');
  view.id = 'view-collaboration';
  view.hidden = true;
  const toolbar = element('div', 'collaboration-toolbar');
  const back = command('arrow-left', '返回对话', () => host.switchView('chat'));
  const heading = element('div');
  heading.append(element('h3', '', 'Agent 协作记录'));
  const caption = element('p');
  heading.append(caption);
  const refresh = command('refresh-cw', '刷新协作记录', () => reload());
  toolbar.append(back, heading, refresh);
  const layout = element('div', 'collaboration-layout');
  const navigator = element('div', 'collaboration-navigation');
  const list = element('div', 'collaboration-list');
  list.setAttribute('aria-label', '派发任务');
  const more = element('button', 'secondary', '加载更早协作');
  more.type = 'button';
  more.onclick = () => reload(true);
  navigator.append(list, more);
  const inspector = element('div', 'collaboration-inspector');
  const taskHeading = element('h4');
  const status = element('p', 'collaboration-task-status');
  const modes = element('div', 'collaboration-tabs');
  modes.setAttribute('aria-label', '记录内容');
  for (const [value, label] of [['task', '任务'], ['result', '回报'], ['files', '产物']]) {
    const button = element('button', '', label);
    button.type = 'button';
    button.dataset.tab = value;
    button.onclick = () => { tab = value; renderDetail(); };
    modes.append(button);
  }
  const content = element('div', 'collaboration-content');
  content.setAttribute('aria-live', 'polite');
  inspector.append(taskHeading, status, modes, content);
  layout.append(navigator, inspector);
  view.append(toolbar, layout);
  document.querySelector('#view-tasks').after(view);
  new MutationObserver(() => document.querySelector('#app').classList.toggle('collaboration-active', !view.hidden))
    .observe(view, { attributes: true, attributeFilter: ['hidden'] });

  const stateName = value => host.statusNames[value] || value;
  const routeName = row => `${row.source_label} → ${row.target_label}`;
  function renderStrip() {
    strip.hidden = !conversation || !records.length;
    const active = records.find(row => ['queued', 'running', 'needs_approval', 'waiting_children', 'reviewing'].includes(row.status)
      || ['queued', 'running', 'needs_approval'].includes(row.review_status));
    const row = active || records[0];
    opener.replaceChildren();
    if (!row) return;
    const image = element('img');
    image.src = '/static/workspace/icons/git-branch.svg';
    image.alt = '';
    const label = active?.review_status && ['queued', 'running', 'needs_approval'].includes(active.review_status)
      ? '发起者验收中' : stateName(row.status);
    opener.append(image, element('b', '', 'Agent 协作'), element('span', '', `${routeName(row)} · ${label}`),
      element('small', '', `${records.length}${before ? '+' : ''} 项`));
  }
  opener.onclick = () => {
    host.switchView('collaboration');
    renderList();
    if (records.length) select(selected || records[0].id);
  };
  function renderList() {
    caption.textContent = conversation?.title || '正在读取对话';
    list.replaceChildren();
    if (!records.length) list.append(element('p', '', '暂无协作记录'));
    for (const row of records) {
      const button = element('button', 'collaboration-row');
      button.type = 'button';
      button.dataset.task = row.id;
      button.classList.toggle('selected', row.id === selected);
      button.append(element('b', '', routeName(row)), element('span', '', stateName(row.status)),
        element('small', '', new Date(row.created * 1000).toLocaleString('zh-CN')));
      button.onclick = () => select(row.id);
      list.append(button);
    }
    more.hidden = !before;
    more.disabled = loadingMore;
  }
  function section(title, text) {
    const block = element('section', 'collaboration-text');
    block.append(element('h5', '', title), element('pre', '', text || '暂无文字回报'));
    content.append(block);
  }
  function actionButton(label, action, disabled = false) {
    const button = element('button', 'secondary', label);
    button.type = 'button';
    button.disabled = disabled;
    button.onclick = async () => {
      button.disabled = true;
      try { await action(); await reload(); }
      catch (error) { host.toast(error.message); button.disabled = false; }
    };
    return button;
  }
  function renderActions(row) {
    const actions = element('div', 'collaboration-actions');
    if (!row || !detail || !host.post) return actions;
    let approval = detail.task.approval;
    if (typeof approval === 'string') { try { approval = JSON.parse(approval); } catch (_) { approval = null; } }
    if (row.status === 'needs_approval' && approval) {
      actions.append(actionButton('允许本次', () => host.post(`/api/jobs/${encodeURIComponent(row.id)}/action`, {
        action: 'approve', allow: true, request_id: approval.request_id || approval.approval_id
      })), actionButton('拒绝', () => host.post(`/api/jobs/${encodeURIComponent(row.id)}/action`, {
        action: 'approve', allow: false, request_id: approval.request_id || approval.approval_id
      })));
    }
    if (['queued', 'running', 'needs_approval', 'waiting_children', 'reviewing'].includes(row.status)) {
      actions.append(actionButton('取消任务', () => host.post(`/api/jobs/${encodeURIComponent(row.id)}/action`, {action: 'cancel'})));
    }
    return actions;
  }
  function renderDetail() {
    content.replaceChildren();
    const row = records.find(item => item.id === selected);
    taskHeading.textContent = row ? routeName(row) : '选择一项协作';
    status.textContent = row ? `${stateName(row.status)}${row.review_status ? ' · 发起者验收：' + stateName(row.review_status) : ''}` : '';
    const actions = renderActions(row);
    for (const button of modes.children) button.setAttribute('aria-pressed', String(button.dataset.tab === tab));
    modes.hidden = !detail;
    if (actions.childElementCount) content.append(actions);
    if (!detail) return;
    if (tab === 'task') {
      section('派发目标', detail.task.prompt);
      content.append(element('p', 'collaboration-id', detail.task.id));
    } else if (tab === 'result') {
      section('执行者回报', detail.task.output || detail.task.error);
      if (detail.review) section('发起者验收', detail.review.output || detail.review.error || stateName(detail.review.status));
    } else {
      if (!detail.files.length) content.append(element('p', '', '暂无可读取的产物引用'));
      for (const file of detail.files) {
        const button = element('button', 'collaboration-file');
        button.type = 'button';
        button.title = file.path;
        button.append(element('b', '', file.name), element('small', '', file.path));
        button.onclick = () => host.openFile(file.path);
        content.append(button);
      }
    }
  }
  async function select(id) {
    const cid = conversation?.id, revision = ++request;
    if (!cid) return;
    selected = id;
    detail = null;
    const row = records.find(item => item.id === id);
    detailVersion = row ? `${row.updated}:${row.review_updated}` : null;
    renderList(); renderDetail();
    content.append(element('p', '', '正在读取协作记录…'));
    try {
      const data = await host.api(`/api/conversations/${encodeURIComponent(cid)}/collaborations/${encodeURIComponent(id)}`);
      if (revision !== request || cid !== conversation?.id) return;
      detail = data;
      const row = records.find(item => item.id === id);
      detailVersion = row ? `${row.updated}:${row.review_updated}` : null;
      renderDetail();
    } catch (error) {
      if (revision === request && cid === conversation?.id) {
        content.replaceChildren(element('p', '', `协作记录暂不可读：${error.message}`));
      }
    }
  }
  async function reload(older = false) {
    const cid = conversation?.id;
    if (!cid || (older && (!before || loadingMore))) return;
    const revision = ++pageRequest;
    loadingMore = true; more.disabled = refresh.disabled = true;
    try {
      const data = await host.api(`/api/conversations/${encodeURIComponent(cid)}/collaborations${older ? '?before=' + encodeURIComponent(before) : ''}`);
      if (revision !== pageRequest || cid !== conversation?.id) return;
      const merged = new Map((older ? records : []).map(row => [row.id, row]));
      for (const row of data.items) merged.set(row.id, row);
      records = [...merged.values()]; before = data.before; paged = older;
      renderStrip(); renderList();
      if (selected && records.some(row => row.id === selected)) select(selected);
    } catch (error) {
      if (revision === pageRequest && cid === conversation?.id) host.toast(error.message);
    } finally {
      if (revision === pageRequest) { loadingMore = false; more.disabled = refresh.disabled = false; }
    }
  }
  function sync(value, data) {
    const changed = conversation?.id !== value?.id;
    conversation = value;
    if (changed || !value) {
      request++; pageRequest++;
      selected = detail = detailVersion = null;
      records = []; before = null; loadingMore = paged = false; more.disabled = refresh.disabled = false;
      renderDetail();
    }
    if (data && data.conversation_id === value?.id) {
      if (paged) {
        const merged = new Map(records.map(row => [row.id, row]));
        for (const row of data.items) merged.set(row.id, row);
        records = [...merged.values()].sort((a, b) => b.created - a.created || b.id.localeCompare(a.id));
      } else { records = data.items; before = data.before; }
    }
    renderStrip();
    if (!view.hidden) {
      renderList();
      const row = records.find(item => item.id === selected);
      if (row && `${row.updated}:${row.review_updated}` !== detailVersion) select(row.id);
    }
  }
  renderDetail();
  return { sync, reset: () => sync(null, null) };
}
