// Light build: HTTP through the native core (tauri-plugin-http), so web-page CORS rules don't apply.
const { fetch } = require("@tauri-apps/plugin-http");
module.exports = { fetch };
