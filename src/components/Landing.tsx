import { useRef, useState } from 'react';
import { FRAMES } from '../plate/frames';
import { IconArrowLeft, IconPhoto, IconSpark, IconVideo } from './Icons';
import { routeFiles } from '../media/route';
import type { FrameId } from '../types/studio';

export interface SampleItem {
  id: string;
  label: string;
  kind: 'photo' | 'video';
  path: string;
  caption: string;
}

export const SAMPLES: SampleItem[] = [
  { id: 'sample-01', label: 'Landscape', kind: 'photo', path: 'samples/sample-01.jpg', caption: '1350 × 900 · 컬러' },
  { id: 'sample-02', label: 'Cafe Portrait', kind: 'photo', path: 'samples/sample-02.jpg', caption: '세로 인물 · 카페' },
  { id: 'portrait_test', label: 'Studio Portrait', kind: 'photo', path: 'samples/portrait_test.png', caption: '스튜디오 인물' },
  { id: 'sample-clip', label: 'Sample Clip', kind: 'video', path: 'samples/sample-clip.mp4', caption: '6초 · 1280×720 · 30fps · 사운드' },
];

interface LandingProps {
  busy: boolean | string;
  error: string | null;
  hasSession: boolean;
  sessionLabel: string;
  onOpenPhotos: (files: File[]) => void;
  onOpenVideo: (file: File) => void;
  onLoadSample: (sample: SampleItem) => void;
  onPickFrame: (frame: FrameId) => void;
  onContinue: () => void;
  onDismissError: () => void;
}

/** The HD2Lab dual-skew mark: two hollow parallelograms, never a filled blob. */
export function HD2LabMark({ size = 30 }: { size?: number }) {
  return (
    <span className="brand-mark" aria-hidden style={{ width: size, height: size }}>
      <svg viewBox="0 0 64 64" role="presentation">
        <path
          d="M15 20L35 10V43L15 53ZM29 24L49 14V47L29 57Z"
          fill="none"
          stroke="currentColor"
          strokeWidth="4.2"
          strokeLinejoin="miter"
        />
      </svg>
    </span>
  );
}

