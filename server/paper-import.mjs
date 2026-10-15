import { validateDocument } from './document.mjs';
import { readPaperPdf, copyPaperPdf, deletePaperPdf } from './pdf-files.mjs';
import { extractPdfText, analyzePaper } from './paper-analyzer.mjs';
import { aiEnvironment } from './ai-config.mjs';
import { taxonomyTags } from '../dist/taxonomy.js';

const normalize = (value) => String(value || '').normalize('NFKC').toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
const clean = (value, max) => String(value ?? '').trim().slice(0, max);
const pdfUrl = (value, text) => {
  const candidate = clean(value, 2000);
  try { const url = new URL(candidate); return /^https?:$/.test(url.protocol) && text.includes(url.hostname) ? candidate : ''; }
  catch { return ''; }
};

export function applyPaperAnalysis(source, raw, jobId, pdfText) {
  const document = structuredClone(source);
  const title = clean(raw.title, 500);
  if (title.length < 4) throw new Error('模型没有识别出可信的论文标题');
  const key = normalize(title);
  const existingPaper = document.papers.find((paper) => normalize(paper.title) === key);
  const paperId = existingPaper?.id || `paper-${jobId}`;
  let paper = existingPaper || document.papers.find((item) => item.id === paperId);
  if (!paper) {
    paper = {
      id: paperId, title, authors: clean(raw.authors, 2000), year: clean(raw.time, 40),
      summary: clean(raw.summary, 12000), abstract: clean(raw.abstract, 16000),
      sourceUrl: pdfUrl(raw.sourceUrl, pdfText), codeUrl: pdfUrl(raw.codeUrl, pdfText),
      notes: '', status: 'unread', hasPdf: true,
    };
    document.papers.push(paper);
  } else paper.hasPdf = true;

  const normalizedPdf = normalize(pdfText);
  const evidence = clean(raw.evidence, 800);
  const evidenceFound = evidence.length >= 20 && normalizedPdf.includes(normalize(evidence));
  const relationship = clean(raw.relationship, 1500);
  const confidence = Number(raw.confidence) || 0;
  const reason = clean(raw.reason, 2000);
  let node = null;
  let addedNodeId = null;
  let addedTagId = null;
  let action = 'unplaced';

  const ownedNode = document.nodes.find((item) => item.id === `node-${jobId}`);
  const matchingNode = document.nodes.find((item) => item.id === raw.existingNodeId);
  const nodeTitle = matchingNode?.title.trim() || '';
  const exactWork = matchingNode && (normalize(nodeTitle) === key || (title.toLocaleLowerCase().startsWith(nodeTitle.toLocaleLowerCase()) && /^[:：\s,(（]/.test(title.slice(nodeTitle.length))));
  if (ownedNode) {
    node = ownedNode;
    addedNodeId = ownedNode.id;
    addedTagId = ownedNode.tagId === `tag-${jobId}` ? ownedNode.tagId : null;
    action = 'created';
  } else if (raw.decision === 'existing' && exactWork) {
    node = matchingNode;
    action = 'linked';
  } else if (raw.decision === 'new') {
    const parent = document.nodes.find((item) => item.id === raw.parentNodeId);
    const duplicateNode = document.nodes.find((item) => normalize(item.title) === key);
    if (duplicateNode) {
      node = duplicateNode;
      action = 'linked';
    } else if (parent && confidence >= .75 && evidenceFound && relationship.length >= 12) {
      const requestedTag = taxonomyTags(document.taxonomy).find((tag) => normalize(tag.name) === normalize(raw.tagName) || normalize(tag.english) === normalize(raw.tagName));
      const tagId = document.tagCatalog.some((tag) => tag.id === requestedTag?.id) ? requestedTag.id : parent.tagId;
      if (tagId) {
        addedNodeId = `node-${jobId}`;
        node = { id: addedNodeId, parentId: parent.id, order: Math.max(-1, ...document.nodes.filter((item) => item.parentId === parent.id).map((item) => item.order)) + 1, title, time: clean(raw.time, 30), description: clean(raw.summary || relationship, 12000), tagId, dabbled: false };
        document.nodes.push(node);
        action = 'created';
      }
    }
  }

  const linkExists = Boolean(node && document.paperLinks.some((link) => link.nodeId === node.id && link.paperId === paperId));
  const addedLink = Boolean(node && (ownedNode || !linkExists));
  if (node && !linkExists) document.paperLinks.push({ nodeId: node.id, paperId });
  const result = { action, paperId, nodeId: node?.id || null, addedNodeId, addedTagId, createdNode: addedNodeId ? structuredClone(node) : null, addedLink, title, reason: reason || (action === 'unplaced' ? '缺少足够证据确定父节点，论文已收入个人库' : ''), relationship, evidence: evidenceFound ? evidence : '', confidence };
  return { document: validateDocument(document), result };
}

export async function runPaperImport(store, jobId) {
  try {
    const pdf = await readPaperPdf(jobId);
    const text = await extractPdfText(pdf);
    const current = await store.read();
    if (!current.document) throw new Error('地图尚未初始化，请先打开首页');
    const analysis = await analyzePaper(text, current.document, aiEnvironment());
    for (let attempt = 0; attempt < 5; attempt++) {
      const snapshot = await store.read();
      const { document, result } = applyPaperAnalysis(snapshot.document, analysis, jobId, text);
      const saved = await store.write(document, snapshot.revision);
      if (saved.conflict) continue;
      await copyPaperPdf(jobId, result.paperId);
      await store.updateImport(jobId, 'done', result);
      await deletePaperPdf(jobId).catch((error) => console.error('Unable to remove temporary PDF:', error));
      return result;
    }
    throw new Error('地图正在频繁更新，请稍后重试导入');
  } catch (error) {
    await store.updateImport(jobId, 'failed', null, error.message);
    return null;
  }
}

export async function undoPaperPlacement(store, job) {
  if (!job || job.status !== 'done' || !job.result || job.result.action === 'unplaced') throw Object.assign(new Error('此记录没有可撤销的入图操作'), { status: 409 });
  const result = job.result;
  for (let attempt = 0; attempt < 5; attempt++) {
    const snapshot = await store.read();
    const document = structuredClone(snapshot.document);
    if (result.addedNodeId) {
      const node = document.nodes.find((item) => item.id === result.addedNodeId);
      const unchanged = node && result.createdNode && ['id', 'parentId', 'order', 'title', 'time', 'description', 'tagId', 'dabbled'].every((field) => node[field] === result.createdNode[field]);
      if (!unchanged || document.nodes.some((item) => item.parentId === node.id)) throw Object.assign(new Error('节点已被修改或有子节点，请手动调整'), { status: 409 });
      document.nodes = document.nodes.filter((item) => item.id !== node.id);
      if (result.addedTagId && !document.nodes.some((item) => item.tagId === result.addedTagId)) document.tagCatalog = document.tagCatalog.filter((tag) => tag.id !== result.addedTagId);
    }
    if (result.addedLink) document.paperLinks = document.paperLinks.filter((link) => !(link.nodeId === result.nodeId && link.paperId === result.paperId));
    const saved = await store.write(validateDocument(document), snapshot.revision);
    if (saved.conflict) continue;
    await store.updateImport(job.id, 'undone', result);
    return { revision: saved.revision };
  }
  throw Object.assign(new Error('地图正在频繁更新，请稍后重试'), { status: 409 });
}
