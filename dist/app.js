import { validateDocument, createEmptyMap } from './document-schema.js';
import { layoutTreeNodes } from './tree-layout.js';
import { taxonomyTags, taxonomyTag, visibleLineageNodeIds } from './taxonomy.js';
const STORAGE_KEY = 'kv-inference-lineage:v1';
const PENDING_KEY = `${STORAGE_KEY}-pending`;
const BACKUP_KEY = `${STORAGE_KEY}-previous-local`;
const CARD_WIDTH = 196;
const CARD_HEIGHT = 122;

const $ = (selector) => document.querySelector(selector);
const escapeHtml = (value = '') => String(value).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
const nodeById = (id) => state.nodes.find((node) => node.id === id);
const childrenOf = (id) => state.nodes.filter((node) => node.parentId === id).sort((a, b) => a.order - b.order || a.title.localeCompare(b.title));
const descendantsOf = (id) => { const found = new Set(); const visit = (parentId) => childrenOf(parentId).forEach((child) => { found.add(child.id); visit(child.id); }); visit(id); return found; };

function readInitial() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) return validateDocument(JSON.parse(saved));
  } catch (error) { setTimeout(() => toast(`已载入初始地图；本地数据读取失败：${error.message}`), 200); }
  return createEmptyMap();
}

let state = readInitial();
let selectedId = null;
let tagNodeId = null;
let pendingTagSelection = null;
let query = '';
let activeCategoryId = null;
let zoom = 1;
let collapsed = new Set();
let positions = new Map();
let canvasSize = { width: 1000, height: 800 };
let originX = 0;
let pendingDelete = null;
let contextNodeId = null;
let tooltipNodeId = null;
let toastTimer;
let renderTimer;
let remoteRevision = 0;
let remoteReady = false;
let remoteConflict = false;
let dirtyBeforeLoad = false;
let saveTimer;
let saving = false;
let retryDelay = 1000;

