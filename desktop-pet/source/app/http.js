// HTTP from the main side (no web-page CORS rules). Full build: Node's fetch. The light build swaps this file
// for one that uses the native core's HTTP client.
module.exports = { fetch: (...a) => fetch(...a) };
