window.TONGZHOU_PREVIEW = true;

const $ = selector => document.querySelector(selector);
const names = {
  chat: '协作对话', collaboration: 'Agent 协作记录', tasks: '任务看板', flows: '工作流',
  notes: '笔记库', artifacts: '产物', agents: 'Agent 管理', projection: 'Codex 原生',
  feishu: '飞书 Hermes', skills: '插件与 Skills', rooms: 'Agent 群聊',
};

$('#login').hidden = true;
$('#app').hidden = false;
$('#preview-banner').hidden = false;
$('#preview-banner').textContent = '只读界面演示 · 示例数据 · 不连接工作台服务、不执行任务或远控';
$('#connection').textContent = '● 离线演示';
$('#connection').style.color = 'var(--muted)';
$('#active-count').textContent = '2';
$('#conversation-title').textContent = '山河居 · 个人网站展示';
$('#conversation-origin').textContent = '本地界面预览 · 示例内容';
$('#model-label').textContent = 'Hermes · 工作台界面演示';
$('#agent-readiness').textContent = '离线预览，不连接执行器';
$('#vault-label').textContent = '只显示界面样例 · 不读取本机笔记';
$('.composer-note').textContent = '只读界面预览，不发送消息，不连接本机 Agent 或模型。';

function node(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text) element.textContent = text;
  return element;
}

function fillMessages() {
  const messages = $('#messages');
  messages.replaceChildren();
  for (const [role, speaker, text] of [
    ['user', '你', '我准备在创新创业课上展示个人网站，想把房间、山河和星空串成一个完整的交互空间。'],
    ['', 'Hermes', '山河居已经整理成离线展示版：房间作为入口，墙上是人物与经历，望远镜进入星河观测，书桌保留同舟工作台的原始界面。'],
  ]) {
    const message = node('article', `message${role ? ` ${role}` : ''}`);
    const meta = node('div', 'message-meta');
    meta.append(node('b', '', speaker), node('small', '', '界面演示'));
    message.append(meta, node('div', 'message-body', text));
    messages.append(message);
  }
}

function fillBoard() {
  const board = $('#task-board');
  board.replaceChildren();
  const columns = [
    ['待执行 / 等待', [['整理课堂展示顺序', '排好房间、人物墙与观星入口。', '待执行']]],
    ['运行 / 待审批', [['个人空间离线验收', '检查离线文件、音频与场景切换。', '进行中']]],
    ['已结束', [['山河居三维房间', '房间与星河场景已接入。', '已完成']]],
  ];
  for (const [title, tasks] of columns) {
    const column = node('section', 'column');
    column.append(node('div', 'column-title', `${title} · ${tasks.length}`));
    for (const [name, detail, state] of tasks) {
      const card = node('article', 'task-card');
      card.append(node('strong', '', name), node('p', '', detail));
      const footer = node('footer');
      footer.append(node('span', 'status-pill', state));
      card.append(footer); column.append(card);
    }
    board.append(column);
  }
}

function fillFlow() {
  const flow = node('article', 'flow');
  const head = node('div', 'flow-head');
  head.append(node('b', '', '创新创业课展示'), node('span', 'status-pill', '演示流程'));
  const nodes = node('div', 'flow-nodes');
  for (const [title, copy] of [
    ['素材准备', '整理个人项目与视觉素材'], ['场景串联', '房间、挂画与星河空间'], ['离线验收', '在教室电脑打开文件夹入口'],
  ]) {
    const item = node('div', 'flow-node'); item.append(node('b', '', title), node('p', '', copy)); nodes.append(item);
  }
  flow.append(head, nodes); $('#flow-list').replaceChildren(flow);
}

function fillRooms() {
  const card = node('article', 'room-card');
  const head = node('div', 'room-card-head');
  head.append(node('b', '', '个人网站展示'), node('span', 'status-pill', '离线演示'));
  card.append(head, node('p', 'muted', '工作台原生界面预览，不连接后台服务。'));
  $('#room-list').replaceChildren(card);
}

function fillNotes() {
  const list = $('#note-list'); list.replaceChildren();
  const notes = [
    ['展示提纲', '从房间醒来，沿着挂画看见个人经历，再从望远镜进入星河。'],
    ['同舟工作台', '工作台 UI 使用提供的原始界面与样式。此包只做只读演示，不包含后台服务。'],
    ['离线检查', '从文件夹打开 index.html；页面素材和演示音频随包提供。'],
  ];
  for (const [title, text] of notes) {
    const button = node('button', '', title);
    button.addEventListener('click', () => { $('#note-content').textContent = text; });
    list.append(button);
  }
  $('#note-content').textContent = notes[0][1];
}

