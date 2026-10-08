import { previewScopeKey } from './preview-policy.mjs';

const node = (tag, className, text) => {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
};

function iconButton(icon, label, action) {
  const button = node('button', 'file-icon-button');
  button.type = 'button';
  button.title = label;
  button.setAttribute('aria-label', label);
  const image = node('img');
  image.src = `/static/workspace/icons/${icon}.svg`;
  image.alt = '';
  button.append(image);
  button.onclick = action;
  return button;
}

const readableSize = bytes => bytes < 1024 ? `${bytes} B`
  : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;

export function createFileWorkspace(host) {
  const chat = document.querySelector('#view-chat');
  const app = document.querySelector('#app');
  const primary = node('div', 'file-chat-primary');
  primary.append(...chat.childNodes);
  chat.classList.add('file-workbench');
  const panel = node('aside', 'file-panel');
  panel.id = 'file-panel';
  panel.setAttribute('aria-label', '当前对话文件');
  panel.hidden = true;
  chat.append(primary, panel);
  const scopes = new Map();
  let conversation = null, key = null, open = false, maximized = false;
  let request = 0, listRequest = 0, openRequest = 0, listPending = false, referencePending = false;

  const current = () => key ? scopes.get(key) : null;
  const activeTab = () => current()?.tabs.find(tab => tab.id === current().active);
  const heading = node('div', 'file-panel-heading');
  const headingCopy = node('div');
  headingCopy.append(node('h3', '', '文件工作面'));
  const caption = node('p', 'file-scope-caption');
  headingCopy.append(caption);
  heading.append(headingCopy,
    iconButton('maximize-2', '放大文件工作面', () => { maximized = !maximized; updateLayout(); }),
    iconButton('x', '收起文件工作面', () => setOpen(false)));
  const toolbar = node('div', 'file-panel-toolbar');
  const refButton = iconButton('file-plus-2', '引用文件', () => {
    referenceForm.hidden = !referenceForm.hidden;
    if (!referenceForm.hidden) pathInput.focus();
  });
  const listRefresh = iconButton('refresh-cw', '刷新当前对话文件', () => loadList());
  const fileCount = node('span', 'file-count');
  toolbar.append(refButton, listRefresh, fileCount, node('span', 'file-mode-label', '只读'));
  const referenceForm = node('form', 'file-reference-form');
  referenceForm.hidden = true;
  const pathLabel = node('label', '', '文件绝对路径');
  const pathInput = node('input');
  pathInput.id = 'workspace-file-path';
  pathInput.placeholder = 'C:\\Users\\11710\\Desktop\\工作区\\…';
  pathInput.autocomplete = 'off';
  pathInput.required = true;
  pathLabel.append(pathInput);
  const referenceSubmit = node('button', 'secondary', '加入当前对话');
  referenceSubmit.type = 'submit';
  referenceForm.append(pathLabel, referenceSubmit);
  const fileList = node('div', 'file-list');
  fileList.setAttribute('aria-label', '文件列表');
  const listStatus = node('p', 'file-list-status');
  listStatus.setAttribute('role', 'status');
  const tabs = node('div', 'file-tabs');
  tabs.setAttribute('role', 'tablist');
  tabs.setAttribute('aria-label', '打开的文件');
  const viewerToolbar = node('div', 'file-viewer-toolbar');
  const fileTitle = node('b', 'file-viewer-title');
  const refreshFile = iconButton('refresh-cw', '重新读取文件版本', () => {
    const tab = activeTab();
    if (tab) loadTab(tab);
  });
  const download = node('a', 'file-icon-button');
  download.title = '下载原文件';
  download.setAttribute('aria-label', '下载原文件');
  const downloadIcon = node('img');
  downloadIcon.src = '/static/workspace/icons/download.svg';
  downloadIcon.alt = '';
  download.append(downloadIcon);
  const quoteFile = iconButton('file-input', '将文件路径加入输入框', () => {
    const tab = activeTab();
    if (tab) {
      host.reference(tab.path);
      maximized = false;
      chat.dataset.fileMode = 'chat';
      updateLayout();
    }
  });
  viewerToolbar.append(fileTitle, refreshFile, download, quoteFile);
  const version = node('p', 'file-version');
  const viewer = node('div', 'file-viewer');
  panel.append(heading, toolbar, referenceForm, fileList, listStatus, tabs, viewerToolbar, version, viewer);
  const opener = iconButton('panel-right', '打开文件工作面', () => setOpen(!open));
  opener.id = 'file-workspace-open';
  opener.setAttribute('aria-controls', 'file-panel');
  document.querySelector('.conversation-controls').append(opener);
  const modes = node('div', 'file-view-modes');
  modes.setAttribute('aria-label', '工作视图');
  for (const [mode, title] of [['chat', '对话'], ['files', '文件']]) {
    const button = node('button', '', title);
    button.type = 'button';
    button.dataset.mode = mode;
    button.onclick = () => { maximized = false; chat.dataset.fileMode = mode; updateLayout(); };
    modes.append(button);
  }
  primary.prepend(modes);

  function updateLayout() {
    const visible = open && !chat.hidden;
    app.classList.toggle('files-open', visible);
    chat.classList.toggle('files-maximized', visible && maximized);
    panel.hidden = !open;
    modes.hidden = !open;
    opener.setAttribute('aria-expanded', String(open));
    for (const button of modes.children) {
      button.setAttribute('aria-pressed', String(button.dataset.mode === chat.dataset.fileMode));
    }
    const maximizeButton = heading.querySelector('button');
    maximizeButton.title = maximized ? '恢复对话与文件分栏' : '放大文件工作面';
    maximizeButton.setAttribute('aria-label', maximizeButton.title);
    if (!visible) viewer.replaceChildren();
  }

  function setOpen(value) {
    open = value;
    if (!open) { request++; openRequest++; maximized = false; }
    if (open) chat.dataset.fileMode = 'files';
    updateLayout();
    if (open) {
      loadList();
      const tab = activeTab();
      if (tab) loadTab(tab); else renderEmpty();
    }
  }

  function renderEmpty(text = '尚未打开文件') {
    viewer.replaceChildren(node('div', 'file-empty', text));
    if (!activeTab()) {
      fileTitle.textContent = '';
      version.textContent = '';
      download.hidden = refreshFile.hidden = quoteFile.hidden = true;
    }
  }

  function renderTabs() {
    tabs.replaceChildren();
    for (const tab of current()?.tabs || []) {
      const container = node('div', 'file-tab');
      container.classList.toggle('active', tab.id === current().active);
      const select = node('button', 'file-tab-select', tab.name);
      select.type = 'button';
      select.title = tab.path;
      select.setAttribute('role', 'tab');
      select.setAttribute('aria-selected', String(tab.id === current().active));
      select.onclick = () => { current().active = tab.id; renderTabs(); loadTab(tab); };
      const close = iconButton('x', `关闭 ${tab.name}`, () => {
        request++;
        const state = current();
        state.tabs = state.tabs.filter(item => item.id !== tab.id);
        if (state.active === tab.id) state.active = state.tabs.at(-1)?.id || null;
        renderTabs();
        const selected = activeTab();
        if (selected) loadTab(selected); else renderEmpty();
      });
      container.append(select, close);
      tabs.append(container);
    }
  }

  function renderList(items) {
    fileList.replaceChildren();
    fileCount.textContent = `${items.length} 个文件`;
    for (const item of items) {
      const row = node('div', 'file-list-row');
      const button = node('button', 'file-list-open');
      button.type = 'button';
      button.title = item.path;
      button.append(node('b', '', item.name), node('small', '', `${item.kind.toUpperCase()} · ${readableSize(item.size)}`));
      button.onclick = () => openItem(item);
      row.append(button);
      if (item.referenced) row.append(iconButton('x', '移除引用，不删除文件', async () => {
        const cid = conversation?.id;
        try {
          await host.post('/api/workspace/files/forget', { conversation_id: cid, path: item.path });
          if (cid === conversation?.id) loadList();
        } catch (error) { host.toast(error.message); }
      }));
      fileList.append(row);
    }
  }

  async function loadList() {
    const cid = conversation?.id, targetKey = key;
    if (!cid) { listStatus.textContent = '请先选择对话'; return; }
    const revision = ++listRequest;
    listPending = true;
    listRefresh.disabled = true;
    listStatus.textContent = '正在读取文件引用…';
    try {
      const data = await host.api(`/api/workspace/files?conversation_id=${encodeURIComponent(cid)}`);
      if (revision !== listRequest || targetKey !== key) return;
      renderList(data.items);
      listStatus.textContent = data.unreadable_references ? `${data.unreadable_references} 个引用已失效或暂不可读`
        : data.older_outputs_not_scanned ? '已读取最近200项任务的文件引用'
          : data.items.length ? '' : '当前对话暂无文件';
    } catch (error) {
      if (revision === listRequest && targetKey === key) {
        fileList.replaceChildren();
        listStatus.textContent = `未读到文件列表：${error.message}`;
      }
    } finally {
      if (revision === listRequest) { listPending = false; listRefresh.disabled = false; }
    }
  }

  async function loadTab(tab) {
    const cid = conversation?.id, targetKey = key, revision = ++request;
    if (!cid || !open || chat.hidden) return;
    fileTitle.textContent = tab.name;
    download.href = `/api/workspace/files/download?${new URLSearchParams({ conversation_id: cid, path: tab.path })}`;
    download.hidden = false;
    refreshFile.hidden = quoteFile.hidden = false;
    refreshFile.disabled = true;
    version.textContent = '正在读取版本…';
    renderEmpty('正在打开文件…');
    try {
      const data = await host.post('/api/workspace/files/preview', { conversation_id: cid, path: tab.path });
      if (revision !== request || targetKey !== key || activeTab()?.id !== tab.id || !open || chat.hidden) return;
      const previous = tab.mtime;
      Object.assign(tab, data.item);
      version.textContent = `${previous && previous !== tab.mtime ? '已读取更新版本 · ' : ''}${readableSize(tab.size)} · ${new Date(tab.mtime / 1000000).toLocaleString('zh-CN')}`;
      if (data.status !== 'ready' || !data.url) { renderEmpty(data.reason || '此格式暂不可预览'); return; }
      const source = new URL(data.url, location.origin);
      if (!source.pathname.startsWith('/preview/')) throw Error('预览地址无效');
      const frame = node('iframe', 'file-preview-frame');
      frame.title = tab.name;
      frame.src = source.pathname + source.search;
      frame.setAttribute('referrerpolicy', 'no-referrer');
      // The generated wrapper is trusted; raw HTML/SVG remains sandboxed by the publisher.
      viewer.replaceChildren(frame);
    } catch (error) {
      if (revision === request && targetKey === key) {
        version.textContent = '文件暂不可读';
        renderEmpty(error.message);
      }
    } finally {
      if (revision === request) refreshFile.disabled = false;
    }
  }

  function openItem(item) {
    const state = current();
    if (!state) return;
    let tab = state.tabs.find(tab => tab.id === item.id);
    if (!tab) {
      if (state.tabs.length >= 8) { host.toast('最多打开8个文件标签，请先关闭不用的标签'); return; }
      tab = { ...item };
      state.tabs.push(tab);
    }
    state.active = tab.id;
    if (!open) { open = true; updateLayout(); }
    chat.dataset.fileMode = 'files';
    updateLayout();
    renderTabs();
    loadTab(tab);
  }

  async function openPath(path) {
    const cid = conversation?.id, targetKey = key, revision = ++openRequest;
    if (!cid) { host.toast('请先选择当前对话'); return; }
    setOpen(true);
    try {
      const data = await host.post('/api/workspace/files/reference', { conversation_id: cid, path });
      if (revision !== openRequest || targetKey !== key || cid !== conversation?.id || !open || chat.hidden) return;
      referenceForm.hidden = true;
      openItem(data.item);
      loadList();
    } catch (error) { if (targetKey === key) host.toast(error.message); }
  }

  referenceForm.onsubmit = async event => {
    event.preventDefault();
    if (referencePending) return;
    referencePending = true;
    referenceSubmit.disabled = true;
    try { await openPath(pathInput.value.trim()); }
    finally { referencePending = false; referenceSubmit.disabled = false; }
  };

  function sync(value) {
    const next = previewScopeKey(null, value?.id);
    caption.textContent = value?.title || '未选择对话';
    conversation = value;
    opener.disabled = !value?.id;
    if (next === key) return;
    request++; listRequest++; openRequest++;
    key = next;
    referenceForm.hidden = true;
    pathInput.value = '';
    maximized = false;
    if (key && !scopes.has(key)) {
      if (scopes.size >= 12) scopes.delete(scopes.keys().next().value);
      scopes.set(key, { tabs: [], active: null });
    }
    fileList.replaceChildren(); fileCount.textContent = ''; listStatus.textContent = '';
    listPending = false; listRefresh.disabled = false;
    renderTabs(); renderEmpty(); updateLayout();
    if (open && !chat.hidden) {
      loadList();
      if (activeTab()) loadTab(activeTab());
    }
  }

  new MutationObserver(() => {
    updateLayout();
    if (!chat.hidden && open && activeTab()) loadTab(activeTab());
  }).observe(chat, { attributes: true, attributeFilter: ['hidden'] });
  updateLayout(); renderEmpty();
  return { sync, openPath, reset: () => { setOpen(false); sync(null); scopes.clear(); },
    refresh: () => { if (open && !listPending) loadList(); } };
}
