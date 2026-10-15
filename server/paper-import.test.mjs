import test from 'node:test';
import assert from 'node:assert/strict';
import { createEmptyMap } from '../dist/document-schema.js';
import { applyPaperAnalysis, undoPaperPlacement } from './paper-import.mjs';
import { analyzePaper, modelConfiguration } from './paper-analyzer.mjs';
import { setRuntimeAiConfig } from './ai-config.mjs';

const text = 'This paper builds directly upon PagedAttention and introduces a new scheduling method for serving systems. Additional details explain the implementation.';
const base = () => {
  const document = createEmptyMap();
  document.tagCatalog.push({ id: 'serving', name: 'Serving Sys', color: '#4f8662' });
  document.nodes.push({ id: 'vllm', parentId: 'root', order: 0, title: 'vLLM', time: '2023', description: '', tagId: 'serving', dabbled: true });
  return document;
};
const analysis = { title: 'New Serving Work', authors: 'A. Author', time: '2025.9', summary: 'Improves request scheduling.', abstract: 'An abstract.', decision: 'new', parentNodeId: 'vllm', relationship: '在 vLLM 的 PagedAttention 基础上改进调度方法。', evidence: 'This paper builds directly upon PagedAttention and introduces a new scheduling method', confidence: .91, reason: '论文明确表述了对 PagedAttention 的继承。' };

test('creates a new work under the evidenced parent with inherited tag and unread state', () => {
  const { document, result } = applyPaperAnalysis(base(), analysis, 'job-a', text);
  assert.equal(result.action, 'created');
  const node = document.nodes.find((item) => item.id === result.nodeId);
  assert.equal(node.parentId, 'vllm');
  assert.equal(node.tagId, 'serving');
  assert.equal(node.dabbled, false);
  assert.equal(document.papers.find((item) => item.id === result.paperId).status, 'unread');
  assert.deepEqual(document.paperLinks.at(-1), { nodeId: result.nodeId, paperId: result.paperId });
});

test('uses the specified standard direction even when a lineage parent has another tag', () => {
  const document = base();
  document.tagCatalog.push({ id: 'kv-reuse', name: '缓存复用', color: '#7458a7' });
  const { document: next, result } = applyPaperAnalysis(document, { ...analysis, tagName: '缓存复用' }, 'job-cross-category', text);
  assert.equal(result.action, 'created');
  assert.equal(next.nodes.find((node) => node.id === result.nodeId).tagId, 'kv-reuse');
});

test('keeps a paper in the library without inventing a parent when evidence is absent', () => {
  const { document, result } = applyPaperAnalysis(base(), { ...analysis, evidence: 'The paper may have inherited something.' }, 'job-b', text);
  assert.equal(result.action, 'unplaced');
  assert.equal(document.nodes.length, 2);
  assert.equal(document.papers.length, 1);
  assert.equal(document.paperLinks.length, 0);
});

test('deduplicates a previously imported paper and work', () => {
  const first = applyPaperAnalysis(base(), analysis, 'job-c', text);
  const second = applyPaperAnalysis(first.document, { ...analysis, decision: 'existing', existingNodeId: first.result.nodeId }, 'job-d', text);
  assert.equal(second.document.papers.length, 1);
  assert.equal(second.document.nodes.length, 3);
  assert.equal(second.document.paperLinks.length, 1);
  assert.equal(second.result.paperId, first.result.paperId);
});

test('does not merge a numbered successor into the original work', () => {
  const document = base();
  document.nodes.push({ id: 'flash', parentId: 'root', order: 1, title: 'FlashAttention', time: '2022', description: '', tagId: 'serving', dabbled: false });
  const imported = applyPaperAnalysis(document, { title: 'FlashAttention-2: Faster Attention with Better Parallelism', decision: 'existing', existingNodeId: 'flash', reason: 'Model suggested existing' }, 'job-flash2', text);
  assert.equal(imported.result.action, 'unplaced');
  assert.equal(imported.document.nodes.length, 3);
});

test('retry after a committed map write preserves ownership and undo information', async () => {
  const first = applyPaperAnalysis(base(), analysis, 'job-retry', text);
  const retry = applyPaperAnalysis(first.document, analysis, 'job-retry', text);
  assert.equal(retry.result.action, 'created');
  assert.equal(retry.result.addedNodeId, first.result.addedNodeId);
  assert.equal(retry.result.addedLink, true);
  assert.equal(retry.document.nodes.length, first.document.nodes.length);
  assert.equal(retry.document.paperLinks.length, 1);
  let document = retry.document;
  const store = {
    read: async () => ({ document, revision: 2 }),
    write: async (next) => { document = next; return { conflict: false, revision: 3 }; },
    updateImport: async () => {},
  };
  await undoPaperPlacement(store, { id: 'job-retry', status: 'done', result: retry.result });
  assert.equal(document.nodes.length, 2);
  assert.equal(document.paperLinks.length, 0);
});

