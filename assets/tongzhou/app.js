const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
let state={jobs:[],workflows:[],cursor:0},stream=null,pendingStreams=new Map(),refreshTimer=null;
let catalogStatus=null, nativeUpdates=null, ccSwitchCatalog=null, ccSwitchMigration=null, remoteStatus=null;
let personalSyncPending=false;
const permissionPending=new Set(),permissionProfiles=new Map();
const permissionCss=document.createElement('link');permissionCss.rel='stylesheet';permissionCss.href='/static/permissions.css?v=20261007-permissions1';document.head.append(permissionCss);
let fileWorkspace=null,fileWorkspacePromise=null;
let collaborationView=null,collaborationPromise=null;
function internalJob(j){return j.origin==='handoff'||!!j.workflow||!!j.parent_job||!!j.review_for||['hermes','codex','pi','claude'].includes(j.requested_by)}
async function ensureCollaboration(){
 if(!collaborationPromise){
  const css=document.createElement('link');css.rel='stylesheet';css.href='/static/collaboration/panel.css?v=20261007-separate2';document.head.append(css);
  collaborationPromise=import('/static/collaboration/panel.js?v=20261007-separate2').then(module=>{
   collaborationView=module.createCollaboration({api,post,toast,statusNames,switchView,openFile:async path=>{try{switchView('chat');const pane=await ensureFileWorkspace();await pane.openPath(path)}catch(error){toast(error.message)}}});
   collaborationView.sync($('#app').hidden?null:conversationView.conversation,conversationView.collaboration);return collaborationView;
  }).catch(error=>{toast('协作记录暂不可用，原有对话仍可使用');throw error});
 }
 return collaborationPromise;
}
async function ensureFileWorkspace(){
 if(!fileWorkspacePromise){
  const css=document.createElement('link');css.rel='stylesheet';css.href='/static/workspace/panel.css?v=20261007-files1';document.head.append(css);
  fileWorkspacePromise=import('/static/workspace/panel.js?v=20261007-files1').then(module=>{
   fileWorkspace=module.createFileWorkspace({api,post,toast,reference:path=>{$('#prompt').value+=($('#prompt').value?'\n':'')+'请按需读取文件：'+path;$('#prompt').focus()}});
   fileWorkspace.sync($('#app').hidden?null:conversationView.conversation);return fileWorkspace;
  }).catch(error=>{toast('文件工作面暂不可用，原有对话仍可使用');throw error});
 }
 return fileWorkspacePromise;
}
let conversationView={id:null,actor:null,jobs:[],conversation:null,before:null,loading:false},conversationRequest=0,historyRequest=0,historySearchTimer=null,newConversationKey=null;
const statusNames={queued:'待执行',running:'正在执行',needs_approval:'待你批准',completed:'本轮已结束',failed:'失败',blocked:'被前置阻塞',cancelled:'已取消',interrupted:'已中断',waiting_children:'等待执行者',reviewing:'收回验收中'};
const actorNames={hermes:'Hermes',codex:'Codex',pi:'Pi',claude:'Claude Code'};
const roleLabels={hermes:'长期助手 · 理解与验收',codex:'高质量产物 · 分析与审查',pi:'小任务 · 轻量操作',claude:'大型代码 · 原生 CLI'};
function el(tag,cls,text){const e=document.createElement(tag);if(cls)e.className=cls;if(text!==undefined)e.textContent=text;return e}
function toast(text){$('#toast').textContent=text;$('#toast').style.display='block';setTimeout(()=>$('#toast').style.display='none',3200)}
async function api(path,options={}){const r=await fetch(path,{credentials:'same-origin',...options,headers:{'Content-Type':'application/json',...(options.headers||{})}});const d=await r.json();if(!r.ok)throw Error(d.error||'接口暂不可用');return d}
function post(path,d){return api(path,{method:'POST',body:JSON.stringify(d)})}
function timeText(t){return new Date(t*1000).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'})}
function switchView(name){if(name!=='feishu')stopFeishuPoll();const frame=$('#projection-frame');if(frame&&name!=='projection'&&frame.getAttribute('src')){frame.contentWindow?.postMessage({action:'stop'},location.origin);frame.removeAttribute('src');}if(frame&&name==='projection'&&!frame.getAttribute('src'))frame.src='/projection/';$$('nav button').forEach(e=>e.classList.toggle('active',e.dataset.view===(name==='collaboration'?'tasks':name)));$$('.view').forEach(e=>e.hidden=e.id!=='view-'+name);$('#page-title').textContent={chat:'协作对话',collaboration:'Agent 协作记录',tasks:'任务看板',flows:'工作流',notes:'笔记库',artifacts:'产物',agents:'Agent 管理',projection:'Codex 原生界面',feishu:'飞书 Hermes',skills:'插件与 Skills',rooms:'Agent 群聊'}[name];$('.sidebar').classList.remove('open');if(name==='notes')loadNotes();if(name==='artifacts')loadArtifacts();if(name==='agents')loadNativeCatalog();if(name==='projection')loadProjection();if(name==='feishu')loadFeishu();if(name==='skills')loadSkills();if(name==='rooms')loadRooms()}
$$('nav button').forEach(e=>e.onclick=()=>switchView(e.dataset.view));$('#mobile-menu').onclick=()=>$('.sidebar').classList.toggle('open');$$('[data-suggestion]').forEach(e=>e.onclick=()=>{$('#prompt').value=e.dataset.suggestion;$('#prompt').focus()});$$('.dialog-close').forEach(e=>e.onclick=()=>e.closest('dialog').close());
function showApp(){$('#login').hidden=true;$('#app').hidden=false}
async function refresh(){try{state=await api('/api/state');nativeCatalog=state.native_integrations;if(state.runtime_controls)runtimeData=state.runtime_controls;showApp();await loadConversation(false);render();ensureFileWorkspace().catch(()=>{});ensureCollaboration().catch(()=>{});if(!$('#view-agents').hidden)renderNativeAgents();if(!stream)connect()}catch(e){if(e.message.includes('登录')){fileWorkspace?.reset();collaborationView?.reset();$('#app').hidden=true;$('#login').hidden=false}else toast(e.message)}}
function scheduleRefresh(){if(refreshTimer)return;refreshTimer=setTimeout(()=>{refreshTimer=null;refresh()},350)}
function render(){
 renderPersonalSyncButton(state.remote_services);
 renderRuntimeControls();renderNativeReadiness();renderVaults();renderConversationHeader();
 $('#vault-label').textContent=state.vault;
 $('#active-count').textContent=state.jobs.filter(j=>['running','queued','needs_approval'].includes(j.status)).length;
 const list=$('#agent-list');list.replaceChildren();for(const id of Object.keys(actorNames)){const e=el('div','agent');e.append(el('div','avatar',{hermes:'H',codex:'C',pi:'π',claude:'K'}[id]));const d=el('div');d.append(el('b','',actorNames[id]),el('small','',roleLabels[id]));const ready=state.native_integrations?.agents?.find(a=>a.id===id)?.ready;const dot=el('span','dot');dot.classList.toggle('offline',ready===false);e.append(d,dot);e.tabIndex=0;e.setAttribute('role','button');e.setAttribute('aria-label','切换到'+actorNames[id]);e.onclick=()=>chooseActor(id);e.onkeydown=ev=>{if(ev.key==='Enter')chooseActor(id)};e.classList.toggle('selected',$('#actor').value===id);list.append(e)}
 const messages=$('#messages'),atEnd=messages.scrollHeight-messages.scrollTop-messages.clientHeight<120;
 messages.replaceChildren();for(const m of conversationView.nativeMessages||[]){const row=el('div','message'+(m.role==='user'?' user':''));const meta=el('div','message-meta');meta.append(el('b','',m.role==='user'?'你':actorNames[conversationView.actor]),el('small','','原生历史'));row.append(meta,el('div','message-body',m.text));messages.append(row)}
 if(conversationView.nativeNote)messages.append(el('p','muted',conversationView.nativeNote));
 if(!visibleConversationJobs().length&&!conversationView.nativeMessages?.length){messages.append(el('div','empty',conversationView.conversation?.source==='native'?'暂未读到最近文本。可点“查看原生历史”重试；原生续接不需要复制整份聊天。':'这是一段独立对话。可从“历史 / 搜索”选择之前的会话，或直接开始。'))}
 for(const j of visibleConversationJobs().reverse()){
  const user=el('div','message user');const m=el('div','message-meta');m.append(el('b','',j.origin==='feishu'?'你 · 飞书':'你'),el('span','',timeText(j.created)));user.append(m,el('div','message-body',j.prompt));messages.append(user);
  const answer=el('div','message'+(j.status==='failed'?' error':''));answer.id='msg-'+j.id;const meta=el('div','message-meta');meta.append(el('b','',actorNames[j.actor]),el('span','status-pill',statusNames[j.status]||j.status));answer.append(meta);
  const text=j.output||pendingStreams.get(j.id)||j.error||(['queued','running'].includes(j.status)?'':'暂无文字输出');answer.append(el('div','message-body',text||'正在处理…'));
  if(j.status==='needs_approval'){const approve=el('button','secondary','允许本次'),deny=el('button','secondary','拒绝');approve.onclick=()=>post('/api/jobs/'+j.id+'/action',{action:'approve',allow:true}).then(refresh).catch(e=>toast(e.message));deny.onclick=()=>post('/api/jobs/'+j.id+'/action',{action:'approve',allow:false}).then(refresh);answer.append(approve,deny)}
  messages.append(answer);
 }
 if(atEnd||state.jobs.length<3)messages.scrollTop=messages.scrollHeight;
 const recent=$('#recent-jobs');recent.replaceChildren();for(const j of state.jobs.slice(0,6)){const card=el('div','mini-job');card.append(el('strong','',actorNames[j.actor]),el('p','',j.prompt),el('small','',statusNames[j.status]+' · '+timeText(j.updated)));recent.append(card)}
 const active=visibleConversationJobs().find(j=>['running','needs_approval'].includes(j.status));$('#reply-status').textContent=active?actorNames[active.actor]+' · '+statusNames[active.status]+'（无需反复发送继续）':'';
 renderBoard();renderFlows();
}
function renderBoard(){const board=$('#task-board');board.replaceChildren();const groups=[['待执行 / 等待',['queued','blocked','waiting_children']],['运行 / 待审批',['running','needs_approval','reviewing']],['已结束',['completed','failed','cancelled','interrupted']]];for(const [name,statuses] of groups){const col=el('div','column');const jobs=state.jobs.filter(j=>statuses.includes(j.status));col.append(el('div','column-title',name+' · '+jobs.length));for(const j of jobs){const c=el('div','task-card');c.append(el('strong','',actorNames[j.actor]),el('p','',j.prompt));const footer=el('footer');footer.append(el('span','status-pill',statusNames[j.status]));if(['queued','running','needs_approval'].includes(j.status)){const stop=el('button','','取消');stop.onclick=()=>post('/api/jobs/'+j.id+'/action',{action:'cancel'}).then(refresh).catch(e=>toast(e.message));footer.append(stop)}c.append(footer);col.append(c)}board.append(col)}}
function renderFlows(){const list=$('#flow-list');list.replaceChildren();if(!state.workflows.length)list.append(el('div','empty','没有自动创建的任务图。选择模板或定义节点后再启动。'));for(const flow of state.workflows){const f=el('div','flow'),head=el('div','flow-head');head.append(el('b','',flow.name),el('span','status-pill',flow.status==='completed'?'已完成':statusNames[flow.status]||flow.status));f.append(head);const nodes=el('div','flow-nodes');for(const n of flow.spec){const j=state.jobs.find(j=>j.workflow===flow.id&&j.node===n.id);const box=el('div','flow-node');box.append(el('b','',n.id+' · '+actorNames[n.actor]),el('p','',n.prompt),el('span','status-pill',j?statusNames[j.status]:'待执行'));nodes.append(box)}f.append(nodes);list.append(f)}}
function connect(){stream=new EventSource('/api/events?after='+state.cursor);stream.onopen=()=>{$('#connection').textContent='● 实时连接';$('#connection').style.color='var(--accent)'};stream.onerror=()=>{$('#connection').textContent='● 正在重连';$('#connection').style.color='#b58a59'};stream.onmessage=e=>{const d=JSON.parse(e.data);state.cursor=d.seq;if(d.kind==='native_connection'){const a=state.native_integrations?.agents?.find(a=>a.id===d.data.actor);if(a)Object.assign(a,d.data);nativeCatalog=state.native_integrations;renderNativeReadiness();if(!$('#view-agents').hidden)renderNativeAgents()}else if(d.kind==='delta'){if(!visibleConversationJobs().some(j=>j.id===d.job)){scheduleRefresh();return}const text=(pendingStreams.get(d.job)||'')+(d.data.text||'');pendingStreams.set(d.job,text);const b=$('#msg-'+d.job+' .message-body');if(b)b.textContent=text;const m=$('#messages');if(m.scrollHeight-m.scrollTop-m.clientHeight<200)m.scrollTop=m.scrollHeight}else if((d.kind==='tool'||d.kind==='progress')&&visibleConversationJobs().some(j=>j.id===d.job)){$('#reply-status').textContent=d.kind==='tool'?'正在使用原生工具 · '+d.data.name:(d.data.text||'').slice(0,140)}else{if(['completed','failed','cancelled'].includes(d.kind))pendingStreams.delete(d.job);scheduleRefresh()}}}
$('#login-form').onsubmit=async e=>{e.preventDefault();try{await post('/api/login',{key:$('#key').value});$('#key').value='';await refresh()}catch(err){$('#login-error').textContent=err.message}};
$('#chat-form').onsubmit=async e=>{e.preventDefault();const p=$('#prompt').value.trim();if(!p)return;if(!conversationView.id||conversationView.loading){toast('先选择或创建一段对话');return;}try{await post('/api/jobs',{actor:$('#actor').value,prompt:p,conversation_id:conversationView.id,idempotency_key:crypto.randomUUID()});$('#prompt').value='';await refresh()}catch(err){toast(err.message)}};
$('#prompt').onkeydown=e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing){e.preventDefault();$('#chat-form').requestSubmit()}};
const presets={research:[{id:'collect',actor:'pi',prompt:'根据我提供的目标收集必要资料，返回来源与准确摘要，不扩展范围。',depends:[]},{id:'analyze',actor:'codex',prompt:'只分析前置资料与目标，给出有依据的方案，不重复收集。',depends:['collect']},{id:'review',actor:'hermes',prompt:'按原目标核查方案和证据，明确结果、风险与下一步，不再次派发同任务。',depends:['analyze']}],code:[{id:'plan',actor:'hermes',prompt:'根据明确需求提出范围、文件写入边界和验收标准，不实现代码。',depends:[]},{id:'implement',actor:'claude',prompt:'按前置方案实现指定代码，保留原生文件工具，返回改动与真实验证。',depends:['plan']},{id:'review',actor:'codex',prompt:'独立检查前置改动和验收证据，报告具体问题，不重复实现。',depends:['implement']}]};
function newFlow(type){$('#flow-name').value=type==='code'?'方案 → 实现 → 审查':'资料 → 分析 → 验收';$('#flow-spec').value=JSON.stringify(presets[type||'research'],null,2);$('#flow-error').textContent='';$('#flow-dialog').showModal()}
$('#new-flow').onclick=()=>newFlow('research');$$('[data-template]').forEach(e=>e.onclick=()=>newFlow(e.dataset.template));$('#flow-form').onsubmit=async e=>{e.preventDefault();try{const nodes=JSON.parse($('#flow-spec').value);await post('/api/workflows',{name:$('#flow-name').value,nodes,idempotency_key:crypto.randomUUID()});$('#flow-dialog').close();await refresh()}catch(err){$('#flow-error').textContent=err.message}};
let catalogData=null,runtimeData=null;
const compactToken=n=>n==null?'未读回':n>=1000000?(n/1000000).toFixed(2)+'M':n>=1000?(n/1000).toFixed(1)+'K':String(n);
function activeRuntime(){return runtimeData?.actors?.[$('#actor').value]}
async function loadCatalog(){catalogData=await api('/api/config/catalog');runtimeData=await api('/api/runtime/catalog');try{catalogStatus=await api('/api/catalog/status')}catch(e){catalogStatus=null}return catalogData}
function chooseActor(id){conversationRequest++;conversationView={id:null,actor:id,jobs:[],conversation:null,before:null,loading:true};$('#actor').value=id;$('#prompt').placeholder='发给 '+actorNames[id]+'，或输入 /model、/effort、/context';render();loadConversation().catch(e=>toast(e.message))}
function renderRuntimeControls(){
 const a=activeRuntime(),s=a?.selection;
 $('#active-agent-title').textContent=actorNames[$('#actor').value];$('.main-avatar').textContent={hermes:'H',codex:'C',pi:'π',claude:'K'}[$('#actor').value];
 $('#agent-native-state').textContent=s?.mode==='workbench'?'仅同舟覆盖':'跟随原生';
 $('#model-label').textContent=s?(s.provider+' / '+(s.model||'由原生解析')+' · '+s.source):'正在读取原生选择';
 $('#quick-model-open').textContent=(s?.model||'选择模型')+' ▾';
 const cap=a?.reasoning,effort=s?.thinking;
 $('#effort-open').textContent='推理：'+(effort?(cap?.labels?.[effort]||effort):'原生默认')+' ▾';
 const c=a?.context;
 $('#context-count').textContent=c?.used!=null?(compactToken(c.used)+' / '+compactToken(c.limit)+' · '+(c.quality==='native_live'?'实时原生上下文':'最近原生上下文快照')):(c?.limit?'上下文未读回 · 容量 '+compactToken(c.limit):'上下文未读回');
 $('#context-meter').value=c?.percent||0;$('#context-meter').classList.toggle('unavailable',c?.used==null);$('#context-strip').title=c?.source||'没有原生统计就不显示假数字';
 const running=state.jobs.filter(j=>j.actor===$('#actor').value&&['running','needs_approval'].includes(j.status));$('#stop-current').hidden=!running.length;
}
async function saveActor(actor,data){runtimeData=await post('/api/runtime/'+actor,data);state.runtime_controls=runtimeData;render();if($('#settings-dialog').open)renderCatalog();toast(data.mode==='native'?'已跟随 '+actorNames[actor]+' 原生选择':'仅同舟 '+actorNames[actor]+' 的下次调用使用此选择');}
function renderCatalog(){
 const cards=$('#provider-cards');cards.replaceChildren();for(const p of catalogData.providers){const card=el('div','provider-card');card.append(el('b','',p.name),el('small','',p.base_url));const labels=[];if(p.billing==='free-limited')labels.push('限时免费');labels.push(p.key_configured?'凭据已配置':p.requires_login?'需 OpenCode Zen 登录':'尚未配置凭据');const st=catalogStatus?.providers?.find(x=>x.id===p.id);if(st?.status==='success')labels.push('目录 '+new Date(st.last_success_at*1000).toLocaleDateString('zh-CN'));else if(st?.status==='failed')labels.push('上次发现失败');card.append(el('span','status-pill',labels.join(' · ')));if(p.privacy_note)card.append(el('small','provider-note',p.privacy_note));const actions=el('div','provider-actions');if(p.billing!=='free-limited'){const b=el('button','native-link','发现新模型');b.type='button';b.onclick=()=>refreshCatalog(p.id);actions.append(b)}card.append(actions);cards.append(card)}
 const list=$('#actor-overrides');list.replaceChildren();
 for(const actor of Object.keys(actorNames)){
  const a=runtimeData.actors[actor],s=a.selection,row=el('section','runtime-actor-card');row.dataset.actor=actor;
  const head=el('div','runtime-card-head');head.append(el('b','',actorNames[actor]),el('span','status-pill',s.mode==='native'?'跟随原生':'仅同舟覆盖'));row.append(head);
  const grid=el('div','runtime-select-grid'),provider=el('select'),model=el('select'),effort=el('select');provider.id='override-provider-'+actor;model.id='override-model-'+actor;effort.id='override-effort-'+actor;
  const native=el('option','','跟随原生 · '+a.native.model);native.value='';provider.append(native);
  for(const p of a.providers){const o=el('option','',p.name+(p.supported?'':' · 不兼容'));o.value=p.id;o.disabled=!p.supported||!p.key_configured;provider.append(o)}
  const update=()=>{model.replaceChildren();effort.replaceChildren();const p=a.providers.find(p=>p.id===provider.value);model.disabled=!p;effort.disabled=!p;
   if(!p){const o=el('option','',a.native.model||'原生自行选择');model.append(o);effort.append(el('option','',a.native.thinking||'原生默认'));return}
   for(const m of p.model_options){const o=el('option','',m.name);o.value=m.id;model.append(o)}if(p.id===s.provider)model.value=s.model;
   updateEffort();};
  const updateEffort=()=>{effort.replaceChildren();const p=a.providers.find(p=>p.id===provider.value);const c=p?.model_options.find(m=>m.id===model.value)?.reasoning;const def=el('option','','原生默认 / 不传覆盖');def.value='';effort.append(def);for(const v of c?.levels||[]){const o=el('option','',c.labels[v]||v);o.value=v;effort.append(o)}if(s.mode==='workbench'&&s.provider===provider.value&&s.model===model.value)effort.value=s.thinking||'';};
  provider.value=s.mode==='native'?'':s.provider;provider.onchange=update;model.onchange=updateEffort;update();
  for(const [label,select] of [['提供商',provider],['模型',model],['推理强度',effort]]){const l=el('label','',label);l.append(select);grid.append(l)}row.append(grid);
  const foot=el('div','runtime-card-foot'),note=el('small','',a.switch_scope+'；不修改任何原生全局默认'),save=el('button','secondary','保存 '+actorNames[actor]);save.type='button';save.onclick=()=>saveActor(actor,provider.value?{mode:'workbench',provider:provider.value,model:model.value,thinking:effort.value}:{mode:'native'}).catch(e=>{$('#settings-error').textContent=e.message});foot.append(note,save);row.append(foot);list.append(row);
 }
 const note=$('#config-runtime-note');note.hidden=false;note.textContent='飞书独立原生运行。API集中管理，但模型/推理选择只作用于对应agent的同舟调用。';
 for(const other of runtimeData.other_native_agents||[]){const p=el('p','native-availability',other.name+'：'+other.execution);list.append(p)}
}
$('#settings-open').onclick=async()=>{try{await loadCatalog();renderCatalog();$('#settings-dialog').showModal()}catch(e){toast(e.message)}};
async function refreshCatalog(providerId=null){try{const d=await post('/api/catalog/refresh',providerId?{provider_id:providerId}:{});const added=d.results.reduce((n,x)=>n+(x.new_models?.length||0),0);toast(added?'发现 '+added+' 个新模型；未自动切换当前模型':'目录已检查；没有自动修改默认配置');await loadCatalog();renderCatalog()}catch(e){toast('模型目录发现失败：'+e.message)}}
$('#catalog-refresh-all').onclick=()=>refreshCatalog();
$('#provider-discover').onclick=async()=>{const status=$('#provider-discover-status'),button=$('#provider-discover');button.disabled=true;status.textContent='正在读取 /models（不调用模型）…';try{const d=await post('/api/catalog/discover',{base_url:$('#provider-url').value.trim(),protocol:$('#provider-protocol').value,api_key:$('#provider-key').value});if(d.status!=='success')throw Error(d.reason||'接口没有返回模型列表');$('#provider-models').value=d.models.join('\n');status.textContent='发现 '+d.models.length+' 个模型；API Key 未保存，点击“保存 API”后才会写入同舟私有配置'}catch(e){status.textContent=e.message}finally{button.disabled=false}};
$('#provider-form').onsubmit=async e=>{e.preventDefault();try{catalogData=await post('/api/config/providers',{id:$('#provider-id').value.trim(),name:$('#provider-name').value.trim(),base_url:$('#provider-url').value.trim(),protocol:$('#provider-protocol').value,api_key:$('#provider-key').value,models:$('#provider-models').value.split('\n').map(s=>s.trim()).filter(Boolean),context_window:Number($('#provider-context').value),max_tokens:Number($('#provider-output').value)});$('#provider-key').value='';runtimeData=await api('/api/runtime/catalog');renderCatalog();toast('API已保存到同舟私有目录，原生配置未改。')}catch(err){$('#provider-error').textContent=err.message}};
function renderPicker(){const a=activeRuntime(),q=$('#model-search').value.trim().toLowerCase(),list=$('#model-picker-list');list.replaceChildren();if(!a)return;let count=0;
 for(const p of a.providers){const rows=p.model_options.filter(m=>(p.name+' '+m.id).toLowerCase().includes(q));if(!rows.length)continue;
  const group=el('section','model-group');group.append(el('h4','',p.name+' · '+rows.length));
  for(const m of rows){count++;const same=(a.selection.catalog_provider||a.selection.provider)===p.id&&a.selection.model===m.id,b=el('button','model-choice'+(same?' selected':''));b.type='button';b.disabled=!p.supported||!p.key_configured;b.title=p.unsupported_reason||'';const name=el('div');name.append(el('b','',m.name),el('small','',m.id));const tags=el('div','model-choice-tags');if(m.metadata?.contextWindow)tags.append(el('span','',compactToken(m.metadata.contextWindow)+' · 目录容量'));tags.append(el('span','',p.protocol),el('span','',same?'✓ 当前':p.supported?'仅此agent':'不兼容'));b.append(name,tags);
   b.onclick=async()=>{try{const thinking=m.reasoning.levels.includes(a.selection.thinking)?a.selection.thinking:'';await saveActor(a.id,{mode:'workbench',provider:p.id,model:m.id,thinking});$('#model-picker').close()}catch(e){$('#model-picker-error').textContent=e.message}};group.append(b);
  }list.append(group)
 }if(!count)list.append(el('div','empty','没有匹配型号。按提供商或模型ID搜索。'));
}
async function openPicker(){try{await loadCatalog();$('#model-search').value='';$('#model-picker-error').textContent='';renderPicker();$('#model-picker').showModal();$('#model-search').focus()}catch(e){toast(e.message)}}
$('#quick-model-open').onclick=openPicker;$('#model-search').oninput=renderPicker;$('#actor').onchange=()=>chooseActor($('#actor').value);$('#picker-open-config').onclick=()=>{$('#model-picker').close();renderCatalog();$('#settings-dialog').showModal()};
$('#native-restore').onclick=()=>saveActor($('#actor').value,{mode:'native'}).catch(e=>toast(e.message));
$('#effort-open').onclick=async()=>{try{await loadCatalog();const a=activeRuntime();$('#effort-explain').textContent=a.reasoning.note;const list=$('#effort-options');list.replaceChildren();for(const value of ['',...a.reasoning.levels]){const b=el('button','effort-option'+(value===(a.selection.thinking||'')?' selected':''),value?(a.reasoning.labels[value]||value):'不覆盖 · 原生默认');b.type='button';b.onclick=async()=>{try{const p=a.providers.find(p=>p.id===(a.selection.catalog_provider||a.selection.provider));if(!p||!p.supported)throw Error('先为此agent选择兼容提供商/模型，再设置同舟强度');await saveActor(a.id,{mode:'workbench',provider:p.id,model:a.selection.model,thinking:value});$('#effort-dialog').close()}catch(e){$('#effort-error').textContent=e.message}};list.append(b)}$('#effort-error').textContent='';$('#effort-dialog').showModal()}catch(e){toast(e.message)}};
$('#context-details-open').onclick=()=>{const a=activeRuntime(),c=a?.context||{},list=$('#context-detail-grid');list.replaceChildren();for(const [name,value] of [['agent',a?.name],['模型',a?.selection.model],['当前上下文',c.quality==='native_live'?compactToken(c.used):'未提供实时值'],['最近原生快照',compactToken(c.last_native_context_used)],['容量',compactToken(c.limit)],['剩余',compactToken(c.remaining)],['最近输入统计',compactToken(c.last_input_tokens)],['最近输出统计',compactToken(c.last_output_tokens)],['缓存读取',compactToken(c.cache_read_tokens)]]){const row=el('div');row.append(el('small','',name),el('b','',value||'未读回'));list.append(row)}$('#context-source').textContent=(c.source||'未收到原生统计')+'。'+(c.capacity_source||'')+'。未发送的草稿不计入原生观测；不把累计花费当占用。';$('#context-dialog').showModal()};
$('#stop-current').onclick=async()=>{const j=visibleConversationJobs().find(j=>['running','needs_approval'].includes(j.status));if(!j)return;if(!confirm('停止 '+actorNames[j.actor]+' 当前这轮？不会删除对话。'))return;try{await post('/api/jobs/'+j.id+'/action',{action:'cancel'});await refresh()}catch(e){toast(e.message)}};
$('#file-reference').onclick=()=>$('#file-dialog').showModal();$('#file-reference-add').onclick=()=>{const path=$('#file-reference-path').value.trim();if(!/^[A-Za-z]:[\\/]/.test(path)){toast('请输入电脑文件的绝对路径');return}$('#prompt').value+=($('#prompt').value?'\n\n':'')+'[文件引用，按需读取] '+path;$('#file-reference-path').value='';$('#file-dialog').close()};
const Speech=window.SpeechRecognition||window.webkitSpeechRecognition;$('#voice-input').disabled=!Speech;$('#voice-input').title=Speech?'浏览器语音输入，需麦克风权限及浏览器服务；不是所有设备可用':'此浏览器未提供语音识别接口';$('#voice-input').onclick=()=>{if(!Speech)return;const speech=new Speech();speech.lang='zh-CN';speech.onresult=e=>{$('#prompt').value+=e.results[0][0].transcript};speech.onerror=()=>toast('浏览器语音服务不可用，请用文字输入');speech.start()};
const priorKey=$('#prompt').onkeydown;$('#prompt').onkeydown=e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing){const c=$('#prompt').value.trim();const map={'/model':'#quick-model-open','/effort':'#effort-open','/context':'#context-details-open','/stop':'#stop-current'};if(map[c]){e.preventDefault();$(map[c]).click();$('#prompt').value='';return}}priorKey(e)};

