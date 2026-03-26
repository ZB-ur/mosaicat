import { select, password } from '@inquirer/prompts';
import { saveUserLLMConfig, loadUserLLMConfig, getConfigPath } from './llm-config-store.js';
import type { UserLLMConfig } from './llm-config-store.js';

interface ProviderChoice {
  name: string;
  value: string;
  needsKey: boolean;
  keyEnvHint: string;
  defaultModel?: string;
  baseUrl?: string;
}

const PROVIDERS: ProviderChoice[] = [
  {
    name: 'Claude CLI (本地 Claude 桌面应用，无需 API Key)',
    value: 'claude-cli',
    needsKey: false,
    keyEnvHint: '',
  },
  {
    name: 'Anthropic API (Claude)',
    value: 'anthropic-sdk',
    needsKey: true,
    keyEnvHint: 'https://console.anthropic.com/account/keys',
    defaultModel: 'claude-sonnet-4-20250514',
  },
  {
    name: 'OpenAI (GPT)',
    value: 'gpt-4o',
    needsKey: true,
    keyEnvHint: 'https://platform.openai.com/api-keys',
    defaultModel: 'gpt-4o',
    baseUrl: 'https://api.openai.com/v1',
  },
  {
    name: 'Google Gemini',
    value: 'gemini',
    needsKey: true,
    keyEnvHint: 'https://aistudio.google.com/apikey',
    defaultModel: 'gemini-2.5-pro',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
  },
  {
    name: '通义千问 (Qwen)',
    value: 'qwen-max',
    needsKey: true,
    keyEnvHint: 'https://dashscope.console.aliyun.com/apiKey',
    defaultModel: 'qwen-max',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  },
  {
    name: '豆包 (Doubao)',
    value: 'doubao',
    needsKey: true,
    keyEnvHint: 'https://console.volcengine.com/ark',
    defaultModel: 'doubao-pro-256k',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
  },
  {
    name: 'Kimi (Moonshot)',
    value: 'kimi',
    needsKey: true,
    keyEnvHint: 'https://platform.moonshot.cn/console/api-keys',
    defaultModel: 'moonshot-v1-128k',
    baseUrl: 'https://api.moonshot.cn/v1',
  },
  {
    name: 'DeepSeek',
    value: 'deepseek',
    needsKey: true,
    keyEnvHint: 'https://platform.deepseek.com/api_keys',
    defaultModel: 'deepseek-chat',
    baseUrl: 'https://api.deepseek.com/v1',
  },
  {
    name: 'MiniMax',
    value: 'minimax',
    needsKey: true,
    keyEnvHint: 'https://platform.minimaxi.com/user-center/basic-information/interface-key',
    defaultModel: 'MiniMax-Text-01',
    baseUrl: 'https://api.minimax.chat/v1',
  },
];

export async function runSetup(): Promise<void> {
  const existing = loadUserLLMConfig();

  process.stdout.write('\n\x1b[1m\x1b[36m━━━ Mosaicat LLM 配置 ━━━\x1b[0m\n');

  if (existing) {
    process.stdout.write(`\x1b[2m当前配置: ${existing.provider}\x1b[0m\n`);
    process.stdout.write(`\x1b[2m配置文件: ${getConfigPath()}\x1b[0m\n\n`);
  }

  // Step 1: Select provider
  const providerValue = await select({
    message: '选择 LLM 提供商:',
    choices: PROVIDERS.map(p => ({
      name: p.defaultModel ? `${p.name} — ${p.defaultModel}` : p.name,
      value: p.value,
    })),
    default: existing?.provider,
  });

  const provider = PROVIDERS.find(p => p.value === providerValue)!;
  const config: UserLLMConfig = { provider: providerValue };

  // Step 2: API key (if needed)
  if (provider.needsKey) {
    process.stdout.write(`\n\x1b[2m获取 API Key: ${provider.keyEnvHint}\x1b[0m\n`);

    const apiKey = await password({
      message: 'API Key:',
      mask: '*',
    });

    if (!apiKey.trim()) {
      process.stdout.write('\x1b[31m✗ API Key 不能为空\x1b[0m\n');
      process.exit(1);
    }
    config.apiKey = apiKey.trim();
  }

  // Step 3: Test connection
  process.stdout.write('\n\x1b[2m测试连接...\x1b[0m\n');
  const ok = await testConnection(config, provider);

  if (!ok) {
    const proceed = await select({
      message: '连接测试失败，是否仍然保存配置？',
      choices: [
        { name: '保存', value: true },
        { name: '取消', value: false },
      ],
    });
    if (!proceed) {
      process.stdout.write('已取消。\n');
      return;
    }
  }

  // Step 5: Save
  saveUserLLMConfig(config);
  process.stdout.write(`\n\x1b[32m✓ 配置已保存到 ${getConfigPath()}\x1b[0m\n`);
  process.stdout.write('\x1b[2m现在可以运行: mosaicat run "你的需求"\x1b[0m\n\n');
}

async function testConnection(config: UserLLMConfig, provider: ProviderChoice): Promise<boolean> {
  try {
    if (config.provider === 'claude-cli') {
      // Claude CLI: just check if the command exists
      const { execSync } = await import('node:child_process');
      execSync('claude --version', { stdio: 'pipe' });
      process.stdout.write('\x1b[32m✓ Claude CLI 可用\x1b[0m\n');
      return true;
    }

    if (config.provider === 'anthropic-sdk') {
      const { default: Anthropic } = await import('@anthropic-ai/sdk');
      const client = new Anthropic({ apiKey: config.apiKey });
      const msg = await client.messages.create({
        model: config.model ?? provider.defaultModel ?? 'claude-sonnet-4-20250514',
        max_tokens: 32,
        messages: [{ role: 'user', content: 'Say "ok"' }],
      });
      const text = msg.content.find(b => b.type === 'text');
      process.stdout.write(`\x1b[32m✓ Anthropic API 连接成功 (${msg.model})\x1b[0m\n`);
      return !!text;
    }

    // OpenAI-compatible providers
    const baseUrl = provider.baseUrl!;
    const model = config.model ?? provider.defaultModel!;
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: 'Say "ok"' }],
        max_tokens: 32,
      }),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      process.stdout.write(`\x1b[31m✗ API 返回 ${response.status}: ${text.slice(0, 200)}\x1b[0m\n`);
      return false;
    }

    const data = await response.json() as { model?: string };
    process.stdout.write(`\x1b[32m✓ 连接成功 (${data.model ?? model})\x1b[0m\n`);
    return true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stdout.write(`\x1b[31m✗ 连接失败: ${msg}\x1b[0m\n`);
    return false;
  }
}
