import { DEFAULT_ADJUSTMENTS, type AdjustmentSettings } from '../types/film';
import { DEFAULT_CAMERA, type CameraSettings } from '../types/camera';
import { defaultCurves, type ToneCurves } from '../types/curves';
import { defaultColorMixer, type ColorMixerSettings } from '../types/colorMixer';
import { DEFAULT_SHARPENING, type SharpeningSettings } from '../types/sharpening';
import {
  DEFAULT_FRAME,
  type FilterSelection,
  type FrameSettings,
  type MediaInfo,
  type TrimRange,
} from '../types/studio';
import { DEFAULT_FILTER, gradeForFilter } from '../filters/catalog';

/** Sheets. Tone Curve is not one of them: it is an overlay on the stage. */
export type ModalKind =
  | 'filter' | 'margarine' | 'emblem' | 'frame' | 'fourcut'
  | 'colorlab' | 'camera' | 'adjust' | 'export' | null;

export interface StudioState {
  media: MediaInfo[];
  activePhoto: number;
  filter: FilterSelection;
  grade: {
    adjustments: AdjustmentSettings;
    camera: CameraSettings;
    curves: ToneCurves;
    colorMixer: ColorMixerSettings;
    sharpening: SharpeningSettings;
    filmId: string;
  };
  frame: FrameSettings;
  trim: TrimRange;
  playing: boolean;
  currentTime: number;
  modal: ModalKind;
  theme: 'dark' | 'light';
  /** 1 = expand limited-range video frames (HDR/HLG safety guard). */
  inputGuard: 0 | 1;
  /** Bumped whenever anything that changes the grade is touched. */
  revision: number;
}

export function initialStudio(): StudioState {
  const grade = gradeForFilter(DEFAULT_FILTER);
  return {
    media: [],
    activePhoto: 0,
    filter: DEFAULT_FILTER,
    grade: {
      adjustments: { ...grade.adjustments },
      camera: grade.camera,
      curves: defaultCurves(),
      colorMixer: defaultColorMixer(),
      sharpening: { ...DEFAULT_SHARPENING },
      filmId: grade.filmId,
    },
    frame: { ...DEFAULT_FRAME },
    trim: { start: 0, end: 0 },
    playing: true,
    currentTime: 0,
    modal: null,
    theme: 'dark',
    inputGuard: 0,
    revision: 1,
  };
}

/**
 * One file's edit session. A workspace keeps one of these per open file, so
 * walking the strip never folds two photographs into the same grade.
 */
export interface StudioSession {
  filter: FilterSelection;
  grade: StudioState['grade'];
  frame: FrameSettings;
  trim: TrimRange;
  inputGuard: 0 | 1;
}

export function sessionOf(state: StudioState): StudioSession {
  return {
    filter: state.filter,
    grade: state.grade,
    frame: state.frame,
    trim: state.trim,
    inputGuard: state.inputGuard,
  };
}

export type StudioAction =
  | { type: 'open-photos'; media: MediaInfo[] }
  | { type: 'open-video'; media: MediaInfo }
  | { type: 'add-photos'; media: MediaInfo[] }
  | { type: 'set-photo'; index: number; media: MediaInfo }
  | { type: 'remove-photo'; index: number }
  | { type: 'clear-media' }
  | { type: 'set-active-photo'; index: number }
  | { type: 'select-filter'; filter: FilterSelection }
  | { type: 'patch-adjustments'; patch: Partial<AdjustmentSettings> }
  | { type: 'patch-camera'; patch: Partial<CameraSettings> }
  | { type: 'patch-date-stamp'; patch: Partial<CameraSettings['dateStamp']> }
  | { type: 'patch-optics'; patch: Partial<CameraSettings['optics']> }
  | { type: 'set-curves'; curves: ToneCurves }
  | { type: 'patch-mixer'; mixer: ColorMixerSettings }
  | { type: 'patch-sharpening'; patch: Partial<SharpeningSettings> }
  | { type: 'set-frame'; patch: Partial<FrameSettings> }
  | { type: 'set-trim'; trim: TrimRange }
  | { type: 'set-duration'; duration: number }
  | { type: 'set-time'; time: number }
  | { type: 'set-playing'; playing: boolean }
  | { type: 'open-modal'; modal: ModalKind }
  | { type: 'set-theme'; theme: 'dark' | 'light' }
  | { type: 'set-input-guard'; guard: 0 | 1 }
  | { type: 'restore-session'; session: StudioSession }
  | { type: 'reset-grade' };

function withGradeSelection(state: StudioState, filter: FilterSelection): StudioState {
  const grade = gradeForFilter(filter, state.grade.camera);
  return {
    ...state,
    filter,
    grade: {
      ...state.grade,
      filmId: grade.filmId,
      adjustments: { ...grade.adjustments },
      camera: { ...grade.camera, dateStamp: { ...state.grade.camera.dateStamp } },
      curves: state.grade.curves,
      colorMixer: state.grade.colorMixer,
      sharpening: state.grade.sharpening,
    },
    revision: state.revision + 1,
  };
}

