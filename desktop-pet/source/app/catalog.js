// Everything EchoBot can wear, and what it costs in coins. Shared by the shop (settings window) and the 3D renderer.
// "level" means it unlocks once EchoBot reaches that level. Seasonal items are free and appear on their own.
const HATS = [
  { id: "none", name: "No hat", price: 0 },
  { id: "party", name: "Party hat", price: 15 },
  { id: "beanie", name: "Cosy beanie", price: 20 },
  { id: "cap", name: "Cap", price: 25 },
  { id: "bow", name: "Big bow", price: 25 },
  { id: "tophat", name: "Top hat", price: 40, level: 3 },
  { id: "crown", name: "Crown", price: 60, level: 5 },
  { id: "antenna", name: "Antenna", price: 35, level: 2 },
  // seasonal, never sold
  { id: "santa", name: "Santa hat", seasonal: true },
  { id: "witch", name: "Witch hat", seasonal: true },
];
const OUTFITS = [
  { id: "none", name: "Nothing", price: 0 },
  { id: "bowtie", name: "Bow tie", price: 15 },
  { id: "scarf", name: "Scarf", price: 20 },
  { id: "glasses", name: "Sunglasses", price: 30 },
  { id: "flower", name: "Flower", price: 20 },
  { id: "cape", name: "Hero cape", price: 50, level: 4 },
];
// hue: degrees to rotate EchoBot's purple. sat/light tweak it a little for the special ones.
const COLOURS = [
  { id: "classic", name: "Classic purple", price: 0, hue: 0 },
  { id: "mint", name: "Mint", price: 20, hue: -120 },
  { id: "sky", name: "Sky blue", price: 20, hue: -50 },
  { id: "rose", name: "Rose", price: 20, hue: 55 },
  { id: "sunset", name: "Sunset", price: 30, hue: 110 },
  { id: "lime", name: "Lime", price: 30, hue: -165 },
  { id: "gold", name: "Gold", price: 60, hue: 150, level: 4 },
];
const FOCUS_COINS = 5, GAME_COIN_DIVISOR = 2;

function find(kind, id) {
  const list = kind === "hat" ? HATS : kind === "outfit" ? OUTFITS : COLOURS;
  return list.find((i) => i.id === id) || list[0];
}
function levelFor(xp) { return Math.floor(Math.sqrt((xp || 0) / 12)) + 1; }
function xpForLevel(level) { return (level - 1) * (level - 1) * 12; }

module.exports = { HATS, OUTFITS, COLOURS, FOCUS_COINS, GAME_COIN_DIVISOR, find, levelFor, xpForLevel };
