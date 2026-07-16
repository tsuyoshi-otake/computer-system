import { describe, expect, it } from "vitest";

import {
  FloppyAudioSequenceGate,
  WebFloppyDriveAudio,
} from "../../web/floppy-audio.js";

describe("Web Floppy audio sequence gate", () => {
  it("does not replay the retained snapshot on first load or reconnect", () => {
    const gate = new FloppyAudioSequenceGate();
    expect(
      gate.accept({
        events: [{ kind: "insert", sequence: 3, tick: 1 }],
        latestSequence: 3,
      }),
    ).toEqual([]);
    expect(
      gate.accept({
        events: [{ kind: "seek", sequence: 4, tick: 2 }],
        latestSequence: 4,
      }),
    ).toEqual(["seek"]);
    expect(
      gate.accept({
        events: [{ kind: "seek", sequence: 4, tick: 2 }],
        latestSequence: 4,
      }),
    ).toEqual([]);
  });

  it("rejects malformed, regressing, and unknown events", () => {
    const gate = new FloppyAudioSequenceGate();
    gate.accept({ events: [], latestSequence: 5 });
    expect(
      gate.accept({
        events: [
          { kind: "unknown", sequence: 6 },
          { kind: "read", sequence: 7 },
          { kind: "write", sequence: 8 },
        ],
        latestSequence: 7,
      }),
    ).toEqual(["read"]);
    expect(gate.accept({ events: [], latestSequence: 4 })).toEqual([]);
  });
});

describe("Web Floppy drive audio", () => {
  it("unlocks on a gesture, synthesizes only new events, bounds voices, and stops them", async () => {
    const originalAudioContext = globalThis.AudioContext;
    globalThis.AudioContext = FakeAudioContext;
    try {
      const audio = new WebFloppyDriveAudio();
      expect(await audio.unlock()).toBe(true);
      const context = audio.context;
      expect(context.resumeCalls).toBe(1);

      audio.consume({
        events: [{ kind: "insert", sequence: 3, tick: 1 }],
        latestSequence: 3,
      });
      expect(context.sources).toHaveLength(0);

      audio.consume({
        events: [{ kind: "seek", sequence: 4, tick: 2 }],
        latestSequence: 4,
      });
      expect(context.sources).toHaveLength(2);
      expect(audio.voices.size).toBe(2);

      for (let index = 0; index < 10; index += 1) audio.play("seek");
      expect(audio.voices.size).toBe(16);
      expect(
        context.sources.filter((source) => source.immediateStopCalls > 0)
          .length,
      ).toBe(6);

      audio.stopAll();
      expect(audio.voices.size).toBe(0);
      expect(
        context.sources.every((source) => source.immediateStopCalls > 0),
      ).toBe(true);

      await audio.close();
      expect(context.closeCalls).toBe(1);
    } finally {
      if (originalAudioContext === undefined) delete globalThis.AudioContext;
      else globalThis.AudioContext = originalAudioContext;
    }
  });
});

class FakeAudioParam {
  setValueAtTime() {}
  exponentialRampToValueAtTime() {}
}

class FakeAudioNode {
  connect(node) {
    return node;
  }

  disconnect() {}
}

class FakeSource extends FakeAudioNode {
  constructor() {
    super();
    this.frequency = new FakeAudioParam();
    this.immediateStopCalls = 0;
    this.stopCalls = 0;
  }

  addEventListener() {}
  start() {}

  stop(when) {
    this.stopCalls += 1;
    if (when === undefined) this.immediateStopCalls += 1;
  }
}

class FakeAudioContext {
  constructor() {
    this.closeCalls = 0;
    this.currentTime = 0;
    this.destination = new FakeAudioNode();
    this.resumeCalls = 0;
    this.sampleRate = 8_000;
    this.sources = [];
    this.state = "suspended";
  }

  async resume() {
    this.resumeCalls += 1;
    this.state = "running";
  }

  async close() {
    this.closeCalls += 1;
    this.state = "closed";
  }

  createOscillator() {
    return this.track(new FakeSource());
  }

  createBufferSource() {
    return this.track(new FakeSource());
  }

  createGain() {
    const node = new FakeAudioNode();
    node.gain = new FakeAudioParam();
    return node;
  }

  createBiquadFilter() {
    const node = new FakeAudioNode();
    node.frequency = new FakeAudioParam();
    return node;
  }

  createBuffer(_channels, frameCount) {
    return {
      getChannelData: () => new Float32Array(frameCount),
    };
  }

  track(source) {
    this.sources.push(source);
    return source;
  }
}
