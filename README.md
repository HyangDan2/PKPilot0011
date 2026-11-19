# Nordlys — HD2Lab Film & Frame Studio

**한 장의 사진도, 움직이는 클립도 하나의 플레이트로.**

`Nordlys`는 HD2Lab의 사진 색보정 스튜디오(Film Studio)와 프레임 인화 엔진(Shutterplate)을
하나로 합친 브라우저 로컬 스튜디오입니다. 사진과 영상을 같은 스테이지에 올리고, 하단 **필름
스트립**이나 **필터 모달**로 색을, **프레임 모달**·**4컷 창**으로 판면을 즉시 바꾼 뒤,
원본 1:1 사진 또는 H.264 + 사운드 영상으로 **한 번의 [저장 / 공유]** 로 내보냅니다.
(저장소 이름과 배포 경로는 `PKPilot0011` 그대로입니다.)

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

- **하나의 열기 카드** — 사진 · 영상을 같은 픽커/드롭 영역으로 받고, 영상이면 영상 파이프라인,
  사진(1~4장)이면 플레이트로 자동 분기합니다.
- **사진** JPEG · PNG · WebP, 최대 4장(4컷 플레이트용 다중 선택), EXIF 자동 파싱
- **영상** MP4 · MOV · WebM, 재생·스크럽·트림, FPS·길이 자동 감지, **소리 켜기 토글**
- 샘플: `sample-01.jpg`(풍경) · `sample-02.jpg`(카페 인물) · `sample-clip.mp4`
  (6.2초 · 1280×720 · 30fps · H.264/AAC — `tools/make-sample-clip.mjs`로 재생성 가능)

### 13 프레임

- **단일 11종** — Clean Horizon, Classic Gallery, Dual Deck, Strap Bar, Film Sprocket,
  Studio Dark, Minimal Edge, Pro Studio, Instant Polaroid, Frosted Glass, Editorial Cover.
  사진과 **영상 모두** 지원하며, **프레임 모달**은 이 11종만 보여 줍니다.
- **4컷 2종** — Contact Sheet, FYRA 04. **사진 전용**이며, 우측 하단의 **4컷 버튼**이 여는
  전용 창에서 2종 선택 · SLOT 1~4 관리(한 번에 추가/개별 교체/삭제) · 프레임 옵션을 한 번에 처리합니다.
  FYRA 04 테마는 **Midnight · Snow · Forest · Sand** 를 포함한 10종.
- 여백·배경(Dark/Light)·엠블럼(Auto/HD2Lab/없음)·엠블럼 잉크(Original/All Black)·
  촬영 정보/캡션 토글, 그리고 카메라·렌즈·노출·촬영일·캡션 직접 편집.

### 화면 구성과 창

- **하단 필름 스트립** — Neutral + FS-001~FS-009 + RETRO 90 카드를 좌우로 넘기며 **한 번에 적용**,
  끝에는 Margarine 58종 바로가기. 썸네일은 지금 화면으로 그린 라이브 프리뷰입니다.
- **타이틀 옆 슬라이드** — 플레이트 뒤 **뷰포트 배경**(`frame.backdrop` Dark/Light)만 바꾸고,
  **우측 하단 플로팅 토글** — 앱 전체 테마(`data-theme`)를 바꿉니다. 둘은 서로 독립입니다.
- **필터 모달** — 지금 화면의 프레임에 69종 필터를 각각 입힌 **라이브 썸네일 그리드**,
  카테고리 칩(HD2Lab / Margarine 여섯 갈래), 필터 강도 슬라이더, 누르면 즉시 적용.
- **프레임 모달**(단일 11종) · **4컷 창** · **세부 보정**(빛 · 색 · 질감 · 영상) ·
  **Color Lab**(8대역 HSL · Color Focus · RGB Base) · **Tone Curve**(W/R/G/B 스플라인) ·
  **Camera Effects**(날짜 각인 · 광학 효과) — 뒤 세 창은 우측 하단 아이콘 버튼으로 엽니다.
