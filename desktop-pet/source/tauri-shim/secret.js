// Light build: the native core encrypts the API key with Windows' data protection (same as the full build).
const { invoke } = require("@tauri-apps/api/core");
module.exports = {
  available: () => true,
  encrypt: async (text) => { const bytes = await invoke("protect", { text }); return btoa(String.fromCharCode(...bytes)); },
  decrypt: async (b64) => invoke("unprotect", { data: [...atob(b64)].map((c) => c.charCodeAt(0)) }),
};
