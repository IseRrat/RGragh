import { removeProblemNodes } from './migrate.js';
import { normalizeTaxonomy } from './taxonomy.js';

const DEFAULT_TAG_COLOR = '#4f8662';
const cleanText = (value, limit) => String(value ?? '').slice(0, limit);
const cleanColor = (value) => /^#[0-9a-fA-F]{6}$/.test(String(value)) ? String(value).toLowerCase() : DEFAULT_TAG_COLOR;

export function validateDocument(value) {
  if (!value || !Array.isArray(value.nodes) || value.nodes.length < 1 || value.nodes.length > 500) {
    throw new Error('节点数量不合法（允许 1–500 个）');
  }
  const ids = new Set();
  const rawNodes = value.nodes.map((raw) => {
    if (!raw || typeof raw.id !== 'string' || !/^[\w-]{1,80}$/.test(raw.id) || ids.has(raw.id)) {
      throw new Error('节点 ID 缺失、重复或格式不合法');
    }
    ids.add(raw.id);
    const title = cleanText(raw.title, 180).trim();
    if (!title) throw new Error('存在没有标题的节点');
    return { ...raw, title, parentId: raw.parentId == null ? null : String(raw.parentId), order: Number.isFinite(raw.order) ? raw.order : 0 };
  });
  if (rawNodes.filter((node) => node.parentId === null).length !== 1) throw new Error('地图必须恰好有一个根节点');
  const byId = new Map(rawNodes.map((node) => [node.id, node]));
  for (const node of rawNodes) {
    if (node.parentId !== null && !byId.has(node.parentId)) throw new Error('父节点不存在');
    const seen = new Set(); let cursor = node;
    while (cursor.parentId !== null) {
      if (seen.has(cursor.id)) throw new Error('节点之间存在循环引用');
      seen.add(cursor.id); cursor = byId.get(cursor.parentId);
    }
  }

  const migrated = rawNodes.some((node) => node.parentId !== null && node.type === 'problem')
    ? removeProblemNodes({ nodes: rawNodes, links: [] }).nodes
    : rawNodes;
  const tagCatalog = [];
  const tagNames = new Map();
  const tagIds = new Set();
  for (const raw of Array.isArray(value.tagCatalog) ? value.tagCatalog.slice(0, 200) : []) {
    const name = cleanText(raw?.name, 40).trim();
    if (!name || tagNames.has(name.toLocaleLowerCase())) continue;
    let id = typeof raw?.id === 'string' && /^[\w-]{1,80}$/.test(raw.id) && !tagIds.has(raw.id) ? raw.id : `tag-${tagCatalog.length + 1}`;
    while (tagIds.has(id)) id = `tag-${tagCatalog.length + 1}-${tagIds.size}`;
    tagCatalog.push({ id, name, color: cleanColor(raw.color) });
    tagIds.add(id); tagNames.set(name.toLocaleLowerCase(), id);
  }
  const nodes = migrated.map((raw) => {
    let tagId = tagIds.has(raw.tagId) ? raw.tagId : null;
    const legacyTag = Array.isArray(raw.tags) ? cleanText(raw.tags[0], 40).trim() : '';
    if (!tagId && legacyTag) {
      const key = legacyTag.toLocaleLowerCase();
      tagId = tagNames.get(key);
      if (!tagId && tagCatalog.length < 200) {
        tagId = `tag-${tagCatalog.length + 1}`;
        while (tagIds.has(tagId)) tagId += '-1';
        tagCatalog.push({ id: tagId, name: legacyTag, color: DEFAULT_TAG_COLOR });
        tagIds.add(tagId); tagNames.set(key, tagId);
      }
    }
    return {
      id: raw.id,
      parentId: raw.parentId,
      order: raw.order,
      title: raw.title,
      time: cleanText(raw.time ?? raw.year, 30),
      description: cleanText(raw.description ?? raw.summary ?? raw.subtitle, 12000),
      tagId: raw.parentId === null ? null : tagId || null,
      dabbled: raw.dabbled === true,
    };
  });
  const paperIds = new Set();
  const papers = (Array.isArray(value.papers) ? value.papers : []).slice(0, 1000).map((raw) => {
    if (!raw || typeof raw.id !== 'string' || !/^[\w-]{1,80}$/.test(raw.id) || paperIds.has(raw.id)) throw new Error('论文 ID 缺失、重复或格式不合法');
    paperIds.add(raw.id);
    const title = cleanText(raw.title, 500).trim();
    if (!title) throw new Error('存在没有标题的论文');
    const safeLink = (link) => { const text = cleanText(link, 2000); if (!text) return ''; try { return ['https:', 'http:'].includes(new URL(text).protocol) ? text : ''; } catch { return ''; } };
    return {
      id: raw.id, title, authors: cleanText(raw.authors, 2000), year: cleanText(raw.year, 40),
      summary: cleanText(raw.summary, 12000), abstract: cleanText(raw.abstract, 16000),
      sourceUrl: safeLink(raw.sourceUrl), codeUrl: safeLink(raw.codeUrl),
      notes: cleanText(raw.notes, 30000),
      status: ['unread', 'reading', 'read'].includes(raw.status) ? raw.status : 'unread',
      hasPdf: raw.hasPdf === true,
    };
  });
  const seenLinks = new Set();
  const paperLinks = (Array.isArray(value.paperLinks) ? value.paperLinks : []).filter((link) => {
    if (!link || !ids.has(link.nodeId) || !paperIds.has(link.paperId)) return false;
    const key = `${link.nodeId}\0${link.paperId}`;
    if (seenLinks.has(key)) return false;
    seenLinks.add(key); return true;
  }).map((link) => ({ nodeId: link.nodeId, paperId: link.paperId }));
  const taxonomy = normalizeTaxonomy(value.taxonomy);
  const domainRoot = {
    title: cleanText(value.domainRoot?.title || '大模型推理系统', 60).trim() || '大模型推理系统',
    english: cleanText(value.domainRoot?.english ?? 'LLM Inference Systems', 100).trim(),
    color: cleanColor(value.domainRoot?.color || '#667b9d'),
  };
  return { version: 3, nodes, tagCatalog, papers, paperLinks, taxonomy, domainRoot };
}

export function createEmptyMap(rootId = 'root') {
  return validateDocument({ version: 3, nodes: [{ id: rootId, parentId: null, order: 0, title: 'LLM Infra', time: '', description: '', tagId: null, dabbled: false }], tagCatalog: [], papers: [], paperLinks: [] });
}