- **⋮ 내비게이션 메뉴** — WORKSPACE(홈 · 교체 · EXIF 되돌리기 · 비우기 · 엠블럼 색상),
  SAMPLES(4종), NAVIGATION(HD2Lab Web-HQ · ApplicationHub).

### 내보내기

- **한 번의 [저장 / 공유]** — 파일을 먼저 만들어 두고(사진은 창을 열 때, 영상은 [영상 준비])
  버튼 탭에서 **곧바로 OS 공유 시트**를 엽니다. 인코딩을 기다리느라 생기던 user activation
  만료(→ 다운로드 폴더행)를 없앴고, 시트를 닫으면 강제 다운로드하지 않습니다
  (`파일로 내려받기`는 보조 링크).
- **사진** — 판면까지 합성한 1:1 원본 해상도 JPEG(화질 조절)/PNG.
- **영상** — `mediabunny` + **WebCodecs**로 프레임 단위 H.264(`avc1`) 인코딩, 트림 구간의
  원본 오디오를 결합한 MP4. 해상도는 원본/1080p/720p 선택.
  - 오디오는 **클립의 실제 트랙**(sampleRate · 채널 수)으로 프로브하고, AAC가 없으면
    **MP4 + Opus**, H.264가 없으면 VP9/VP8 + Opus(WebM)로 **소리를 먼저 지킵니다**.
  - 최종 판면(여백·카피 밴드 포함)을 **짝수 픽셀 + 프리셋 상한**(720p 1280 / 1080p 1920 / 원본 3840)
    으로 클램프한 뒤 그 크기로 `canEncodeVideo`를 검사합니다 — 홀수/초과 픽셀이 인코더를 죽이던 원인.
  - 회전 메타데이터가 있는 세로 영상은 디코드된 프레임을 회전해 그립니다.
  - 그리기용 WebGL 컨텍스트는 작업이 끝나는 즉시 파기되고(스테이지 1개 + 임시 1개),
    프리뷰 상한은 1080px, 컨텍스트 손실 시 안내와 재그리기를 제공합니다.
  - MediaRecorder 폴백은 프레임마다 `seeked`를 기다려 순차 렌더하고, 캔버스 스트림에
    `<video>`의 오디오 트랙을 결합하며, 벽시계에 맞춰 녹화합니다.

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
- `tests/upgrade.test.ts` — 실제 트랙 파라미터 오디오 프로브·Opus 폴백, 판면 클램프/짝수,
  통합 파일 라우팅, 무EXIF 스펙 채움, 가상 판면 크기·타입 부스트, 4컷 슬롯 리듀서, FYRA 신규 테마
- `tests/e2e/studio.spec.ts` — 1280×800 / 390×844에서 랜딩 · 에디터 · 필름 스트립 · ⋮ 메뉴 ·
  11종 프레임 창 · 4컷 창 · Color Lab/Tone Curve/Camera Effects · 저장/공유 창을 확인하고
  **겹침·오버플로·콘솔 에러 0건**, 모바일 판면 글자 최소 크기, 그리고 **내보낸 영상에 들리는 소리**
  (AudioContext 디코드 피크)까지 검사합니다. 검증용 내보내기 파일은 `downloads/`에 저장됩니다.

## 크레딧

- 필름 프로필·LUT·색보정 엔진: HD2Lab (AGPilot0007)
- 판면 엔진·13 프레임·메이커 엠블럼: HD2Lab Shutterplate (PKPilot0003)
- `mediabunny` (MIT) — 미디어 먹싱/인코딩, `exifr` (MIT) — EXIF, React (MIT), Vite (MIT)
- 상표는 각 소유자의 것이며, 촬영 기기를 표기하는 인화 전통에 따라 사용했습니다.
  자세한 라이선스는 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

MIT License — [LICENSE](LICENSE)
