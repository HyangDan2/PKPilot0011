import type { FrameId } from '../types/studio';
import { isMultiFrame } from '../types/studio';

export interface FrameDef {
  id: FrameId;
  label: string;
  tag: string;
  blurb: string;
  video: boolean;
}

/** The thirteen signatures, described for the picker. Labels match the engine. */
export const FRAMES: FrameDef[] = [
  { id: 'horizon', label: 'Clean Horizon', tag: 'MINIMAL', blurb: '종이 여백과 한 줄 캡션. 가장 조용한 프레임.', video: true },
  { id: 'gallery', label: 'Classic Gallery', tag: 'MATTE', blurb: '마감이 있는 매트 갤러리 프린트. 기본값.', video: true },
  { id: 'dual', label: 'Dual Deck', tag: '2-LINE', blurb: '장비 스펙과 캡션을 두 줄로 나눈 편집 프레임.', video: true },
  { id: 'strap', label: 'Strap Bar', tag: 'WIDE', blurb: '하단에 넓은 스트랩 바가 깔리는 와이드 프레임.', video: true },
  { id: 'film', label: 'Film Sprocket', tag: '35MM', blurb: '35mm 퍼포레이션과 필름 스톡 표기.', video: true },
  { id: 'studio', label: 'Studio Dark', tag: 'DARK', blurb: '어두운 스튜디오 보드에 인화한 느낌.', video: true },
  { id: 'edge', label: 'Minimal Edge', tag: 'FLUSH', blurb: '사진이 판면에 닿는 플러시 엣지.', video: true },
  { id: 'pro', label: 'Pro Studio', tag: 'GRID', blurb: '넉넉한 마진과 그리드 라인의 프로 시트.', video: true },
  { id: 'polaroid', label: 'Instant Polaroid', tag: 'INSTANT', blurb: '아래가 넓은 즉석 인화지와 손글씨 캡션.', video: true },
  { id: 'frosted', label: 'Frosted Glass', tag: 'GLASS', blurb: '반투명 유리 판 위에 얹은 다크 프레임.', video: true },
  { id: 'editorial', label: 'Editorial Cover', tag: 'EDITION', blurb: '매거진 커버처럼 마스트헤드를 올린 프레임.', video: true },
  { id: 'contact', label: 'Contact Sheet', tag: '4-UP · MULTI', blurb: '네 장을 한 장에 붙인 콘택트 시트. 사진 전용.', video: false },
  { id: 'fyra04', label: 'FYRA 04', tag: 'NORDIC 4-CUT', blurb: '네 컷을 노르딕 테마로 묶는 플레이트. 사진 전용.', video: false },
];

export const FRAME_MAP: Record<FrameId, FrameDef> = FRAMES.reduce((map, frame) => {
  map[frame.id] = frame;
  return map;
}, {} as Record<FrameId, FrameDef>);

export function frameDef(id: FrameId): FrameDef {
  return FRAME_MAP[id] ?? FRAME_MAP.gallery;
}

export function frameSupportsVideo(id: FrameId): boolean {
  return !isMultiFrame(id);
}

/** The eleven single-cut signatures, for the frame modal. */
export const SINGLE_FRAME_DEFS: FrameDef[] = FRAMES.filter((frame) => frameSupportsVideo(frame.id));

/** The two four-cut plates, for the 4-cut window. */
export const MULTI_FRAME_DEFS: FrameDef[] = FRAMES.filter((frame) => !frameSupportsVideo(frame.id));

export const FYRA_THEME_LABELS: { id: string; label: string }[] = [
  { id: 'midnight', label: 'Midnight' },
  { id: 'snow', label: 'Snow' },
  { id: 'forest', label: 'Forest' },
  { id: 'sand', label: 'Sand' },
  { id: 'nordic', label: 'Nordic' },
  { id: 'classic', label: 'Classic' },
  { id: 'dark', label: 'Dark' },
  { id: 'film', label: 'Film' },
  { id: 'editorial', label: 'Editorial' },
  { id: 'minimal', label: 'Minimal' },
];