async function loadNotes(){try{const d=await api('/api/notes');const list=$('#note-list');list.replaceChildren();for(const f of d.files){const btn=el('button','',f.replace(/\.md$/,''));btn.onclick=async()=>{const note=await api('/api/notes?path='+encodeURIComponent(f));$('#note-content').textContent=note.content};list.append(btn)}}catch(e){toast(e.message)}}$('#notes-refresh').onclick=loadNotes;
async function loadArtifacts(){try{const d=await api('/api/artifacts'),list=$('#artifact-list');list.replaceChildren();if(!d.items.length)list.append(el('div','empty','任务完成后，引用工作区产物路径会显示在这里。'));for(const f of d.items){const e=el('div','artifact');e.append(el('b','',f.name),el('small','',f.path));const open=el('button','secondary','打开文件');open.onclick=async()=>{try{const pane=await ensureFileWorkspace();switchView('chat');await pane.openPath(f.path)}catch(error){toast(error.message)}};e.append(open);list.append(e)}}catch(e){toast(e.message)}}

let nativeCatalog=null,currentSkills=null;
const allNativeNames={...actorNames,opencode:'OpenCode',workbuddy:'WorkBuddy',trae:'TRAE'};
function renderNativeReadiness(){
 const a=state.native_integrations?.agents?.find(a=>a.id===$('#actor').value);
 if(!a)return;
 $('#agent-readiness').textContent=a.status;$('#agent-readiness').classList.toggle('not-ready',!a.ready);
 const readonlyNative=conversationView.conversation?.source==='native'&&!conversationView.conversation?.resume_supported;$('#chat-form .send').disabled=!a.ready||Boolean(window.TONGZHOU_PREVIEW)||conversationView.loading||readonlyNative;$('#prompt').disabled=!a.ready||readonlyNative;
 $('#agent-native-state').textContent=!a.ready?'接口未连接':activeRuntime()?.selection?.mode==='workbench'?'仅同舟覆盖':'跟随原生';
 const reconnect=$('#agent-connect');reconnect.hidden=false;reconnect.disabled=['checking','connecting'].includes(a.connectionState);reconnect.textContent=reconnect.disabled?'自动连接中…':a.ready?'检查连接':'重连接口';
}
async function reconnectAgent(actor){try{await post('/api/native/connect',{actor});await refresh();toast('正在检查连接，结果会自动更新')}catch(e){toast(e.message)}}
$('#agent-connect').onclick=()=>reconnectAgent($('#actor').value);
async function launchNative(target,actor){
 if(window.TONGZHOU_PREVIEW){toast('只读预览不会启动电脑软件；请打开实际工作台后测试。');return}
 const answer=await post('/api/native/launch',{target,actor,confirmed:true,idempotency_key:crypto.randomUUID()});
 toast(answer.navigation||answer.message);return answer;
}
async function loadProjection(){try{const d=await api('/api/projection/status');const box=$('#projection-status-panel');if(box)box.textContent=(d.installed?'组件已准备 · ':'组件未准备 · ')+(d.active?(d.connected?'已连接原生 Codex':'已启动等待连接'):'尚未启动')+' · '+d.network;}catch(e){const box=$('#projection-status-panel');if(box)box.textContent=e.message}}
$('#projection-open-new').onclick=()=>window.open('/projection/','_blank','noopener');$('#projection-refresh').onclick=loadProjection;
async function loadNativeCatalog(){
 try{[nativeCatalog,ccSwitchCatalog,ccSwitchMigration,remoteStatus,state.agent_permissions]=await Promise.all([api('/api/native/catalog'),api('/api/ccswitch/catalog'),api('/api/ccswitch/migration'),api('/api/remote/status'),api('/api/native/permissions')]);state.native_integrations=nativeCatalog;state.cc_switch=ccSwitchCatalog;state.remote_services=remoteStatus;renderNativeReadiness();renderNativeAgents();renderCCSwitchPanel();renderRemotePanel();renderVaults();api('/api/native/updates').then(d=>{nativeUpdates=d;state.native_updates=d;renderNativeAgents()}).catch(e=>toast('版本信息暂未读到：'+e.message))}catch(e){toast(e.message)}
}
function renderCCSwitchPanel(){
 const box=$('#ccswitch-agent-panel');if(!box)return;box.replaceChildren();const c=ccSwitchCatalog||state.cc_switch;
 if(!c?.available){box.append(el('p','muted','CC Switch 未找到或不可读；原生 Agent 仍可独立运行。'));return}
 const current=c.current||{};const head=el('div','ccswitch-panel-head');head.append(el('b','', 'CC Switch 当前配置'),el('span','status-pill','只读同步 · 不复制密钥'));box.append(head);
 const rows=el('div','ccswitch-current-list');for(const actor of ['codex','claude','pi','hermes']){const p=(c.providers||[]).find(x=>x.app_type===actor&&x.active)||null;const row=el('div','ccswitch-current-row');row.append(el('b','',actorNames[actor]||actor),el('span','',p?p.name:'未登记 / 未识别'),el('small','',p&&p.models?.length?'模型 '+p.models.slice(0,4).join('、'):'模型由原生配置读取'));rows.append(row)}box.append(rows);const mig=ccSwitchMigration||state.cc_switch_migration;if(mig?.candidates?.length){const warning=el('div','ccswitch-migration-warning');warning.append(el('b','', '发现原生配置尚未登记到 CC Switch'));for(const item of mig.candidates){const row=el('div','ccswitch-migration-row');row.append(el('span','',item.name+' · '+item.app_type),el('small','',item.base_url||'当前原生配置'));const open=el('button','native-link','打开 CC Switch 导入');open.onclick=()=>$('#ccswitch-open').click();row.append(open);warning.append(row)}box.append(warning)}}
