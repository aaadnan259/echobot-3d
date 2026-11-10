// Hats, outfits and seasonal extras, built from simple shapes so they stay tiny and match EchoBot's soft look.
// Everything is attached to the "Squash" node, so it squishes and bounces along with the body.
// EchoBot's body is a sphere of radius ~1 there: the top of the head is at y ≈ 0.96, the face looks down +z.
import * as THREE from "three";

const mat = (color, extra = {}) => new THREE.MeshPhysicalMaterial({ color, roughness: 0.45, clearcoat: 0.3, ...extra });
const glow = (color, i = 1.2) => new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: i, roughness: 0.4 });

function stripedTexture(a, b, stripes = 6) {
  const c = document.createElement("canvas"); c.width = 64; c.height = 64;
  const g = c.getContext("2d");
  for (let i = 0; i < stripes; i++) { g.fillStyle = i % 2 ? b : a; g.fillRect(0, (i * 64) / stripes, 64, 64 / stripes + 1); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
function onHead(group, tilt = -0.18, y = 0.86) { group.position.set(0.08, y, 0.05); group.rotation.set(tilt * 0.4, 0, tilt); return group; }

const HATS = {
  party() {
    const g = new THREE.Group();
    const cone = new THREE.Mesh(new THREE.ConeGeometry(0.34, 0.78, 32, 1, true), mat(0xffffff, { map: stripedTexture("#ff5fa2", "#ffd84d"), side: THREE.DoubleSide }));
    cone.position.y = 0.39;
    const pom = new THREE.Mesh(new THREE.SphereGeometry(0.1, 16, 12), mat(0x7ae7ff));
    pom.position.y = 0.8;
    g.add(cone, pom); return onHead(g, -0.22, 0.82);
  },
  santa() {
    const g = new THREE.Group();
    const cone = new THREE.Mesh(new THREE.ConeGeometry(0.42, 0.72, 32), mat(0xd7263d));
    cone.position.set(0, 0.36, 0); cone.rotation.z = -0.25;
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.09, 12, 32), mat(0xffffff, { roughness: 0.9, sheen: 1 }));
    rim.rotation.x = Math.PI / 2;
    const pom = new THREE.Mesh(new THREE.SphereGeometry(0.11, 16, 12), mat(0xffffff, { roughness: 0.95 }));
    pom.position.set(0.24, 0.68, 0);
    g.add(cone, rim, pom); return onHead(g, -0.15, 0.8);
  },
  witch() {
    const g = new THREE.Group();
    const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.72, 0.72, 0.04, 40), mat(0x2b1d4a));
    const cone = new THREE.Mesh(new THREE.ConeGeometry(0.38, 0.85, 32), mat(0x2b1d4a));
    cone.position.y = 0.44; cone.rotation.z = -0.12;
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.385, 0.4, 0.1, 32, 1, true), mat(0xff9b2e));
    band.position.y = 0.08;
    g.add(brim, cone, band); return onHead(g, -0.12, 0.8);
  },
  beanie() {
    const g = new THREE.Group();
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.62, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2), mat(0xff7a59, { roughness: 0.85, sheen: 1, sheenColor: new THREE.Color(0xffc2a8) }));
    cap.scale.set(1, 0.75, 1);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.6, 0.09, 12, 40), mat(0xffe3d6, { roughness: 0.9 }));
    rim.rotation.x = Math.PI / 2;
    const pom = new THREE.Mesh(new THREE.SphereGeometry(0.14, 16, 12), mat(0xffe3d6, { roughness: 0.95 }));
    pom.position.y = 0.5;
    g.add(cap, rim, pom); return onHead(g, -0.08, 0.66);
  },
  cap() {
    const g = new THREE.Group();
    const dome = new THREE.Mesh(new THREE.SphereGeometry(0.6, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2), mat(0x3d7bff));
    dome.scale.set(1, 0.65, 1);
    const peak = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.04, 32, 1, false, -Math.PI / 2, Math.PI), mat(0x2b5fd9));
    peak.position.set(0, 0.02, 0.42); peak.scale.set(1, 1, 0.9);
    const button = new THREE.Mesh(new THREE.SphereGeometry(0.06, 12, 8), mat(0xffffff));
    button.position.y = 0.39;
    g.add(dome, peak, button); return onHead(g, -0.1, 0.68);
  },
  bow() {
    const g = new THREE.Group();
    const m = mat(0xff4f9a);
    const wing = new THREE.ConeGeometry(0.24, 0.38, 24);
    const l = new THREE.Mesh(wing, m); l.rotation.z = Math.PI / 2; l.position.x = -0.2;
    const r = new THREE.Mesh(wing, m); r.rotation.z = -Math.PI / 2; r.position.x = 0.2;
    const knot = new THREE.Mesh(new THREE.SphereGeometry(0.1, 16, 12), m);
    g.add(l, r, knot); g.scale.setScalar(1.1);
    g.position.set(0.38, 0.84, 0.22); g.rotation.set(0.2, 0, -0.45); return g;
  },
  tophat() {
    const g = new THREE.Group();
    const m = mat(0x1d1830, { roughness: 0.35 });
    const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.56, 0.56, 0.04, 40), m);
    const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.38, 0.62, 40), m);
    crown.position.y = 0.32;
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.385, 0.39, 0.1, 40, 1, true), mat(0xb48cff));
    band.position.y = 0.09;
    g.add(brim, crown, band); return onHead(g, -0.14, 0.84);
  },
  crown() {
    const g = new THREE.Group();
    const gold = mat(0xffc93c, { metalness: 0.8, roughness: 0.25 });
    const ring = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.44, 0.22, 40, 1, true), gold);
    ring.material.side = THREE.DoubleSide;
    g.add(ring);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const spike = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.22, 4), gold);
      spike.position.set(Math.sin(a) * 0.42, 0.21, Math.cos(a) * 0.42);
      const gem = new THREE.Mesh(new THREE.SphereGeometry(0.045, 10, 8), glow(i % 2 ? 0xff4f9a : 0x5fd4ff, 0.6));
      gem.position.set(Math.sin(a) * 0.45, 0.02, Math.cos(a) * 0.45);
      g.add(spike, gem);
    }
    return onHead(g, -0.12, 0.86);
  },
  antenna() {
    const g = new THREE.Group();
    const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.03, 0.42, 12), mat(0xd9d2ee, { metalness: 0.6, roughness: 0.3 }));
    stick.position.y = 0.21;
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.1, 16, 12), glow(0x9aff6b, 1.6));
    ball.position.y = 0.46; ball.name = "AntennaBall";
    g.add(stick, ball); return onHead(g, -0.2, 0.9);
  },
  headphones() {
    const g = new THREE.Group();
    const band = new THREE.Mesh(new THREE.TorusGeometry(1.0, 0.06, 12, 40, Math.PI), mat(0x2a2240));
    band.position.y = 0.0;
    const cupGeo = new THREE.CylinderGeometry(0.26, 0.26, 0.18, 28);
    const cupMat = mat(0x2a2240), padMat = mat(0xb48cff, { roughness: 0.8 });
    for (const s of [-1, 1]) {
      const cup = new THREE.Mesh(cupGeo, cupMat); cup.rotation.z = Math.PI / 2; cup.position.x = s * 1.0;
      const pad = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.05, 24), padMat); pad.rotation.z = Math.PI / 2; pad.position.x = s * 0.9;
      const light = new THREE.Mesh(new THREE.CircleGeometry(0.1, 20), glow(0x7ae7ff, 1.4)); light.position.x = s * 1.095; light.rotation.y = s * Math.PI / 2;
      g.add(cup, pad, light);
    }
    g.add(band); g.position.y = 0.12; return g;
  },
};