export function Landing(props: LandingProps) {
  const input = useRef<HTMLInputElement | null>(null);
  const [dragging, setDragging] = useState(false);

  const route = (files: File[]) => {
    const picked = routeFiles(files);
    if (!picked) return;
    if (picked.kind === 'video') props.onOpenVideo(picked.file);
    else props.onOpenPhotos(picked.files);
  };

  return (
    <div className="landing">
      <div className="landing-scroll">
        <header className="landing-top">
          <HD2LabMark size={26} />
          <span className="brand-word">HD2Lab</span>
          <span className="brand-div">|</span>
          <span className="brand-sub">Nordlys</span>
          <span className="brand-badge">STUDIO</span>
        </header>

        <section className="hero">
          <p className="hero-kicker">FILM STUDIO × SHUTTERPLATE</p>
          <h1>한 장의 사진도,<br /><em>움직이는 클립도</em> 하나의 플레이트로.</h1>
          <p className="hero-copy">
            9종 HD2Lab 필름과 RETRO 90, 58종 Margarine 룩을 영상 프레임에 실시간으로 입히고,
            Shutterplate의 13종 프레임으로 인화합니다. 사진은 원본 1:1로, 영상은 H.264 + 사운드로.
            모든 처리는 이 기기 안에서만 일어납니다 — 업로드 0 B.
          </p>
          <div className="hero-stats">
            <span><b>13</b> 프레임</span>
            <span><b>69</b> 필터</span>
            <span><b>4K</b> 입력</span>
            <span><b>0 B</b> 업로드</span>
          </div>
        </section>

        {props.hasSession && (
          <button type="button" className="session-card" onClick={props.onContinue}>
            <span className="session-thumb"><IconSpark size={18} /></span>
            <span>
              <small>이어서 편집</small>
              <strong>{props.sessionLabel}</strong>
            </span>
            <span className="session-go">열기 →</span>
          </button>
        )}

        <section
          className={`open-grid single${dragging ? ' dragging' : ''}`}
          onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            route(Array.from(event.dataTransfer.files));
          }}
        >
          <button
            type="button"
            className="open-card wide"
            onClick={() => input.current?.click()}
            disabled={!!props.busy}
            data-testid="open-any"
          >
            <span className="open-icons" aria-hidden>
              <span className="open-icon"><IconPhoto size={24} /></span>
              <span className="open-icon video"><IconVideo size={24} /></span>
            </span>
            <span className="open-copy">
              <strong>사진 · 영상 열기</strong>
              <span>
                JPEG · PNG · WebP · MP4 · MOV · WebM<br />
                사진은 최대 4장(4컷 플레이트), 영상은 재생·트림 후 인코딩
              </span>
            </span>
            <span className="open-cta">파일 선택 →</span>
          </button>
          <p className="drop-hint">여기로 끌어다 놓아도 됩니다 · 영상과 사진을 함께 놓으면 영상이 열립니다</p>
        </section>

        <section className="sample-section">
          <div className="section-head">
            <h2>바로 체험하기</h2>
            <p>샘플을 누르면 필터와 프레임이 그대로 적용된 편집 화면으로 이동합니다.</p>
          </div>
          <div className="sample-row">
            {SAMPLES.map((sample) => (
              <button
                key={sample.id}
                type="button"
                className={`sample-card ${sample.kind}`}
                onClick={() => props.onLoadSample(sample)}
                disabled={!!props.busy}
              >
                {sample.kind === 'photo' ? (
                  <img src={`${import.meta.env.BASE_URL}${sample.path}`} alt={sample.label} loading="lazy" draggable={false} />
                ) : (
                  <span className="sample-video">
                    <IconVideo size={30} />
                    <span className="play-dot" aria-hidden />
                  </span>
                )}
                <span className="sample-meta">
                  <strong>{sample.label}</strong>
                  <small>{sample.caption}</small>
                </span>
              </button>
            ))}
          </div>
        </section>

        <section className="frame-section">
          <div className="section-head">
            <h2>13 signature frames</h2>
            <p>단일 11종은 영상까지, 4컷 2종은 사진 전용입니다. 카드를 누르면 샘플 사진에 그 프레임이 적용됩니다.</p>
          </div>
          <div className="frame-chip-grid">
            {FRAMES.map((frame, index) => (
              <button
                key={frame.id}
                type="button"
                className={`frame-chip${frame.video ? '' : ' photo-only'}`}
                onClick={() => props.onPickFrame(frame.id)}
                disabled={!!props.busy}
              >
                <span className="frame-index">{String(index + 1).padStart(2, '0')}</span>
                <span className="frame-chip-body">
                  <strong>{frame.label}</strong>
                  <small>{frame.tag}</small>
                </span>
                {!frame.video && <span className="frame-chip-badge">사진 전용</span>}
              </button>
            ))}
          </div>
        </section>

        <footer className="landing-foot">
          <span>HD2Lab · Nordlys — Film Studio × Shutterplate</span>
          <span>브라우저 로컬 처리 · WebGL2 + WebCodecs</span>
        </footer>
      </div>

      {props.busy && (
        <div className="landing-busy" role="status">
          <span className="spinner" aria-hidden />
          <p>{typeof props.busy === 'string' ? props.busy : '여는 중…'}</p>
        </div>
      )}
      {props.error && (
        <div className="landing-error" role="alert">
          <p>{props.error}</p>
          <button type="button" className="btn ghost small" onClick={props.onDismissError}>
            <IconArrowLeft size={14} /> 닫기
          </button>
        </div>
      )}

      <input
        ref={input}
        type="file"
        accept="image/*,video/*,.mp4,.mov,.webm,.m4v"
        multiple
        hidden
        data-testid="open-input"
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          if (files.length) route(files);
          event.target.value = '';
        }}
      />
    </div>
  );
}