function renderRemotePanel(){
 renderPersonalSyncButton(remoteStatus||state.remote_services);
 const box=$('#remote-agent-panel');if(!box)return;box.replaceChildren();const r=remoteStatus||state.remote_services;if(!r)return;const sync=r.syncthing||{};const remoteHere=location.protocol==='https:'&&location.hostname.endsWith('.ts.net');const head=el('div','ccswitch-panel-head');head.append(el('b','', '手机远控与同步'),el('span','status-pill',sync.vault_sync_verified?'个人笔记同步已验收':'等待同步配置'));box.append(head);const grid=el('div','remote-status-grid');const rows=[['Tailscale',r.tailscale?.online?(r.tailscale.ipv4||'在线'):'未连接'],['vivo PC远控',r.vivo_pc_remote?.installed?'已安装 · 配对状态未知':'未发现'],['Syncthing',sync.paired?(sync.connected?'平板已连接':'已配对 · 平板离线'):(sync.installed?'已安装未配对':'未安装')],['个人笔记',sync.syncing?'同步中':(sync.paused?'手动同步 · 已暂停':'等待配置')],['工作台网页',remoteHere?'私网 HTTPS 已连接':(r.web_access_enabled?'已启用':'本机入口 · 私网访问见说明')]];for(const [k,v] of rows){const row=el('div','remote-status-row');row.append(el('small','',k),el('b','',v));grid.append(row)}box.append(grid);const note=el('p','muted',sync.note||'个人 Vault 和 AI 项目库保持独立。');box.append(note);if(sync.last_sync?.message)box.append(el('p','muted',sync.last_sync.message));if(remoteHere){const url=el('a','native-link',location.origin+'/');url.href=location.origin+'/';box.append(el('p','muted','将这个网址加入平板或手机浏览器书签。两端 Tailscale 保持连接。'),url)}
}
function permissionEntry(actor,profile='default'){return state.agent_permissions?.entries?.find(e=>e.actor===actor&&e.profile===profile)}
function permissionControl(actor,profile='default'){
 const entry=permissionEntry(actor,profile),row=el('div','agent-permission-control');
 if(!entry){row.append(el('span','permission-summary','权限状态暂未读到'));return row}
 const button=el('button','permission-button',entry.mode==='full'?'关闭全权限':'开启全权限');button.type='button';button.setAttribute('aria-pressed',entry.mode==='full');button.setAttribute('aria-label',actorNames[actor]+(actor==='hermes'?' / '+profile:'')+' '+button.textContent);button.dataset.permissionScope=entry.scope;button.disabled=entry.busy||permissionPending.has(entry.scope);
 row.append(button,el('span','permission-summary',entry.busy?'任务进行中':entry.mode==='full'?'已开启 · 不逐次申请':actor==='pi'?'原生工具无需审批':'默认权限'));
 button.title=entry.busy?'先完成或取消当前任务，再切换权限':entry.mode==='full'?'关闭后新任务恢复原生权限':'仅同舟任务；不修改飞书或原生全局配置';
 button.onclick=async()=>{
  const mode=entry.mode==='full'?'native':'full';
  if(mode==='full'&&!confirm('给 '+actorNames[actor]+(actor==='hermes'?' / '+profile:'')+' 开启全权限？\n\n同舟发起的后续任务将不再逐次申请文件修改、删除、命令执行和网络访问。这可能影响当前账户可访问的文件和凭据。\n\n仅此 Agent / 机器人，不授权其他成员；不改变飞书、原生全局配置或 Windows 管理员权限。'))return;
  permissionPending.add(entry.scope);button.disabled=true;
  try{state.agent_permissions=await post('/api/native/permissions/'+actor,{profile,mode,confirmed:mode==='full'});toast(mode==='full'?'全权限已开启；同舟新任务不再逐次申请':'已恢复默认权限；新任务生效')}
  catch(error){toast(error.message)}
  finally{permissionPending.delete(entry.scope);renderChatPermissions();if(!$('#view-agents').hidden)renderNativeAgents()}
 };
 return row;
}
function renderChatPermissions(){
 let slot=$('#chat-permission-control');if(!slot){slot=el('div');slot.id='chat-permission-control';$('#chat-form .composer-top').append(slot)}
 const c=conversationView.conversation,actor=$('#actor').value;slot.replaceChildren(permissionControl(actor,c?.native_profile||'default'));if(!c||conversationView.loading)slot.querySelector('button')?.setAttribute('disabled','');
}
function renderNativeAgents(){
 const list=$('#native-agent-grid');list.replaceChildren();
 for(const a of (nativeCatalog?.agents||state.native_integrations?.agents||[])){
  const card=el('article','native-agent-card');const head=el('div','runtime-card-head');head.append(el('h4','',a.name),el('span','status-pill',a.installed?'已发现原生入口':'未发现入口'));card.append(head);
  const u=nativeUpdates?.agents?.find(x=>x.id===a.id);card.append(el('p','',a.status));const ver=el('div','native-version');ver.append(el('span','版本：'+(u?.version||'由原生软件显示')),el('small','',u?.check||'未检查'));card.append(ver);
   const tags=el('div','native-tags');tags.append(el('span','',a.taskAdapter?'同舟有任务适配器':'原生界面入口'),el('span','',a.modelControls?'模型 / 推理按原生能力':'模型 / 上下文在原生软件操作'));card.append(tags);
   if(a.taskAdapter){
    const area=el('div','agent-permission-area');let profile=permissionProfiles.get(a.id)||'default';
    if(a.id==='hermes'){const select=el('select');select.setAttribute('aria-label','Hermes 权限机器人');for(const entry of state.agent_permissions?.entries?.filter(e=>e.actor==='hermes')||[]){const option=el('option','',entry.profile==='default'?'Hermes · 主机器人':entry.profile);option.value=entry.profile;select.append(option)}if(!permissionEntry(a.id,profile))profile='default';select.value=profile;select.onchange=()=>{permissionProfiles.set(a.id,select.value);renderNativeAgents()};area.append(select)}
    area.append(permissionControl(a.id,profile));if(a.id==='pi')area.append(el('small','permission-summary','全权限额外信任本次项目资源；扩展自身规则仍保留'));card.append(area);
   }
  const actions=el('div','native-actions');if(a.id==='hermes'){const feishu=el('button','secondary','飞书对话 / 自动连接');feishu.onclick=()=>switchView('feishu');actions.append(feishu)}if(a.id==='codex'){const projection=el('button','secondary','Codex 原生界面');projection.onclick=()=>switchView('projection');actions.append(projection)}if(a.taskAdapter){const chat=el('button','secondary','网页对话 / 输出');chat.onclick=()=>{switchView('chat');chooseActor(a.id)};actions.append(chat);const history=el('button','secondary','历史对话');history.onclick=()=>{chooseActor(a.id);showConversationHistory().catch(e=>toast(e.message))};actions.append(history);if(!a.ready){const retry=el('button','secondary',['checking','connecting'].includes(a.connectionState)?'自动连接中…':'重连接口');retry.disabled=['checking','connecting'].includes(a.connectionState);retry.onclick=()=>reconnectAgent(a.id);actions.append(retry)}}
  else{const remote=el('button','secondary','通过 PC 远控操作');remote.onclick=()=>$('#vivo-remote-open').click();actions.append(remote)}
  const open=el('button','native-link',a.nativeEntry==='terminal'?'在电脑打开原生终端':'在电脑打开原生软件');open.disabled=!a.installed;open.title='在电脑打开窗口；平板不会自动投影，请使用网页任务或 PC 远控';open.onclick=()=>launchNative('agent',a.id).catch(e=>toast(e.message));actions.append(open);
  const update=el('button','native-update-button','原生更新');update.disabled=!a.installed;update.onclick=()=>openNativeUpdate(a.id);actions.append(update);
  const skills=el('button','native-link','Skills / 插件');skills.onclick=()=>{switchView('skills');$('#skills-actor').value=a.id;loadSkills()};actions.append(skills);card.append(actions);list.append(card);
 }
}
async function openNativeUpdate(actor){if(!confirm('打开 '+(actorNames[actor]||actor)+' 的原生更新入口？工作台不会自动安装或改配置。'))return;try{const d=await post('/api/native/updates/open',{actor,confirmed:true,idempotency_key:crypto.randomUUID()});toast(d.message||'已打开原生更新入口')}catch(e){toast(e.message)}}

