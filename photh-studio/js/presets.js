/* 프리셋 정의 — 모두 GPU 셰이더 파라미터로만 구성되어 즉시 반영됩니다. */

export const NEUTRAL_LOOK = {
  ev: 0,               // 노출 보정(EV)
  contrast: 0,         // -1..1
  lift: [0, 0, 0],     // 채널별 블랙 리프트
  gain: [1, 1, 1],     // 채널별 게인
  gamma: [1, 1, 1],    // 채널별 감마
  fade: 0,             // 0..1 페이드(들뜬 흑)
  shadowTint: [1, 1, 1],
  shadowTintAmt: 0,
  highTint: [1, 1, 1],
  highTintAmt: 0,
  sat: 0,              // -1..1 추가 채도
  grain: 0,            // 0..1 기본 그레인
  vignette: 0          // 0..1 기본 비네팅
};

const p = (id, name, en, swatch, look) => ({
  id, name, en, swatch, look: { ...NEUTRAL_LOOK, ...look }
});

export const PRESETS = [
  p('original', '원본', 'Original', ['#6b7280', '#9aa3b2'], {}),

  p('portra', '코닥 포트라', 'Kodak Portra 400', ['#f7dcb8', '#bb845c', '#6f5541'], {
    ev: 0.06,
    contrast: -0.06,
    lift: [0.018, 0.012, 0.018],
    gain: [1.035, 1.008, 0.968],
    gamma: [1.0, 1.0, 1.02],
    fade: 0.10,
    highTint: [1.02, 1.0, 0.955],
    highTintAmt: 0.30,
    shadowTint: [0.99, 1.0, 1.025],
    shadowTintAmt: 0.18,
    sat: -0.06,
    grain: 0.12
  }),

  p('fuji', '후지 청량 필름', 'Fuji Superia', ['#d5efe2', '#7db9a8', '#3d6a7b'], {
    ev: 0.10,
    contrast: 0.05,
    lift: [0.006, 0.012, 0.018],
    gain: [0.982, 1.012, 1.022],
    gamma: [1.0, 1.0, 1.0],
    saturationBoost: true,
    sat: 0.10,
    highTint: [0.972, 1.0, 1.022],
    highTintAmt: 0.26,
    shadowTint: [0.955, 1.0, 1.035],
    shadowTintAmt: 0.30,
    grain: 0.06
  }),

  p('wedding', '웨딩 소프트', 'Wedding Soft', ['#fdf5ee', '#ecd8cb', '#c0aaa1'], {
    ev: 0.14,
    contrast: -0.12,
    lift: [0.03, 0.026, 0.03],
    gain: [1.012, 1.0, 0.996],
    gamma: [1.02, 1.012, 1.0],
    fade: 0.14,
    highTint: [1.014, 1.0, 0.99],
    highTintAmt: 0.22,
    sat: -0.04,
    grain: 0.03
  }),

  p('date', '데이트 웜톤', 'Date Warm', ['#ffcb90', '#e08c5c', '#7e4136'], {
    ev: 0.04,
    contrast: 0.10,
    lift: [0.016, 0.006, 0.004],
    gain: [1.062, 1.0, 0.938],
    gamma: [1.0, 1.0, 1.03],
    fade: 0.05,
    highTint: [1.045, 1.0, 0.94],
    highTintAmt: 0.30,
    shadowTint: [1.0, 0.985, 0.99],
    shadowTintAmt: 0.12,
    sat: 0.07,
    vignette: 0.10,
    grain: 0.05
  }),

  p('moody', '무드 다크', 'Moody Dark', ['#3d4d59', '#1f2a33', '#0f151a'], {
    ev: -0.12,
    contrast: 0.20,
    lift: [-0.008, -0.004, 0.006],
    gain: [0.955, 0.965, 1.0],
    gamma: [0.96, 0.96, 0.97],
    fade: -0.04,
    shadowTint: [0.94, 0.98, 1.04],
    shadowTintAmt: 0.26,
    highTint: [1.02, 1.0, 0.97],
    highTintAmt: 0.18,
    sat: -0.22,
    vignette: 0.34,
    grain: 0.18
  }),

  p('pastel', '파스텔 스냅', 'Pastel Snap', ['#ffe7f0', '#d9c9eb', '#aab9df'], {
    ev: 0.10,
    contrast: -0.22,
    lift: [0.045, 0.04, 0.05],
    gain: [1.01, 0.995, 1.01],
    fade: 0.20,
    highTint: [1.02, 0.99, 1.02],
    highTintAmt: 0.20,
    shadowTint: [1.0, 0.985, 1.03],
    shadowTintAmt: 0.18,
    sat: -0.12,
    grain: 0.05
  }),

  p('vintage', '빈티지 90s', 'Vintage 90s', ['#e9d09d', '#b9a06a', '#6f6443'], {
    ev: 0.02,
    contrast: -0.06,
    lift: [0.030, 0.026, 0.020],
    gain: [1.055, 1.02, 0.895],
    gamma: [1.02, 1.0, 0.95],
    fade: 0.18,
    highTint: [1.06, 1.02, 0.90],
    highTintAmt: 0.34,
    shadowTint: [1.0, 0.99, 0.95],
    shadowTintAmt: 0.22,
    sat: -0.14,
    vignette: 0.20,
    grain: 0.30
  }),

  p('mono', '모노크롬 흑백', 'Monochrome', ['#dadada', '#8a8a8a', '#2f2f2f'], {
    contrast: 0.16,
    gain: [1.0, 1.0, 1.0],
    sat: -1.0,
    highTint: [1.0, 1.0, 1.0],
    highTintAmt: 0,
    grain: 0.12,
    vignette: 0.08
  }),

  p('highkey', '하이키 클린', 'High-Key Clean', ['#ffffff', '#eaf1f7', '#cfdce8'], {
    ev: 0.20,
    contrast: -0.14,
    lift: [0.035, 0.035, 0.038],
    gain: [1.006, 1.006, 1.01],
    gamma: [1.08, 1.08, 1.08],
    fade: 0.16,
    highTint: [0.995, 1.0, 1.012],
    highTintAmt: 0.20,
    sat: 0.02,
    grain: 0.02
  }),

  p('cinematic', '시네마틱 틸오렌지', 'Cinematic', ['#ffb26b', '#6f8d9f', '#1d3b45'], {
    ev: -0.04,
    contrast: 0.14,
    lift: [-0.004, 0.004, 0.012],
    gain: [1.03, 1.0, 0.985],
    fade: 0.04,
    shadowTint: [0.90, 0.98, 1.09],
    shadowTintAmt: 0.42,
    highTint: [1.06, 1.0, 0.92],
    highTintAmt: 0.34,
    sat: -0.05,
    vignette: 0.16,
    grain: 0.08
  }),

  p('golden', '노을 골든아워', 'Golden Hour', ['#ffd28d', '#e69850', '#7c4c26'], {
    ev: 0.08,
    contrast: 0.06,
    lift: [0.020, 0.010, 0.002],
    gain: [1.075, 1.005, 0.895],
    fade: 0.06,
    highTint: [1.08, 1.01, 0.885],
    highTintAmt: 0.50,
    shadowTint: [1.01, 0.99, 0.965],
    shadowTintAmt: 0.20,
    sat: 0.12,
    vignette: 0.12,
    grain: 0.07
  }),

  p('cool', '쿨톤 스냅', 'Cool Snap', ['#e2f2ff', '#9dc4e0', '#4b6b87'], {
    ev: 0.04,
    contrast: 0.10,
    lift: [0.004, 0.008, 0.014],
    gain: [0.962, 1.002, 1.048],
    gamma: [0.995, 1.0, 1.01],
    fade: 0.03,
    highTint: [0.975, 1.0, 1.02],
    highTintAmt: 0.24,
    shadowTint: [0.95, 1.0, 1.04],
    shadowTintAmt: 0.26,
    sat: 0.04,
    grain: 0.05
  }),

  p('classic', '클래식 그레인', 'Classic Grain', ['#dacfba', '#a89880', '#4e463b'], {
    contrast: 0.10,
    lift: [0.022, 0.020, 0.018],
    gain: [1.01, 1.0, 0.985],
    fade: 0.12,
    sat: -0.08,
    grain: 0.45,
    vignette: 0.14
  })
];

export const PRESET_BY_ID = Object.fromEntries(PRESETS.map(x => [x.id, x]));

/** 프리셋 강도(0..1)로 룩 파라미터를 중립값과 보간 */
export function blendLook(look, strength) {
  const s = Math.max(0, Math.min(1, strength));
  const m = (v, n) => n + (v - n) * s;
  const mv = (a, b) => a.map((v, i) => m(v, b[i]));
  return {
    ev: m(look.ev, 0),
    contrast: m(look.contrast, 0),
    lift: mv(look.lift, [0, 0, 0]),
    gain: mv(look.gain, [1, 1, 1]),
    gamma: mv(look.gamma, [1, 1, 1]),
    fade: m(look.fade, 0),
    shadowTint: mv(look.shadowTint, [1, 1, 1]),
    shadowTintAmt: m(look.shadowTintAmt, 0),
    highTint: mv(look.highTint, [1, 1, 1]),
    highTintAmt: m(look.highTintAmt, 0),
    sat: m(look.sat, 0),
    grain: m(look.grain, 0),
    vignette: m(look.vignette, 0)
  };
}
