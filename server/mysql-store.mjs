import mysql from 'mysql2/promise';

export async function createStore(env = process.env) {
  for (const key of ['DB_HOST', 'DB_USER', 'DB_PASSWORD', 'DB_NAME']) {
    if (!env[key]) throw new Error(`缺少 ${key} 环境变量`);
  }
  const pool = mysql.createPool({
    host: env.DB_HOST,
    port: Number(env.DB_PORT || 3306),
    user: env.DB_USER,
    password: env.DB_PASSWORD,
    database: env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 5,
    charset: 'utf8mb4',
    ssl: env.DB_SSL === 'false' ? undefined : { rejectUnauthorized: true, ...(env.DB_CA_CERT ? { ca: env.DB_CA_CERT.replace(/\\n/g, '\n') } : {}) },
  });
  try {
    await pool.query(`CREATE TABLE IF NOT EXISTS map_documents (
      document_id VARCHAR(80) PRIMARY KEY,
      revision BIGINT UNSIGNED NOT NULL,
      payload JSON NOT NULL,
      updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    await pool.query(`CREATE TABLE IF NOT EXISTS paper_imports (
      id VARCHAR(80) PRIMARY KEY,
      filename VARCHAR(255) NOT NULL,
      status VARCHAR(24) NOT NULL,
      result JSON NULL,
      error_text TEXT NULL,
      created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    await pool.execute("UPDATE paper_imports SET status = 'failed', error_text = '服务重启中断了处理，请点击重试' WHERE status IN ('processing', 'queued')");
  } catch (error) {
    await pool.end();
    throw error;
  }
  return {
    async listImports() {
      const [rows] = await pool.query('SELECT id, filename, status, result, error_text AS error, created_at AS createdAt, updated_at AS updatedAt FROM paper_imports ORDER BY created_at DESC LIMIT 30');
      return rows.map((row) => ({ ...row, result: typeof row.result === 'string' ? JSON.parse(row.result) : row.result }));
    },
    async getImport(id) {
      const [rows] = await pool.execute('SELECT id, filename, status, result, error_text AS error FROM paper_imports WHERE id = ?', [id]);
      if (!rows.length) return null;
      const row = rows[0];
      return { ...row, result: typeof row.result === 'string' ? JSON.parse(row.result) : row.result };
    },
    async createImport(id, filename) {
      await pool.execute('INSERT INTO paper_imports (id, filename, status) VALUES (?, ?, ?)', [id, filename, 'queued']);
    },
    async updateImport(id, status, result = null, error = null) {
      await pool.execute('UPDATE paper_imports SET status = ?, result = ?, error_text = ? WHERE id = ?', [status, result ? JSON.stringify(result) : null, error, id]);
    },
    async read() {
      const [rows] = await pool.execute('SELECT revision, payload FROM map_documents WHERE document_id = ?', ['main']);
      if (!rows.length) return { revision: 0, document: null };
      const payload = typeof rows[0].payload === 'string' ? JSON.parse(rows[0].payload) : rows[0].payload;
      return { revision: Number(rows[0].revision), document: payload };
    },
    async write(document, expectedRevision) {
      const connection = await pool.getConnection();
      try {
        await connection.beginTransaction();
        const [rows] = await connection.execute('SELECT revision FROM map_documents WHERE document_id = ? FOR UPDATE', ['main']);
        const current = rows.length ? Number(rows[0].revision) : 0;
        if (current !== expectedRevision) {
          await connection.rollback();
          return { conflict: true, revision: current };
        }
        if (rows.length) {
          await connection.execute('UPDATE map_documents SET revision = ?, payload = ? WHERE document_id = ?', [current + 1, JSON.stringify(document), 'main']);
        } else {
          await connection.execute('INSERT INTO map_documents (document_id, revision, payload) VALUES (?, ?, ?)', ['main', 1, JSON.stringify(document)]);
        }
        await connection.commit();
        return { conflict: false, revision: current + 1 };
      } catch (error) {
        await connection.rollback();
        if (error.code === 'ER_DUP_ENTRY') return { conflict: true, revision: 1 };
        throw error;
      } finally { connection.release(); }
    },
    close: () => pool.end(),
  };
}