function renderVaults(){
 const vaults=nativeCatalog?.vaults||state.native_integrations?.vaults;if(!vaults)return;
 const list=$('#vault-separation');list.replaceChildren();
 for(const [id,v] of Object.entries(vaults)){const box=el('div','vault-info');box.append(el('b','',id==='ai'?'AI 项目共享库':'我的个人笔记'),el('p','',v.role),el('small','',v.path));
 if(id==='personal'){box.append(el('p','muted',v.syncStatus));const button=el('button','secondary','在 Obsidian 打开个人库');button.disabled=!v.exists;button.onclick=()=>launchNative('personal-vault').catch(e=>toast(e.message));box.append(button)}list.append(box)}
}
async function loadSkills(){
 if(!$('#skills-actor').options.length)for(const [id,name] of Object.entries(allNativeNames)){const o=el('option','',name);o.value=id;$('#skills-actor').append(o)}
 try{currentSkills=await api('/api/native/skills/'+$('#skills-actor').value);renderSkills()}catch(e){$('#skills-summary').textContent=e.message}
}
function renderSkills(){
 if(!currentSkills)return;const q=$('#skill-search').value.toLowerCase();const list=$('#skills-list');list.replaceChildren();
 const skills=currentSkills.skills.filter(s=>(s.name+' '+s.description).toLowerCase().includes(q));$('#skills-summary').textContent=currentSkills.name+' · '+currentSkills.skills.length+' 个 Skill · '+currentSkills.management;
 for(const s of skills){const card=el('article','skill-card');card.append(el('b','',s.name),el('p','',s.description||'原生 Skill，未读取到简述'),el('small','',s.path));if(s.sharedNativeDiscovery)card.append(el('span','status-pill','原生兼容发现，未复制'));list.append(card)}
 if(!skills.length)list.append(el('div','empty','未发现匹配的 Skill；不会为了填满界面自动安装。'));
 const plugins=$('#plugins-list');plugins.replaceChildren();for(const p of currentSkills.plugins){const row=el('div','plugin-row');row.append(el('b','',p.name),el('small','',p.state));plugins.append(row)}if(!currentSkills.plugins.length)plugins.append(el('p','muted','未在已知原生目录发现插件。MCP 与扩展的完整启停管理尚未接入。'));
}
$('#vivo-remote-open').onclick=async()=>{const b=$('#vivo-remote-open');b.disabled=true;try{if(!confirm('在电脑上打开 vivo 办公套件并尝试选择 PC远控？不自动登录、配对或修改授权。'))return;await launchNative('vivo')}catch(e){toast(e.message)}finally{b.disabled=false}};
function renderPersonalSyncButton(r){const b=$('#personal-notes-sync');if(!b)return;const enabled=r?.manual_sync_available===true;b.disabled=personalSyncPending||!enabled;b.textContent=personalSyncPending?'⇄ 同步中…':(enabled?'⇄ 同步笔记':'同步待启用');b.title=enabled?'只同步个人笔记库；完成后自动暂停':'笔记同步更新已准备，需要重启同舟后启用';}
$('#personal-notes-sync').onclick=async()=>{personalSyncPending=true;renderPersonalSyncButton(remoteStatus||state.remote_services);try{const result=await post('/api/remote/notes-sync',{idempotency_key:crypto.randomUUID()});toast(result.message);remoteStatus=await api('/api/remote/status');renderRemotePanel()}catch(e){toast(e.message)}finally{personalSyncPending=false;renderPersonalSyncButton(remoteStatus||state.remote_services)}};
$('#native-refresh').onclick=loadNativeCatalog;$('#ccswitch-open').onclick=async()=>{if(!confirm('打开 CC Switch 原生配置界面？同舟只读同步，不会直接修改 CC Switch 数据库。'))return;try{await post('/api/ccswitch/open',{confirmed:true});toast('已打开 CC Switch')}catch(e){toast(e.message)}};$('#skills-actor').onchange=loadSkills;$('#skill-search').oninput=renderSkills;$('#skills-folder-open').onclick=()=>launchNative('skills',$('#skills-actor').value).catch(e=>toast(e.message));


