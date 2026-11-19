# PKPilot 0011 — Film Studio × Shutterplate

**한 장의 사진도, 움직이는 클립도 하나의 플레이트로.**

HD2Lab의 사진 색보정 스튜디오(Film Studio)와 프레임 인화 엔진(Shutterplate)을 하나로 합친
브라우저 로컬 스튜디오입니다. 사진과 영상을 같은 스테이지에 올리고, **필터 모달**과
**프레임 모달**을 각각 열어 색과 판면을 즉시 바꾼 뒤, 원본 1:1 사진 또는 H.264 영상으로 내보냅니다.

- Live: <https://hyangdan2.github.io/PKPilot0011/>
- 업로드 **0 B** — 디코딩, 색보정, 합성, 인코딩이 모두 이 기기 안에서 일어납니다.
- 외부 CDN·분석·유료 API 없음. LUT·엠블럼·샘플까지 전부 저장소에 들어 있습니다.

---

## 무엇이 들어 있나

### 두 단의 합성 파이프라인

| 단계 | 엔진 | 하는 일 |
| --- | --- | --- |
| **Stage 1** | WebGL2 색보정 (`src/engine`) | 9종 HD2Lab 필름 + `RETRO 90` + Margarine 58종, 노출·화밸·하이라이트·섀도우·대비·화이트/블랙, W/R/G/B 톤커브, Colour Lab(Spectrum · Color Focus · RGB Base), 2패스 샤프닝, 할레이션/글로우, 7세그먼트 날짜 인화, 3D LUT |
| **Stage 2** | Shutterplate 캔버스 (`public/plate`) | 13종 판면의 여백·메타 텍스트·메이커 엠블럼을 판면 픽셀 좌표로 실시간 합성 |

- **동적 35mm 그레인** — `u_time`을 24fps로 양자화해 시드하므로 재생·내보내기 중에도 먼지가
  얼어붙지 않습니다.
- **HDR/HLG 안전 가드** — 휴대폰 HDR 클립이 회색으로 뜨거나 하이라이트가 날아갈 때
  16–235 범위를 0–255로 펴고 하이라이트를 부드럽게 마감합니다(세부 보정 → 영상).
- **모든 처리는 sRGB Rec.709 기준**으로 정규화되고, 출력은 항상 8-bit sRGB로 클램프됩니다.

### 입력

- **사진** JPEG · PNG · WebP, 최대 4장(4컷 플레이트용 다중 선택), EXIF 자동 파싱
- **영상** MP4 · MOV · WebM, 재생·스크럽·트림, FPS·길이 자동 감지
- 샘플: `sample-01.jpg`(풍경) · `sample-02.jpg`(카페 인물) · `sample-clip.mp4`
  (6.2초 · 1280×720 · 30fps · H.264/AAC — `tools/make-sample-clip.mjs`로 재생성 가능)

### 13 프레임

- **단일 11종** — Clean Horizon, Classic Gallery, Dual Deck, Strap Bar, Film Sprocket,
  Studio Dark, Minimal Edge, Pro Studio, Instant Polaroid, Frosted Glass, Editorial Cover.
  사진과 **영상 모두** 지원.
- **4컷 2종** — Contact Sheet, FYRA 04. **사진 전용**(프레임 모달에서 명확히 표시).
- 여백·배경(Dark/Light)·엠블럼(Auto/HD2Lab/없음)·엠블럼 잉크(Original/All Black)·
  촬영 정보/캡션 토글·FYRA 테마, 그리고 카메라·렌즈·노출·촬영일·캡션 직접 편집.

### 두 개의 모달

- **필터 모달** — 지금 화면의 프레임에 69종 필터를 각각 입힌 **라이브 썸네일 그리드**,
  카테고리 칩(HD2Lab / Margarine 여섯 갈래), 필터 강도 슬라이더, 누르면 즉시 적용.
- **프레임 모달** — 현재 필터가 적용된 이미지로 그린 13종 **라이브 미니어처**, 판면 옵션과
  메타데이터 편집.
- 그 밖에 **세부 보정**(빛 · 색 · 커브 · 질감 · 날짜 · 영상)과 **내보내기** 시트.

### 내보내기

- **사진** — 판면까지 합성한 1:1 원본 해상도 JPEG(화질 조절)/PNG, 다운로드 또는 Web Share.
- **영상** — `mediabunny` + **WebCodecs**로 프레임 단위 H.264(`avc1`) 인코딩, 트림 구간의
  원본 오디오(AAC)를 결합한 MP4. 해상도는 원본/1080p/720p 선택.
  - `VideoEncoder.isConfigSupported` 런타임 확인 → H.264가 없으면 VP9/VP8 WebM.
  - `AudioEncoder`/AAC가 없으면(구형 iOS 등) **소리 없이 H.264로** 저장하고 그 사실을 알립니다.
  - `VideoFrame.close()`로 매 프레임 즉시 해제, `try/catch`로 디코더 예외 방어.
  - WebCodecs 자체가 없는 브라우저는 **MediaRecorder 폴백**으로 WebM을 만듭니다.

