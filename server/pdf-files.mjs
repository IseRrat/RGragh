import { mkdir, readFile, writeFile, copyFile, unlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'papers');
const MAX_PDF_BYTES = 40_000_000;
const pathFor = (id) => {
  if (!/^[\w-]{1,80}$/.test(id)) throw Object.assign(new Error('论文 ID 不合法'), { status: 400 });
  return join(root, `${id}.pdf`);
};

export async function readPaperPdf(id) { return readFile(pathFor(id)); }
export async function copyPaperPdf(fromId, toId) {
  if (fromId === toId) return;
  await copyFile(pathFor(fromId), pathFor(toId));
}
export async function deletePaperPdf(id) { await unlink(pathFor(id)).catch((error) => { if (error.code !== 'ENOENT') throw error; }); }

export async function savePaperPdf(id, request) {
  const path = pathFor(id);
  if (!String(request.headers['content-type'] || '').startsWith('application/pdf')) {
    throw Object.assign(new Error('请上传 PDF 文件'), { status: 415 });
  }
  const chunks = []; let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_PDF_BYTES) throw Object.assign(new Error('PDF 不得超过 40 MB'), { status: 413 });
    chunks.push(chunk);
  }
  const data = Buffer.concat(chunks);
  if (data.length < 8 || data.subarray(0, 5).toString('ascii') !== '%PDF-') {
    throw Object.assign(new Error('文件内容不是 PDF'), { status: 400 });
  }
  await mkdir(root, { recursive: true });
  await writeFile(path, data);
  return { size: data.length };
}
