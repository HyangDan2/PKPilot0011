/**
 * The sound path for the source clip, written for Android Chrome.
 *
 * A muted autoplay is the only autoplay a phone allows, and Android Chrome is
 * allowed to keep the audio track of a muted element asleep: setting
 * `video.muted = false` on an element that is already running often changes
 * nothing audible, because the renderer and the AudioFocus were never granted
 * for it. So the sound is turned on from inside the visitor's tap, in this
 * order, and every step is one the platform actually reacts to:
 *
 *  1. `preload = 'auto'` — the whole track is wanted from now on, not a probe.
 *  2. An `AudioContext` resumed inside the same tap, with the element routed
 *     through `MediaElementAudioSourceNode → GainNode → AnalyserNode → out`.
 *     A running context gives the page its own audio output, which Chrome then
 *     keeps alive while the clip plays. The routing is done once per element
 *     (`createMediaElementSource` is permanent) and only when the context has
 *     really reached `'running'`; if it did not, the element keeps its native
 *     output and still plays.
 *  3. A rebind: if the clip was already playing silently, pause on the same
 *     frame and play again, which makes the decoder build a fresh audio track
 *     with sound instead of reusing the muted one.
 *
 * The analyser is not decoration: it is how a test can prove real PCM came out
 * of the graph, not just that a flag flipped. The measured level is published on
 * `window.__cineplateAudio` while the monitor runs.
 */

interface AudioGraph {
  context: AudioContext;
  source: MediaElementAudioSourceNode;
  gain: GainNode;
  analyser: AnalyserNode;
}

/** One graph per element: `createMediaElementSource` can only ever run once. */
const graphs = new WeakMap<HTMLVideoElement, AudioGraph>();
/** How the element is currently wired, for the mute toggle and diagnostics. */
const routed = new WeakMap<HTMLVideoElement, boolean>();

let context: AudioContext | null = null;
let monitor: number | null = null;
let monitored: HTMLVideoElement | null = null;

export interface AudioDiagnostics {
  context: 'unavailable' | AudioContextState;
  routed: boolean;
  muted: boolean;
  volume: number;
  paused: boolean;
  /** RMS of the last analysed window, 0 when silent or not routed. */
  rms: number;
  peak: number;
  timestamp: number;
}

declare global {
  interface Window {
    __cineplateAudio?: AudioDiagnostics;
  }
}

function audioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const Ctor = window.AudioContext
    ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  if (!context || context.state === 'closed') {
    try {
      context = new Ctor();
    } catch {
      return null;
    }
  }
  return context;
}

/** True while the element's audio leaves the page through our own graph. */
export function isAudioRouted(video: HTMLVideoElement): boolean {
  return routed.get(video) === true;
}

/**
 * Resume the shared context from inside a tap and route this element into it.
 * Returns the graph only when the context is genuinely running; otherwise the
 * element is left alone, so a platform that refuses Web Audio still gets the
 * native output path instead of silence.
 */
export async function attachAudioGraph(video: HTMLVideoElement): Promise<AudioGraph | null> {
  const existing = graphs.get(video);
  if (existing) {
    if (existing.context.state !== 'running') {
      try { await existing.context.resume(); } catch { /* the monitor reports it */ }
    }
    return existing.context.state === 'running' ? existing : null;
  }
  const ctx = audioContext();
  if (!ctx) return null;
  // Called synchronously inside the gesture: this is the call Android listens
  // for. Anything after the await is allowed to arrive late.
  const resuming = ctx.state === 'running' ? null : ctx.resume();
  if (resuming) {
    try { await resuming; } catch { /* fall through to the state check */ }
  }
  if (ctx.state !== 'running') return null;
  try {
    const source = ctx.createMediaElementSource(video);
    const gain = ctx.createGain();
    gain.gain.value = 1;
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.3;
    source.connect(gain);
    gain.connect(analyser);
    analyser.connect(ctx.destination);
    const graph: AudioGraph = { context: ctx, source, gain, analyser };
    graphs.set(video, graph);
    routed.set(video, true);
    return graph;
  } catch {
    // The element is already attached to another context (or the platform said
    // no): keep its native output rather than taking its sound away.
    routed.set(video, false);
    return null;
  }
}

