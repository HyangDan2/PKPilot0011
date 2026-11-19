import { useEffect, useRef, useState } from 'react';
import { Modal } from './Modal';
import { Segmented, Slider, Toggle } from './controls';
import { IconDownload, IconShare } from './Icons';
import { canShareFile, downloadBlob, shareFile, toFile, type PreparedFile } from '../studio/exporters';
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
  onClose: () => void;
}

/**
 * One window, one button. The file is made *first* — on open for a still, by
 * the visitor for a clip — and then cached, so the tap that opens the OS share
 * sheet has nothing to await. Awaiting the encode inside the tap was what spent
 * the browser's transient activation and turned "공유" into a download into the
 * phone's Download folder.
 */
export function ExportModal(props: ExportModalProps) {
  const { media } = props;
  const isPhoto = media.kind === 'photo';
  const [format, setFormat] = useState<'jpeg' | 'png'>('jpeg');
  const [quality, setQuality] = useState(94);
  const [options, setOptions] = useState<VideoExportOptions>({ ...DEFAULT_VIDEO_EXPORT, fps: Math.min(30, Math.round(media.fps || 30)) });
  const [prepared, setPrepared] = useState<PreparedFile | null>(null);
  const [busy, setBusy] = useState<string | false>(false);
  const [progress, setProgress] = useState<ExportProgress | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const prepareToken = useRef(0);

  const seconds = Math.max(0.1, props.trim.end - props.trim.start);
  const frames = Math.max(1, Math.round(seconds * options.fps));

  const prepareStill = async () => {
    const token = prepareToken.current + 1;
    prepareToken.current = token;
    setBusy('인화 준비 중…');
    setError(null);
    setNote(null);
    setPrepared(null);
    try {
      const result = await props.onExportStill(format, quality / 100);
      if (prepareToken.current !== token) return;
      setPrepared({
        file: toFile(result.blob, result.filename),
        filename: result.filename,
        width: result.width,
        height: result.height,
      });
    } catch (err) {
      if (prepareToken.current === token) setError(err instanceof Error ? err.message : '내보내지 못했습니다.');
    } finally {
      if (prepareToken.current === token) setBusy(false);
    }
  };

  // A still is small: make it as soon as the window opens, and again whenever
  // the format or quality changes, so the button is always holding a real file.
  useEffect(() => {
    if (!isPhoto) return;
    void prepareStill();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPhoto, format, quality]);

  const prepareMovie = async () => {
    setBusy('영상을 인코딩하는 중…');
    setError(null);
    setNote(null);
    setPrepared(null);
    setProgress(null);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const result = await props.onExportMovie(options, setProgress, controller.signal);
      const size = (result.blob.size / (1024 * 1024)).toFixed(1);
      setPrepared({
        file: toFile(result.blob, result.filename),
        filename: result.filename,
        width: 0,
        height: 0,
        note: result.note,
        mode: result.mode,
      });
      setNote(`${result.filename} · ${size}MB${result.note ? ` — ${result.note}` : ''}`);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') setNote('내보내기를 취소했습니다.');
      else setError(err instanceof Error ? err.message : '내보내지 못했습니다.');
    } finally {
      setBusy(false);
      abortRef.current = null;
    }
  };

  /** Called straight from the click: no await, no lost user activation. */
  const saveOrShare = () => {
    if (!prepared) return;
    setSavedMessage(null);
    const shareable = canShareFile(prepared.file);
    shareFile(prepared.file, 'Nordlys');
    setSavedMessage(shareable
      ? `${prepared.filename} — 공유 시트에서 저장하거나 보내세요.`
      : `${prepared.filename} 파일로 저장했습니다.`);
  };

  return (
    <Modal
      kicker="SAVE & SHARE"
      title="저장 / 공유"
      description={`${props.filterLabel} · ${props.frameLabel}가 합성된 최종 결과입니다. 한 번 누르면 폰의 공유 시트(사진 앱 저장 포함)로 넘깁니다.`}
      onClose={() => { abortRef.current?.abort(); props.onClose(); }}
      testId="export-modal"
      footer={
        <div className="export-foot">
          {prepared && (
            <button type="button" className="link-btn" onClick={() => downloadBlob(prepared.file, prepared.filename)}>
              파일로 내려받기
            </button>
          )}
          {!isPhoto && busy && (
            <button type="button" className="btn ghost" onClick={() => abortRef.current?.abort()}>취소</button>
          )}
          {!isPhoto && !prepared && !busy && (
            <button type="button" className="btn ghost" onClick={() => void prepareMovie()}>
              <IconDownload size={16} /> 영상 준비
            </button>
          )}
          <button
            type="button"
            className="btn primary"
            onClick={saveOrShare}
            disabled={!prepared || !!busy}
            data-testid="save-share"
          >
            <IconShare size={16} /> 저장 / 공유
          </button>
        </div>
      }
    >
      {isPhoto ? (
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
            <div><dt>결과</dt><dd>{prepared ? `${prepared.width}×${prepared.height}px · ${prepared.filename}` : '준비 중…'}</dd></div>
            <div><dt>저장</dt><dd>1:1 원본 해상도 · 로컬 처리</dd></div>
          </dl>
          {busy && <p className="notice">{typeof busy === 'string' ? busy : ''}</p>}
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
              onChange={(value) => { setPrepared(null); setOptions({ ...options, resolution: value }); }}
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
              onChange={(value) => { setPrepared(null); setOptions({ ...options, fps: Number(value) }); }}
            />
            <Toggle label="원본 오디오" hint="트림 구간에 맞춰 결합합니다." checked={options.includeAudio} onChange={(value) => { setPrepared(null); setOptions({ ...options, includeAudio: value }); }} />
          </div>
          <dl className="export-table">
            <div><dt>트림</dt><dd>{props.trim.start.toFixed(2)}s – {props.trim.end.toFixed(2)}s</dd></div>
            <div><dt>길이</dt><dd>{seconds.toFixed(2)}초 · {frames}프레임</dd></div>
            <div><dt>인코더</dt><dd>WebCodecs (H.264 + AAC/Opus) · 실패 시 MediaRecorder</dd></div>
            <div><dt>결과</dt><dd>{prepared ? `${prepared.filename}${prepared.mode === 'mediarecorder' ? ' · MediaRecorder' : ''}` : '아직 준비되지 않았습니다.'}</dd></div>
          </dl>
          {progress && busy && (
            <div className="progress">
              <div className="progress-bar"><span style={{ width: `${Math.min(100, (progress.current / Math.max(1, progress.total)) * 100)}%` }} /></div>
              <p>{progress.message}</p>
            </div>
          )}
          {!prepared && !busy && <p className="note">[영상 준비]를 누르면 인코딩이 끝난 뒤 [저장 / 공유]가 열립니다.</p>}
        </div>
      )}
      {note && <p className="notice">{note}</p>}
      {savedMessage && <p className="notice ok">{savedMessage}</p>}
      {error && <p className="notice error">{error}</p>}
    </Modal>
  );
}
