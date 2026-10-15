import { validateDocument } from './document-schema.js';
import { catalogFromTaxonomy } from './taxonomy.js';

export function affectedWorkCount(document, kind, id) {
  const group = document.taxonomy.find((item) => item.id === id);
  const ids = kind === 'group' ? new Set((group?.tags || []).map((tag) => tag.id)) : new Set([id]);
  return document.nodes.filter((node) => ids.has(node.tagId)).length;
}

export function applyDomainAction(source, action) {
  const doc = validateDocument(source);
  const groups = doc.taxonomy;
  const group = groups.find((item) => item.id === action.id || item.id === action.groupId || item.tags.some((child) => child.id === action.id));
  const tag = group?.tags.find((item) => item.id === action.id);
  const name = () => {
    const value = String(action.name || '').trim();
    if (!value || value.length > 60) throw new Error('名称需要在 1–60 字之间');
    return value;
  };
  const color = () => {
    if (!/^#[0-9a-fA-F]{6}$/.test(action.color || '')) throw new Error('颜色格式不合法');
    return action.color.toLowerCase();
  };
  const english = () => {
    const value = String(action.english || '').trim();
    if (value.length > 100) throw new Error('英文名称不能超过 100 字');
    return value;
  };
  const id = () => {
    if (!/^[\w-]{1,80}$/.test(action.newId || '')) throw new Error('ID 不合法');
    if (groups.some((item) => item.id === action.newId) || groups.some((item) => item.tags.some((child) => child.id === action.newId))) throw new Error('ID 已存在');
    return action.newId;
  };
  switch (action.type) {
    case 'rename-root': doc.domainRoot.title = name(); break;
    case 'english-root': doc.domainRoot.english = english(); break;
    case 'color-root': doc.domainRoot.color = color(); break;
    case 'add-group': groups.push({ id: id(), name: name(), english: english(), color: color(), tags: [] }); break;
    case 'rename-group': if (!group) throw new Error('一级方向不存在'); group.name = name(); break;
    case 'english-group': if (!group) throw new Error('一级方向不存在'); group.english = english(); break;
    case 'color-group':
    case 'color-tag': if (!group) throw new Error('所属一级方向不存在'); group.color = color(); break;
    case 'delete-group': {
      if (!group) throw new Error('一级方向不存在');
      const removed = new Set(group.tags.map((item) => item.id));
      doc.taxonomy = groups.filter((item) => item.id !== group.id);
      for (const node of doc.nodes) if (removed.has(node.tagId)) node.tagId = null;
      break;
    }
    case 'add-tag': if (!group) throw new Error('一级方向不存在'); group.tags.push({ id: id(), name: name(), english: english() }); break;
    case 'rename-tag': if (!tag) throw new Error('二级方向不存在'); tag.name = name(); break;
    case 'english-tag': if (!tag) throw new Error('二级方向不存在'); tag.english = english(); break;
    case 'delete-tag':
      if (!tag) throw new Error('二级方向不存在');
      group.tags = group.tags.filter((item) => item.id !== tag.id);
      for (const node of doc.nodes) if (node.tagId === tag.id) node.tagId = null;
      break;
    default: throw new Error('未知操作');
  }
  const canonical = catalogFromTaxonomy(doc.taxonomy);
  const canonicalIds = new Set(canonical.map((item) => item.id));
  const originalIds = new Set(source.taxonomy?.flatMap((item) => item.tags.map((child) => child.id)) || []);
  doc.tagCatalog = [...canonical, ...doc.tagCatalog.filter((item) => !canonicalIds.has(item.id) && !originalIds.has(item.id))];
  return validateDocument(doc);
}