function fillArtifacts() {
  const list = $('#artifact-list'); list.replaceChildren();
  for (const [title, detail] of [
    ['山河居离线展示版', 'index.html · Three.js 房间、星河与互动内容'],
    ['同舟工作台界面', 'assets/tongzhou/ · 原始 UI 样式与只读导航演示'],
  ]) {
    const card = node('article', 'artifact'); card.append(node('b', '', title), node('small', '', detail)); list.append(card);
  }
}

function fillAgents() {
  const agents = $('#native-agent-grid'); agents.replaceChildren();
  for (const [name, detail] of [
    ['Hermes', '主助手 · 界面示例'], ['Codex', '代码与审查 · 界面示例'],
    ['Pi', '轻量任务 · 界面示例'], ['Claude Code', '大型代码 · 界面示例'],
  ]) {
    const card = node('article', 'native-agent-card');
    const head = node('div', 'runtime-card-head'); head.append(node('h4', '', name), node('span', 'status-pill', '未连接'));
    card.append(head, node('p', '', detail), node('p', 'muted', '此离线预览不会读取或启动电脑上的 Agent。'));
    agents.append(card);
  }
  $('#ccswitch-agent-panel').append(node('p', 'muted', '模型配置未读取。'));
  $('#remote-agent-panel').append(node('p', 'muted', '远控已禁用。'));
}

function fillSkills() {
  $('#skills-summary').textContent = '离线界面预览 · 不扫描本机目录';
  $('#skills-list').replaceChildren(node('article', 'skill-card', 'Skills 列表在实际工作台服务中读取。'));
  $('#plugins-list').replaceChildren(node('p', 'muted', '插件列表未连接本机服务。'));
}

function fillRecent() {
  const recent = $('#recent-jobs'); recent.replaceChildren();
  for (const [actor, title, status] of [
    ['Codex', '检查离线展示包', '已完成'], ['Hermes', '梳理个人网站内容', '已完成'],
  ]) {
    const item = node('article', 'mini-job');
    item.append(node('strong', '', actor), node('p', '', title), node('small', '', `${status} · 示例`)); recent.append(item);
  }
}

fillMessages(); fillBoard(); fillFlow(); fillRooms(); fillNotes(); fillArtifacts(); fillAgents(); fillSkills(); fillRecent();
$('#projection-status-panel').textContent = 'Codex 原生界面不在离线演示包内。';
$('#feishu-feedback').textContent = '离线界面预览，不连接飞书。';
for (const [initial, name] of [['H', 'Hermes'], ['C', 'Codex'], ['π', 'Pi'], ['K', 'Claude Code']]) {
  const row = node('div', 'agent');
  const copy = node('div');
  copy.append(node('b', '', name), node('small', '', '离线演示'));
  row.append(node('div', 'avatar', initial), copy, node('span', 'dot offline'));
  $('#agent-list').append(row);
}

function switchView(name) {
  document.querySelectorAll('.view').forEach(view => { view.hidden = view.id !== `view-${name}`; });
  document.querySelectorAll('nav button[data-view]').forEach(button => {
    const active = button.dataset.view === name;
    button.classList.toggle('active', active);
    button.setAttribute('aria-current', active ? 'page' : 'false');
  });
  $('#page-title').textContent = names[name] || names.chat;
  $('.sidebar').classList.remove('open');
}

document.querySelectorAll('nav button[data-view]').forEach(button => button.addEventListener('click', () => switchView(button.dataset.view)));
$('#mobile-menu').addEventListener('click', () => $('.sidebar').classList.toggle('open'));
document.querySelectorAll('form').forEach(form => form.addEventListener('submit', event => {
  event.preventDefault();
  $('#toast').textContent = '只读离线预览未连接工作台服务。';
  $('#toast').style.display = 'block';
  setTimeout(() => { $('#toast').style.display = 'none'; }, 2200);
}));

document.addEventListener('click', event => {
  const button = event.target.closest('button');
  if (!button || button.matches('nav button[data-view], #mobile-menu, #note-list button, .dialog-close')) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  $('#toast').textContent = '只读离线预览未连接工作台服务。';
  $('#toast').style.display = 'block';
  setTimeout(() => { $('#toast').style.display = 'none'; }, 2200);
}, true);

document.querySelectorAll('.dialog-close').forEach(button => button.addEventListener('click', () => button.closest('dialog')?.close()));
