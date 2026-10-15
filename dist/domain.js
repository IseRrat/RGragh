import { validateDocument } from './document-schema.js';
import { applyDomainAction, affectedWorkCount } from './domain-model.js';

const $ = (selector) => document.querySelector(selector);
const escapeHtml = (value = '') => String(value).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
const WIDTH = 2400, HEIGHT = 2200, CX = WIDTH / 2, CY = HEIGHT / 2;
let documentState = null;
let zoom = 0.72;
let selection = null;
let deleting = null;
let toastTimer;

function toast(message) {
  const box = $('#toast'); box.textContent = message; box.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => box.classList.remove('show'), 3200);
}
async function refresh() {
  const response = await fetch('/api/map', { cache: 'no-store' });
  if (!response.ok) throw new Error(`读取数据库失败：HTTP ${response.status}`);
  const result = await response.json();
  documentState = validateDocument(result.document);
  $('#saveState').textContent = '已连接 MySQL';
  render();
}
async function commit(actions) {
  $('#saveState').textContent = '正在保存…';
  for (let attempt = 0; attempt < 3; attempt++) {
    const currentResponse = await fetch('/api/map', { cache: 'no-store' });
    if (!currentResponse.ok) throw new Error('无法读取最新地图');
    const current = await currentResponse.json();
    let updated = validateDocument(current.document);
    for (const action of actions) updated = applyDomainAction(updated, action);
    const response = await fetch('/api/map', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ revision: current.revision, document: updated }) });
    if (response.status === 409) continue;
    if (!response.ok) { const error = await response.json().catch(() => ({})); throw new Error(error.error || `保存失败：HTTP ${response.status}`); }
    const result = await response.json();
    documentState = validateDocument(result.document);
    $('#saveState').textContent = '已保存到 MySQL';
    render();
    localStorage.setItem('kv-inference-lineage:domain-updated', String(result.revision));
    return;
  }
  throw new Error('地图被其他页面同时修改，请重试');
}
function polar(radius, angle) { return { x: CX + Math.cos(angle) * radius, y: CY + Math.sin(angle) * radius }; }
function line(from, to, color) {
  const middle = { x: from.x + (to.x - from.x) * .48, y: from.y + (to.y - from.y) * .48 };
  return `<path d="M${from.x.toFixed(1)} ${from.y.toFixed(1)} Q${middle.x.toFixed(1)} ${middle.y.toFixed(1)} ${to.x.toFixed(1)} ${to.y.toFixed(1)}" stroke="${color}"/>`;
}
function card(kind, id, name, english, color, position, add) {
  const addButton = add ? `<button type="button" class="add-node" data-add="${add.kind}" data-id="${escapeHtml(id)}" aria-label="${escapeHtml(add.label)}" title="${escapeHtml(add.label)}">+</button>` : '';
  return `<div class="node-wrap ${kind}" style="left:${position.x}px;top:${position.y}px;--node-color:${color}"><button type="button" class="map-node ${kind}" data-kind="${kind}" data-id="${escapeHtml(id)}" title="编辑${escapeHtml(name)}"><span>${escapeHtml(name)}</span>${english ? `<small>${escapeHtml(english)}</small>` : ''}</button>${addButton}</div>`;
}
function render() {
  if (!documentState) return;
  const groups = documentState.taxonomy;
  const total = groups.reduce((sum, group) => sum + Math.max(1, group.tags.length) + .55, 0) || 1;
  let cursor = 0;
  const cards = [], edges = [];
  for (const group of groups) {
    const count = Math.max(1, group.tags.length);
    const centerUnit = cursor + count / 2;
    const groupAngle = -Math.PI / 2 + 2 * Math.PI * centerUnit / total;
    const groupPosition = polar(385, groupAngle);
    edges.push(line({ x: CX, y: CY }, groupPosition, group.color));
    cards.push(card('group', group.id, group.name, group.english, group.color, groupPosition, { kind: 'tag', label: `在${group.name}下新增二级方向` }));
    group.tags.forEach((tag, index) => {
      const angle = -Math.PI / 2 + 2 * Math.PI * (cursor + index + .5) / total;
      const position = polar(950, angle);
      edges.push(line(groupPosition, position, group.color));
      cards.push(card('tag', tag.id, tag.name, tag.english, group.color, position));
    });
    cursor += count + .55;
  }
  const root = documentState.domainRoot;
  cards.push(card('root', 'root', root.title, root.english, root.color, { x: CX, y: CY }, { kind: 'group', label: '新增一级方向' }));
  $('#canvas').innerHTML = `<svg class="edges" width="${WIDTH}" height="${HEIGHT}" aria-hidden="true">${edges.join('')}</svg>${cards.join('')}`;
  updateZoom();
}
function updateZoom() {
  $('#canvas').style.transform = `scale(${zoom})`;
  $('#stage').style.width = `${WIDTH * zoom}px`;
  $('#stage').style.height = `${HEIGHT * zoom}px`;
  $('#zoomLabel').textContent = `${Math.round(zoom * 100)}%`;
}
function fit() {
  const viewport = $('#viewport');
  zoom = Math.min(1, Math.max(.3, Math.min((viewport.clientWidth - 30) / WIDTH, (viewport.clientHeight - 30) / HEIGHT)));
  updateZoom();
  viewport.scrollLeft = Math.max(0, CX * zoom - viewport.clientWidth / 2);
  viewport.scrollTop = Math.max(0, CY * zoom - viewport.clientHeight / 2);
}
function center() {
  const viewport = $('#viewport');
  viewport.scrollLeft = Math.max(0, CX * zoom - viewport.clientWidth / 2);
  viewport.scrollTop = Math.max(0, CY * zoom - viewport.clientHeight / 2);
}
function zoomAroundCenter(next) {
  const viewport = $('#viewport');
  const contentX = (viewport.scrollLeft + viewport.clientWidth / 2) / zoom;
  const contentY = (viewport.scrollTop + viewport.clientHeight / 2) / zoom;
  zoom = Math.min(1.5, Math.max(.3, next));
  updateZoom();
  viewport.scrollLeft = contentX * zoom - viewport.clientWidth / 2;
  viewport.scrollTop = contentY * zoom - viewport.clientHeight / 2;
}
function selectedItem() {
  if (!selection) return null;
  if (selection.kind === 'root') return documentState.domainRoot;
  if (selection.kind === 'group') return documentState.taxonomy.find((group) => group.id === selection.id);
  for (const group of documentState.taxonomy) {
    const tag = group.tags.find((item) => item.id === selection.id);
    if (tag) return { ...tag, color: group.color, groupId: group.id };
  }
  return null;
}
function openEditor(kind, id, isNew = false) {
  selection = { kind, id, isNew };
  const item = isNew ? null : selectedItem();
  $('#editorLevel').textContent = kind === 'root' ? '中心节点' : kind === 'group' ? '一级方向' : '二级方向';
  $('#editorTitle').textContent = isNew ? `新增${kind === 'group' ? '一级' : '二级'}方向` : '编辑方向';
  $('#nameInput').value = item?.name || item?.title || '';
  $('#englishInput').value = item?.english || '';
  $('#nameInput').placeholder = isNew ? '输入方向名称' : '';
  $('#colorInput').value = item?.color || (kind === 'tag' ? documentState.taxonomy.find((group) => group.id === id)?.color : '#667b9d') || '#667b9d';
  $('#deleteButton').hidden = isNew || kind === 'root';
  $('#colorHint').textContent = kind === 'tag' ? '修改二级方向的颜色，会同步修改所属一级方向及其全部二级方向。' : kind === 'group' ? '二级方向与该一级方向共用颜色。' : '中心节点颜色只影响领域图。';
  $('#editor').showModal();
  $('#nameInput').focus();
}
async function saveEditor() {
  const name = $('#nameInput').value.trim(), english = $('#englishInput').value.trim(), color = $('#colorInput').value;
  if (!name) { $('#nameInput').focus(); return; }
  const item = selectedItem(), { kind, id, isNew } = selection;
  const actions = [];
  if (isNew) {
    actions.push({ type: kind === 'group' ? 'add-group' : 'add-tag', groupId: kind === 'tag' ? id : undefined, newId: `${kind}-${crypto.randomUUID()}`, name, english, color });
    if (kind === 'tag' && color !== documentState.taxonomy.find((group) => group.id === id)?.color) actions.push({ type: 'color-group', id, color });
  }
  else {
    if (name !== (item.name || item.title)) actions.push({ type: `rename-${kind}`, id, name });
    if (english !== (item.english || '')) actions.push({ type: `english-${kind}`, id, groupId: item.groupId, english });
    if (color !== item.color) actions.push({ type: `color-${kind}`, id, groupId: item.groupId, color });
  }
  try {
    if (actions.length) await commit(actions);
    $('#editor').close(); toast(actions.length ? '已更新方向与 tag' : '没有改动');
  } catch (error) { $('#saveState').textContent = '保存失败'; toast(error.message); }
}
function openDelete() {
  if (!selection || selection.kind === 'root') return;
  deleting = { ...selection };
  const item = selectedItem();
  const count = affectedWorkCount(documentState, selection.kind, selection.id);
  const children = selection.kind === 'group' ? documentState.taxonomy.find((group) => group.id === selection.id)?.tags.length || 0 : 0;
  $('#confirmText').textContent = `删除「${item.name}」${children ? `及其 ${children} 个二级方向` : ''}？${count ? `已有 ${count} 个工作使用这些 tag，删除后这些工作的 tag 会清空，工作和论文会保留。` : '没有工作使用此 tag。'}`;
  $('#editor').close(); $('#confirm').showModal();
}
$('#canvas').addEventListener('click', (event) => {
  const add = event.target.closest('[data-add]');
  if (add) return openEditor(add.dataset.add, add.dataset.id, true);
  const node = event.target.closest('[data-kind]');
  if (node) openEditor(node.dataset.kind, node.dataset.id);
});
$('#saveButton').addEventListener('click', saveEditor);
$('#editor form').addEventListener('submit', (event) => { event.preventDefault(); saveEditor(); });
$('#deleteButton').addEventListener('click', openDelete);
$('#cancelDelete').addEventListener('click', () => $('#confirm').close());
$('#confirmDelete').addEventListener('click', async () => {
  if (!deleting) return;
  try { await commit([{ type: `delete-${deleting.kind}`, id: deleting.id }]); $('#confirm').close(); toast('方向已删除'); }
  catch (error) { toast(error.message); }
});
$('#zoomIn').addEventListener('click', () => zoomAroundCenter(zoom + .1));
$('#zoomOut').addEventListener('click', () => zoomAroundCenter(zoom - .1));
$('#zoomFit').addEventListener('click', fit);
window.addEventListener('resize', center);
$('#viewport').addEventListener('wheel', (event) => {
  if (!event.ctrlKey) return;
  event.preventDefault();
  const viewport = $('#viewport'), rect = viewport.getBoundingClientRect();
  const x = event.clientX - rect.left, y = event.clientY - rect.top;
  const atX = (viewport.scrollLeft + x) / zoom, atY = (viewport.scrollTop + y) / zoom;
  zoom = Math.min(1.5, Math.max(.3, zoom * Math.exp(-event.deltaY * .001)));
  updateZoom(); viewport.scrollLeft = atX * zoom - x; viewport.scrollTop = atY * zoom - y;
}, { passive: false });
let pan = null;
let suppressDragClick = false;
$('#viewport').addEventListener('click', (event) => {
  if (!suppressDragClick || event.detail === 0) return;
  event.preventDefault();
  event.stopPropagation();
  suppressDragClick = false;
}, true);
$('#viewport').addEventListener('pointerdown', (event) => {
  if (event.pointerType !== 'mouse' || event.button !== 0 || event.target.closest('.add-node')) return;
  const viewport = $('#viewport');
  pan = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, left: viewport.scrollLeft, top: viewport.scrollTop, moved: false };
});
$('#viewport').addEventListener('pointermove', (event) => {
  if (!pan || event.pointerId !== pan.pointerId) return;
  const dx = event.clientX - pan.x, dy = event.clientY - pan.y;
  if (!pan.moved && Math.hypot(dx, dy) < 5) return;
  const viewport = $('#viewport');
  if (!pan.moved) { pan.moved = true; viewport.setPointerCapture(event.pointerId); viewport.classList.add('panning'); }
  viewport.scrollLeft = pan.left - dx;
  viewport.scrollTop = pan.top - dy;
});
function endPan(event) {
  if (!pan || event.pointerId !== pan.pointerId) return;
  if (pan.moved) { suppressDragClick = true; setTimeout(() => { suppressDragClick = false; }, 0); }
  pan = null;
  $('#viewport').classList.remove('panning');
}
$('#viewport').addEventListener('pointerup', endPan);
$('#viewport').addEventListener('pointercancel', endPan);
refresh().then(() => requestAnimationFrame(center)).catch((error) => { $('#saveState').textContent = '数据库未连接'; toast(error.message); });
