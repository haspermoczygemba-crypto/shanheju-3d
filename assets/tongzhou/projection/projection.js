// State reads are deliberately independent from the native screen client.
// All requests and modules stay on this workbench origin; no model credentials here.
const $ = selector => document.querySelector(selector);
const STATE_TIMEOUT = 10000;
const COMPONENT_TIMEOUT = 15000;
let rfb = null, rfbClass = null, libraryTask = null;
let connecting = false, connected = false, desired = false, alive = true;
let reading = false, installed = false, attemptOwned = false;
let retryTimer = null, handshakeTimer = null, retries = 0;
const keymap = {tab:[0xff09,'Tab'], backspace:[0xff08,'Backspace'], escape:[0xff1b,'Escape']};

function status(text, kind = '') {
    $('#status').textContent = text;
    $('#status').dataset.kind = kind;
}
function controls() {
    $('#start').disabled = reading || !installed || connecting || connected;
    $('#retry-status').disabled = reading || connecting || connected;
    $('#stop').disabled = !connecting && !connected && !desired;
    $('#focus').disabled = !connected;
    $('#insert').disabled = !connected || $('#view-only').checked;
    for (const id of ['zoom-out','zoom-in','zoom-reset','zoom-fit']) {
        $('#'+id).disabled = !connected;
    }
    updateZoomLabel();
    document.querySelectorAll('[data-key]').forEach(button => {
        button.disabled = !connected || $('#view-only').checked;
    });
}
async function api(path, options = {}, timeout = STATE_TIMEOUT) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
        const response = await fetch(path, {
            credentials:'same-origin', cache:'no-store', ...options,
            headers:{'Content-Type':'application/json', ...(options.headers || {})},
            signal:controller.signal
        });
        if (response.status === 401) {
            throw Error('登录已过期，请返回同舟页面重新登录');
        }
        let data;
        try { data = await response.json(); }
        catch { throw Error('投影接口返回异常（HTTP ' + response.status + '），请重新读取状态'); }
        if (!response.ok) throw Error(data.error || '投影接口暂不可用（HTTP ' + response.status + '）');
        return data;
    } catch (error) {
        if (error.name === 'AbortError') {
            throw Error('请求超过 ' + Math.round(timeout / 1000) + ' 秒：检查电脑是否运行、手机 Tailscale 是否连接，然后点“重新读取”');
        }
        throw error;
    } finally { clearTimeout(timer); }
}
async function load() {
    if (reading || connecting || connected) return;
    reading = true;
    controls();
    status('正在读取电脑端状态…');
    try {
        const state = await api('/api/projection/status');
        installed = state.installed === true;
        if (!installed) status('投影组件未准备好，请检查电脑端组件', 'error');
        else if (state.connected) status('另一页面已连接；请先在那里断开，再连接此页面');
        else status(state.active ? '投影已准备；点击“连接原生界面”即可使用' : '未连接 · 请点击“连接原生界面”');
    } catch (error) {
        installed = false;
        status(error.message, 'error');
    } finally { reading = false; controls(); }
}
async function loadScreenClient() {
    if (rfbClass) return rfbClass;
    if (!libraryTask) {
        libraryTask = import('./screen-client.js?v=20261005-zoom1').then(module => {
            rfbClass = module.default;
            return rfbClass;
        }).catch(error => { libraryTask = null; throw error; });
    }
    let timer;
    try {
        return await Promise.race([
            libraryTask,
            new Promise((resolve, reject) => {
                timer = setTimeout(() => reject(Error('画面组件加载超过 15 秒，请重试；状态读取和模型接口不受影响')), COMPONENT_TIMEOUT);
            })
        ]);
    } catch (error) {
        throw Error('画面组件未加载：' + error.message);
    } finally { clearTimeout(timer); }
}
async function start() {
    if (reading || !installed || connecting || connected) return;
    desired = true;
    clearTimeout(retryTimer);
    connecting = true;
    controls();
    status('正在加载本机画面组件…');
    try {
        // Load client first, so a failed phone script cannot leave a native server running.
        const RFB = await loadScreenClient();
        if (!alive || !desired) return;
        status('正在连接电脑上的 Codex…');
        const state = await api('/api/projection/action', {
            method:'POST', body:JSON.stringify({action:'start'})
        }, 30000);
        if (state.connected) throw Error('已有页面在操作投影，请先断开那个页面');
        attemptOwned = true;
        if (!alive || !desired) return;
        connect(RFB);
    } catch (error) {
        connecting = false;
        desired = false;
        controls();
        status(error.message, 'error');
    }
}
function connect(RFB) {
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const client = new RFB($('#screen'), protocol + '//' + location.host + '/api/projection/ws');
    rfb = client;
    client.scaleViewport = $('#fit').checked;
    client.clipViewport = false;
    client.resizeSession = false;
    client.qualityLevel = 7;
    client.compressionLevel = 2;
    client.focusOnClick = true;
    client.viewOnly = $('#view-only').checked;
    client.panMode = $('#pan-mode').checked;
    client.addEventListener('localzoom', () => updateZoomLabel());
    clearTimeout(handshakeTimer);
    handshakeTimer = setTimeout(() => {
        if (rfb !== client || connected) return;
        desired = false;
        status('画面连接超过 20 秒，请重新连接；不会重复发送模型任务', 'error');
        client.disconnect();
    }, 20000);
    client.addEventListener('connect', () => {
        if (rfb !== client) return;
        clearTimeout(handshakeTimer);
        connecting = false;
        connected = true;
        retries = 0;
        controls();
        status('已连接 · 这是电脑当前的原生 Codex', 'ok');
    });
    client.addEventListener('disconnect', event => {
        if (rfb !== client) return;
        clearTimeout(handshakeTimer);
        rfb = null;
        connecting = false;
        connected = false;
        controls();
        if (desired && alive && retries < 3) {
            const wait = 1000 * 2 ** retries++;
            status('画面连接中断，正在重连…');
            retryTimer = setTimeout(start, wait);
        } else {
            desired = false;
            controls();
            if ($('#status').dataset.kind !== 'error') {
                status(event.detail?.clean ? '投影已断开，电脑任务不受影响' : '画面连接未完成，点连接重试', 'error');
            }
        }
    });
    client.addEventListener('credentialsrequired', () => {
        desired = false;
        status('投影配置与预期不一致；不会要求你填写模型密钥', 'error');
        client.disconnect();
    });
    client.addEventListener('securityfailure', event => {
        desired = false;
        status('投影安全协商失败：' + (event.detail?.reason || ''), 'error');
    });
}
async function stop() {
    desired = false;
    clearTimeout(retryTimer);
    clearTimeout(handshakeTimer);
    if (rfb) { const old = rfb; rfb = null; old.disconnect(); }
    connecting = false;
    connected = false;
    controls();
    try {
        if (attemptOwned) {
            await api('/api/projection/action', {method:'POST', body:JSON.stringify({action:'stop'})});
            attemptOwned = false;
        }
        status('投影已断开；原生 Codex 及其任务继续运行');
    } catch (error) { status(error.message, 'error'); }
}
async function focus() {
    try { await api('/api/projection/action', {method:'POST', body:JSON.stringify({action:'focus'})}); }
    catch (error) { status(error.message, 'error'); }
}
async function insert() {
    if (!rfb || !connected || $('#view-only').checked) return;
    const text = $('#input-text').value;
    if (!text) return;
    rfb.blur();
    $('#insert').disabled = true;
    try {
        const result = await api('/api/projection/text', {
            method:'POST', body:JSON.stringify({text, idempotency_key:crypto.randomUUID()})
        });
        $('#input-text').value = '';
        status(result.message + '；请检查原生输入框', 'ok');
    } catch (error) {
        status(error.message + '。没有自动重试，原文本已保留。', 'error');
    } finally { controls(); }
}
$('#start').onclick = start;
$('#retry-status').onclick = load;
$('#stop').onclick = stop;
$('#focus').onclick = focus;
$('#insert').onclick = insert;
$('#fullscreen').onclick = () => document.documentElement.requestFullscreen?.().catch(error => status('浏览器未进入全屏：' + error.message, 'error'));
$('#fit').onchange = () => { if (!rfb) return; if ($('#fit').checked) rfb.fitLocalViewport(); else rfb.setLocalScale(1); updateZoomLabel(); };
$('#view-only').onchange = () => { if (rfb) rfb.viewOnly = $('#view-only').checked; controls(); };
document.querySelectorAll('[data-key]').forEach(button => {
    button.onclick = () => { if (rfb && connected && !$('#view-only').checked) rfb.sendKey(...keymap[button.dataset.key]); };
});
function updateZoomLabel() {
    if (!rfb || !connected) { $('#zoom-value').textContent = '适应屏幕'; return; }
    const value = Math.round(rfb.localScale * 100);
    const fit = rfb.scaleViewport;
    $('#fit').checked = fit;
    $('#zoom-value').textContent = (fit ? '适应 · ' : '') + value + '%';
    $('#zoom-out').disabled = value <= 10;
    $('#zoom-in').disabled = value >= 300;
}
function changeZoom(factor) {
    if (!rfb || !connected) return;
    rfb.setLocalScale(rfb.localScale * factor);
    updateZoomLabel();
}
$('#zoom-out').onclick = () => changeZoom(1 / 1.25);
$('#zoom-in').onclick = () => changeZoom(1.25);
$('#zoom-reset').onclick = () => { if (rfb && connected) rfb.setLocalScale(1); updateZoomLabel(); };
$('#zoom-fit').onclick = () => { if (rfb && connected) rfb.fitLocalViewport(); updateZoomLabel(); };
$('#pan-mode').onchange = () => { if (rfb) rfb.panMode = $('#pan-mode').checked; };

function leave() {
    alive = false;
    desired = false;
    clearTimeout(retryTimer);
    clearTimeout(handshakeTimer);
    if (rfb) { rfb.disconnect(); rfb = null; }
    // Viewing state must not stop someone else's projection when this page closes.
    if (attemptOwned) {
        fetch('/api/projection/action', {method:'POST', credentials:'same-origin',
            headers:{'Content-Type':'application/json'}, body:JSON.stringify({action:'stop'}), keepalive:true
        }).catch(() => {});
    }
}
window.addEventListener('pagehide', leave);
window.addEventListener('message', event => {
    if (event.origin !== location.origin) return;
    if (event.data?.action === 'start') start();
    if (event.data?.action === 'stop') stop();
    if (event.data?.action === 'focus') focus();
});
controls();
load();