function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    localStorage.setItem(PENDING_KEY, '1');
    $('#saveState').textContent = remoteReady ? '正在同步 MySQL…' : '已保存在此浏览器 · 数据库未连接';
  } catch (error) {
    $('#saveState').textContent = '无法保存，请导出备份';
    toast(`自动保存失败：${error.message}`);
  }
  if (!remoteReady) { dirtyBeforeLoad = true; return; }
  if (!remoteConflict) { clearTimeout(saveTimer); saveTimer = setTimeout(flushRemote, 450); }
}
async function flushRemote() {
  if (!remoteReady || remoteConflict || saving) return;
  saving = true;
  const snapshot = JSON.stringify(state);
  try {
    const response = await fetch('/api/map', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ revision: remoteRevision, document: JSON.parse(snapshot) }),
    });
    if (response.status === 409) {
      remoteConflict = true;
      $('#saveState').textContent = '云端版本冲突 · 请先导出备份';
      toast('其他设备修改了地图。当前修改保留在本浏览器，请先导出备份。');
      return;
    }
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const result = await response.json();
    remoteRevision = result.revision;
    const expected = JSON.stringify(validateDocument(JSON.parse(snapshot)));
    if (!result.document || JSON.stringify(validateDocument(result.document)) !== expected) {
      remoteConflict = true;
      $('#saveState').textContent = '服务端未保存完整内容 · 请重启本地服务';
      toast('服务端版本过旧，修改已留在此浏览器。请重启本地服务后刷新。');
      return;
    }
    retryDelay = 1000;
    if (JSON.stringify(state) === snapshot) { localStorage.removeItem(PENDING_KEY); $('#saveState').textContent = '已同步到 MySQL'; }
    else setTimeout(flushRemote, 0);
  } catch (error) {
    $('#saveState').textContent = '数据库暂时不可用 · 本地备份已保留，正在重试';
    toast(`同步失败：${error.message}`);
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flushRemote, retryDelay);
    retryDelay = Math.min(retryDelay * 2, 30000);
  } finally { saving = false; }
}
async function loadRemote() {
  try {
    const response = await fetch('/api/map', { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const result = await response.json();
    remoteRevision = result.revision;
    remoteReady = true;
    if (result.document) {
      const remoteDocument = validateDocument(result.document);
      const requiresMigration = result.document.version !== 3;
      const pending = dirtyBeforeLoad || localStorage.getItem(PENDING_KEY) === '1';
      if (pending && JSON.stringify(state) !== JSON.stringify(remoteDocument)) {
        remoteConflict = true;
        $('#saveState').textContent = '本地修改待处理 · 请导出备份';
        toast('本地修改与云端不同，请先导出 JSON 备份。');
        return;
      }
      if (!pending && localStorage.getItem(STORAGE_KEY) && JSON.stringify(state) !== JSON.stringify(remoteDocument)) {
        localStorage.setItem(BACKUP_KEY, JSON.stringify(state));
        $('#exportLocalBackup').hidden = false;
      }
      state = remoteDocument;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      localStorage.removeItem(PENDING_KEY);
      selectedId = null;
      renderMap(); renderDetails();
      requestAnimationFrame(centerOnOrigin);
      $('#saveState').textContent = '已从 MySQL 载入';
      if (requiresMigration) save();
    } else {
      $('#saveState').textContent = '正在初始化 MySQL…';
      await flushRemote();
    }
  } catch {
    remoteReady = false;
    $('#saveState').textContent = '已保存在此浏览器 · 数据库未连接';
  }
}
function toast(message) {
  const el = $('#toast'); el.textContent = message; el.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), 3000);
}
function hideNodeTooltip() { $('#nodeTooltip').hidden = true; tooltipNodeId = null; }
function positionNodeTooltip(clientX, clientY) {
  const tooltip = $('#nodeTooltip');
  const bounds = tooltip.getBoundingClientRect();
  const left = clientX + 16 + bounds.width > window.innerWidth - 10 ? clientX - bounds.width - 16 : clientX + 16;
  const top = clientY + 18 + bounds.height > window.innerHeight - 10 ? clientY - bounds.height - 18 : clientY + 18;
  tooltip.style.left = `${Math.max(10, Math.min(left, window.innerWidth - bounds.width - 10))}px`;
  tooltip.style.top = `${Math.max(10, Math.min(top, window.innerHeight - bounds.height - 10))}px`;
}
function showNodeTooltip(nodeId, clientX, clientY) {
  const node = nodeById(nodeId); if (!node) return;
  if (tooltipNodeId !== nodeId) {
    const description = node.description.trim();
    $('#nodeTooltipText').textContent = description ? `${description.slice(0, 160)}${description.length > 160 ? '…' : ''}` : '暂无介绍';
    tooltipNodeId = nodeId;
    $('#nodeTooltip').hidden = false;
  }
  positionNodeTooltip(clientX, clientY);
}
function scheduleRender() {
  clearTimeout(renderTimer);
  renderTimer = setTimeout(renderMap, 140);
}
function matchingNodes() {
  const q = query.trim().toLocaleLowerCase();
  return new Set(state.nodes.filter((node) => {
    if (node.parentId === null) return false;
    if (activeCategoryId && taxonomyTag(node.tagId, state.taxonomy)?.groupId !== activeCategoryId) return false;
    if (!q) return true;
    const tag = state.tagCatalog.find((item) => item.id === node.tagId);
    return [node.title, node.time, node.description, tag?.name].join(' ').toLocaleLowerCase().includes(q);
  }).map((node) => node.id));
}
function renderCategoryFilters() {
  const counts = new Map(state.taxonomy.map((group) => [group.id, 0]));
  for (const node of state.nodes) {
    const groupId = taxonomyTag(node.tagId, state.taxonomy)?.groupId;
    if (groupId) counts.set(groupId, counts.get(groupId) + 1);
  }
  $('#categoryFilters').innerHTML = `<button type="button" data-category="" class="${activeCategoryId ? '' : 'active'}" aria-pressed="${!activeCategoryId}"><span class="category-label"><strong>全部方向</strong><small>All directions</small></span><span class="category-count">${state.nodes.length - 1}</span></button>`
    + state.taxonomy.map((group) => `<button type="button" data-category="${group.id}" class="${activeCategoryId === group.id ? 'active' : ''}" aria-pressed="${activeCategoryId === group.id}" title="${escapeHtml(group.english)}"><span class="category-dot" style="--category-color:${group.color}"></span><span class="category-label"><strong>${escapeHtml(group.name)}</strong>${group.english ? `<small>${escapeHtml(group.english)}</small>` : ''}</span><span class="category-count">${counts.get(group.id)}</span></button>`).join('');
}
function layoutTree() {
  const visible = visibleLineageNodeIds(state.nodes, activeCategoryId, state.taxonomy);
  const layout = layoutTreeNodes(state.nodes.filter((node) => visible.has(node.id)), collapsed, { cardWidth: CARD_WIDTH, cardHeight: CARD_HEIGHT });
  positions = layout.positions;
  originX = layout.originX;
  canvasSize = layout.canvasSize;
  const viewportWidth = $('#mapViewport').clientWidth / zoom;
  if (canvasSize.width < viewportWidth) {
    const shift = (viewportWidth - canvasSize.width) / 2;
    for (const position of positions.values()) position.x += shift;
    originX += shift;
    canvasSize.width = viewportWidth;
  }
}
function renderMap() {
  hideNodeTooltip();
  renderCategoryFilters();
  layoutTree();
  const matches = matchingNodes();
  const filtered = Boolean(query.trim() || activeCategoryId);
  $('#resultCount').textContent = filtered ? `${matches.size} 个匹配` : `${state.nodes.length - 1} 个工作`;
  const links = [];
  for (const parent of state.nodes) {
    if (!positions.has(parent.id) || collapsed.has(parent.id)) continue;
    const children = childrenOf(parent.id).filter((child) => positions.has(child.id));
    if (!children.length) continue;
    const a = positions.get(parent.id);
    const y1 = a.y + (parent.parentId === null ? 46 : CARD_HEIGHT);
    const y2 = positions.get(children[0].id).y;
    const parentX = a.x + CARD_WIDTH / 2;
    const braceY = y1 + (y2 - y1) * .55;
    links.push(`<path class="${selectedId === parent.id ? 'active' : ''}" d="M${parentX} ${y1} V${braceY}"/>`);
    const firstX = positions.get(children[0].id).x + CARD_WIDTH / 2;
    const lastX = positions.get(children[children.length - 1].id).x + CARD_WIDTH / 2;
    const radius = 14;
    if (children.length > 1) {
      links.push(`<path class="branch-brace" d="M${firstX} ${braceY + radius} Q${firstX} ${braceY} ${firstX + radius} ${braceY} H${lastX - radius} Q${lastX} ${braceY} ${lastX} ${braceY + radius}"/>`);
    }
    for (const child of children) {
      const x = positions.get(child.id).x + CARD_WIDTH / 2;
      const isOuter = children.length > 1 && (child.id === children[0].id || child.id === children[children.length - 1].id);
      const startY = isOuter ? braceY + radius : braceY;
      links.push(`<path class="${selectedId === child.id ? 'active' : ''}" d="M${x} ${startY} V${y2}"/>`);
    }
  }
  const cards = state.nodes.filter((node) => node.parentId !== null && positions.has(node.id)).map((node) => {
    const pos = positions.get(node.id), kidCount = childrenOf(node.id).filter((child) => positions.has(child.id)).length;
    const selected = selectedId === node.id ? 'selected' : '';
    const dimmed = filtered && !matches.has(node.id) ? 'dimmed' : '';
    const dabbled = node.dabbled ? 'dabbled' : '';
    const tag = state.tagCatalog.find((item) => item.id === node.tagId);
    return `<article class="tree-card ${selected} ${dimmed} ${dabbled}" data-id="${escapeHtml(node.id)}" style="left:${pos.x}px;top:${pos.y}px" tabindex="0" role="button" aria-label="编辑${escapeHtml(node.title)}，${node.dabbled ? '已涉猎' : '未涉猎'}">
      <time class="node-time">${escapeHtml(node.time)}</time>
      <div class="node-title">${escapeHtml(node.title)}</div>
      <button class="node-tag ${tag ? '' : 'empty'}" type="button" data-tag-node="${escapeHtml(node.id)}" style="--tag-color:${tag ? tag.color : '#7f9485'}" aria-label="设置${escapeHtml(node.title)}的标签">${tag ? escapeHtml(tag.name) : '＋ tag'}</button>
      <button class="node-add" type="button" data-add-child="${escapeHtml(node.id)}" aria-label="在${escapeHtml(node.title)}下新增子节点">+</button>
      ${kidCount ? `<button class="collapse-toggle" type="button" data-collapse="${escapeHtml(node.id)}" aria-label="${collapsed.has(node.id) ? '展开' : '折叠'}子节点">${collapsed.has(node.id) ? `展开 ${kidCount} ›` : `收起 ${kidCount} ⌄`}</button>` : ''}
    </article>`;
  });
  $('#mapInner').style.width = `${canvasSize.width}px`;
  $('#mapInner').style.height = `${canvasSize.height}px`;
  $('#mapInner').style.transform = `scale(${zoom})`;
  const root = state.nodes.find((node) => node.parentId === null);
  const rootTitle = root?.title;
  const rootLabel = rootTitle === '地图' ? '推理系统' : rootTitle || 'LLM Infra';
  const rootId = root?.id || 'root';
  $('#mapInner').innerHTML = `<svg class="edge-layer" width="${canvasSize.width}" height="${canvasSize.height}" aria-hidden="true">${links.join('')}</svg><div class="tree-origin ${root?.dabbled ? 'dabbled' : ''}" data-id="${escapeHtml(rootId)}" tabindex="0" role="button" aria-label="编辑${escapeHtml(rootLabel)}，${root?.dabbled ? '已涉猎' : '未涉猎'}" style="left:${originX - 84}px;top:20px"><span>${escapeHtml(rootLabel)}</span><button class="node-add" type="button" data-add-child="${escapeHtml(rootId)}" aria-label="在${escapeHtml(rootLabel)}下新增子节点">+</button></div>${cards.join('')}`;
  $('#mapStage').style.width = `${Math.ceil(canvasSize.width * zoom)}px`;
  $('#mapStage').style.height = `${Math.ceil(canvasSize.height * zoom)}px`;
  $('#zoomLabel').textContent = `${Math.round(zoom * 100)}%`;
}
function focusNode(id) {
  if (activeCategoryId && !visibleLineageNodeIds(state.nodes, activeCategoryId, state.taxonomy).has(id)) activeCategoryId = null;
  let cursor = nodeById(id);
  while (cursor && cursor.parentId) { collapsed.delete(cursor.parentId); cursor = nodeById(cursor.parentId); }
  renderMap();
  const pos = positions.get(id), viewport = $('#mapViewport');
  if (pos) { viewport.scrollTo({ left: Math.max(0, (pos.x + CARD_WIDTH / 2) * zoom - viewport.clientWidth / 2), top: Math.max(0, (pos.y + 50) * zoom - viewport.clientHeight / 2), behavior: 'smooth' }); }
}
function selectNode(id, focus = false) {
  if (!nodeById(id)) return;
  hideNodeTooltip();
  selectedId = id; renderDetails();
  if (focus) focusNode(id); else renderMap();
}
function renderDetails() {
  const dialog = $('#nodeDialog'), node = nodeById(selectedId);
  if (!node) { if (dialog.open) dialog.close(); dialog.innerHTML = ''; return; }
  const tag = state.tagCatalog.find((item) => item.id === node.tagId);
  dialog.innerHTML = `<div class="editor-head">
    <div><p>节点内容</p><h2>${node.parentId === null ? '编辑根节点' : '编辑工作'}</h2></div>
    <button class="dialog-close" type="button" data-action="close" aria-label="关闭">×</button>
  </div>
  <div class="editor-body">
    <label class="editor-field"><span>工作名称</span><input data-field="title" maxlength="180" value="${escapeHtml(node.title)}" autocomplete="off"></label>
    <label class="editor-field"><span>诞生时间</span><input data-field="time" maxlength="30" placeholder="例如 2025.9" value="${escapeHtml(node.time)}" autocomplete="off"></label>
    <label class="editor-field"><span>介绍</span><textarea data-field="description" maxlength="12000" placeholder="写下这项工作的介绍…">${escapeHtml(node.description)}</textarea></label>
    ${node.parentId === null ? '' : `<div class="editor-tag-field"><span>细分方向</span><button class="editor-tag-button" type="button" data-tag-node="${escapeHtml(node.id)}" style="--tag-color:${tag ? tag.color : '#7f9485'}">${tag ? escapeHtml(tag.name) : '＋ 选择 tag'}</button></div>`}
  </div>
  <div class="editor-footer">
    <a class="editor-view" href="./work.html?id=${encodeURIComponent(node.id)}">查看 →</a>
  </div>`;
  if (!dialog.open) dialog.showModal();
}
function closeEditor() { selectedId = null; renderDetails(); renderMap(); }
function moveSibling(nodeId, step) {
  const node = nodeById(nodeId); if (!node || node.parentId === null) return;
  const siblings = childrenOf(node.parentId);
  const from = siblings.findIndex((item) => item.id === nodeId);
  const to = from + step;
  if (from < 0 || to < 0 || to >= siblings.length) return;
  [siblings[from], siblings[to]] = [siblings[to], siblings[from]];
  siblings.forEach((item, index) => { item.order = index; });
  save(); renderMap();
}
function closeNodeContextMenu() {
  $('#nodeContextMenu').hidden = true;
  contextNodeId = null;
}
function openNodeContextMenu(nodeId, clientX, clientY) {
  const node = nodeById(nodeId); if (!node) return;
  hideNodeTooltip();
  contextNodeId = nodeId;
  const siblings = node.parentId === null ? [] : childrenOf(node.parentId);
  const index = siblings.findIndex((item) => item.id === nodeId);
  const menu = $('#nodeContextMenu');
  menu.innerHTML = `<div class="node-context-title">${escapeHtml(node.title)}</div>
    <button type="button" role="menuitemcheckbox" aria-checked="${Boolean(node.dabbled)}" data-context-action="dabble"><span>${node.dabbled ? '✓' : '○'}</span>Dabble</button>
    ${node.parentId === null ? '' : `<div class="node-context-divider"></div>
      <button type="button" role="menuitem" data-context-action="move-up" ${index <= 0 ? 'disabled' : ''}><span>↑</span>上移</button>
      <button type="button" role="menuitem" data-context-action="move-down" ${index >= siblings.length - 1 ? 'disabled' : ''}><span>↓</span>下移</button>
      <div class="node-context-divider"></div>
      <button type="button" role="menuitem" class="node-context-danger" data-context-action="delete"><span>×</span>删除</button>`}`;
  menu.hidden = false;
  const bounds = menu.getBoundingClientRect();
  menu.style.left = `${Math.max(8, Math.min(clientX, window.innerWidth - bounds.width - 8))}px`;
  menu.style.top = `${Math.max(8, Math.min(clientY, window.innerHeight - bounds.height - 8))}px`;
  menu.querySelector('button:not(:disabled)')?.focus();
}
function toggleDabble(nodeId) {
  const node = nodeById(nodeId); if (!node) return;
  node.dabbled = !node.dabbled;
  save(); renderMap(); toast(node.dabbled ? '已标记为涉猎' : '已标记为未涉猎');
}
function openDeleteDialog(nodeId) {
  const node = nodeById(nodeId); if (!node || node.parentId === null) return;
  pendingDelete = nodeId;
  const count = descendantsOf(nodeId).size;
  $('#deleteMessage').textContent = count ? `「${node.title}」下还有 ${count} 个后代节点。请选择如何处理。` : `确定删除「${node.title}」吗？`;
  $('[data-delete="promote"]').hidden = !count;
  $('#deleteDialog').showModal();
}
function updateField(field, raw) {
  const node = nodeById(selectedId); if (!node || !['title', 'time', 'description'].includes(field)) return;
  if (field === 'title' && !raw.trim()) return;
  node[field] = field === 'title' ? raw.slice(0, 180) : field === 'time' ? raw.slice(0, 30) : raw.slice(0, 12000);
  save(); scheduleRender();
}
function renderTagDialog() {
  const dialog = $('#tagDialog'), node = nodeById(tagNodeId);
  if (!node) { if (dialog.open) dialog.close(); return; }
  dialog.innerHTML = `<div class="tag-dialog-head"><h2>选择细分方向</h2><button type="button" class="dialog-close" data-tag-close aria-label="关闭">×</button></div>
    <p class="tag-hint">按主要优化对象选择。颜色对应一级方向。</p>
    <div class="tag-options">
      <button type="button" class="tag-choice ${node.tagId ? '' : 'chosen'}" data-select-tag="">无标签</button>
      ${state.taxonomy.map((group) => `<details class="tag-group" ${group.id === (taxonomyTag(node.tagId, state.taxonomy)?.groupId || activeCategoryId || state.taxonomy[0]?.id) ? 'open' : ''}><summary style="--group-color:${group.color}">${escapeHtml(group.name)} <small>${escapeHtml(group.english)}</small></summary><div class="tag-group-options">${group.tags.map(({ id, name, english }) => `<button type="button" class="tag-choice ${node.tagId === id ? 'chosen' : ''}" data-select-tag="${id}" style="--tag-color:${group.color}" title="${escapeHtml(english)}">${escapeHtml(name)}</button>`).join('')}</div></details>`).join('')}
    </div>`;
  if (!dialog.open) dialog.showModal();
}
function openTagDialog(nodeId) { tagNodeId = nodeId; renderTagDialog(); }
function requestTagSelection(tagId) {
  const node = nodeById(tagNodeId); if (!node) return;
  const nextId = tagId || null;
  if (node.tagId === nextId) { $('#tagDialog').close(); return; }
  const current = state.tagCatalog.find((item) => item.id === node.tagId);
  const next = state.tagCatalog.find((item) => item.id === nextId) || taxonomyTags(state.taxonomy).find((item) => item.id === nextId);
  if (nextId && !next) return;
  pendingTagSelection = { nodeId: node.id, tagId: nextId };
  $('#tagConfirmMessage').textContent = `将「${node.title}」的 tag 从「${current?.name || '无标签'}」改为「${next?.name || '无标签'}」？`;
  $('#tagConfirmDialog').showModal();
}
function applyTagSelection() {
  const selection = pendingTagSelection; if (!selection) return;
  const node = nodeById(selection.nodeId); if (!node) return;
  pendingTagSelection = null;
  if (selection.tagId && !state.tagCatalog.some((tag) => tag.id === selection.tagId)) {
    const tag = taxonomyTags(state.taxonomy).find((item) => item.id === selection.tagId);
    if (tag) state.tagCatalog.push({ id: tag.id, name: tag.name, color: tag.color });
  }
  node.tagId = selection.tagId;
  save(); $('#tagConfirmDialog').close(); $('#tagDialog').close(); renderMap();
  if (selectedId === node.id) renderDetails();
}
function addChild(parentId) {
  activeCategoryId = null;
  const root = state.nodes.find((node) => node.parentId === null);
  const parent = nodeById(parentId) || root;
  const id = `n-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  const node = { id, parentId: parent.id, order: childrenOf(parent.id).length, title: '新的工作', time: '', description: '', tagId: null, dabbled: false };
  state.nodes.push(node); collapsed.delete(parent.id); save(); selectNode(id, true); toast('已添加节点');
  const title = $('#nodeDialog [data-field="title"]'); if (title) { title.focus(); title.select(); }
}
function deleteNode(mode) {
  const node = nodeById(pendingDelete); if (!node || node.parentId === null) return;
  const descendants = descendantsOf(node.id);
  if (mode === 'cascade') state.nodes = state.nodes.filter((item) => item.id !== node.id && !descendants.has(item.id));
  if (mode === 'promote') {
    const children = childrenOf(node.id); children.forEach((child, index) => { child.parentId = node.parentId; child.order = node.order + index; });
    state.nodes = state.nodes.filter((item) => item.id !== node.id);
  }
  const retainedNodes = new Set(state.nodes.map((item) => item.id));
  state.paperLinks = state.paperLinks.filter((link) => retainedNodes.has(link.nodeId));
  collapsed.delete(node.id); selectedId = null; pendingDelete = null;
  save(); renderMap(); renderDetails(); toast('节点已删除');
}
function setZoom(next) { zoom = Math.max(.15, Math.min(2.5, Math.round(next * 100) / 100)); renderMap(); }
function exportData() {
  const blob = new Blob([JSON.stringify({ ...state, exportedAt: new Date().toISOString() }, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob), anchor = document.createElement('a');
  anchor.href = url; anchor.download = `rgragh-${new Date().toISOString().slice(0, 10)}.json`; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000); $('#dataMenu').hidden = true; toast('已导出 JSON 备份');
}
function exportLocalBackup() {
  const saved = localStorage.getItem(BACKUP_KEY);
  if (!saved) return;
  const url = URL.createObjectURL(new Blob([saved], { type: 'application/json' }));
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'rgragh-previous-local.json'; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000); $('#dataMenu').hidden = true;
}
async function importData(file) {
  if (!file) return;
  if (file.size > 3_000_000) { toast('文件过大，请使用小于 3 MB 的 JSON'); return; }
  try {
    const incoming = validateDocument(JSON.parse(await file.text()));
    if (!window.confirm(`将用 ${incoming.nodes.length} 个导入节点替换当前地图。建议先导出当前备份。继续吗？`)) return;
    state = incoming; selectedId = null; collapsed = new Set(); query = ''; $('#search').value = '';
    save(); renderMap(); renderDetails(); toast('地图已导入');
  } catch (error) { toast(`导入失败：${error.message}`); }
  finally { $('#importFile').value = ''; }
}

$('#mapInner').addEventListener('click', (event) => {
  const add = event.target.closest('[data-add-child]'); if (add) { addChild(add.dataset.addChild); return; }
  const tag = event.target.closest('[data-tag-node]'); if (tag) { openTagDialog(tag.dataset.tagNode); return; }
  const collapse = event.target.closest('[data-collapse]'); if (collapse) { const id = collapse.dataset.collapse; collapsed.has(id) ? collapsed.delete(id) : collapsed.add(id); focusNode(id); return; }
  const card = event.target.closest('.tree-card, .tree-origin'); if (card) selectNode(card.dataset.id);
});
$('#mapInner').addEventListener('pointerover', (event) => {
  if (event.pointerType && event.pointerType !== 'mouse') return;
  const card = event.target.closest('.tree-card, .tree-origin');
  if (card) showNodeTooltip(card.dataset.id, event.clientX, event.clientY);
  else hideNodeTooltip();
});
$('#mapInner').addEventListener('pointermove', (event) => {
  if (event.pointerType && event.pointerType !== 'mouse') return;
  const card = event.target.closest('.tree-card, .tree-origin');
  if (card) showNodeTooltip(card.dataset.id, event.clientX, event.clientY);
  else hideNodeTooltip();
});
$('#mapInner').addEventListener('pointerleave', hideNodeTooltip);
$('#mapInner').addEventListener('keydown', (event) => { if ((event.key === 'Enter' || event.key === ' ') && (event.target.classList.contains('tree-card') || event.target.classList.contains('tree-origin'))) { event.preventDefault(); selectNode(event.target.dataset.id); } });
$('#mapInner').addEventListener('contextmenu', (event) => {
  const card = event.target.closest('.tree-card, .tree-origin');
  if (!card) { closeNodeContextMenu(); return; }
  event.preventDefault();
  openNodeContextMenu(card.dataset.id, event.clientX, event.clientY);
});
$('#mapInner').addEventListener('keydown', (event) => {
  if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return;
  const card = event.target.closest('.tree-card, .tree-origin'); if (!card) return;
  event.preventDefault();
  const rect = card.getBoundingClientRect();
  openNodeContextMenu(card.dataset.id, rect.left + 20, rect.top + 20);
});
$('#nodeContextMenu').addEventListener('click', (event) => {
  const button = event.target.closest('[data-context-action]'); if (!button || button.disabled) return;
  const action = button.dataset.contextAction, nodeId = contextNodeId;
  closeNodeContextMenu();
  if (action === 'dabble') toggleDabble(nodeId);
  else if (action === 'move-up') moveSibling(nodeId, -1);
  else if (action === 'move-down') moveSibling(nodeId, 1);
  else if (action === 'delete') openDeleteDialog(nodeId);
});
document.addEventListener('pointerdown', (event) => { if (!event.target.closest('#nodeContextMenu')) closeNodeContextMenu(); });
$('#mapViewport').addEventListener('scroll', () => { closeNodeContextMenu(); hideNodeTooltip(); }, { passive: true });
window.addEventListener('resize', () => { closeNodeContextMenu(); hideNodeTooltip(); });
window.addEventListener('blur', hideNodeTooltip);
$('#nodeDialog').addEventListener('input', (event) => { const field = event.target.dataset.field; if (field) updateField(field, event.target.value); });
$('#nodeDialog').addEventListener('click', (event) => {
  const tag = event.target.closest('[data-tag-node]'); if (tag) { openTagDialog(tag.dataset.tagNode); return; }
  const action = event.target.closest('[data-action]')?.dataset.action; if (!action) return;
  if (action === 'close') closeEditor();
});
$('#nodeDialog').addEventListener('close', () => { if (selectedId) { selectedId = null; renderMap(); } });
$('#tagDialog').addEventListener('click', (event) => {
  if (event.target.closest('[data-tag-close]')) { $('#tagDialog').close(); return; }
  const choice = event.target.closest('[data-select-tag]'); if (choice) requestTagSelection(choice.dataset.selectTag);
});
$('#tagConfirmDialog').addEventListener('click', (event) => {
  const action = event.target.closest('[data-tag-confirm]')?.dataset.tagConfirm;
  if (action === 'apply') applyTagSelection();
  else if (action === 'cancel') { pendingTagSelection = null; $('#tagConfirmDialog').close(); }
});
$('#tagConfirmDialog').addEventListener('close', () => { if (!$('#tagConfirmDialog').open) pendingTagSelection = null; });
$('#deleteDialog').addEventListener('click', (event) => { const mode = event.target.dataset.delete; if (!mode) return; $('#deleteDialog').close(); if (mode !== 'cancel') deleteNode(mode); else pendingDelete = null; });
$('#search').addEventListener('input', (event) => { query = event.target.value; renderMap(); });
$('#categoryFilters').addEventListener('click', (event) => {
  const button = event.target.closest('[data-category]');
  if (!button) return;
  activeCategoryId = button.dataset.category || null;
  collapsed.clear();
  renderMap();
  requestAnimationFrame(centerOnOrigin);
});
const shell = $('.app-shell');
const railToggle = $('#toggleRail');
function setRailCollapsed(value) {
  shell.classList.toggle('rail-collapsed', value);
  railToggle.setAttribute('aria-expanded', String(!value));
  railToggle.setAttribute('aria-label', value ? '展开侧栏' : '收起侧栏');
}
setRailCollapsed(window.matchMedia('(max-width: 780px)').matches);
railToggle.addEventListener('click', () => setRailCollapsed(!shell.classList.contains('rail-collapsed')));
$('#mapViewport').addEventListener('wheel', (event) => {
  if (!event.ctrlKey) return;
  event.preventDefault();
  const viewport = $('#mapViewport');
  const rect = viewport.getBoundingClientRect();
  const cursorX = event.clientX - rect.left;
  const cursorY = event.clientY - rect.top;
  const contentX = (viewport.scrollLeft + cursorX) / zoom;
  const contentY = (viewport.scrollTop + cursorY) / zoom;
  setZoom(zoom * Math.exp(-event.deltaY * .001));
  viewport.scrollLeft = contentX * zoom - cursorX;
  viewport.scrollTop = contentY * zoom - cursorY;
}, { passive: false });
let pan = null;
$('#mapViewport').addEventListener('pointerdown', (event) => {
  if (event.pointerType !== 'mouse' || event.button !== 0 || event.target.closest('.tree-card, .tree-origin, .node-add')) return;
  const viewport = $('#mapViewport');
  pan = { x: event.clientX, y: event.clientY, left: viewport.scrollLeft, top: viewport.scrollTop };
  viewport.setPointerCapture(event.pointerId);
  viewport.classList.add('panning');
});
$('#mapViewport').addEventListener('pointermove', (event) => {
  if (!pan) return;
  const viewport = $('#mapViewport');
  viewport.scrollLeft = pan.left - (event.clientX - pan.x);
  viewport.scrollTop = pan.top - (event.clientY - pan.y);
});
function endPan() { pan = null; $('#mapViewport').classList.remove('panning'); }
$('#mapViewport').addEventListener('pointerup', endPan);
$('#mapViewport').addEventListener('pointercancel', endPan);
document.addEventListener('keydown', (event) => { if (event.key === '/' && !['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName) && !$('#nodeDialog').open && !$('#tagDialog').open) { event.preventDefault(); $('#search').focus(); } if (event.key === 'Escape') { $('#dataMenu').hidden = true; closeNodeContextMenu(); } });
$('#zoomOut').addEventListener('click', () => setZoom(zoom - .1)); $('#zoomIn').addEventListener('click', () => setZoom(zoom + .1));
$('#zoomFit').addEventListener('click', () => { layoutTree(); setZoom(($('#mapViewport').clientWidth - 28) / canvasSize.width); $('#mapViewport').scrollTo({ left: 0, top: 0, behavior: 'smooth' }); });
$('#menuButton').addEventListener('click', () => { const menu = $('#dataMenu'); menu.hidden = !menu.hidden; $('#menuButton').setAttribute('aria-expanded', String(!menu.hidden)); });
document.addEventListener('click', (event) => { if (!event.target.closest('.top-actions')) { $('#dataMenu').hidden = true; $('#menuButton').setAttribute('aria-expanded', 'false'); } });
$('#exportData').addEventListener('click', exportData); $('#importData').addEventListener('click', () => $('#importFile').click()); $('#importFile').addEventListener('change', (event) => importData(event.target.files[0]));
$('#exportLocalBackup').addEventListener('click', exportLocalBackup);
$('#exportLocalBackup').hidden = !localStorage.getItem(BACKUP_KEY);
renderMap();
loadRemote();
let knownImportStatuses = null;
async function pollMapImports() {
  try {
    const response = await fetch('/api/imports', { cache: 'no-store' });
    if (!response.ok) return;
    const jobs = (await response.json()).imports || [];
    const current = new Map(jobs.map((job) => [job.id, job.status]));
    const processing = jobs.some((job) => ['queued', 'processing'].includes(job.status));
    $('.library-link').textContent = processing ? '论文库 · 处理中' : '论文库';
    if (knownImportStatuses) {
      const completed = jobs.find((job) => ['queued', 'processing'].includes(knownImportStatuses.get(job.id)) && job.status === 'done');
      if (completed) {
        if (remoteReady && !remoteConflict && localStorage.getItem(PENDING_KEY) !== '1') {
          const mapResponse = await fetch('/api/map', { cache: 'no-store' });
          if (mapResponse.ok) {
            const latest = await mapResponse.json();
            if (latest.revision > remoteRevision) {
              remoteRevision = latest.revision;
              state = validateDocument(latest.document);
              localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
              renderMap(); renderDetails();
            }
          }
        }
        toast(completed.result?.action === 'unplaced' ? '论文已入库，暂未定位到树图' : '论文已自动加入树图');
      }
    }
    knownImportStatuses = current;
  } catch { /* The map remains usable while import status is unavailable. */ }
  finally { setTimeout(pollMapImports, 5000); }
}
pollMapImports();
window.addEventListener('online', () => { if (remoteReady && !remoteConflict && localStorage.getItem(PENDING_KEY) === '1') { clearTimeout(saveTimer); saveTimer = setTimeout(flushRemote, 0); } });
window.addEventListener('storage', (event) => {
  if (event.key === 'kv-inference-lineage:domain-updated' && localStorage.getItem(PENDING_KEY) !== '1') loadRemote();
});
document.addEventListener('visibilitychange', () => { if (!document.hidden && remoteReady && !remoteConflict && localStorage.getItem(PENDING_KEY) === '1') { clearTimeout(saveTimer); saveTimer = setTimeout(flushRemote, 0); } });
function centerOnOrigin() {
  const viewport = $('#mapViewport');
  viewport.scrollLeft = Math.max(0, originX * zoom - viewport.clientWidth / 2);
  viewport.scrollTop = 0;
}
requestAnimationFrame(centerOnOrigin);