function visibleConversationJobs(){
 const cid=conversationView.id;if(!cid)return [];
 const items=new Map((conversationView.jobs||[]).filter(j=>!internalJob(j)).map(j=>[j.id,j]));
 for(const j of state.jobs||[])if(j.conversation_id===cid)items.set(j.id,j);
 return [...items.values()].filter(j=>j.conversation_id===cid&&!internalJob(j)).sort((a,b)=>b.created-a.created||b.id.localeCompare(a.id));
}
function renderConversationHeader(){
 const c=conversationView.conversation;$('#conversation-title').textContent=c?.title||'正在读取…';
 fileWorkspace?.sync(c);
 collaborationView?.sync(c,conversationView.collaboration);
 $('#conversation-origin').textContent=c?(c.source==='native'?'原生会话 · 不复制全文':'同舟独立会话'):'选择对话后再发送';
 $('#conversation-native-view').hidden=c?.source!=='native';$('#conversation-load-earlier').hidden=!conversationView.before;
  if(conversationView.loading)$('#chat-form .send').disabled=true;
   renderChatFeishuHeader();
   renderChatPermissions();
}
async function loadConversation(renderAfter=true){
 const actor=$('#actor').value,cid=state.active_conversations?.[actor];const request=++conversationRequest;
 if(!cid){conversationView={id:null,actor,jobs:[],conversation:null,before:null,loading:false};if(renderAfter)render();return}
 const changed=conversationView.id!==cid;conversationView.loading=true;if(changed){conversationView={id:cid,actor,jobs:[],conversation:null,before:null,loading:true};renderConversationHeader()}
 try{
  const d=await api('/api/conversations/'+encodeURIComponent(cid)+'/messages');
  if(request!==conversationRequest||$('#actor').value!==actor)return;
  const prev=changed?[]:conversationView.jobs;const all=new Map(prev.map(j=>[j.id,j]));for(const j of d.jobs)all.set(j.id,j);
  conversationView={...conversationView,id:cid,actor,conversation:{...d.conversation,resume_supported:d.conversation.actor!=='hermes'||d.conversation.source!=='native'},collaboration:d.collaboration,jobs:[...all.values()],before:changed?d.before:(conversationView.before||d.before),loading:false};
  if(d.conversation.source==='native'&&!conversationView.nativeLoaded){
   try{const transcript=await api('/api/conversations/'+encodeURIComponent(cid)+'/native-messages');if(request!==conversationRequest||$('#actor').value!==actor)return;conversationView.nativeMessages=transcript.messages;conversationView.nativeNote=transcript.note;conversationView.nativeLoaded=true}catch(e){if(request!==conversationRequest)return;conversationView.nativeNote='原生正文读取失败：'+e.message+'。可点“查看原生历史”重试。';conversationView.nativeLoaded=true}
  }
  if(renderAfter)render();
 }catch(e){if(request===conversationRequest){conversationView.loading=true;toast('对话读取失败：'+e.message);$('#chat-form .send').disabled=true}}
}
async function showConversationHistory(){
 const select=$('#history-actor');if(!select.options.length)for(const [id,name] of Object.entries(allNativeNames)){const o=el('option','',name);o.value=id;select.append(o)}
 select.value=$('#actor').value;$('#history-search').value='';$('#history-hidden').checked=false;$('#conversation-dialog').showModal();
 await retrieveNativeHistory();
}
async function retrieveNativeHistory(){
 const actor=$('#history-actor').value;
 if(!actorNames[actor]){await loadHistoryList();return}
 $('#history-status').textContent='读取原生目录…';$('#history-scan').disabled=true;
 try{const d=await post('/api/conversations/scan',{actor});$('#history-status').textContent=d.warnings?.join('；')||(d.cache_hit?'已复用原生目录缓存':'已检索原生目录；不复制全文')}catch(e){$('#history-status').textContent=e.message}finally{$('#history-scan').disabled=false}
 await loadHistoryList();
}
async function loadHistoryList(){
 const actor=$('#history-actor').value,request=++historyRequest,list=$('#history-list');
 if(!actorNames[actor]){list.replaceChildren(el('p','empty','该 Agent 尚无已验证的历史接口。使用原生软件历史页，不虚报可续接。'));const open=el('button','secondary','打开 '+allNativeNames[actor]+' 原生软件');open.onclick=()=>launchNative('agent',actor).catch(e=>toast(e.message));list.append(open);return}
 try{
  const d=await api('/api/conversations?actor='+actor+'&q='+encodeURIComponent($('#history-search').value)+'&hidden='+($('#history-hidden').checked?'1':'0'));
  if(request!==historyRequest)return;list.replaceChildren();
  for(const c of d.items){
   const row=el('article','history-row'+(c.active?' active':''));const info=el('div','history-row-copy');info.append(el('b','',c.title),el('small','',new Date(c.updated*1000).toLocaleString('zh-CN')+' · '+(c.source==='native'?'原生索引':'同舟对话')+' · '+c.turns+' 条同舟记录'),el('p','',c.preview||'原生正文按需读取，不重复保存'));row.append(info);const controls=el('div','history-row-actions');
   if(c.deleted){const restore=el('button','secondary','恢复到列表');restore.onclick=async()=>{try{await post('/api/conversations/'+c.id+'/restore',{});await refresh();await loadHistoryList()}catch(e){toast(e.message)}};controls.append(restore)}
   else{
    if(c.source==='native'){const view=el('button','secondary','查看正文');view.onclick=()=>viewNativeTranscript(c);controls.append(view)}
    const open=el('button','secondary',c.resume_supported?(c.active?'当前对话':'选择 / 续接'):'查看原生历史');
    open.onclick=async()=>{if(!c.resume_supported){await viewNativeTranscript(c);return}if(c.source==='native'&&!confirm('续接 '+c.title+' 的原生记录？请先结束该原生会话的当前任务，避免同时写入。原工作目录：'+(c.cwd||'未记录')+'。这不会把完整聊天复制给模型。'))return;try{await post('/api/conversations/'+c.id+'/select',{});state.active_conversations[actor]=c.id;$('#actor').value=actor;$('#conversation-dialog').close();await refresh();switchView('chat')}catch(e){toast(e.message)}};
    const hide=el('button','history-hide','移除');hide.onclick=async()=>{if(!confirm('从同舟列表隐藏这段对话？原生历史和任务证据保留，可在“已隐藏”中恢复。'))return;try{await api('/api/conversations/'+c.id,{method:'DELETE'});await refresh();await loadHistoryList()}catch(e){toast(e.message)}};
    controls.append(open,hide);
   }
   row.append(controls);list.append(row);
  }
  if(!d.items.length)list.append(el('div','empty','没有匹配对话。可新建对话或检索原生历史。'));
 }catch(e){if(request===historyRequest)list.replaceChildren(el('div','empty',e.message))}
}
async function viewNativeTranscript(c){
 $('#native-transcript-title').textContent=c.title;const body=$('#native-transcript-body');body.replaceChildren(el('p','muted','按需读取最近文本…'));$('#native-transcript-dialog').showModal();
 try{const d=await api('/api/conversations/'+c.id+'/native-messages');body.replaceChildren();for(const m of d.messages){const row=el('div','message'+(m.role==='user'?' user':''));row.append(el('b','',m.role==='user'?'你':allNativeNames[c.actor]),el('div','message-body',m.text));body.append(row)}body.append(el('p','muted',d.note||'最近文本；不写入同舟数据库'))}catch(e){body.replaceChildren(el('p','muted',e.message))}
}
$('#conversation-history-open').onclick=()=>showConversationHistory().catch(e=>toast(e.message));$('#history-scan').onclick=retrieveNativeHistory;$('#history-actor').onchange=retrieveNativeHistory;$('#history-hidden').onchange=loadHistoryList;
$('#history-search').oninput=()=>{clearTimeout(historySearchTimer);historySearchTimer=setTimeout(loadHistoryList,300)};
$('#conversation-new-open').onclick=()=>{newConversationKey=crypto.randomUUID();$('#new-conversation-title').value='';$('#new-conversation-actor').textContent=actorNames[$('#actor').value];$('#new-conversation-error').textContent='';$('#new-conversation-dialog').showModal();$('#new-conversation-title').focus()};
$('#new-conversation-form').onsubmit=async e=>{e.preventDefault();const button=$('#new-conversation-submit');button.disabled=true;try{const actor=$('#actor').value;const d=await post('/api/conversations',{actor,title:$('#new-conversation-title').value.trim(),idempotency_key:newConversationKey||crypto.randomUUID()});state.active_conversations=state.active_conversations||{};state.active_conversations[actor]=d.conversation.id;$('#new-conversation-dialog').close();await refresh()}catch(e){$('#new-conversation-error').textContent=e.message}finally{button.disabled=false}};
$('#conversation-native-view').onclick=()=>viewNativeTranscript(conversationView.conversation);
$('#conversation-load-earlier').onclick=async()=>{const cid=conversationView.id,before=conversationView.before;if(!before)return;try{const d=await api('/api/conversations/'+cid+'/messages?before='+encodeURIComponent(before));if(cid!==conversationView.id)return;conversationView.jobs.push(...d.jobs);conversationView.before=d.before;render()}catch(e){toast(e.message)}};