export function studioReducer(state: StudioState, action: StudioAction): StudioState {
  switch (action.type) {
    case 'open-photos':
      return {
        ...state,
        media: action.media,
        activePhoto: 0,
        trim: { start: 0, end: 0 },
        revision: state.revision + 1,
      };
    case 'add-photos':
      return { ...state, media: [...state.media, ...action.media], revision: state.revision + 1 };
    case 'set-photo': {
      if (action.index < 0 || action.index >= state.media.length) return state;
      const media = state.media.map((item, index) => index === action.index ? action.media : item);
      return { ...state, media, revision: state.revision + 1 };
    }
    case 'remove-photo': {
      if (action.index < 0 || action.index >= state.media.length) return state;
      const media = state.media.filter((_, index) => index !== action.index);
      return {
        ...state,
        media,
        activePhoto: Math.max(0, Math.min(media.length - 1, state.activePhoto)),
        revision: state.revision + 1,
      };
    }
    case 'open-video':
      return {
        ...state,
        media: [action.media],
        activePhoto: 0,
        trim: { start: 0, end: action.media.duration },
        currentTime: 0,
        playing: true,
        frame: state.frame.style === 'contact' || state.frame.style === 'fyra04'
          ? { ...state.frame, style: 'gallery' }
          : state.frame,
        revision: state.revision + 1,
      };
    case 'clear-media':
      return { ...state, media: [], activePhoto: 0, trim: { start: 0, end: 0 }, currentTime: 0, modal: null };
    case 'set-active-photo':
      return { ...state, activePhoto: Math.max(0, Math.min(state.media.length - 1, action.index)), revision: state.revision + 1 };
    case 'select-filter':
      return withGradeSelection(state, action.filter);
    case 'patch-adjustments':
      return {
        ...state,
        grade: { ...state.grade, adjustments: { ...state.grade.adjustments, ...action.patch } },
        revision: state.revision + 1,
      };
    case 'patch-camera':
      return { ...state, grade: { ...state.grade, camera: { ...state.grade.camera, ...action.patch } }, revision: state.revision + 1 };
    case 'patch-date-stamp':
      return {
        ...state,
        grade: {
          ...state.grade,
          camera: { ...state.grade.camera, dateStamp: { ...state.grade.camera.dateStamp, ...action.patch } },
        },
        revision: state.revision + 1,
      };
    case 'patch-optics':
      return {
        ...state,
        grade: {
          ...state.grade,
          camera: { ...state.grade.camera, optics: { ...state.grade.camera.optics, ...action.patch } },
        },
        revision: state.revision + 1,
      };
    case 'set-curves':
      return { ...state, grade: { ...state.grade, curves: action.curves }, revision: state.revision + 1 };
    case 'patch-mixer':
      return { ...state, grade: { ...state.grade, colorMixer: action.mixer }, revision: state.revision + 1 };
    case 'patch-sharpening':
      return { ...state, grade: { ...state.grade, sharpening: { ...state.grade.sharpening, ...action.patch } }, revision: state.revision + 1 };
    case 'set-frame':
      return { ...state, frame: { ...state.frame, ...action.patch }, revision: state.revision + 1 };
    case 'set-trim':
      return { ...state, trim: action.trim, revision: state.revision + 1 };
    case 'set-duration': {
      // A clip opened on metadata alone reports its length a beat later. The
      // stage takes the number for the media and, while the trim bar has no
      // end yet, for the cut as well — otherwise the play loop has nothing to
      // loop against and the spec row prints no length.
      const seconds = action.duration;
      if (!Number.isFinite(seconds) || seconds <= 0) return state;
      const active = state.media[state.activePhoto] ?? state.media[0] ?? null;
      if (!active || active.kind !== 'video') return state;
      const settled = Math.abs((active.duration || 0) - seconds) < 0.001;
      const trimKnown = state.trim.end > 0;
      if (settled && trimKnown) return state;
      const media = state.media.map((item) =>
        item === active ? { ...item, duration: seconds } : item);
      return {
        ...state,
        media,
        trim: trimKnown ? state.trim : { ...state.trim, end: seconds },
        revision: state.revision + 1,
      };
    }
    case 'set-time':
      return { ...state, currentTime: action.time };
    case 'set-playing':
      return { ...state, playing: action.playing };
    case 'open-modal':
      return { ...state, modal: action.modal };
    case 'set-theme':
      return { ...state, theme: action.theme };
    case 'set-input-guard':
      return { ...state, inputGuard: action.guard, revision: state.revision + 1 };
    case 'restore-session':
      // Everything the visitor changed on this file comes back at once: the
      // filter and its grade, the frame and its margin, the cut.
      return {
        ...state,
        filter: action.session.filter,
        grade: action.session.grade,
        frame: action.session.frame,
        trim: action.session.trim,
        inputGuard: action.session.inputGuard,
        revision: state.revision + 1,
      };
    case 'reset-grade': {
      const grade = gradeForFilter(state.filter, DEFAULT_CAMERA);
      return {
        ...state,
        grade: {
          adjustments: { ...DEFAULT_ADJUSTMENTS, ...grade.adjustments },
          camera: { ...grade.camera, dateStamp: { ...DEFAULT_CAMERA.dateStamp } },
          curves: defaultCurves(),
          colorMixer: defaultColorMixer(),
          sharpening: { ...DEFAULT_SHARPENING },
          filmId: grade.filmId,
        },
        revision: state.revision + 1,
      };
    }
    default:
      return state;
  }
}
