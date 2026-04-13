import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const CONFIG_DIR = path.join(os.homedir(), ".superdeep");
const CONFIG_FILE = path.join(CONFIG_DIR, "config.json");

export interface SuperdeepConfig {
  apiKeys: Record<string, string>;
}

const DEFAULT_CONFIG: SuperdeepConfig = {
  apiKeys: {},
};

// Providers and their environment variable names (matching pi-ai conventions)
export const PROVIDERS: Record<string, { envVar: string; displayName: string }> = {
  anthropic: { envVar: "ANTHROPIC_API_KEY", displayName: "Anthropic (Claude)" },
  openai: { envVar: "OPENAI_API_KEY", displayName: "OpenAI (GPT)" },
  google: { envVar: "GOOGLE_API_KEY", displayName: "Google (Gemini)" },
  mistral: { envVar: "MISTRAL_API_KEY", displayName: "Mistral" },
  groq: { envVar: "GROQ_API_KEY", displayName: "Groq" },
  perplexity: { envVar: "PERPLEXITY_API_KEY", displayName: "Perplexity" },
  deepseek: { envVar: "DEEPSEEK_API_KEY", displayName: "DeepSeek" },
};

function ensureConfigDir(): void {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }
}

export function loadConfig(): SuperdeepConfig {
  ensureConfigDir();
  if (!fs.existsSync(CONFIG_FILE)) {
    return { ...DEFAULT_CONFIG };
  }
  const raw = fs.readFileSync(CONFIG_FILE, "utf-8");
  return JSON.parse(raw) as SuperdeepConfig;
}

export function saveConfig(config: SuperdeepConfig): void {
  ensureConfigDir();
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), "utf-8");
}

export function setApiKey(provider: string, key: string): void {
  const config = loadConfig();
  config.apiKeys[provider] = key;
  saveConfig(config);
}

export function removeApiKey(provider: string): void {
  const config = loadConfig();
  delete config.apiKeys[provider];
  saveConfig(config);
}

export function getApiKey(provider: string): string | undefined {
  const config = loadConfig();
  return config.apiKeys[provider];
}

/** Load saved API keys into process.env so pi-ai can find them */
export function loadKeysIntoEnv(): void {
  const config = loadConfig();
  for (const [provider, key] of Object.entries(config.apiKeys)) {
    const providerInfo = PROVIDERS[provider];
    if (providerInfo && key) {
      process.env[providerInfo.envVar] = key;
    }
  }
}

export function getConfiguredProviders(): string[] {
  const config = loadConfig();
  return Object.keys(config.apiKeys).filter((p) => config.apiKeys[p]);
}