let roomsData=[],dispatchRoomId=null,roomCreateKey=null,roomPending=false,roomRows=0,roomBotOptions=[];
async function loadRooms(){try{const d=await api('/api/rooms');roomsData=d.rooms||[];renderRooms()}catch(e){toast(e.message)}}
function renderRooms(){
 const list=$('#room-list');if(!list)return;list.replaceChildren();
 if(!roomsData.length){list.append(el('div','empty','还没有群聊。新建时可选择已有上下文的对话；创建不会调用模型。'));return}
 for(const room of roomsData){
  const card=el('article','room-card'),head=el('div','room-card-head');
  head.append(el('h4','',room.title),el('span','status-pill',(room.participants?.length||room.members.length)+' 位成员'));card.append(head);
  const members=el('div','room-members');
  if(room.participants?.length)for(const m of room.participants)members.append(el('span','',m.label+' · '+(actorNames[m.actor]||m.actor)));
  else for(const m of room.members)members.append(el('span','',actorNames[m]||m));
  card.append(members);const actions=el('div','native-actions'),dispatch=el('button','secondary','派发任务');
  dispatch.onclick=()=>openRoomDispatch(room);actions.append(dispatch);card.append(actions);list.append(card);
 }
}
function roomMembers(room){return room.participants?.length?room.participants:room.members.map(actor=>({member_id:actor,actor,label:actorNames[actor]}))}
function openRoomDispatch(room){
 dispatchRoomId=room.id;const source=$('#room-source-agent'),target=$('#room-target-agent');source.replaceChildren();target.replaceChildren();
 for(const m of roomMembers(room)){for(const box of [source,target]){const o=el('option','',m.label+' · '+actorNames[m.actor]);o.value=m.member_id;box.append(o)}}
 if(target.options.length>1)target.selectedIndex=1;
 $('#room-dispatch-meta').textContent=room.title+' · 任务继续所选成员的独立原生上下文';$('#room-goal').value='';$('#room-dispatch-error').textContent='';$('#room-dispatch-dialog').showModal();
}
async function loadRoomRow(row){
 const actor=row.dataset.actor,profile=row.querySelector('.room-profile')?.value||'default',select=row.querySelector('.room-conversation');
 const selected=select.value;select.replaceChildren();const fresh=el('option','','新建独立对话');fresh.value='';select.append(fresh);
 const d=await api('/api/conversations?actor='+encodeURIComponent(actor));
 for(const c of d.items||[]){if(!c.resume_supported||c.deleted||(actor==='hermes'&&(c.native_profile||'default')!==profile))continue;const option=el('option','',(c.active?'当前 · ':'')+c.title+' · '+(c.source==='native'?'原生已有上下文':'同舟已有上下文'));option.value=c.id;select.append(option)}
 if([...select.options].some(o=>o.value===selected))select.value=selected;
}
async function addRoomRow(actor,extra=false){
 const row=el('div','room-context-row');row.dataset.actor=actor;row.dataset.memberId='member-'+roomRows++;
 const label=el('label','room-context-enable'),check=document.createElement('input');check.type='checkbox';check.checked=true;
 label.append(check,el('b','',actorNames[actor]));row.append(label);
 if(actor==='hermes'){
  const profile=document.createElement('select');profile.className='room-profile';profile.setAttribute('aria-label','Hermes 原生机器人');
  const bots=roomBotOptions.length?roomBotOptions:[{name:'default',display_name:'主机器人'}];
  for(const bot of bots){const o=el('option','',bot.display_name||bot.name);o.value=bot.name;profile.append(o)}
  profile.onchange=()=>loadRoomRow(row).catch(e=>$('#room-error').textContent=e.message);row.append(profile);
 }
 const select=document.createElement('select');select.className='room-conversation';select.setAttribute('aria-label',actorNames[actor]+' 成员对话');row.append(select);
 const scan=el('button','secondary','读取原生历史');scan.type='button';scan.onclick=async()=>{scan.disabled=true;try{await post('/api/rooms/scan',{actor,profile:row.querySelector('.room-profile')?.value||'default'});await loadRoomRow(row)}catch(e){$('#room-error').textContent=e.message}finally{scan.disabled=false}};row.append(scan);
 $('#room-member-options').append(row);await loadRoomRow(row);return row;
}
$('#room-new-open').onclick=async()=>{
 $('#room-member-options').replaceChildren();$('#room-name').value='';$('#room-error').textContent='';roomRows=0;roomCreateKey=crypto.randomUUID();$('#room-dialog').showModal();
 roomBotOptions=[];
 try{roomBotOptions=(await api('/api/rooms/bots')).bots||[]}catch(e){$('#room-error').textContent='机器人列表暂未读回；主机器人仍可选择。'+e.message}
 for(const actor of Object.keys(actorNames))try{await addRoomRow(actor)}catch(e){$('#room-error').textContent=e.message}
};
$('#room-add-hermes').onclick=()=>addRoomRow('hermes',true).catch(e=>$('#room-error').textContent=e.message);
$('#room-form').onsubmit=async e=>{
 e.preventDefault();if(roomPending)return;const submit=$('#room-form button[type=submit]');
 try{
  const participants=$$('#room-member-options .room-context-row').filter(row=>row.querySelector('input[type=checkbox]').checked).map(row=>({member_id:row.dataset.memberId,actor:row.dataset.actor,profile:row.querySelector('.room-profile')?.value||'default',conversation_id:row.querySelector('.room-conversation').value,label:actorNames[row.dataset.actor]+(row.querySelector('.room-profile')?' · '+row.querySelector('.room-profile').selectedOptions[0].textContent:'')}));
  if(!participants.length)throw Error('至少选择一位成员');
  const title=$('#room-name').value.trim();if(!title)throw Error('请输入群聊名称');
  roomPending=true;submit.disabled=true;submit.textContent='正在创建…';$('#room-error').textContent='';
  await post('/api/rooms',{title,participants,idempotency_key:roomCreateKey});$('#room-dialog').close();await loadRooms();toast('群聊已创建；成员保留自己的上下文，没有调用模型');
 }catch(error){$('#room-error').textContent=error.message}finally{roomPending=false;submit.disabled=false;submit.textContent='创建群聊'}
};
$('#room-dispatch-form').onsubmit=async e=>{
 e.preventDefault();try{
  const room=roomsData.find(r=>r.id===dispatchRoomId),members=roomMembers(room),source=members.find(m=>m.member_id===$('#room-source-agent').value),target=members.find(m=>m.member_id===$('#room-target-agent').value);
  if(!source||!target||source.member_id===target.member_id)throw Error('请选择不同的发起成员和目标成员');
  const data={source_actor:source.actor,actor:target.actor,goal:$('#room-goal').value.trim(),idempotency_key:crypto.randomUUID()};
  if(room.participants?.length)Object.assign(data,{source_member_id:source.member_id,member_id:target.member_id});
  await post('/api/rooms/'+dispatchRoomId+'/dispatch',data);$('#room-dispatch-dialog').close();toast('任务已派发到所选上下文，结果回到发起成员');await loadRooms();
 }catch(error){$('#room-dispatch-error').textContent=error.message}
};