test('undo removes only the automatic tree placement and keeps the PDF record', async () => {
  let { document, result } = applyPaperAnalysis(base(), analysis, 'job-undo', text);
  let revision = 1;
  let status;
  const store = {
    read: async () => ({ document, revision }),
    write: async (next, expected) => { assert.equal(expected, revision); document = next; return { conflict: false, revision: ++revision }; },
    updateImport: async (_id, next) => { status = next; },
  };
  await undoPaperPlacement(store, { id: 'job-undo', status: 'done', result });
  assert.equal(status, 'undone');
  assert.equal(document.nodes.length, 2);
  assert.equal(document.paperLinks.length, 0);
  assert.equal(document.papers.length, 1);
});

test('requires a key for cloud use and accepts a conventional OpenAI key variable', () => {
  assert.throws(() => modelConfiguration({ AI_PROVIDER: 'openai' }), /API Key/);
  assert.equal(modelConfiguration({ OPENAI_API_KEY: 'test-key' }).model, 'gpt-4.1');
  const deepseek = modelConfiguration({ AI_PROVIDER: 'deepseek', DEEPSEEK_API_KEY: 'test-key' });
  assert.equal(deepseek.model, 'deepseek-flash');
  assert.equal(deepseek.url, 'https://api.deepseek.com/chat/completions');
});

test('rejects non-ASCII API keys before constructing an HTTP header', () => {
  assert.throws(() => setRuntimeAiConfig({ provider: 'deepseek', key: `处${'a'.repeat(20)}` }), /API Key 含中文/);
  assert.throws(() => modelConfiguration({ AI_PROVIDER: 'deepseek', AI_API_KEY: `处${'a'.repeat(20)}` }), /API Key 含中文/);
});

test('sends extracted text and map context to OpenAI JSON endpoint', async () => {
  const originalFetch = globalThis.fetch;
  let captured;
  globalThis.fetch = async (url, options) => {
    captured = { url, headers: options.headers, body: JSON.parse(options.body) };
    return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({ title: 'New Serving Work', decision: 'unplaced' }) } }] }) };
  };
  try {
    const result = await analyzePaper(text, base(), { AI_PROVIDER: 'openai', AI_API_KEY: 'test-key', AI_MODEL: 'gpt-4.1' });
    assert.equal(result.title, 'New Serving Work');
    assert.equal(captured.url, 'https://api.openai.com/v1/chat/completions');
    assert.equal(captured.headers.authorization, 'Bearer test-key');
    assert.equal(captured.body.response_format.type, 'json_object');
    assert.match(captured.body.messages[1].content, /PagedAttention/);
    assert.match(captured.body.messages[1].content, /vLLM/);
  } finally { globalThis.fetch = originalFetch; }
});

test('sends a DeepSeek-compatible JSON request', async () => {
  const originalFetch = globalThis.fetch;
  let captured;
  globalThis.fetch = async (url, options) => {
    captured = { url, headers: options.headers, body: JSON.parse(options.body) };
    return { ok: true, json: async () => ({ choices: [{ message: { content: '{"decision":"unplaced"}' } }] }) };
  };
  try {
    const result = await analyzePaper(text, base(), { AI_PROVIDER: 'deepseek', AI_API_KEY: 'test-key' });
    assert.equal(result.decision, 'unplaced');
    assert.equal(captured.url, 'https://api.deepseek.com/chat/completions');
    assert.equal(captured.body.model, 'deepseek-flash');
    assert.equal(captured.body.response_format.type, 'json_object');
    assert.deepEqual(captured.body.thinking, { type: 'disabled' });
    assert.equal(captured.headers.authorization, 'Bearer test-key');
  } finally { globalThis.fetch = originalFetch; }
});

test('retries once when DeepSeek JSON mode returns empty content', async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return { ok: true, json: async () => ({ choices: [{ finish_reason: 'stop', message: { content: calls === 1 ? '' : '{"title":"Recovered","decision":"unplaced"}' } }] }) };
  };
  try {
    const result = await analyzePaper(text, base(), { AI_PROVIDER: 'deepseek', AI_API_KEY: 'test-key' });
    assert.equal(result.title, 'Recovered');
    assert.equal(calls, 2);
  } finally { globalThis.fetch = originalFetch; }
});
