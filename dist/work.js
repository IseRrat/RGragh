import { validateDocument, createEmptyMap } from './document-schema.js';

const STORAGE_KEY = 'kv-inference-lineage:v1';
const PENDING_KEY = `${STORAGE_KEY}-pending`;
const requestedNodeId = new URLSearchParams(location.search).get('id');
const $ = (selector) => document.querySelector(selector);
const escapeHtml = (value = '') => String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const safeUrl = (value) => { try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) ? url.href : ''; } catch { return ''; } };
const paperById = (id) => state?.papers.find((paper) => paper.id === id);
const node = () => state?.nodes.find((item) => item.id === requestedNodeId);
const statusLabels = { unread: '待读', reading: '在读', read: '已读' };
let state;
let revision = 0;
let remoteReady = false;
let conflict = false;
let dirty = false;
let savePromise = null;
let saveTimer;
let selectedPaperId = null;
let scope = requestedNodeId ? 'current' : 'all';
let tab = 'overview';
let query = '';
let toastTimer;
let importJobs = [];
let importsInitialized = false;
let importPollTimer;
let pendingUploadFiles = [];

function toast(message) {
  const element = $('#paperToast'); element.textContent = message; element.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => element.classList.remove('show'), 3200);
}
function setSaveStatus(message) { $('#paperSaveState').textContent = message; }
function linkedPaperIds() { return new Set(state.paperLinks.filter((link) => link.nodeId === requestedNodeId).map((link) => link.paperId)); }
function visiblePapers() {
  const linked = scope === 'current' ? linkedPaperIds() : null;
  const needle = query.trim().toLocaleLowerCase();
  return state.papers.filter((paper) => (!linked || linked.has(paper.id)) && (!needle || [paper.title, paper.authors, paper.year, paper.summary].join(' ').toLocaleLowerCase().includes(needle)))
    .sort((a, b) => b.year.localeCompare(a.year) || a.title.localeCompare(b.title));
}
function saveLocal() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  localStorage.setItem(PENDING_KEY, '1');
  dirty = true;
  setSaveStatus(remoteReady ? '正在保存…' : '已保存在此浏览器');
  clearTimeout(saveTimer);
  if (remoteReady && !conflict) saveTimer = setTimeout(flushRemote, 400);
}
function flushRemote() {
  if (!remoteReady || conflict) return false;
  if (savePromise) return savePromise;
  savePromise = performFlush().finally(() => { savePromise = null; });
  return savePromise;
}
async function performFlush() {
  clearTimeout(saveTimer);
  try {
    while (dirty) {
      dirty = false;
      const snapshot = JSON.stringify(state);
      const response = await fetch('/api/map', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ revision, document: JSON.parse(snapshot) }) });
      if (response.status === 409) {
        conflict = true; dirty = true; setSaveStatus('保存冲突 · 请先保留备份');
        toast('地图在其他页面有更新；当前修改仍在此浏览器。');
        return false;
      }
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      revision = (await response.json()).revision;
      if (JSON.stringify(state) !== snapshot) dirty = true;
    }
    localStorage.removeItem(PENDING_KEY);
    setSaveStatus('已保存到 MySQL');
    return true;
  } catch (error) {
    dirty = true; setSaveStatus('数据库暂不可用 · 本地已保存');
    toast(`保存失败：${error.message}`);
    saveTimer = setTimeout(flushRemote, 3000);
    return false;
  }
}
function renderShell() {
  const currentNode = node();
  $('#workTitle').textContent = currentNode ? currentNode.title : '个人论文库';
  document.title = `${currentNode ? currentNode.title : '论文库'} · RGragh`;
  $('[data-scope="current"]').hidden = !currentNode;
  if (!currentNode) scope = 'all';
  document.querySelectorAll('[data-scope]').forEach((button) => button.classList.toggle('active', button.dataset.scope === scope));
}
function renderList() {
  const papers = visiblePapers();
  $('#paperCount').textContent = `${papers.length} 篇`;
  $('#paperList').innerHTML = papers.length ? papers.map((paper) => `<button type="button" class="paper-list-item ${paper.id === selectedPaperId ? 'active' : ''}" data-paper="${escapeHtml(paper.id)}"><strong>${escapeHtml(paper.title)}</strong><span><i class="status-dot ${paper.status}"></i>${escapeHtml(paper.year || '未填年份')} · ${statusLabels[paper.status]}</span></button>`).join('')
    : `<div class="paper-list-empty">${query ? '没有匹配的论文' : scope === 'current' ? '这个节点还没有关联论文' : '论文库还是空的'}</div>`;
}
function renderOverview(paper) {
  const sourceUrl = safeUrl(paper.sourceUrl), codeUrl = safeUrl(paper.codeUrl);
  $('#paperOverview').innerHTML = `<div class="paper-form">
    <div class="paper-form-row"><label class="paper-field"><span>论文标题</span><input data-field="title" maxlength="500" value="${escapeHtml(paper.title)}"></label><label class="paper-field"><span>发表时间</span><input data-field="year" maxlength="40" placeholder="例如 2025.9" value="${escapeHtml(paper.year)}"></label></div>
    <div class="paper-form-row"><label class="paper-field"><span>作者</span><input data-field="authors" maxlength="2000" value="${escapeHtml(paper.authors)}"></label><label class="paper-field"><span>阅读状态</span><select data-field="status"><option value="unread" ${paper.status === 'unread' ? 'selected' : ''}>待读</option><option value="reading" ${paper.status === 'reading' ? 'selected' : ''}>在读</option><option value="read" ${paper.status === 'read' ? 'selected' : ''}>已读</option></select></label></div>
    <h3 class="paper-section-title">内容</h3>
    <label class="paper-field"><span>论文介绍</span><textarea data-field="summary" maxlength="12000" placeholder="这篇论文做了什么？与当前工作有什么关系？">${escapeHtml(paper.summary)}</textarea></label>
    <label class="paper-field"><span>原文摘要</span><textarea data-field="abstract" maxlength="16000" placeholder="可粘贴论文 Abstract">${escapeHtml(paper.abstract)}</textarea></label>
    <h3 class="paper-section-title">链接</h3>
    <label class="paper-field"><span>论文链接</span><input data-field="sourceUrl" type="url" maxlength="2000" placeholder="https://..." value="${escapeHtml(paper.sourceUrl)}">${sourceUrl ? `<small><a href="${escapeHtml(sourceUrl)}" target="_blank" rel="noopener noreferrer">打开论文 ↗</a></small>` : ''}</label>
    <label class="paper-field"><span>代码仓库</span><input data-field="codeUrl" type="url" maxlength="2000" placeholder="https://github.com/..." value="${escapeHtml(paper.codeUrl)}">${codeUrl ? `<small><a href="${escapeHtml(codeUrl)}" target="_blank" rel="noopener noreferrer">打开仓库 ↗</a></small>` : ''}</label>
    <h3 class="paper-section-title">阅读笔记</h3>
    <label class="paper-field notes"><span>笔记与疑问</span><textarea data-field="notes" maxlength="30000" placeholder="记录读到的关键点、疑问和自己的判断…">${escapeHtml(paper.notes)}</textarea></label>
  </div>`;
}
function renderReader(paper) {
  $('#paperReader').innerHTML = paper.hasPdf
    ? `<div class="reader-toolbar"><span>本地 PDF</span><button type="button" data-upload-pdf>更换 PDF</button><a href="/api/papers/${encodeURIComponent(paper.id)}/pdf" target="_blank" rel="noopener noreferrer">单独打开 ↗</a></div><iframe class="reader-frame" title="${escapeHtml(paper.title)} PDF" src="/api/papers/${encodeURIComponent(paper.id)}/pdf"></iframe>`
    : `<div class="reader-empty"><strong>还没有 PDF</strong><p>上传本地 PDF 后，就可以在这里阅读。</p><button type="button" data-upload-pdf>上传 PDF</button></div>`;
}
function renderPaper() {
  const paper = paperById(selectedPaperId);
  $('#paperEmpty').hidden = Boolean(paper);
  $('#paperDetail').hidden = !paper;
  if (!paper) return;
  $('#paperTitle').textContent = paper.title;
  $('#paperContext').textContent = scope === 'current' && node() ? `${node().title} · 相关论文` : '个人论文库';
  $('#unlinkPaper').hidden = !(node() && state.paperLinks.some((link) => link.nodeId === requestedNodeId && link.paperId === paper.id));
  document.querySelectorAll('[data-tab]').forEach((button) => { button.classList.toggle('active', button.dataset.tab === tab); button.setAttribute('aria-selected', String(button.dataset.tab === tab)); });
  $('#paperOverview').hidden = tab !== 'overview'; $('#paperReader').hidden = tab !== 'reader';
  renderOverview(paper); renderReader(paper);
}
function render() {
  renderShell();
  const visible = visiblePapers();
  if (!visible.some((paper) => paper.id === selectedPaperId)) selectedPaperId = visible[0]?.id || null;
  renderList(); renderPaper();
}
function renderImports() {
  const labels = { queued: '等待处理…', processing: '正在读论文…', done: '已完成', failed: '处理失败', undone: '已撤销入图' };
  $('#importCount').textContent = importJobs.some((job) => ['queued', 'processing'].includes(job.status)) ? '处理中' : '';
  $('#importList').innerHTML = importJobs.length ? importJobs.slice(0, 8).map((job) => {
    const result = job.result;
    const placement = result?.action === 'created' ? '已新增节点' : result?.action === 'linked' ? '已关联节点' : result?.action === 'unplaced' ? '已入库 · 暂未定位' : '';
    return `<div class="import-item ${escapeHtml(job.status)}"><strong>${escapeHtml(result?.title || job.filename)}</strong><span>${labels[job.status] || job.status}${placement ? ` · ${placement}` : ''}</span>${job.error ? `<p>${escapeHtml(job.error)}</p>` : ''}${result?.reason ? `<p>${escapeHtml(result.reason)}</p>` : ''}<div class="import-actions">${result?.paperId ? `<button type="button" data-open-import="${escapeHtml(result.paperId)}">查看</button>` : ''}${job.status === 'failed' ? `<button type="button" data-retry-import="${escapeHtml(job.id)}">重试</button>` : ''}${job.status === 'done' && result?.action !== 'unplaced' ? `<button type="button" data-undo-import="${escapeHtml(job.id)}">撤销入图</button>` : ''}</div></div>`;
  }).join('') : '<div class="import-empty">上传 PDF 后，结果会显示在这里</div>';
}
async function refreshMapAfterImport() {
  if (!remoteReady || dirty || conflict || localStorage.getItem(PENDING_KEY) === '1') return;
  const response = await fetch('/api/map', { cache: 'no-store' });
  if (!response.ok) return;
  const result = await response.json();
  if (result.revision <= revision) return;
  revision = result.revision;
  state = validateDocument(result.document);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  render();
  setSaveStatus('已从 MySQL 更新');
}
async function pollImports() {
  clearTimeout(importPollTimer);
  try {
    const response = await fetch('/api/imports', { cache: 'no-store' });
    if (!response.ok) return;
    const previous = new Map(importJobs.map((job) => [job.id, job.status]));
    importJobs = (await response.json()).imports || [];
    renderImports();
    if (importsInitialized && importJobs.some((job) => previous.get(job.id) !== job.status && ['done', 'undone'].includes(job.status))) {
      await refreshMapAfterImport();
      const latest = importJobs.find((job) => previous.get(job.id) !== job.status && job.status === 'done');
      if (latest) toast(latest.result?.action === 'unplaced' ? '论文已入库，暂未定位到树图' : '论文已自动整理并更新地图');
    }
    importsInitialized = true;
  } catch { /* Keep the library usable when the import API is temporarily unavailable. */ }
  finally { importPollTimer = setTimeout(pollImports, importJobs.some((job) => ['queued', 'processing'].includes(job.status)) ? 2500 : 12000); }
}
async function uploadPdf(file) {
  if (!file) return;
  if (!file.name.toLocaleLowerCase().endsWith('.pdf') || file.size > 40_000_000) { toast('请选择不超过 40 MB 的 PDF'); return; }
  if (!remoteReady || conflict) { toast('请先连接本机 MySQL，再上传 PDF'); return; }
  if (dirty && !(await flushRemote())) return;
  try {
    setSaveStatus('正在上传 PDF…');
    const response = await fetch('/api/imports', { method: 'POST', headers: { 'content-type': 'application/pdf', 'x-file-name': encodeURIComponent(file.name) }, body: file });
    if (!response.ok) { const error = new Error((await response.json().catch(() => ({}))).error || `HTTP ${response.status}`); error.status = response.status; throw error; }
    setSaveStatus('PDF 已上传 · 正在自动整理');
    toast('PDF 已上传，正在自动整理');
    await pollImports();
  } catch (error) {
    if (error.status === 503 && /API Key/.test(error.message)) { pendingUploadFiles.unshift(file); openAiSettings(); setSaveStatus('等待配置模型'); return; }
    setSaveStatus('PDF 上传失败'); toast(`上传失败：${error.message}`);
  }
}
async function load() {
  let local;
  try { const saved = localStorage.getItem(STORAGE_KEY); if (saved) local = validateDocument(JSON.parse(saved)); } catch { /* Use MySQL below. */ }
  try {
    const response = await fetch('/api/map', { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const result = await response.json();
    revision = result.revision; remoteReady = true;
    const remote = result.document ? validateDocument(result.document) : createEmptyMap();
    const pending = localStorage.getItem(PENDING_KEY) === '1';
    state = pending && local ? local : remote;
    if (!pending) localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    setSaveStatus(pending ? '本地修改待同步' : '已从 MySQL 载入');
    if (pending || result.document?.version !== 3) saveLocal();
  } catch {
    state = local || createEmptyMap();
    setSaveStatus('仅本地可用 · MySQL 未连接');
  }
  render();
  pollImports();
  refreshAiStatus();
}

function setAiStatus(message, error = false) {
  const status = $('#aiStatus');
  status.textContent = message;
  status.classList.toggle('error', error);
}
async function refreshAiStatus() {
  try {
    const response = await fetch('/api/ai', { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const config = await response.json();
    if (config.provider) $('#aiProvider').value = config.provider;
    $('#modelSettings').textContent = config.configured ? `模型设置 · ${config.provider === 'deepseek' ? 'DeepSeek' : 'OpenAI'}` : '模型设置';
    $('#apiKeyInput').placeholder = config.configured ? '输入新 Key 以替换' : '输入 API Key';
    setAiStatus(config.configured
      ? `已配置 ${config.provider === 'deepseek' ? 'DeepSeek' : 'OpenAI'}（${config.model}）。原 Key 不回显。`
      : '尚未配置 API Key。');
    return config;
  } catch {
    setAiStatus('无法读取当前配置，请检查本机服务。', true);
    return null;
  }
}
async function retryModelConnectionFailures() {
  try {
    const response = await fetch('/api/imports', { cache: 'no-store' });
    if (!response.ok) return 0;
    const { imports = [] } = await response.json();
    let retried = 0;
    for (const job of imports) {
      if (job.status !== 'failed' || !/无法连接模型|API Key/.test(job.error || '')) continue;
      const retry = await fetch(`/api/imports/${encodeURIComponent(job.id)}/retry`, { method: 'POST' });
      if (retry.ok) retried++;
    }
    if (retried) await pollImports();
    return retried;
  } catch {
    return 0;
  }
}
function openAiSettings() {
  $('#apiKeyInput').value = '';
  $('#apiKeyDialog').showModal();
  refreshAiStatus();
}

$('#scopeSwitch').addEventListener('click', (event) => { const button = event.target.closest('[data-scope]'); if (!button) return; scope = button.dataset.scope; selectedPaperId = null; render(); });
$('#paperSearch').addEventListener('input', (event) => { query = event.target.value; render(); });
$('#paperList').addEventListener('click', (event) => { const button = event.target.closest('[data-paper]'); if (!button) return; selectedPaperId = button.dataset.paper; tab = 'overview'; renderList(); renderPaper(); });
$('#uploadPaper').addEventListener('click', () => $('#pdfFile').click());
$('#modelSettings').addEventListener('click', openAiSettings);
$('#unlinkPaper').addEventListener('click', () => { state.paperLinks = state.paperLinks.filter((link) => !(link.nodeId === requestedNodeId && link.paperId === selectedPaperId)); selectedPaperId = null; saveLocal(); render(); toast('已从当前节点移除关联'); });
$('.paper-tabs').addEventListener('click', (event) => { const button = event.target.closest('[data-tab]'); if (!button) return; tab = button.dataset.tab; renderPaper(); });
$('#paperOverview').addEventListener('input', (event) => {
  const field = event.target.dataset.field;
  if (!field || field === 'status') return;
  const paper = paperById(selectedPaperId);
  if (!paper || (field === 'title' && !event.target.value.trim())) return;
  paper[field] = event.target.value;
  saveLocal();
  if (field === 'title' || field === 'year' || field === 'authors') { $('#paperTitle').textContent = paper.title; renderList(); }
});
$('#paperOverview').addEventListener('change', (event) => { if (event.target.dataset.field !== 'status') return; const paper = paperById(selectedPaperId); if (!paper) return; paper.status = event.target.value; saveLocal(); renderList(); });
$('#paperReader').addEventListener('click', (event) => { if (event.target.closest('[data-upload-pdf]')) $('#pdfFile').click(); });
$('#pdfFile').addEventListener('change', async (event) => {
  const files = [...event.target.files]; event.target.value = '';
  if (!files.length) return;
  try {
    const response = await fetch('/api/ai');
    if (response.ok && !(await response.json()).configured) { pendingUploadFiles = files; openAiSettings(); return; }
  } catch { /* Upload will show the server error below. */ }
  for (const file of files) await uploadPdf(file);
});
$('#apiKeyForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const key = $('#apiKeyInput').value.trim();
  const provider = $('#aiProvider').value;
  if (!/^[\x21-\x7e]{15,500}$/.test(key)) {
    setAiStatus('请输入平台生成的原始 API Key；不能包含中文、空格或换行。', true);
    return;
  }
  const saveButton = $('#saveApiKey');
  saveButton.disabled = true;
  saveButton.textContent = '保存中…';
  setAiStatus('正在保存…');
  try {
    const response = await fetch('/api/ai', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key, provider }) });
    if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || `HTTP ${response.status}`);
    const config = await response.json();
    $('#apiKeyInput').value = '';
    $('#modelSettings').textContent = `模型设置 · ${config.provider === 'deepseek' ? 'DeepSeek' : 'OpenAI'}`;
    $('#apiKeyInput').placeholder = '输入新 Key 以替换';
    setAiStatus(`已配置 ${config.provider === 'deepseek' ? 'DeepSeek' : 'OpenAI'}（${config.model}）。原 Key 不回显。`);
    $('#apiKeyDialog').close();
    toast(`API Key 已保存 · ${config.model}`);
    const files = pendingUploadFiles; pendingUploadFiles = [];
    for (const file of files) await uploadPdf(file);
    const retried = await retryModelConnectionFailures();
    if (retried) toast(`已自动重试 ${retried} 篇论文，正在处理`);
  } catch (error) { setAiStatus(`保存失败：${error.message}`, true); }
  finally { saveButton.disabled = false; saveButton.textContent = '保存'; }
});
$('#cancelApiKey').addEventListener('click', () => { pendingUploadFiles = []; $('#apiKeyInput').value = ''; $('#apiKeyDialog').close(); });
$('#importList').addEventListener('click', async (event) => {
  const open = event.target.closest('[data-open-import]');
  if (open) { await refreshMapAfterImport(); scope = 'all'; selectedPaperId = open.dataset.openImport; tab = 'overview'; render(); return; }
  const retry = event.target.closest('[data-retry-import]');
  const undo = event.target.closest('[data-undo-import]');
  if (!retry && !undo) return;
  const id = retry?.dataset.retryImport || undo?.dataset.undoImport;
  try {
    const response = await fetch(`/api/imports/${encodeURIComponent(id)}/${retry ? 'retry' : 'undo'}`, { method: 'POST' });
    if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || `HTTP ${response.status}`);
    await pollImports();
    if (undo) await refreshMapAfterImport();
    toast(retry ? '已重新开始处理' : '已撤销入图，论文仍保留在库中');
  } catch (error) { toast(error.message); }
});
$('.back-map').addEventListener('click', async (event) => { if (!dirty || !remoteReady || conflict) return; event.preventDefault(); await flushRemote(); location.href = './index.html'; });
load();