## 빠른 시작

```bash
npm ci
npm run dev        # http://localhost:5173/PKPilot0011/
npm test           # Vitest 55개 (색보정·LUT·필터·플레이트 레이아웃·트림/코덱·리듀서)
npm run build      # tsc --noEmit && vite build
npm run preview    # http://localhost:4173/PKPilot0011/
npm run test:e2e   # Playwright: 데스크톱/모바일 흐름 + 스크린샷 4장
```

- Node 20+ / 최신 Chromium·Safari·Firefox. WebGL2 필수, 영상 내보내기는 WebCodecs 권장.
- `base`는 `/PKPilot0011/`로 고정되어 있어 GitHub Pages 하위 경로와 로컬 프리뷰가 동일하게 동작합니다.

## 구조

```
src/
  App.tsx                 화면·상태 오케스트레이션 (랜딩 / 에디터 / 4개 모달)
  components/             Landing, Stage, Timeline, FilterModal, FrameModal, AdjustModal, ExportModal
  engine/renderer/        ColorEngine(WebGL2) + shaders (시간 시드 그레인, 입력 가드)
  engine/color/           LUT 로더·보간, 톤커브, RGB Base, Colour Mixer, 샤프닝
  engine/overlay/         7세그먼트 날짜 인화
  films/, presets/        FS-001~FS-010 프로필, Margarine 58종
  plate/                  Shutterplate 브리지(타입·로더) + 프레임 카탈로그
  studio/                 렌더 조합, 그레이딩 캐시, 썸네일, 내보내기 파이프라인
  export/                 코덱 선택·트림 계산(순수 함수) + WebCodecs/MediaRecorder 내보내기
  media/                  사진/영상 로더, EXIF → 판면 메타
  state/                  스튜디오 리듀서
public/
  plate/                  검증된 Shutterplate 엔진(plate.js, emblems.js) — 그대로 이식
  luts/                   FS-001~010 + identity .cube
  samples/                샘플 사진 3장 + sample-clip.mp4
tests/                    Vitest 단위 테스트 + Playwright E2E
tools/make-sample-clip.mjs
```

### 자산 이식 원칙

- 색보정 엔진과 LUT, 필름 프로필, Margarine 룩은 검증된 **AGPilot0007**에서 그대로 가져왔습니다.
- 판면 엔진과 메이커 엠블럼 벡터는 **PKPilot0003**의 것을 **한 줄도 고치지 않고** 로드합니다
  (`public/plate/`). 그래서 이 앱의 인화 결과는 Shutterplate와 픽셀 단위로 같습니다.
- 기존 두 저장소는 건드리지 않았습니다.

## 테스트

- `tests/plate.test.ts` — 13종 순서·11/2 분기·4컷 셀·여백 계산을 **실제 엔진 코드**로 검증
- `tests/filters.test.ts` — 9+1+58 카탈로그, 필터 선택 시 보정 초기화, RETRO 광학 효과
- `tests/codecs.test.ts` — H.264→VP9→VP8 폴백, AAC 부재 시 무음, 짝수 해상도, 트림 프레임 그리드
- `tests/media.test.ts` — 노출/초점/셔터 표기, EXIF → 메타, 파일 라우팅
- `tests/studio.test.ts` — 리듀서(트림·프레임 강등·필터 리셋·날짜), 스테이지 피팅
- `tests/engine.test.ts` — 실제 `.cube` LUT 파싱·항등 보간, 톤커브 텍스처, 시간 시드 그레인·HDR 가드 셰이더 계약
- `tests/e2e/studio.spec.ts` — 1280×800과 390×844에서 랜딩 → 샘플 사진/영상 → 필터 모달 →
  프레임 모달, 콘솔 에러 0건, 캔버스 실제 픽셀 확인, 스크린샷 4장 저장

## 크레딧

- 필름 프로필·LUT·색보정 엔진: HD2Lab (AGPilot0007)
- 판면 엔진·13 프레임·메이커 엠블럼: HD2Lab Shutterplate (PKPilot0003)
- `mediabunny` (MIT) — 미디어 먹싱/인코딩, `exifr` (MIT) — EXIF, React (MIT), Vite (MIT)
- 상표는 각 소유자의 것이며, 촬영 기기를 표기하는 인화 전통에 따라 사용했습니다.
  자세한 라이선스는 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

MIT License — [LICENSE](LICENSE)
