import type { AdjustmentSettings } from './film';
import type { CameraSettings } from './camera';
import type { ToneCurves } from './curves';
import type { ColorMixerSettings } from './colorMixer';
import type { SharpeningSettings } from './sharpening';

export type MediaKind = 'photo' | 'video';

export type FrameId =
  | 'horizon'
  | 'gallery'
  | 'dual'
  | 'strap'
  | 'film'
  | 'studio'
  | 'edge'
  | 'pro'
  | 'polaroid'
  | 'frosted'
  | 'editorial'
  | 'contact'
  | 'fyra04';

/** The eleven single-cut signatures, in library order. */
export const SINGLE_FRAMES: FrameId[] = [
  'horizon', 'gallery', 'dual', 'strap', 'film', 'studio', 'edge', 'pro',
  'polaroid', 'frosted', 'editorial',
];

/** The two four-cut plates — photo only in Phase 1. */
export const MULTI_FRAMES: FrameId[] = ['contact', 'fyra04'];

export const ALL_FRAMES: FrameId[] = [...SINGLE_FRAMES, ...MULTI_FRAMES];

export function isMultiFrame(id: FrameId): boolean {
  return id === 'contact' || id === 'fyra04';
}

/** Video accepts the eleven single-cut signatures only. */
export function framesFor(kind: MediaKind): FrameId[] {
  return kind === 'video' ? SINGLE_FRAMES : ALL_FRAMES;
}

export interface PlateMeta {
  make: string;
  model: string;
  lens: string;
  focal: string;
  aperture: string;
  shutter: string;
  iso: string;
  datetime: string;
  caption: string;
}

export const EMPTY_META: PlateMeta = {
  make: '', model: '', lens: '', focal: '', aperture: '', shutter: '', iso: '', datetime: '', caption: '',
};

export interface MediaInfo {
  kind: MediaKind;
  name: string;
  url: string;
  width: number;
  height: number;
  /** Seconds; video only. */
  duration: number;
  /** Frames per second as reported by the decoder, video only. */
  fps: number;
  size: number;
  meta: PlateMeta;
}

export interface FrameSettings {
  style: FrameId;
  emblem: string;          // 'auto' | 'none' | emblem id
  emblemMono: boolean;     // All Black ink
  padPct: number | null;   // null = the frame's own default
  extraPct: number | null;
  fyraTheme: string;
  backdrop: 'dark' | 'light';
  /** The spec row (camera, lens, exposure) printed by the frame. */
  showSpec: boolean;
  /** The visitor's own caption line. */
  showCaption: boolean;
}

export const DEFAULT_FRAME: FrameSettings = {
  style: 'gallery',
  emblem: 'auto',
  emblemMono: false,
  padPct: null,
  extraPct: null,
  fyraTheme: 'nordic',
  backdrop: 'dark',
  showSpec: true,
  showCaption: true,
};

export type FilterKind = 'neutral' | 'film' | 'margarine';

export interface FilterSelection {
  kind: FilterKind;
  /** FS-001 … FS-010 (RETRO 90) */
  filmId: string;
  /** Margarine preset id when kind === 'margarine' */
  presetId: string | null;
}

/** Everything the renderer needs for one frame. */
export interface GradeSettings {
  filmId: string;
  adjustments: AdjustmentSettings;
  camera: CameraSettings;
  curves: ToneCurves;
  colorMixer: ColorMixerSettings;
  sharpening: SharpeningSettings;
}

export interface TrimRange {
  start: number;
  end: number;
}

export interface VideoExportOptions {
  resolution: 'source' | '1080p' | '720p';
  fps: number;
  includeAudio: boolean;
}

export const DEFAULT_VIDEO_EXPORT: VideoExportOptions = {
  resolution: '1080p',
  fps: 30,
  includeAudio: true,
};

/** Preview is capped so a phone does not cook while scrubbing a 4K clip. */
export const PREVIEW_MAX_EDGE = 1080;

/** The stage designs every plate at this long edge, then scales to the room it has. */
export const PLATE_BASE_EDGE = 1200;
