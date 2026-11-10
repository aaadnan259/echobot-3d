// Encrypts the chat API key with Windows' own per-user data protection, so the settings file never holds it
// in plain text. (The light build swaps this file for one that asks its native core to do the same.)
const { safeStorage } = require("electron");
module.exports = {
  available: () => safeStorage.isEncryptionAvailable(),
  encrypt: async (text) => safeStorage.encryptString(text).toString("base64"),
  decrypt: async (b64) => safeStorage.decryptString(Buffer.from(b64, "base64")),
};
