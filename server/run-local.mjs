import mysql from 'mysql2/promise';
import { createInterface, emitKeypressEvents } from 'node:readline';

function passwordFromStdin(label = 'MySQL password: ') {
  if (process.stdin.isTTY) return new Promise((resolve) => {
    process.stdout.write(label);
    emitKeypressEvents(process.stdin);
    process.stdin.setRawMode(true);
    let value = '';
    const onKey = (character, key) => {
      if (key?.ctrl && key.name === 'c') process.exit(130);
      if (key?.name === 'return' || key?.name === 'enter') {
        process.stdin.off('keypress', onKey);
        process.stdin.setRawMode(false);
        process.stdout.write('\n');
        resolve(value);
      } else if (key?.name === 'backspace') value = value.slice(0, -1);
      else if (character && !key?.ctrl && !key?.meta) value += character;
    };
    process.stdin.on('keypress', onKey);
  });
  return new Promise((resolve) => {
    const input = createInterface({ input: process.stdin, output: process.stdout, terminal: false });
    process.stdout.write(label);
    input.once('line', (line) => { input.close(); resolve(line); });
  });
}

process.env.DB_HOST ||= '127.0.0.1';
process.env.DB_PORT ||= '3306';
process.env.DB_USER ||= 'root';
process.env.DB_NAME ||= 'inference_lineage';
process.env.DB_SSL ||= 'false';
process.env.DB_PASSWORD ||= await passwordFromStdin();
if (!process.env.AI_API_KEY && !process.env.OPENAI_API_KEY && !process.env.DEEPSEEK_API_KEY) {
  process.env.AI_API_KEY = await passwordFromStdin('AI API key (Enter to skip; configure in page): ');
}

const connection = await mysql.createConnection({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
});
try {
  const name = process.env.DB_NAME;
  if (!/^[a-zA-Z0-9_]{1,64}$/.test(name)) throw new Error('数据库名只能包含字母、数字和下划线');
  await connection.query(`CREATE DATABASE IF NOT EXISTS \`${name}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
} finally { await connection.end(); }

await import('./index.mjs');