let feishuData = null, feishuPending = false, feishuPoll = null, feishuPolls = 0, feishuAttempt = null;
function feishuMessage(text, error = false) {
  const box = $('#feishu-feedback');
  box.textContent = text;
  box.classList.toggle('error', error);
}
function stopFeishuPoll() { clearTimeout(feishuPoll); feishuPoll = null; }
async function feishuApi(path, options = {}) {
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 50000);
  try {
    const response = await fetch(path, { credentials: 'same-origin', cache: 'no-store', ...options,
      headers: {'Content-Type': 'application/json', ...options.headers}, signal: controller.signal });
    const data = await response.json();
    if (!response.ok) throw Error(data.error || '原生飞书操作失败');
    return data;
  } catch (error) {
    if (error.name === 'AbortError') throw Error('原生操作确认超时；请先刷新状态，未自动重复提交');
    throw error;
  } finally { clearTimeout(timer); }
}
async function loadFeishu(preserve = false) {
  if (!preserve) feishuMessage('正在读取原生飞书状态…');
  try {
    const health = await api('/health');
    if ((health.native_feishu_revision || 0) < 2) throw Error('飞书稳定版页面已准备，电脑后台还需加载此次更新');
    feishuData = await feishuApi('/api/feishu/bridge/status?fresh=1');
    renderFeishu();
    if (!preserve) {
      const d = feishuData;
      feishuMessage(d.connected ? (d.handoff_in_flight ? '原生对话接入中；等待原生确认，不会重复提交' :
        d.busy ? '原生飞书已连接；Hermes 正在工作，任务结束后再切换' :
        '原生飞书已连接；可选择对话接入') : '原生飞书尚未连接；点击“连接 / 重连”');
    }
    return true;
  } catch (error) {
    feishuData = null;
    $('#feishu-switch').disabled = true;
    feishuMessage(error.message, true);
    return false;
  }
}
function renderFeishu() {
  if (!feishuData) return;
  const d = feishuData, summary = $('#feishu-summary');
  summary.replaceChildren();
  const rows = [
    ['网关', d.gateway_live ? '正在运行' : '未运行'],
    ['飞书', d.connected ? '已连接' : d.connection_state || '未连接'],
    ['Windows 登录启动', d.startup.enabled ? (d.startup.stable_launcher ? '已启用 · 官方稳定入口' : '已启用 · 启动入口待修复') : '尚未启用'],
    ['当前任务', d.busy ? 'Hermes 正在工作' : d.handoff_in_flight ? '原生对话切换中' : d.gateway_idle_verified ? '空闲' : '等待最新状态']
  ];
  for (const [name, value] of rows) {
    const row = el('div', 'feishu-info');
    row.append(el('small', '', name), el('b', '', value)); summary.append(row);
  }
  for (const warning of d.warnings || []) summary.append(el('p', 'muted', warning));
  const channels = $('#feishu-channel'), sessions = $('#feishu-session');
  const oldChannel = channels.value, oldSession = sessions.value;
  channels.replaceChildren();
  for (const route of d.routes) {
    const option = el('option', '', (route.name || '飞书') + ' · ' + route.chat_id);
    option.value = route.chat_id; channels.append(option);
  }
  if (d.routes.some(r => r.chat_id === oldChannel)) channels.value = oldChannel;
  if (!d.routes.length) {
    const option = el('option', '', '暂无已配置的飞书会话，请先在原生飞书发一条消息');
    option.value = ''; channels.append(option);
  }
  sessions.replaceChildren();
  const current = d.routes.find(r => r.chat_id === channels.value)?.session_id;
  for (const session of d.sessions) {
    const option = el('option', '', (session.id === current ? '当前飞书 · ' : '') + session.title + ' · ' + session.source);
    option.value = session.id; sessions.append(option);
  }
  if (d.sessions.some(s => s.id === oldSession)) sessions.value = oldSession;
  else if (current) sessions.value = current;
  const list = $('#feishu-session-list'); list.replaceChildren();
  for (const session of d.sessions) {
    const card = el('article', 'feishu-session-card'), copy = el('div');
    const handoff = {pending: ' · 接入待处理', running: ' · 接入中', failed: ' · 上次接入失败'}[session.handoff_state] || '';
    copy.append(el('b', '', session.title), el('small', '', session.source + ' · ' + session.messages + ' 条原生记录' + handoff), el('code', '', session.id));
    const choose = el('button', 'secondary', session.id === current ? '当前飞书' : '选择此对话');
    choose.disabled = feishuPending;
    choose.onclick = () => {
      sessions.value = session.id;
      feishuMessage('已选择“' + session.title + '”；点击“接入所选对话”后才会切换');
    };
    card.append(copy, choose); list.append(card);
  }
  if (!d.sessions.length) list.append(el('p', 'muted', '暂未发现可接入的原生对话，不复制或伪造历史。'));
  $('#feishu-switch').disabled = feishuPending || !d.switch_available || !current || !d.sessions.length;
  for (const id of ['feishu-connect', 'feishu-startup', 'feishu-refresh', 'feishu-channel', 'feishu-session']) {
    $('#' + id).disabled = feishuPending;
  }
}
async function feishuOperation(data) {
  if(chatFeishuPending||feishuPending)throw Error('已有飞书操作进行中，请等待完成');
  feishuPending = true; renderFeishu();
  try { return await feishuApi('/api/feishu/bridge/action', {method: 'POST', body: JSON.stringify(data)}); }
  finally { feishuPending = false; renderFeishu(); }
}
$('#feishu-refresh').onclick = () => loadFeishu();
$('#feishu-channel').onchange = renderFeishu;
$('#feishu-connect').onclick = async () => {
  feishuMessage('正在检查原生连接，复用已运行的 Hermes…');
  try {
    feishuData = await feishuOperation({action: 'connect'}); renderFeishu();
    feishuMessage(feishuData.connected ? '原生飞书已连接；没有切换对话或调用模型' : feishuData.message, !feishuData.connected);
  } catch (error) { feishuMessage(error.message, true); }
};
$('#feishu-startup').onclick = async () => {
  if (!confirm('启用/修复 Hermes 原生 Windows 登录启动？保留当前模型和飞书会话，不重启网关。')) return;
  try {
    const result = await feishuOperation({action: 'startup', confirmed: true});
    if (!(await loadFeishu(true))) return;
    feishuMessage(result.enabled && result.stable_launcher ? '开机启动已配置并读回确认；登录 Windows 后使用官方稳定入口，保留既有绑定' : '启动入口尚未确认，请检查系统启动应用', !result.enabled || !result.stable_launcher);
  } catch (error) { feishuMessage(error.message, true); }
};
async function pollFeishuHandoff(chatId, sessionId, title) {
  stopFeishuPoll(); feishuPolls = 0;
  const check = async () => {
    if ($('#view-feishu').hidden) return;
    if (++feishuPolls > 60) {
      feishuMessage('原生接入确认仍未结束；请刷新查看，不会自动重试或重复发消息', true); return;
    }
    if (!(await loadFeishu(true))) return;
    const target = feishuData.sessions.find(s => s.id === sessionId);
    if (target?.handoff_state === 'failed') {
      feishuMessage('Hermes 原生接入失败；请检查原生网关日志，未自动重试', true); return;
    }
    const current = feishuData.routes.find(r => r.chat_id === chatId);
    if (current?.session_id === sessionId && !feishuData.handoff_in_flight) {
      feishuMessage('已接入“' + title + '”；原生状态已读回，后续飞书消息继续这段对话'); return;
    }
    feishuMessage('原生对话接入中；等待 Hermes 原生确认，不会重复提交');
    feishuPoll = setTimeout(check, 3000);
  };
  feishuPoll = setTimeout(check, 1500);
}
$('#feishu-switch').onclick = async () => {
  if (!feishuData || feishuPending) return;
  const sessionId = $('#feishu-session').value, chatId = $('#feishu-channel').value;
  const route = feishuData.routes.find(r => r.chat_id === chatId), selected = feishuData.sessions.find(s => s.id === sessionId);
  if (!route || !selected) return;
  if (sessionId !== route.session_id && !confirm('将“' + selected.title + '”接到飞书？Hermes 原生会发一次接入确认，可能调用一次模型；正在运行的任务不得切换。')) return;
  const fingerprint = JSON.stringify([sessionId, route.session_id, chatId]);
  if (!feishuAttempt || feishuAttempt.fingerprint !== fingerprint) feishuAttempt = {fingerprint, key: crypto.randomUUID()};
  try {
    const result = await feishuOperation({action: 'switch', session_id: sessionId, expected_session_id: route.session_id,
      chat_id: chatId, idempotency_key: feishuAttempt.key, confirmed: true});
    feishuMessage(result.message);
    if (!(await loadFeishu(true))) return;
    if (result.queued) pollFeishuHandoff(chatId, sessionId, selected.title);
  } catch (error) { feishuMessage(error.message, true); }
};