/**
 * Turn the sound on from a tap: full preload, an unmuted element at full
 * volume, a resumed context, and — if it was already playing silently — a
 * pause/play on the same frame so the decoder rebuilds the audio track.
 */
export async function openAudioPath(video: HTMLVideoElement): Promise<void> {
  try { video.preload = 'auto'; } catch { /* an element that refuses keeps its preload */ }
  video.volume = 1;
  video.muted = false;
  const graph = await attachAudioGraph(video);
  if (graph) {
    graph.gain.gain.value = 1;
    startMonitor(video, graph);
  }
}

/**
 * Android Chrome keeps the muted audio track it started with. Pausing on the
 * very frame it shows and playing again makes it open a new one — with sound.
 * A paused element is left paused; the caller decides whether to play.
 */
export async function rebindAudioTrack(video: HTMLVideoElement): Promise<void> {
  if (video.paused) return;
  const at = video.currentTime;
  video.pause();
  try { video.currentTime = at; } catch { /* a clip that refuses the seek still replays */ }
  await video.play();
}

/** Silence the clip: element mute plus a closed gain, whatever the wiring is. */
export function closeAudioPath(video: HTMLVideoElement): void {
  video.muted = true;
  video.volume = 1;
  const graph = graphs.get(video);
  if (graph) graph.gain.gain.value = 0;
  publish(video, graph ?? null);
}

/** The element follows the toggle: element mute first, then the graph's gain. */
export function applyMuted(video: HTMLVideoElement, muted: boolean): void {
  video.muted = muted;
  video.volume = 1;
  const graph = graphs.get(video);
  if (graph) graph.gain.gain.value = muted ? 0 : 1;
}

/** Give the graph and the monitor back when the clip leaves the stage. */
export function releaseAudio(video: HTMLVideoElement): void {
  const graph = graphs.get(video);
  if (graph) {
    try { graph.gain.gain.value = 0; } catch { /* a closed context is already silent */ }
    try { graph.source.disconnect(); } catch { /* already detached */ }
    try { graph.gain.disconnect(); } catch { /* already detached */ }
    try { graph.analyser.disconnect(); } catch { /* already detached */ }
    graphs.delete(video);
  }
  routed.delete(video);
  if (monitored === video) stopMonitor();
}

/**
 * The context itself is kept, not closed: closing it would leave the next clip
 * without a running context until another tap, and the tap that opened this one
 * is already spent.
 */
function startMonitor(video: HTMLVideoElement, graph: AudioGraph): void {
  if (typeof window === 'undefined') return;
  if (monitored === video && monitor !== null) return;
  stopMonitor();
  monitored = video;
  const data = new Uint8Array(graph.analyser.fftSize);
  const tick = () => {
    if (!graphs.has(video)) { stopMonitor(); return; }
    graph.analyser.getByteTimeDomainData(data);
    let peak = 0;
    let sum = 0;
    for (let i = 0; i < data.length; i += 1) {
      const value = (data[i] - 128) / 128;
      const magnitude = Math.abs(value);
      if (magnitude > peak) peak = magnitude;
      sum += value * value;
    }
    publish(video, graph, Math.sqrt(sum / data.length), peak);
    monitor = window.setTimeout(tick, 100);
  };
  tick();
}

function stopMonitor(): void {
  if (monitor !== null) window.clearTimeout(monitor);
  monitor = null;
  monitored = null;
}

function publish(video: HTMLVideoElement, graph: AudioGraph | null, rms = 0, peak = 0): void {
  if (typeof window === 'undefined') return;
  window.__cineplateAudio = {
    context: graph ? graph.context.state : (context?.state ?? 'unavailable'),
    routed: isAudioRouted(video),
    muted: video.muted,
    volume: video.volume,
    paused: video.paused,
    rms,
    peak,
    timestamp: Date.now(),
  };
}
