let runtimeKey = '';
let runtimeProvider = '';
let runtimeModel = '';

export function aiEnvironment() {
  return { ...process.env, ...(runtimeKey ? { AI_API_KEY: runtimeKey } : {}), ...(runtimeProvider ? { AI_PROVIDER: runtimeProvider } : {}), ...(runtimeModel ? { AI_MODEL: runtimeModel } : {}) };
}

export function setRuntimeAiConfig({ key: value, provider } = {}) {
  const key = String(value || '').trim();
  if (key.length < 15 || key.length > 500) throw Object.assign(new Error('API Key 格式不合法'), { status: 400 });
  if (!/^[\x21-\x7e]+$/.test(key)) throw Object.assign(new Error('API Key 含中文、空格或特殊字符；请只复制平台显示的原始 Key'), { status: 400 });
  if (!['deepseek', 'openai'].includes(provider)) throw Object.assign(new Error('请选择 DeepSeek 或 OpenAI'), { status: 400 });
  runtimeKey = key;
  runtimeProvider = provider;
  runtimeModel = provider === 'deepseek' ? 'deepseek-flash' : 'gpt-4.1';
}
