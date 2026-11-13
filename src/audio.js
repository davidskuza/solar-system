/**
 * Ambient Space Soundtrack controller with smooth fade and Web Audio fallback.
 */

export class SpaceAudioController {
  constructor(src = 'assets/audio/space_ambient.mp3') {
    this.audio = new Audio(src);
    this.audio.loop = true;
    this.audio.preload = 'metadata';
    this.audio.volume = 0;

    this.targetVolume = 0.42;
    this.isPlaying = false;
    this.userMuted = false;
    this.hasInteracted = false;
    this._fadeRaf = null;
    this._fallbackNodes = null;
    this._audioCtx = null;

    this.audio.addEventListener('error', () => {
      console.warn('MP3 soundtrack unavailable; Web Audio ambient pad ready as fallback.');
    });
  }

  async tryAutoStart() {
    if (this.hasInteracted || this.userMuted || this.isPlaying) return;
    this.hasInteracted = true;
    await this.play();
  }

  async play() {
    this.userMuted = false;
    try {
      await this.audio.play();
      this.isPlaying = true;
      this._fadeTo(this.targetVolume, 1400);
      return true;
    } catch {
      // Autoplay blocked or file missing; try Web Audio pad if user explicitly clicked Play
      return false;
    }
  }

  pause() {
    this.userMuted = true;
    this.isPlaying = false;
    this._fadeTo(0, 450, () => {
      if (!this.isPlaying) {
        this.audio.pause();
      }
    });
    this._stopFallback();
  }

  async toggle() {
    this.hasInteracted = true;
    if (this.isPlaying) {
      this.pause();
      return false;
    }
    const ok = await this.play();
    if (!ok) {
      this._startFallback();
      this.isPlaying = true;
      return true;
    }
    return true;
  }

  setVolume(val) {
    this.targetVolume = Math.max(0, Math.min(1, val));
    if (this.isPlaying) {
      this.audio.volume = this.targetVolume;
      if (this._fallbackNodes) {
        this._fallbackNodes.master.gain.setTargetAtTime(
          this.targetVolume * 0.25,
          this._audioCtx.currentTime,
          0.1
        );
      }
    }
  }

  _fadeTo(target, durationMs, onComplete) {
    if (this._fadeRaf) cancelAnimationFrame(this._fadeRaf);
    const start = this.audio.volume;
    const startTime = performance.now();

    const step = (now) => {
      const t = Math.min(1, (now - startTime) / durationMs);
      this.audio.volume = start + (target - start) * t;
      if (t < 1) {
        this._fadeRaf = requestAnimationFrame(step);
      } else {
        this._fadeRaf = null;
        if (onComplete) onComplete();
      }
    };
    this._fadeRaf = requestAnimationFrame(step);
  }

  _startFallback() {
    if (this._fallbackNodes) return;
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;

    this._audioCtx = new AudioCtx();
    const master = this._audioCtx.createGain();
    master.gain.value = this.targetVolume * 0.22;
    master.connect(this._audioCtx.destination);

    const filter = this._audioCtx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 340;
    filter.connect(master);

    const freqs = [55.0, 82.41, 110.0, 164.81];
    const oscs = freqs.map((f, idx) => {
      const osc = this._audioCtx.createOscillator();
      osc.type = idx % 2 === 0 ? 'sine' : 'triangle';
      osc.frequency.value = f;
      osc.detune.value = (idx - 1.5) * 4;
      const g = this._audioCtx.createGain();
      g.gain.value = 0.25 / freqs.length;
      osc.connect(g);
      g.connect(filter);
      osc.start();
      return osc;
    });

    this._fallbackNodes = { master, oscs };
  }

  _stopFallback() {
    if (!this._fallbackNodes) return;
    for (const osc of this._fallbackNodes.oscs) {
      try {
        osc.stop();
      } catch {}
    }
    if (this._audioCtx) {
      this._audioCtx.close().catch(() => {});
    }
    this._fallbackNodes = null;
    this._audioCtx = null;
  }
}
