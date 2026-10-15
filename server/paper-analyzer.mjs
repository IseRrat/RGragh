import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { taxonomyTags } from '../dist/taxonomy.js';

const MAX_PAGES = 80;

export async function extractPdfText(buffer) {
  const pdf = await getDocument({ data: new Uint8Array(buffer), useSystemFonts: true }).promise;
  const pages = [];
  try {
    for (let pageNumber = 1; pageNumber <= Math.min(pdf.numPages, MAX_PAGES); pageNumber++) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      const text = content.items.map((item) => item.str || '').join(' ').replace(/\s+/g, ' ').trim();
      if (text) pages.push(`Page ${pageNumber}: ${text}`);
    }
  } finally { await pdf.destroy(); }
  const text = pages.join('\n');
  if (text.replace(/\s/g, '').length < 300) throw Object.assign(new Error('PDF 中可提取文字太少，可能是扫描版'), { status: 422 });
  return text;
}

export function modelConfiguration(env = process.env) {
  const provider = String(env.AI_PROVIDER || (env.DEEPSEEK_API_KEY ? 'deepseek' : 'openai')).toLowerCase();
  const model = String(env.AI_MODEL || (provider === 'deepseek' ? 'deepseek-flash' : provider === 'openai' ? 'gpt-4.1' : '')).trim();
  const key = env.AI_API_KEY || (provider === 'deepseek' ? env.DEEPSEEK_API_KEY : env.OPENAI_API_KEY) || '';
  if (!model) throw Object.assign(new Error('尚未配置 AI_MODEL；请在启动服务前指定模型'), { status: 503 });
  if (['deepseek', 'openai'].includes(provider) && !key) throw Object.assign(new Error(`尚未配置 ${provider === 'deepseek' ? 'DeepSeek' : 'OpenAI'} API Key`), { status: 503 });
  if (key && !/^[\x21-\x7e]+$/.test(key)) throw Object.assign(new Error('API Key 含中文、空格或特殊字符；请重新输入原始 Key'), { status: 400 });
  if (!['ollama', 'openai', 'deepseek'].includes(provider)) throw Object.assign(new Error('AI_PROVIDER 仅支持 deepseek、openai 或 ollama'), { status: 503 });
  return { provider, model, url: env.AI_BASE_URL || (provider === 'ollama' ? 'http://127.0.0.1:11434/api/chat' : provider === 'deepseek' ? 'https://api.deepseek.com/chat/completions' : 'https://api.openai.com/v1/chat/completions'), key };
}

function parseModelJson(content) {
  const text = String(content || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  if (!text) throw new Error('模型返回空内容');
  try { return JSON.parse(text); }
  catch { throw new Error('模型没有返回有效 JSON，请重试'); }
}

export async function analyzePaper(text, document, env = process.env) {
  const config = modelConfiguration(env);
  const nodes = document.nodes.map((node) => ({ id: node.id, parentId: node.parentId, title: node.title, time: node.time, tag: document.tagCatalog.find((tag) => tag.id === node.tagId)?.name || '', description: node.description.slice(0, 180) }));
  const papers = document.papers.map((paper) => ({ id: paper.id, title: paper.title, year: paper.year }));
  const excerpt = text.length > 65000 ? `${text.slice(0, 52000)}\n[中间省略]\n${text.slice(-13000)}` : text;
  const system = `你是 LLM Infra 论文库的严谨编辑。地图是一棵按技术发展脉络组织的工作树，不是领域分类树。tag 按工作的主要优化对象分类，即使父子工作属于不同方向也分别选择。请读论文并对照现有地图，只输出一个 JSON 对象，不要 Markdown。\n字段：title, authors(字符串), time(YYYY 或 YYYY.M), summary(中文，论文工作简介), abstract(原文摘要，能辨认才填), sourceUrl, codeUrl, decision("existing"|"new"|"unplaced"), existingNodeId, parentNodeId, tagName, relationship(中文，说明相对父工作的具体推进), evidence(论文中能支持这个关系的短原文，逐字摘录), confidence(0 到 1), reason(中文，说明定位理由)。\n规则：existing 仅表示论文对应同一工作；new 表示确有清楚的父工作与方法继承/改进关系；引用某工作本身不足以构成父子关系。父节点拿不准时用 unplaced。不能凭空编造日期、网址或仓库；找不到填空字符串。tagName 必须从给定的二级方向名称中选择，按主要优化对象判断，不要沿用宽泛旧标签。摘要和关系依据要与论文内容一致。\n示例 JSON：{"title":"Example Work","authors":"A. Author","time":"2025.9","summary":"方法简介","abstract":"","sourceUrl":"","codeUrl":"","decision":"unplaced","existingNodeId":"","parentNodeId":"","tagName":"缓存复用","relationship":"","evidence":"","confidence":0.4,"reason":"论文没有给出足够证据来确定父工作"}。只返回可解析的 JSON，不能只输出空白。`;
  const categories = taxonomyTags(document.taxonomy).map((tag) => tag.name).join('、');
  const user = `可选二级方向：${categories}\n现有节点：${JSON.stringify(nodes)}\n现有论文：${JSON.stringify(papers)}\nPDF 文本：\n${excerpt}`;
  const body = config.provider === 'ollama'
    ? { model: config.model, stream: false, format: 'json', options: { temperature: 0 }, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] }
    : { model: config.model, temperature: 0, max_tokens: 6000, response_format: { type: 'json_object' }, ...(config.provider === 'deepseek' ? { thinking: { type: 'disabled' } } : {}), messages: [{ role: 'system', content: system }, { role: 'user', content: user }] };
  for (let attempt = 0; attempt < (config.provider === 'deepseek' ? 2 : 1); attempt++) {
    let response;
    try {
      response = await fetch(config.url, { method: 'POST', headers: { 'content-type': 'application/json', ...(config.key ? { authorization: `Bearer ${config.key}` } : {}) }, body: JSON.stringify(body), signal: AbortSignal.timeout(240000) });
    } catch (error) { throw new Error(`无法连接 ${config.provider === 'deepseek' ? 'DeepSeek' : config.provider === 'openai' ? 'OpenAI' : '模型'}：${error.cause?.code || error.message}`); }
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 300);
      throw new Error(`模型请求失败（${response.status}）：${detail}`);
    }
    const output = await response.json();
    const choice = output.choices?.[0];
    const content = config.provider === 'ollama' ? output.message?.content : choice?.message?.content;
    try { return parseModelJson(content); }
    catch (error) {
      if (attempt > 0 || config.provider !== 'deepseek') {
        throw new Error(`${error.message}${choice?.finish_reason === 'length' ? '（输出长度不足）' : ''}`);
      }
      body.messages[0].content += '\n请在本次重试中直接给出完整 JSON 对象，禁止先输出思考过程或空白。';
      body.messages[1].content = `可选二级方向：${categories}\n现有节点：${JSON.stringify(nodes)}\n现有论文：${JSON.stringify(papers)}\nPDF 文本：\n${text.slice(0, 20000)}\n[后文摘要]\n${text.slice(-4000)}`;
    }
  }
}
