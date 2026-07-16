const eventKinds = new Set([
  "eject",
  "insert",
  "motor_start",
  "read",
  "seek",
  "write",
]);
const maximumEventsPerBatch = 32;
const maximumVoices = 16;

/** Keeps reconnects and repeated terminal snapshots from replaying old sounds. */
export class FloppyAudioSequenceGate {
  constructor() {
    this.cursor = undefined;
  }

  accept(batch) {
    const latest = batch?.latestSequence;
    if (!Number.isSafeInteger(latest) || latest < 0) return [];
    if (this.cursor === undefined) {
      this.cursor = latest;
      return [];
    }
    if (latest < this.cursor || !Array.isArray(batch.events)) return [];
    const accepted = [];
    let cursor = this.cursor;
    for (const event of batch.events.slice(0, maximumEventsPerBatch)) {
      if (
        !Number.isSafeInteger(event?.sequence) ||
        event.sequence <= cursor ||
        event.sequence > latest ||
        !eventKinds.has(event.kind)
      ) {
        continue;
      }
      cursor = event.sequence;
      accepted.push(event.kind);
    }
    // A bounded server ring may omit events older than its first retained
    // sequence. Advancing to latest prevents those omissions being replayed.
    this.cursor = latest;
    return accepted;
  }
}

export class WebFloppyDriveAudio {
  constructor() {
    this.context = undefined;
    this.gate = new FloppyAudioSequenceGate();
    this.voices = new Set();
  }

  async unlock() {
    const AudioContext =
      globalThis.AudioContext ?? globalThis.webkitAudioContext;
    if (AudioContext === undefined) return false;
    this.context ??= new AudioContext();
    if (this.context.state === "suspended") await this.context.resume();
    return this.context.state === "running";
  }

  consume(batch) {
    const kinds = this.gate.accept(batch);
    if (this.context?.state !== "running") return;
    for (const kind of kinds) this.play(kind);
  }

  stopAll() {
    for (const voice of [...this.voices]) voice.stop();
  }

  async close() {
    this.stopAll();
    const context = this.context;
    this.context = undefined;
    if (context !== undefined && context.state !== "closed")
      await context.close().catch(() => undefined);
  }

  play(kind) {
    switch (kind) {
      case "motor_start":
        this.tone(92, 118, 0.34, "sawtooth", 0.035);
        this.noise(0.3, 0.018, 520);
        break;
      case "seek":
        this.tone(170, 105, 0.075, "square", 0.045);
        this.noise(0.065, 0.04, 1_700);
        break;
      case "read":
        this.noise(0.12, 0.026, 2_200);
        this.tone(138, 145, 0.1, "triangle", 0.018);
        break;
      case "write":
        this.noise(0.16, 0.038, 1_350);
        this.tone(112, 124, 0.14, "square", 0.022);
        break;
      case "insert":
        this.noise(0.09, 0.07, 850);
        this.tone(78, 54, 0.085, "triangle", 0.045);
        break;
      case "eject":
        this.noise(0.11, 0.075, 1_050);
        this.tone(64, 105, 0.1, "triangle", 0.04);
        break;
    }
  }

  tone(startFrequency, endFrequency, duration, type, volume) {
    const context = this.context;
    if (context === undefined) return;
    const source = context.createOscillator();
    const gain = context.createGain();
    const now = context.currentTime;
    source.type = type;
    source.frequency.setValueAtTime(startFrequency, now);
    source.frequency.exponentialRampToValueAtTime(endFrequency, now + duration);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(volume, now + 0.006);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    source.connect(gain).connect(context.destination);
    this.track(source, gain);
    source.start(now);
    source.stop(now + duration + 0.01);
  }

  noise(duration, volume, cutoff) {
    const context = this.context;
    if (context === undefined) return;
    const frameCount = Math.max(1, Math.floor(context.sampleRate * duration));
    const buffer = context.createBuffer(1, frameCount, context.sampleRate);
    const channel = buffer.getChannelData(0);
    for (let index = 0; index < channel.length; index += 1)
      channel[index] = Math.random() * 2 - 1;
    const source = context.createBufferSource();
    const filter = context.createBiquadFilter();
    const gain = context.createGain();
    const now = context.currentTime;
    source.buffer = buffer;
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(cutoff, now);
    gain.gain.setValueAtTime(volume, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    source.connect(filter).connect(gain).connect(context.destination);
    this.track(source, gain, filter);
    source.start(now);
    source.stop(now + duration + 0.01);
  }

  track(source, ...nodes) {
    while (this.voices.size >= maximumVoices)
      this.voices.values().next().value?.stop();
    let stopped = false;
    const voice = {
      stop: () => {
        if (stopped) return;
        stopped = true;
        this.voices.delete(voice);
        try {
          source.stop();
        } catch {
          // The source already reached its scheduled terminal state.
        }
        source.disconnect();
        for (const node of nodes) node.disconnect();
      },
    };
    source.addEventListener("ended", voice.stop, { once: true });
    this.voices.add(voice);
  }
}
