// Light build: the official Anthropic SDK, sending its requests through the native HTTP client
// (so they aren't subject to web-page CORS rules).
const Anthropic = require("@anthropic-ai/sdk").default || require("@anthropic-ai/sdk");
const { fetch: tauriFetch } = require("@tauri-apps/plugin-http");
class EchoAnthropic extends Anthropic {
  constructor(opts = {}) {
    const baseURL = (globalThis.process && process.env.ANTHROPIC_BASE_URL) || undefined;
    super({ ...opts, ...(baseURL ? { baseURL } : {}), fetch: tauriFetch, dangerouslyAllowBrowser: true });
  }
}
for (const k of Object.getOwnPropertyNames(Anthropic)) { if (!(k in EchoAnthropic)) { try { EchoAnthropic[k] = Anthropic[k]; } catch {} } }
module.exports = EchoAnthropic;
