// Listens to sound so EchoBot can bob to music. Only runs when you turn it on in settings.
// "music" listens to what your PC is playing (Windows loopback), "mic" to the microphone.
// Audio is analysed live in memory for loudness and beats; nothing is recorded, saved or sent anywhere.
export class Ears {
  constructor() { this.mode = "off"; this.level = 0; this.bass = 0; this.beat = 0; this.voice = 0; this.music = 0; this.ok = false; this.error = ""; }

  async setMode(mode) {
    if (mode === this.mode) return;
    this.stop();
    this.mode = mode;
    if (mode === "off") return;
    if (window.__TAURI__) return this.startNative(mode);
    try {
      let stream;
      if (mode === "music") {
        stream = await navigator.mediaDevices.getDisplayMedia({ audio: true, video: true });
        stream.getVideoTracks().forEach((t) => t.stop());          // we only want the sound
      } else {
        stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false } });
      }
      if (this.mode !== mode) { stream.getTracks().forEach((t) => t.stop()); return; }
      this.stream = stream;
      this.ctx = new AudioContext();
      const src = this.ctx.createMediaStreamSource(stream);
      this.an = this.ctx.createAnalyser();
      this.an.fftSize = 1024; this.an.smoothingTimeConstant = 0.6;
      src.connect(this.an);                // not connected to the speakers: nothing is played back
      this.freq = new Uint8Array(this.an.frequencyBinCount);
      this.wave = new Uint8Array(this.an.fftSize);
      this.avgBass = 0; this.ok = true; this.error = "";
    } catch (e) { this.ok = false; this.error = String(e && e.message || e); this.mode = "off"; }
  }

  // Light build: the native core measures the sound and sends ~60 levels a second.
  async startNative(mode) {
    const T = window.__TAURI__;
    try {
      await T.core.invoke("audio_start", { mode });
      if (this.mode !== mode) { T.core.invoke("audio_stop"); return; }
      this.native = { level: 0, bass: 0, voice: 0 };
      this.unlisten = await T.event.listen("audio", (e) => { this.native = e.payload; });
      this.avgBass = 0; this.ok = true; this.error = "";
    } catch (e) { this.ok = false; this.error = String(e && e.message || e); this.mode = "off"; }
  }

  stop() {
    if (this.unlisten) { this.unlisten(); this.unlisten = null; if (window.__TAURI__) window.__TAURI__.core.invoke("audio_stop").catch(() => {}); }
    this.native = null;
    if (this.stream) this.stream.getTracks().forEach((t) => t.stop());
    if (this.ctx) this.ctx.close().catch(() => {});
    this.stream = null; this.ctx = null; this.an = null; this.ok = false; this.level = this.bass = this.beat = this.voice = this.music = 0;
  }

  // Called every frame. Updates level (0..1), bass, beat (1 right on a beat, decays), voice (speech-band loudness).
  update(dt) {
    if (this.native) {
      const n = this.native;
      this.level += (Math.min(1, n.level * 4) - this.level) * Math.min(1, dt * 12);
      this.voice += (Math.min(1, n.voice * 6) - this.voice) * Math.min(1, dt * 10);
      const bass = Math.min(1, n.bass * 3);
      this.avgBass += (bass - this.avgBass) * Math.min(1, dt * 1.5);
      this.beat = Math.max(0, this.beat - dt * 4);
      if (bass > 0.08 && bass > this.avgBass * 1.3 && (!this.lastBeat || performance.now() - this.lastBeat > 280)) { this.beat = 1; this.lastBeat = performance.now(); }
      this.bass = bass;
      this.music = Math.max(0, Math.min(1, this.music + (this.level > 0.06 ? dt / 4 : -dt / 2)));
      return;
    }
    if (!this.an) return;
    this.an.getByteTimeDomainData(this.wave);
    let sum = 0;
    for (let i = 0; i < this.wave.length; i++) { const v = (this.wave[i] - 128) / 128; sum += v * v; }
    const rms = Math.sqrt(sum / this.wave.length);
    this.level += (Math.min(1, rms * 4) - this.level) * Math.min(1, dt * 12);
    this.an.getByteFrequencyData(this.freq);
    const binHz = this.ctx.sampleRate / this.an.fftSize;
    const band = (lo, hi) => { let s = 0, n = 0; for (let i = Math.floor(lo / binHz); i <= Math.ceil(hi / binHz) && i < this.freq.length; i++) { s += this.freq[i]; n++; } return n ? s / n / 255 : 0; };
    const bass = band(40, 140), voice = band(300, 3000);
    this.voice += (voice - this.voice) * Math.min(1, dt * 10);
    this.avgBass += (bass - this.avgBass) * Math.min(1, dt * 1.5);
    this.beat = Math.max(0, this.beat - dt * 4);
    if (bass > 0.25 && bass > this.avgBass * 1.25 && (!this.lastBeat || performance.now() - this.lastBeat > 280)) { this.beat = 1; this.lastBeat = performance.now(); }
    this.bass = bass;
    // "music" builds up while there's steady sound, and drains in silence
    this.music = Math.max(0, Math.min(1, this.music + (this.level > 0.06 ? dt / 4 : -dt / 2)));
  }
}
