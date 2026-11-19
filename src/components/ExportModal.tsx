import { useMemo, useRef, useState } from 'react';
import { Modal } from './Modal';
import { Segmented, Slider, Toggle } from './controls';
import { IconDownload, IconShare } from './Icons';
import type { ExportProgress, VideoExportResult } from '../export/videoExporter';
import type { StillResult } from '../studio/exporters';
import type { MediaInfo, TrimRange, VideoExportOptions } from '../types/studio';
import { DEFAULT_VIDEO_EXPORT } from '../types/studio';

interface ExportModalProps {
  media: MediaInfo;
  trim: TrimRange;
  filterLabel: string;
  frameLabel: string;
  plateSize: string;
  onExportStill: (format: 'jpeg' | 'png', quality: number) => Promise<StillResult>;
  onExportMovie: (options: VideoExportOptions, onProgress: (progress: ExportProgress) => void, signal: AbortSignal) => Promise<VideoExportResult>;
  onShareStill: (result: StillResult) => Promise<'shared' | 'downloaded'>;
  onClose: () => void;
}

export function ExportModal(props: ExportModalProps) {
  const { media } = props;
  const [format, setFormat] = useState<'jpeg' | 'png'>('jpeg');
  const [quality, setQuality] = useState(94);
  const [options, setOptions] = useState<VideoExportOptions>({ ...DEFAULT_VIDEO_EXPORT, fps: Math.min(30, Math.round(media.fps || 30)) });
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<ExportProgress | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const seconds = Math.max(0.1, props.trim.end - props.trim.start);
  const frames = useMemo(() => Math.max(1, Math.round(seconds * options.fps)), [seconds, options.fps]);

  const runStill = async (mode: 'save' | 'share') => {
    setBusy(true); setError(null); setMessage(null);
    try {
      const result = await props.onExportStill(format, quality / 100);
      if (mode === 'share') {
        const outcome = await props.onShareStill(result);
        setMessage(outcome === 'shared' ? '공유 시트로 전달했습니다.' : `${result.filename} 파일로 저장했습니다.`);
      } else {
        const { downloadBlob } = await import('../studio/exporters');
        downloadBlob(result.blob, result.filename);
        setMessage(`${result.filename} · ${result.width}×${result.height}px 저장을 시작했습니다.`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '내보내지 못했습니다.');
    } finally {
      setBusy(false);
    }
  };

  const runMovie = async () => {
    setBusy(true); setError(null); setMessage(null); setProgress(null);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const result = await props.onExportMovie(options, setProgress, controller.signal);
      const { downloadBlob } = await import('../studio/exporters');
      downloadBlob(result.blob, result.filename);
      const size = (result.blob.size / (1024 * 1024)).toFixed(1);
      setMessage(`${result.filename} · ${size}MB 저장을 시작했습니다.${result.note ? ` ${result.note}` : ''}`);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') setMessage('내보내기를 취소했습니다.');
      else setError(err instanceof Error ? err.message : '내보내지 못했습니다.');
    } finally {
      setBusy(false);
      abortRef.current = null;
    }
  };

  return (
    <Modal
      kicker="EXPORT"
      title="내보내기"
      description={`${props.filterLabel} · ${props.frameLabel}가 합성된 최종 결과를 저장합니다.`}
      onClose={() => { abortRef.current?.abort(); props.onClose(); }}
      testId="export-modal"
      footer={
        media.kind === 'photo' ? (
          <div className="export-foot">
            <button type="button" className="btn ghost" disabled={busy} onClick={() => void runStill('share')}>
              <IconShare size={16} /> 공유
            </button>
            <button type="button" className="btn primary" disabled={busy} onClick={() => void runStill('save')}>
              <IconDownload size={16} /> 저장
            </button>
          </div>
        ) : (
          <div className="export-foot">
            {busy ? (
              <button type="button" className="btn ghost" onClick={() => abortRef.current?.abort()}>취소</button>
            ) : (
              <span className="muted">약 {frames}프레임 · {seconds.toFixed(1)}초</span>
            )}
            <button type="button" className="btn primary" disabled={busy} onClick={() => void runMovie()}>
              <IconDownload size={16} /> 영상 저장
            </button>
          </div>
        )
      }
    >
      {media.kind === 'photo' ? (
        <div className="panel-stack">
          <div className="panel-grid">
            <Segmented label="형식" value={format} options={[{ value: 'jpeg', label: 'JPEG' }, { value: 'png', label: 'PNG' }]} onChange={setFormat} />
            {format === 'jpeg' && (
              <Slider label="화질" value={quality} min={60} max={100} step={1} defaultValue={94} format={(value) => `${Math.round(value)}`} onChange={setQuality} />
            )}
          </div>
          <dl className="export-table">
            <div><dt>원본</dt><dd>{media.width}×{media.height}px</dd></div>
            <div><dt>플레이트</dt><dd>{props.plateSize}</dd></div>
            <div><dt>저장</dt><dd>1:1 원본 해상도 · 로컬 처리</dd></div>
          </dl>
        </div>
      ) : (
        <div className="panel-stack">
          <div className="panel-grid">
            <Segmented
              label="해상도"
              value={options.resolution}
              options={[
                { value: 'source', label: `원본 ${media.width}×${media.height}` },
                { value: '1080p', label: '1080p' },
                { value: '720p', label: '720p' },
              ]}
              onChange={(value) => setOptions({ ...options, resolution: value })}
            />
            <Segmented
              label="프레임레이트"
              value={String(options.fps)}
              options={Array.from(new Set([Math.min(30, Math.round(media.fps || 30)), 24, 30]))
                .sort((a, b) => a - b)
                .map((rate) => ({
                  value: String(rate),
                  label: rate === Math.min(30, Math.round(media.fps || 30)) ? `원본 ${rate}` : String(rate),
                }))}
              onChange={(value) => setOptions({ ...options, fps: Number(value) })}
            />
            <Toggle label="원본 오디오" hint="트림 구간에 맞춰 결합합니다." checked={options.includeAudio} onChange={(value) => setOptions({ ...options, includeAudio: value })} />
          </div>
          <dl className="export-table">
            <div><dt>트림</dt><dd>{props.trim.start.toFixed(2)}s – {props.trim.end.toFixed(2)}s</dd></div>
            <div><dt>길이</dt><dd>{seconds.toFixed(2)}초 · {frames}프레임</dd></div>
            <div><dt>인코더</dt><dd>WebCodecs (H.264 우선) · 실패 시 MediaRecorder</dd></div>
            <div><dt>예상 시간</dt><dd>프레임 수에 비례합니다 (720p가 가장 빠름)</dd></div>
          </dl>
          {progress && (
            <div className="progress">
              <div className="progress-bar"><span style={{ width: `${Math.min(100, (progress.current / Math.max(1, progress.total)) * 100)}%` }} /></div>
              <p>{progress.message}</p>
            </div>
          )}
        </div>
      )}
      {message && <p className="notice ok">{message}</p>}
      {error && <p className="notice error">{error}</p>}
    </Modal>
  );
}