let chatFeishuPending=false,chatFeishuContext=null,chatFeishuFeedback=null,chatFeishuPoll=null,chatFeishuAttempt=null;
const chatFeishuButton=el('button','secondary','飞书接入此对话');
chatFeishuButton.id='conversation-feishu-attach';chatFeishuButton.type='button';chatFeishuButton.hidden=true;
$('.conversation-controls').prepend(chatFeishuButton);
const chatFeishuStatus=el('p','chat-feishu-status');chatFeishuStatus.id='conversation-feishu-status';
chatFeishuStatus.hidden=true;chatFeishuStatus.setAttribute('role','status');chatFeishuStatus.setAttribute('aria-live','polite');
$('.conversation-toolbar').after(chatFeishuStatus);
const chatFeishuDialog=el('dialog','runtime-dialog');chatFeishuDialog.id='chat-feishu-dialog';
const chatFeishuForm=el('form'),chatFeishuHeading=el('div','dialog-title'),chatFeishuTitle=el('h3','','飞书接入此对话');
const chatFeishuClose=el('button','','关闭');chatFeishuClose.type='button';chatFeishuClose.onclick=()=>chatFeishuDialog.close();
chatFeishuHeading.append(chatFeishuTitle,chatFeishuClose);
const chatFeishuLabel=el('label','','飞书频道'),chatFeishuSelect=el('select');chatFeishuSelect.id='chat-feishu-channel';
chatFeishuLabel.append(chatFeishuSelect);
const chatFeishuSubmit=el('button','primary','接入此对话');chatFeishuSubmit.type='submit';
chatFeishuForm.append(chatFeishuHeading,chatFeishuLabel,chatFeishuSubmit);chatFeishuDialog.append(chatFeishuForm);document.body.append(chatFeishuDialog);

function renderChatFeishuHeader(){
 const c=conversationView.conversation,hermes=$('#actor').value==='hermes';
 chatFeishuButton.hidden=!hermes;chatFeishuButton.disabled=conversationView.loading||!c||chatFeishuPending||feishuPending;
 chatFeishuButton.textContent=chatFeishuPending?'飞书接入中…':chatFeishuFeedback&&chatFeishuFeedback.cid===c?.id&&chatFeishuFeedback.bound?'飞书已接入此对话':'飞书接入此对话';
 chatFeishuButton.title=c?.native_profile&&c.native_profile!=='default'?'飞书主机器人不能接入其他 profile':'将现有飞书绑定接入当前 Hermes 原生会话';
 const feedback=hermes&&chatFeishuFeedback?.cid===c?.id?chatFeishuFeedback:null;
 chatFeishuStatus.hidden=!feedback;chatFeishuStatus.textContent=feedback?.text||'';chatFeishuStatus.classList.toggle('error',Boolean(feedback?.error));
}
function chatFeishuMessage(cid,text,error=false,bound=false){
 chatFeishuFeedback={cid,text,error,bound};renderChatFeishuHeader();
}
function isChatFeishuCurrent(context){return $('#actor').value==='hermes'&&conversationView.id===context.cid&&!conversationView.loading}
async function readChatFeishu(context){
 return feishuApi('/api/conversations/'+encodeURIComponent(context.cid)+'/feishu');
}
function pollChatFeishu(context,chatId,count=0){
 clearTimeout(chatFeishuPoll);
 chatFeishuPoll=setTimeout(async()=>{
  if(!isChatFeishuCurrent(context)||$('#view-chat').hidden)return;
  try{
   const d=await readChatFeishu(context);if(!isChatFeishuCurrent(context))return;
   const target=d.feishu.sessions.find(s=>s.id===context.sid);
   if(target?.handoff_state==='failed'){chatFeishuMessage(context.cid,'Hermes 原生接入失败；未自动重试，请检查飞书 Hermes 状态',true);return}
   if(d.session_id!==context.sid){chatFeishuMessage(context.cid,'此对话原生会话已变化，请重新检查',true);return}
   if(d.bound_chat_ids.includes(chatId)&&!d.feishu.handoff_in_flight){chatFeishuMessage(context.cid,'飞书已接入此对话；后续飞书消息继续这段原生上下文',false,true);return}
   if(count>=59){chatFeishuMessage(context.cid,'接入确认仍未结束，请检查飞书 Hermes 状态；未重复提交',true);return}
   chatFeishuMessage(context.cid,'飞书接入中，等待 Hermes 原生确认');pollChatFeishu(context,chatId,count+1);
  }catch(error){if(isChatFeishuCurrent(context))chatFeishuMessage(context.cid,error.message,true)}
 },count===0?1500:3000);
}
async function attachChatFeishu(context,chatId){
 if(chatFeishuPending||feishuPending)return;
 chatFeishuPending=true;renderChatFeishuHeader();
 try{
  const d=await readChatFeishu(context);
  if(!isChatFeishuCurrent(context))throw Error('当前对话已变化，请在新的对话旁重新点击接入');
  if(d.session_id!==context.sid)throw Error('当前原生会话已变化，请重新点击接入');
  const routes=d.feishu.routes.filter(r=>r.chat_id===chatId);
  if(routes.length!==1)throw Error('飞书频道路由不唯一或已变化，请检查飞书 Hermes');
  const route=routes[0],same=route.session_id===context.sid;
  if(same&&d.feishu.handoff_in_flight){
   chatFeishuMessage(context.cid,'飞书接入中，等待 Hermes 原生确认');pollChatFeishu(context,chatId);return;
  }
  if(!d.feishu.connected||(!same&&!d.can_switch))throw Error(d.reason||'暂不可接入，请稍后重试');
  if(!same&&!confirm('将飞书接入“'+d.title+'”？后续飞书消息继续当前对话。Hermes 原生会发一次接入确认，可能调用一次模型。'))return;
  const fingerprint=JSON.stringify([context.cid,context.sid,route.session_id,chatId]);
  if(!chatFeishuAttempt||chatFeishuAttempt.fingerprint!==fingerprint)chatFeishuAttempt={fingerprint,key:crypto.randomUUID()};
  const result=await feishuApi('/api/conversations/'+encodeURIComponent(context.cid)+'/feishu',{method:'POST',body:JSON.stringify({
   expected_native_id:context.sid,expected_session_id:route.session_id,chat_id:chatId,idempotency_key:chatFeishuAttempt.key,confirmed:true})});
  chatFeishuDialog.close();
  if(isChatFeishuCurrent(context)){
   chatFeishuMessage(context.cid,result.queued?'飞书接入中，等待 Hermes 原生确认':result.message,false,result.state==='unchanged');
   if(result.queued)pollChatFeishu(context,chatId);
  }else toast('原对话的飞书接入已提交；当前新选择的对话未接入');
 }catch(error){chatFeishuMessage(context.cid,error.message,true)}
 finally{chatFeishuPending=false;renderChatFeishuHeader()}
}
chatFeishuButton.onclick=async()=>{
 if(chatFeishuPending||feishuPending||conversationView.loading)return;
 const context={cid:conversationView.id,sid:conversationView.conversation?.native_id};
 if(!context.cid)return;
 clearTimeout(chatFeishuPoll);chatFeishuPending=true;chatFeishuMessage(context.cid,'正在检查当前对话与飞书绑定…');
 try{
  const d=await readChatFeishu(context);if(!isChatFeishuCurrent(context))return;
  if(d.session_id!==context.sid)throw Error('当前原生会话已变化，请重新点击接入');
  if(!d.feishu.connected||!d.feishu.routes.length||!d.eligible)throw Error(d.reason||'此对话暂不可接入');
  if(d.feishu.routes.length===1){
   chatFeishuPending=false;await attachChatFeishu(context,d.feishu.routes[0].chat_id);
  }else{
   chatFeishuContext=context;chatFeishuSelect.replaceChildren();
   for(const route of d.feishu.routes){const option=el('option','',(route.name||'飞书')+' · '+route.chat_id);option.value=route.chat_id;chatFeishuSelect.append(option)}
   chatFeishuTitle.textContent='飞书接入“'+d.title+'”';chatFeishuDialog.showModal();
   chatFeishuMessage(context.cid,'请选择要接入的飞书频道');
  }
 }catch(error){if(isChatFeishuCurrent(context))chatFeishuMessage(context.cid,error.message,true)}
 finally{chatFeishuPending=false;renderChatFeishuHeader()}
};
chatFeishuForm.onsubmit=e=>{e.preventDefault();if(chatFeishuContext)attachChatFeishu(chatFeishuContext,chatFeishuSelect.value)};

// Restore authenticated sessions and initialize the live state on every page load.
refresh();