const OUTFITS = {
  bowtie() {
    const g = new THREE.Group();
    const m = mat(0xe83a5f);
    const wing = new THREE.ConeGeometry(0.14, 0.24, 4);
    const l = new THREE.Mesh(wing, m); l.rotation.z = Math.PI / 2; l.position.x = -0.12;
    const r = new THREE.Mesh(wing, m); r.rotation.z = -Math.PI / 2; r.position.x = 0.12;
    const k = new THREE.Mesh(new THREE.SphereGeometry(0.06, 12, 8), m);
    g.add(l, r, k); g.position.set(0, -0.76, 0.64); g.rotation.x = -0.85; return g;
  },
  scarf() {
    const g = new THREE.Group();
    const m = mat(0x3fbf8f, { roughness: 0.9, sheen: 1, sheenColor: new THREE.Color(0xbaffdf), map: stripedTexture("#3fbf8f", "#e9fff5", 8) });
    const loop = new THREE.Mesh(new THREE.TorusGeometry(0.86, 0.12, 14, 48), m);
    loop.rotation.x = Math.PI / 2 + 0.15; loop.position.y = -0.48;
    const tail = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.42, 0.08), m);
    tail.position.set(0.32, -0.72, 0.74); tail.rotation.set(-0.4, 0, 0.18);
    g.add(loop, tail); return g;
  },
  glasses() {
    const g = new THREE.Group();
    const lens = new THREE.MeshPhysicalMaterial({ color: 0x140c26, roughness: 0.1, clearcoat: 1, transparent: true, opacity: 0.92 });
    const frame = mat(0x140c26);
    for (const s of [-1, 1]) {
      const l = new THREE.Mesh(new THREE.CircleGeometry(0.2, 28), lens);
      l.position.set(s * 0.28, 0.08, 1.0); l.scale.y = 0.82; l.rotation.y = s * 0.2;
      g.add(l);
    }
    const bridge = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.035, 0.03), frame);
    bridge.position.set(0, 0.13, 1.02);
    g.add(bridge); return g;
  },
  flower() {
    const g = new THREE.Group();
    const petal = mat(0xffffff, { roughness: 0.7 });
    for (let i = 0; i < 6; i++) {
      const p = new THREE.Mesh(new THREE.SphereGeometry(0.09, 12, 8), petal);
      const a = (i / 6) * Math.PI * 2; p.position.set(Math.cos(a) * 0.11, Math.sin(a) * 0.11, 0); p.scale.z = 0.4;
      g.add(p);
    }
    const mid = new THREE.Mesh(new THREE.SphereGeometry(0.07, 12, 8), mat(0xffcf3d)); mid.position.z = 0.03;
    g.add(mid); g.position.set(-0.62, 0.62, 0.62); g.rotation.set(-0.5, -0.6, 0); return g;
  },
  cape() {
    const g = new THREE.Group();
    const geo = new THREE.CylinderGeometry(0.95, 1.25, 1.3, 32, 4, true, Math.PI * 0.62, Math.PI * 0.76);
    const m = mat(0xe8384f, { side: THREE.DoubleSide, roughness: 0.6, sheen: 0.6 });
    const c = new THREE.Mesh(geo, m); c.position.y = -0.45; c.name = "Cape";
    const clasp = new THREE.Mesh(new THREE.SphereGeometry(0.07, 12, 8), mat(0xffc93c, { metalness: 0.8, roughness: 0.3 }));
    clasp.position.set(0, -0.12, 0.98);
    g.add(c, clasp); return g;
  },
};

// Keeps the right pieces attached as the config changes.
export class Wardrobe {
  constructor(parent) { this.parent = parent; this.key = ""; this.group = new THREE.Group(); parent.add(this.group); this.t = 0; }
  set({ hat = "none", outfit = "none", focus = false }) {
    const key = [hat, outfit, focus].join("|");
    if (key === this.key) return;
    this.key = key;
    this.group.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
    this.group.clear();
    if (focus) this.group.add(HATS.headphones());
    if (hat !== "none" && HATS[hat]) {
      const h = HATS[hat]();
      if (focus) h.position.y += 0.08;     // sits on top of the headphone band
      this.group.add(h);
    }
    if (outfit !== "none" && OUTFITS[outfit]) this.group.add(OUTFITS[outfit]());
  }
  update(dt, sway) {
    this.t += dt;
    const ball = this.group.getObjectByName("AntennaBall");
    if (ball) ball.material.emissiveIntensity = 1.1 + Math.sin(this.t * 3) * 0.5;
    const cape = this.group.getObjectByName("Cape");
    if (cape) cape.rotation.x = Math.max(-0.5, Math.min(0.5, -sway * 0.6)) + Math.sin(this.t * 2) * 0.03;
  }
}
