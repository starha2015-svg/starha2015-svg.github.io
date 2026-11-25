/* WebGL2 렌더러 — 모든 보정은 GPU에서 즉시 처리됩니다. */

const VERT = `#version 300 es
in vec2 aPos;
out vec2 vUv;
void main(){ vUv = aPos * 0.5 + 0.5; gl_Position = vec4(aPos, 0.0, 1.0); }
`;

/* 마지막 패스 전용: 텍스처 좌표를 상하 뒤집어 캔버스에 바로 그린다.
   (ImageBitmap 업로드는 UNPACK_FLIP_Y_WEBGL을 무시하기 때문에 최종 단계에서만 뒤집는다) */
const VERT_FLIP = `#version 300 es
in vec2 aPos;
out vec2 vUv;
void main(){ vUv = vec2(aPos.x * 0.5 + 0.5, 0.5 - aPos.y * 0.5); gl_Position = vec4(aPos, 0.0, 1.0); }
`;

/* 마지막 패스: 그리드 메쉬(얼굴형 워핑) + 좌표 뒤집기 */
const VERT_MESH = `#version 300 es
in vec2 aPos;
out vec2 vUv;
uniform sampler2D uDisp;
uniform float uWarp;
void main(){
  vec2 uv = vec2(aPos.x * 0.5 + 0.5, 0.5 - aPos.y * 0.5);
  vUv = uv;
  vec2 d = texture(uDisp, uv).rg * 2.0 - 1.0;
  vec2 p = aPos;
  if (uWarp > 0.5) {
    vec2 off = d * 0.060;
    p += vec2(off.x * 2.0, -off.y * 2.0);
  }
  gl_Position = vec4(p, 0.0, 1.0);
}
`;

/* ── 1) 인물 리터칭: 피부·눈·치아·메이크업·헤어 (모두 마스크 기반) ── */
const FRAG_RETOUCH = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uTex;
uniform sampler2D uSkin;
uniform sampler2D uEyes;
uniform sampler2D uLips;
uniform sampler2D uTeeth;
uniform sampler2D uCheek;
uniform sampler2D uUnder;
uniform sampler2D uHair;
uniform sampler2D uCatch;
uniform vec2 uTexel;
uniform float uRadius;
uniform float uSmooth;
uniform float uBrighten;
uniform float uBlemish;
uniform float uDark;
uniform float uShine;
uniform float uEyesAmt;
uniform float uCatchAmt;
uniform float uTeethAmt;
uniform float uLipAmt;
uniform float uBlushAmt;
uniform float uHairAmt;

float gs(float x, float s){ return exp(-(x * x) / (2.0 * s * s)); }
float luma(vec3 c){ return dot(c, vec3(0.299, 0.587, 0.114)); }

void main(){
  vec3 c = texture(uTex, vUv).rgb;
  float skin = texture(uSkin, vUv).r;

  // ── 피부 매끈 (에지 보존)
  if (uSmooth > 0.001 && skin > 0.003) {
    float r = max(uRadius, 0.5);
    vec3 sum = c;
    float wsum = 1.0;
    float sigmaColor = mix(0.045, 0.135, uSmooth);
    for (int ring = 1; ring <= 3; ring++) {
      float rr = r * float(ring) / 3.0;
      float sw = gs(float(ring), 1.5);
      for (int i = 0; i < 8; i++) {
        float ang = float(i) * 0.7853981634 + float(ring) * 0.3927;
        vec2 off = vec2(cos(ang), sin(ang)) * rr * uTexel;
        vec3 s = texture(uTex, vUv + off).rgb;
        float d = length(s - c);
        float w = sw * gs(d, sigmaColor);
        sum += s * w;
        wsum += w;
      }
    }
    vec3 sm = sum / wsum;
    c = mix(c, sm, clamp(uSmooth * skin, 0.0, 1.0));
  }

  // ── 잡티·주름 완화 (주파수 분리: 저주파는 두고 고주파 디테일만 눌름)
  if (uBlemish > 0.001 && skin > 0.003) {
    vec2 d = uTexel * max(uRadius * 2.4, 1.0);
    vec3 lo = texture(uTex, vUv + vec2(d.x, 0.0)).rgb
            + texture(uTex, vUv - vec2(d.x, 0.0)).rgb
            + texture(uTex, vUv + vec2(0.0, d.y)).rgb
            + texture(uTex, vUv - vec2(0.0, d.y)).rgb;
    lo *= 0.25;
    vec3 detail = c - lo;
    float dh = luma(detail);
    // 눈·입술·머리카락은 건드리지 않는다
    float protect = 1.0 - clamp(max(texture(uEyes, vUv).r, max(texture(uLips, vUv).r, texture(uHair, vUv).r)), 0.0, 1.0);
    float keep = 1.0 - 0.62 * uBlemish * skin * protect;
    c = lo + detail * keep;
  }

  // ── 피부 톤 업
  if (uBrighten > 0.001 && skin > 0.003) {
    float l = luma(c);
    float protect = 1.0 - smoothstep(0.74, 0.99, l);
    vec3 lifted = mix(c, vec3(1.0), 0.17) * 1.015;
    float lg = luma(lifted);
    lifted = mix(lifted, vec3(lg), 0.11);
    c = mix(c, lifted, clamp(uBrighten * skin * protect, 0.0, 1.0));
  }

  // ── 유분기 억제 (과한 스페큘러만 진정)
  if (uShine > 0.001 && skin > 0.003) {
    float l = luma(c);
    float spec = smoothstep(0.66, 0.99, l) * skin;
    c *= 1.0 - uShine * spec * 0.42;
    c = mix(vec3(luma(c)), c, 1.0 + uShine * spec * 0.18);
  }

  // ── 다크서클 완화
  if (uDark > 0.001) {
    float u = texture(uUnder, vUv).r;
    if (u > 0.002) {
      float l = luma(c);
      vec3 lift = c * 1.10 + vec3(0.030, 0.026, 0.022);
      lift = mix(vec3(luma(lift)), lift, 0.86);
      float amt = uDark * u * (1.0 - smoothstep(0.55, 0.95, l));
      c = mix(c, lift, clamp(amt, 0.0, 0.9));
    }
  }

  // ── 눈 밝기·선명 (홍채 디테일 살리기)
  if (uEyesAmt > 0.001) {
    float e = texture(uEyes, vUv).r;
    if (e > 0.002) {
      vec2 d = uTexel * 1.6;
      vec3 blur = (texture(uTex, vUv + vec2(d.x, 0.0)).rgb + texture(uTex, vUv - vec2(d.x, 0.0)).rgb
                 + texture(uTex, vUv + vec2(0.0, d.y)).rgb + texture(uTex, vUv - vec2(0.0, d.y)).rgb) * 0.25;
      vec3 sharp = c + (c - blur) * 1.15;
      float l = luma(c);
      sharp = mix(sharp, sharp * 1.06 + 0.012, 0.55);
      sharp = mix(vec3(luma(sharp)), sharp, 1.12);
      c = mix(c, sharp, clamp(uEyesAmt * e, 0.0, 1.0));
    }
  }

  // ── 눈 캐치라이트
  if (uCatchAmt > 0.001) {
    float k = texture(uCatch, vUv).r;
    if (k > 0.002) c += vec3(1.0, 0.985, 0.96) * uCatchAmt * k * 0.55;
  }

  // ── 치아 미백 (입 안쪽 + 밝은 영역만)
  if (uTeethAmt > 0.001) {
    float t = texture(uTeeth, vUv).r;
    if (t > 0.002) {
      float l = luma(c);
      float white = smoothstep(0.30, 0.72, l);
      float m = uTeethAmt * t * white;
      vec3 w = c;
      w.r *= 1.0 - 0.055 * m;
      w.b *= 1.0 + 0.085 * m;
      w = mix(vec3(luma(w)), w, 1.0 - 0.35 * m);
      w = w * (1.0 + 0.10 * m) + 0.03 * m;
      c = mix(c, w, clamp(m, 0.0, 0.95));
    }
  }

  // ── 입술 생기 (자연스러운 로즈 틴트)
  if (uLipAmt > 0.001) {
    float lp = texture(uLips, vUv).r;
    if (lp > 0.002) {
      float l = luma(c);
      vec3 tint = vec3(0.74, 0.24, 0.31);
      vec3 mixed = mix(c, tint, 0.30);
      mixed = mix(vec3(luma(mixed)), mixed, 1.22);
      mixed *= 0.94 + 0.10 * (1.0 - l);
      c = mix(c, mixed, clamp(uLipAmt * lp, 0.0, 1.0));
    }
  }

  // ── 볼 블러셔
  if (uBlushAmt > 0.001) {
    float ch = texture(uCheek, vUv).r;
    if (ch > 0.002) {
      float l = luma(c);
      vec3 warm = mix(c, vec3(0.95, 0.52, 0.48), 0.20);
      warm = mix(vec3(luma(warm)), warm, 1.10);
      float amt = uBlushAmt * ch * (1.0 - smoothstep(0.72, 0.98, l));
      c = mix(c, warm, clamp(amt, 0.0, 0.5));
    }
  }

  // ── 헤어 윤기·톤
  if (uHairAmt > 0.001) {
    float h = texture(uHair, vUv).r;
    if (h > 0.002) {
      float l = luma(c);
      vec3 toned = c * vec3(1.035, 1.0, 0.955);
      float strand = smoothstep(0.45, 0.95, l);
      toned += vec3(0.035, 0.028, 0.018) * strand * uHairAmt;
      toned = mix(vec3(luma(toned)), toned, 1.0 + 0.10 * uHairAmt);
      c = mix(c, toned, clamp(uHairAmt * h, 0.0, 0.95));
    }
  }

  outColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}
`;

/* ── 2) 배경 보케: 인물은 선명, 배경은 흐림 + 빛망울 ── */
const FRAG_BOKEH = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uTex;
uniform sampler2D uBlur;
uniform sampler2D uGlow;
uniform sampler2D uPerson;
uniform float uBokeh;
uniform float uLight;
uniform float uRadial;
uniform float uAspect;

void main(){
  vec3 sharp = texture(uTex, vUv).rgb;
  float m = texture(uPerson, vUv).r;

  // 인물 마스크가 없을 때는 중앙부를 초점으로 가정한 방사형 폴백
  vec2 p = (vUv - 0.5) * vec2(uAspect, 1.0);
  float radialPerson = 1.0 - smoothstep(0.18, 0.62, length(p) * 1.35);
  float person = mix(radialPerson, m, uRadial);
  float bg = 1.0 - smoothstep(0.06, 0.88, person);

  // 배경 흐림: 기본 블러 + 강도가 높을수록 넓게 퍼지는 다중 샘플 (단렌즈 느낌)
  float amt = pow(clamp(uBokeh, 0.0, 1.0), 0.78);
  float kk = uBokeh * uBokeh;
  vec2 off = vec2(0.0055 * kk, 0.0055 * kk * uAspect);
  vec3 bsum = texture(uBlur, vUv).rgb * 0.36;
  bsum += texture(uBlur, vUv + vec2( off.x, 0.0)).rgb * 0.16;
  bsum += texture(uBlur, vUv + vec2(-off.x, 0.0)).rgb * 0.16;
  bsum += texture(uBlur, vUv + vec2(0.0,  off.y)).rgb * 0.16;
  bsum += texture(uBlur, vUv + vec2(0.0, -off.y)).rgb * 0.16;
  vec3 bgc = mix(sharp, bsum, amt);

  vec3 glow = texture(uGlow, vUv).rgb;
  float gl = max(glow.r, max(glow.g, glow.b));
  float orb = smoothstep(0.035, 0.26, gl);
  bgc += glow * orb * uLight * (0.40 + 0.60 * amt);

  outColor = vec4(clamp(mix(sharp, bgc, bg), 0.0, 1.0), 1.0);
}
`;

/* ── 3) 레퍼런스 색감 매칭: CIE Lab Reinhard color transfer ── */
const FRAG_MATCH = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uTex;
uniform float uStrength;
uniform vec3 uSrcMean;
uniform vec3 uSrcStd;
uniform vec3 uRefMean;
uniform vec3 uRefStd;

float labF(float t){ return t > 0.008856 ? pow(t, 1.0/3.0) : 7.787 * t + 16.0/116.0; }
float labF3(float t){ float t3 = t*t*t; return t3 > 0.008856 ? t3 : (t - 16.0/116.0) / 7.787; }

vec3 srgb2lab(vec3 c){
  c = clamp(c, 0.0, 1.0);
  vec3 lin = mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(vec3(0.04045), c));
  float X = dot(lin, vec3(0.4124564, 0.3575761, 0.1804375));
  float Y = dot(lin, vec3(0.2126729, 0.7151522, 0.0721750));
  float Z = dot(lin, vec3(0.0193339, 0.1191920, 0.9503041));
  float fx = labF(X / 0.95047), fy = labF(Y), fz = labF(Z / 1.08883);
  return vec3(116.0 * fy - 16.0, 500.0 * (fx - fy), 200.0 * (fy - fz));
}

vec3 lab2srgb(vec3 lab){
  float fy = (lab.x + 16.0) / 116.0;
  float fx = fy + lab.y / 500.0;
  float fz = fy - lab.z / 200.0;
  float X = 0.95047 * labF3(fx);
  float Y = labF3(fy);
  float Z = 1.08883 * labF3(fz);
  vec3 lin = vec3(
    X *  3.2404542 + Y * -1.5371385 + Z * -0.4985314,
    X * -0.9692660 + Y *  1.8760108 + Z *  0.0415560,
    X *  0.0556434 + Y * -0.2040259 + Z *  1.0572252
  );
  lin = max(lin, 0.0);
  vec3 c = mix(lin * 12.92, 1.055 * pow(lin, vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), lin));
  return clamp(c, 0.0, 1.0);
}

void main(){
  vec3 c = texture(uTex, vUv).rgb;
  if (uStrength < 0.002) { outColor = vec4(c, 1.0); return; }

  vec3 lab = srgb2lab(c);

  // 채널별 표준편차 비율은 과도한 증폭을 막기 위해 제한
  float sL = clamp(uRefStd.x / max(uSrcStd.x, 0.55), 0.55, 2.10);
  float sA = clamp(uRefStd.y / max(uSrcStd.y, 0.60), 0.45, 2.40);
  float sB = clamp(uRefStd.z / max(uSrcStd.z, 0.60), 0.45, 2.40);

  vec3 t;
  t.x = (lab.x - uSrcMean.x) * sL + uRefMean.x;
  t.y = (lab.y - uSrcMean.y) * sA + uRefMean.y;
  t.z = (lab.z - uSrcMean.z) * sB + uRefMean.z;

  vec3 mixedLab = mix(lab, t, uStrength);
  vec3 outc = lab2srgb(mixedLab);

  // 명도는 그대로 두고 색만 옮기는 구간에서 원본 디테일을 조금 남긴다
  outColor = vec4(clamp(mix(c, outc, 1.0), 0.0, 1.0), 1.0);
}
`;

/* ── 4) 햇빛(가상 조명): 2.5D 법선 추정 → 방향광 · 그림자 · 림라이트 · 글로우 ── */
const FRAG_SUN = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;

uniform sampler2D uTex;
uniform sampler2D uPerson;
uniform sampler2D uFace;
uniform float uStrength;
uniform float uGlow;
uniform float uAspect;
uniform vec3 uLightDir;
uniform vec3 uSunColor;
uniform vec3 uGlowColor;
uniform vec2 uSunUV;
uniform vec2 uPersonCenter;

float lumc(vec3 c){ return dot(c, vec3(0.299, 0.587, 0.114)); }
float sat(float x){ return clamp(x, 0.0, 1.0); }

void main(){
  vec3 c = texture(uTex, vUv).rgb;
  if (uStrength < 0.002) { outColor = vec4(c, 1.0); return; }

  float person = texture(uPerson, vUv).r;
  float face = texture(uFace, vUv).r;

  // 표본 간격을 이미지 크기와 무관하게(약 0.3%) 고정 → 미리보기/원본 저장이 같은 결과
  const float st = 0.0028;
  vec2 ox = vec2(st, 0.0), oy = vec2(0.0, st);

  // 인물 가중치를 더 넓게 펴서 마스크 경계에 색 테두리가 생기지 않게 한다
  float pBlur = 0.25 * (texture(uPerson, vUv + ox).r + texture(uPerson, vUv - ox).r
                      + texture(uPerson, vUv + oy).r + texture(uPerson, vUv - oy).r);
  person = clamp(mix(person, pBlur, 0.75), 0.0, 1.0);

  float hC = lumc(c) * 0.50 + face * 0.95 + person * 0.06;
  float hL = lumc(texture(uTex, vUv - ox).rgb) * 0.50 + texture(uFace, vUv - ox).r * 0.95 + texture(uPerson, vUv - ox).r * 0.06;
  float hR = lumc(texture(uTex, vUv + ox).rgb) * 0.50 + texture(uFace, vUv + ox).r * 0.95 + texture(uPerson, vUv + ox).r * 0.06;
  float hD = lumc(texture(uTex, vUv + oy).rgb) * 0.50 + texture(uFace, vUv + oy).r * 0.95 + texture(uPerson, vUv + oy).r * 0.06;
  float hU = lumc(texture(uTex, vUv - oy).rgb) * 0.50 + texture(uFace, vUv - oy).r * 0.95 + texture(uPerson, vUv - oy).r * 0.06;

  // 높이장의 기울기 → 2.5D 노멀 (얼굴 볼록면이 주도)
  vec2 g = clamp(vec2(hR - hL, hD - hU) * 14.0, -1.4, 1.4);
  vec3 N = normalize(vec3(-g, 1.0));

  vec3 L = normalize(uLightDir);
  float ndl = dot(N, L);
  // 얼굴 돔의 미세 음영 + 인물 중심 기준의 큰 방향성(스튜디오 조명처럼)
  vec2 rel = (vUv - uPersonCenter) * vec2(uAspect, 1.0);
  float rl = length(rel);
  vec2 lxy = normalize(vec2(L.x, L.y) + vec2(1e-5, 1e-5));
  float side = rl > 1e-4 ? dot(rel / rl, lxy) * smoothstep(0.0, 0.30, rl) : 0.0;
  float shade = clamp(0.52 * ndl + 0.55 * side, -1.0, 1.0);
  float lit = smoothstep(-0.55, 0.80, shade);
  float back = clamp(-shade, 0.0, 1.0);
  float w = mix(0.40, 1.0, person);
  float s = clamp(uStrength, 0.0, 1.0) * w;
  float base = lumc(c);
  float headroom = 1.0 - smoothstep(0.55, 1.0, base);

  // 빛을 받는 쪽: 따뜻하고 밝게 (밝은 부분은 덜 더해 타지 않게)
  vec3 lit3 = c * uSunColor * (1.0 + 0.16 * headroom) + uSunColor * 0.030 * headroom;
  c = mix(c, lit3, clamp(s * lit * 0.70, 0.0, 1.0));

  // 반대쪽: 채도가 살짝 빠지는 부드러운 그림자
  float sh = back * back * (0.62 + 0.38 * (1.0 - person)) * (0.55 + 0.45 * (1.0 - base));
  c *= 1.0 - s * 0.30 * sh;

  // 인물 경계 림라이트 (머리카락·어깨)
  vec2 o2 = vec2(st * 1.7, st * 1.7);
  float pL = texture(uPerson, vUv - vec2(o2.x, 0.0)).r;
  float pR = texture(uPerson, vUv + vec2(o2.x, 0.0)).r;
  float pD = texture(uPerson, vUv + vec2(0.0, o2.y)).r;
  float pU = texture(uPerson, vUv - vec2(0.0, o2.y)).r;
  vec2 pg = vec2(pR - pL, pD - pU);
  float edge = smoothstep(0.018, 0.20, length(pg)) * smoothstep(0.05, 0.55, person);
  vec2 outward = -normalize(pg + vec2(1e-5, 1e-5));
  vec2 l2 = normalize(vec2(L.x, L.y) + vec2(1e-5, 1e-5));
  float toward = sat(dot(outward, l2));
  float backAmt = 1.0 - sat(L.z);
  float rim = edge * toward * clamp(uStrength, 0.0, 1.0) * (0.14 + 0.46 * backAmt);
  c += uSunColor * rim * mix(0.85, 1.15, backAmt);

  // 광원 위치에서 퍼지는 햇살 글로우 / 베일링 플레어
  vec2 dp = (vUv - uSunUV) * vec2(uAspect, 1.0);
  float dd = length(dp);
  float core = exp(-dd * dd / 0.0060);
  float halo = exp(-dd * dd / 0.090);
  float veil = exp(-dd / 0.50);
  float gAmt = clamp(uGlow, 0.0, 1.0) * clamp(uStrength, 0.0, 1.0);
  float sunLum = smoothstep(0.30, 0.92, base);
  c += uGlowColor * gAmt * (core * 0.80 * (0.45 + 0.55 * sunLum) + halo * 0.28 + veil * 0.10);

  // 소프트 하이라이트 롤오프 — 밝기만 압축해 색이 파랗게 틀어지지 않게
  float cl = lumc(c);
  float cl2 = cl / (1.0 + max(cl - 0.88, 0.0) * 2.2);
  c *= (cl > 1e-4) ? (cl2 / cl) : 1.0;

  outColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}
`;

/* ── 5) 색감 그레이딩 (프리셋 룩 + 세부 슬라이더 + 비네팅/그레인) ── */
const FRAG_GRADE = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;

uniform sampler2D uTex;
uniform sampler2D uSkin;
uniform sampler2D uPerson;
uniform vec2 uTexel;
uniform vec2 uRes;
uniform float uAspect;
uniform float uSeed;
uniform float uMaskView;
uniform float uRot;
uniform float uZoom;
uniform float uHslH[8];
uniform float uHslS[8];
uniform float uHslL[8];
uniform float uBgBright;
uniform vec3 uBgColor;
uniform float uBgMix;

uniform float uEv;
uniform float uContrast;
uniform float uHigh;
uniform float uShadow;
uniform float uTemp;
uniform float uTint;
uniform float uSaturation;
uniform float uClarity;
uniform float uVignette;
uniform float uGrain;

uniform vec3 uLift;
uniform vec3 uGain;
uniform vec3 uGamma;
uniform float uFade;
uniform vec3 uShadowTint;
uniform vec3 uHighTint;
uniform float uShadowAmt;
uniform float uHighAmt;
uniform float uLookSat;
uniform float uLookContrast;

const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);
float luma(vec3 c){ return dot(c, LUMA); }

float hash21(vec2 p){
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

vec3 rgb2hsl(vec3 c){
  float mx = max(max(c.r, c.g), c.b);
  float mn = min(min(c.r, c.g), c.b);
  float l = (mx + mn) * 0.5;
  float h = 0.0, s = 0.0;
  float d = mx - mn;
  if (d > 1e-5) {
    s = l > 0.5 ? d / max(2.0 - mx - mn, 1e-4) : d / max(mx + mn, 1e-4);
    if (mx == c.r) h = (c.g - c.b) / d + (c.g < c.b ? 6.0 : 0.0);
    else if (mx == c.g) h = (c.b - c.r) / d + 2.0;
    else h = (c.r - c.g) / d + 4.0;
    h /= 6.0;
  }
  return vec3(h, s, l);
}

float hue2rgb(float p, float q, float t){
  if (t < 0.0) t += 1.0;
  if (t > 1.0) t -= 1.0;
  if (t < 1.0 / 6.0) return p + (q - p) * 6.0 * t;
  if (t < 0.5) return q;
  if (t < 2.0 / 3.0) return p + (q - p) * (2.0 / 3.0 - t) * 6.0;
  return p;
}

vec3 hsl2rgb(vec3 hsl){
  float h = hsl.x, s = clamp(hsl.y, 0.0, 1.5), l = hsl.z;
  if (s < 1e-4) return vec3(l);
  float q = l < 0.5 ? l * (1.0 + s) : l + s - l * s;
  float p = 2.0 * l - q;
  return vec3(hue2rgb(p, q, h + 1.0 / 3.0), hue2rgb(p, q, h), hue2rgb(p, q, h - 1.0 / 3.0));
}

float hslCenter(int i){
  if (i == 0) return 0.0;
  if (i == 1) return 32.0;
  if (i == 2) return 58.0;
  if (i == 3) return 120.0;
  if (i == 4) return 180.0;
  if (i == 5) return 238.0;
  if (i == 6) return 278.0;
  return 320.0;
}

bool hslActive(){
  float s = 0.0;
  for (int i = 0; i < 8; i++) s += abs(uHslH[i]) + abs(uHslS[i]) + abs(uHslL[i]);
  return s > 0.001;
}

void main(){
  // 수평(회전) + 자동 크롭: 출력 좌표를 원본 좌표로 되돌려 표본화
  vec2 pp = (vUv - 0.5) * vec2(uAspect, 1.0);
  float cs = cos(uRot), sn = sin(uRot);
  vec2 qq = vec2(cs * pp.x - sn * pp.y, sn * pp.x + cs * pp.y) / max(uZoom, 0.0001);
  vec2 tuv = qq / vec2(uAspect, 1.0) + 0.5;

  vec3 c = texture(uTex, tuv).rgb;

  // 화이트밸런스
  float t = uTemp, ti = uTint;
  vec3 wb = vec3(1.0 + 0.20 * t + 0.015 * ti, 1.0 - 0.095 * ti, 1.0 - 0.245 * t + 0.015 * ti);
  wb /= max(dot(wb, LUMA), 1e-4);
  c *= wb;

  // 노출
  c *= exp2(uEv);

  // 톤 커브
  float l = max(luma(c), 1e-5);
  float L = l;
  float kc = uContrast + uLookContrast;
  if (kc > 0.0) { L = mix(L, smoothstep(0.0, 1.0, L), clamp(kc, 0.0, 1.0) * 0.9); }
  else { L = mix(L, (L - 0.5) * 0.72 + 0.5, clamp(-kc, 0.0, 1.0) * 0.9); }

  float shW = pow(1.0 - clamp(L, 0.0, 1.0), 2.0);
  float hiW = pow(clamp(L, 0.0, 1.0), 2.0);
  L += uShadow * 0.34 * shW;
  L += uHigh * 0.30 * hiW;
  L = max(L, 0.0);
  L = L * (1.0 - 0.30 * max(uFade, 0.0)) + 0.070 * max(uFade, 0.0) + 0.085 * min(uFade, 0.0);

  c *= L / l;

  // 프리셋 컬러 밸런스
  c = max(c * uGain + uLift, vec3(0.0));
  c = pow(clamp(c, 0.0, 1.6), 1.0 / max(uGamma, vec3(0.2)));

  // 스플릿 토닝
  float lg = clamp(luma(c), 0.0, 1.0);
  c = mix(c, c * uShadowTint, clamp(uShadowAmt * (1.0 - lg), 0.0, 1.0));
  c = mix(c, c * uHighTint, clamp(uHighAmt * lg, 0.0, 1.0));

  // 채도
  float g = luma(c);
  c = mix(vec3(g), c, clamp(1.0 + uSaturation + uLookSat, 0.0, 2.2));

  // HSL: 8색상 밴드별 색조·채도·휘도
  if (hslActive()) {
    vec3 hsl = rgb2hsl(clamp(c, 0.0, 1.0));
    float hd = hsl.x * 360.0;
    float wsum = 0.0, hShift = 0.0, sMul = 0.0, lAdd = 0.0;
    for (int i = 0; i < 8; i++) {
      float ctr = hslCenter(i);
      float dd = abs(hd - ctr);
      dd = min(dd, 360.0 - dd);
      float w = 1.0 - smoothstep(12.0, 38.0, dd);
      if (w <= 0.0) continue;
      wsum += w;
      hShift += w * uHslH[i] * 24.0;
      sMul += w * uHslS[i];
      lAdd += w * uHslL[i];
    }
    if (wsum > 0.001) {
      float n = max(1.0, wsum);
      hsl.x = fract((hd + hShift / n) / 360.0 + 1.0);
      hsl.y = clamp(hsl.y * (1.0 + sMul / n), 0.0, 1.0);
      hsl.z = clamp(hsl.z + lAdd / n * 0.16, 0.0, 1.0);
      c = hsl2rgb(hsl);
    }
  }

  // 선명도 (국소 대비)
  if (abs(uClarity) > 0.002) {
    vec2 d = uTexel * 5.0;
    float bl = 0.0;
    bl += luma(texture(uTex, tuv + vec2(-d.x, 0.0)).rgb);
    bl += luma(texture(uTex, tuv + vec2( d.x, 0.0)).rgb);
    bl += luma(texture(uTex, tuv + vec2(0.0, -d.y)).rgb);
    bl += luma(texture(uTex, tuv + vec2(0.0,  d.y)).rgb);
    bl += luma(texture(uTex, tuv + vec2(-d.x, -d.y)).rgb);
    bl += luma(texture(uTex, tuv + vec2( d.x, -d.y)).rgb);
    bl += luma(texture(uTex, tuv + vec2(-d.x,  d.y)).rgb);
    bl += luma(texture(uTex, tuv + vec2( d.x,  d.y)).rgb);
    bl *= 0.125;
    float detail = luma(c) - bl;
    c += detail * uClarity * 0.9;
  }

  // 배경 밝기 / 단색 배경 (인물 마스크 페더링)
  if (abs(uBgBright) > 0.001 || uBgMix > 0.001) {
    float pAll = texture(uPerson, tuv).r;
    float bgm = 1.0 - smoothstep(0.10, 0.68, pAll);
    if (abs(uBgBright) > 0.001) c *= mix(1.0, 1.0 + uBgBright * 0.62, bgm);
    if (uBgMix > 0.001) c = mix(c, uBgColor, bgm * uBgMix);
  }

  // 비네팅
  if (uVignette > 0.002) {
    vec2 p = (vUv - 0.5) * vec2(uAspect, 1.0);
    float d2 = length(p) * 1.45;
    float v = smoothstep(0.40, 1.12, d2);
    c *= 1.0 - uVignette * v * 0.95;
  }

  // 필름 그레인 (화면 크기에 맞춰 알갱이 크기 보정)
  if (uGrain > 0.002) {
    float gscale = max(1.0, uRes.y / 900.0);
    vec2 gp = floor(gl_FragCoord.xy / gscale);
    float n = hash21(gp + uSeed) + hash21(gp * 1.7 + 17.3 + uSeed) - 1.0;
    float lc = luma(c);
    float amp = uGrain * 0.20 * (0.35 + 0.65 * (1.0 - clamp(abs(lc - 0.45) * 1.7, 0.0, 1.0)));
    c += n * amp;
  }

  // 마스크 미리보기
  if (uMaskView > 0.5) {
    float sk = texture(uSkin, tuv).r;
    float pe = texture(uPerson, tuv).r;
    c = c * 0.30 + vec3(0.10, 0.28, 0.85) * pe * 0.42 + vec3(1.0, 0.16, 0.55) * sk * 0.55;
  }

  outColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}
`;

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl2', {
      alpha: false, antialias: false, depth: false, stencil: false,
      premultipliedAlpha: false, preserveDrawingBuffer: true,
      powerPreference: 'high-performance'
    });
    if (!gl) throw new Error('WebGL2 not supported');
    this.gl = gl;
    this.maxTex = gl.getParameter(gl.MAX_TEXTURE_SIZE);
    this._quad = this._makeQuad();
    this.pRetouch = this._program(FRAG_RETOUCH);
    this.pBokeh = this._program(FRAG_BOKEH);
    this.pMatch = this._program(FRAG_MATCH);
    this.pSun = this._program(FRAG_SUN);
    this.pGrade = this._program(FRAG_GRADE, VERT_MESH);
    this._mesh = this._makeMesh(48);
    this.tex = {};
    this.targets = null;
    this.size = [0, 0];
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    this._blank = this._solidTex(0);
    this._black = this._solidTex(0);
  }

  _makeQuad() {
    const gl = this.gl;
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    return buf;
  }

  /* 얼굴형 워핑용 그리드 메쉬 */
  _makeMesh(n) {
    const gl = this.gl;
    const verts = new Float32Array((n + 1) * (n + 1) * 2);
    let p = 0;
    for (let y = 0; y <= n; y++) {
      for (let x = 0; x <= n; x++) {
        verts[p++] = (x / n) * 2 - 1;
        verts[p++] = (y / n) * 2 - 1;
      }
    }
    const idx = new Uint16Array(n * n * 6);
    let q = 0;
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const a = y * (n + 1) + x;
        const b = a + 1;
        const c = a + n + 1;
        const d = c + 1;
        idx[q++] = a; idx[q++] = c; idx[q++] = b;
        idx[q++] = b; idx[q++] = c; idx[q++] = d;
      }
    }
    const vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STATIC_DRAW);
    const ibo = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
    return { vbo, ibo, count: idx.length };
  }

  _shader(type, src) {
    const gl = this.gl;
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(s);
      gl.deleteShader(s);
      throw new Error('shader compile: ' + log);
    }
    return s;
  }

  _program(fragSrc, vertSrc) {
    const gl = this.gl;
    const p = gl.createProgram();
    gl.attachShader(p, this._shader(gl.VERTEX_SHADER, vertSrc || VERT));
    gl.attachShader(p, this._shader(gl.FRAGMENT_SHADER, fragSrc));
    gl.bindAttribLocation(p, 0, 'aPos');
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      throw new Error('link: ' + gl.getProgramInfoLog(p));
    }
    const uniforms = {};
    const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) {
      const info = gl.getActiveUniform(p, i);
      const loc = gl.getUniformLocation(p, info.name);
      uniforms[info.name] = loc;
      const alias = info.name.replace(/\[0\]$/, '');
      if (alias !== info.name) uniforms[alias] = loc;
    }
    return { prog: p, u: uniforms };
  }

  _use(pr) {
    const gl = this.gl;
    gl.useProgram(pr.prog);
    gl.bindBuffer(gl.ARRAY_BUFFER, this._quad);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    return pr.u;
  }

  _tex(index, texture, loc) {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + index);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.uniform1i(loc, index);
  }

  _createTex() {
    const gl = this.gl;
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    return t;
  }

  _upload(source) {
    const gl = this.gl;
    const t = this._createTex();
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    return t;
  }

  _solidTex(v) {
    const gl = this.gl;
    const t = this._createTex();
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([v, v, v, 255]));
    return t;
  }

  setSource(source) {
    const gl = this.gl;
    if (this.tex.src) gl.deleteTexture(this.tex.src);
    this.tex.src = this._upload(source);
    this.srcSize = [source.width || source.naturalWidth, source.height || source.naturalHeight];
  }

  setMasks(m = {}) {
    const gl = this.gl;
    const keys = ['skin', 'person', 'face', 'eyes', 'lips', 'teeth', 'cheek', 'underEye', 'catchlight', 'hair'];
    for (const k of keys) {
      if (this.tex[k] && this.tex[k] !== this._blank) gl.deleteTexture(this.tex[k]);
      const src = m[k];
      this.tex[k] = src ? this._upload(src) : (k === 'person' ? null : this._blank);
    }
    this.hasPerson = !!m.person;
  }

  /* 얼굴형 워핑 변위 맵 */
  setWarp(canvas) {
    const gl = this.gl;
    if (this.tex.disp) { gl.deleteTexture(this.tex.disp); this.tex.disp = null; }
    if (canvas) this.tex.disp = this._upload(canvas);
    this.hasWarp = !!canvas;
  }

  setBokeh({ blur, glow }) {
    const gl = this.gl;
    if (this.tex.blur && this.tex.blur !== this._blank) gl.deleteTexture(this.tex.blur);
    if (this.tex.glow && this.tex.glow !== this._black) gl.deleteTexture(this.tex.glow);
    this.tex.blur = blur ? this._upload(blur) : null;
    this.tex.glow = glow ? this._upload(glow) : null;
  }

  _ensureTargets(w, h) {
    const gl = this.gl;
    if (this.targets && this.size[0] === w && this.size[1] === h) return this.targets;
    this._freeTargets();
    const make = () => {
      const t = this._createTex();
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      const f = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, f);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      return { tex: t, fbo: f };
    };
    this.targets = { a: make(), b: make() };
    this.size = [w, h];
    return this.targets;
  }

  _freeTargets() {
    const gl = this.gl;
    if (!this.targets) return;
    for (const k of ['a', 'b']) {
      gl.deleteTexture(this.targets[k].tex);
      gl.deleteFramebuffer(this.targets[k].fbo);
    }
    this.targets = null;
  }

  _draw() {
    const gl = this.gl;
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  /**
   * @param {object} u  유니폼 값 묶음
   * @param {number} w  렌더 폭(px)
   * @param {number} h  렌더 높이(px)
   */
  render(u, w, h) {
    const gl = this.gl;
    w = Math.max(1, Math.round(w));
    h = Math.max(1, Math.round(h));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    const t = this._ensureTargets(w, h);
    const aspect = w / h;
    const texel = [1 / w, 1 / h];
    if (!this.tex.src) return;

    // 1) 리터칭
    gl.bindFramebuffer(gl.FRAMEBUFFER, t.a.fbo);
    gl.viewport(0, 0, w, h);
    {
      const U = this._use(this.pRetouch);
      this._tex(0, this.tex.src, U.uTex);
      this._tex(1, this.tex.skin || this._blank, U.uSkin);
      this._tex(2, this.tex.eyes || this._blank, U.uEyes);
      this._tex(3, this.tex.lips || this._blank, U.uLips);
      this._tex(4, this.tex.teeth || this._blank, U.uTeeth);
      this._tex(5, this.tex.cheek || this._blank, U.uCheek);
      this._tex(6, this.tex.underEye || this._blank, U.uUnder);
      this._tex(7, this.tex.hair || this._blank, U.uHair);
      this._tex(8, this.tex.catchlight || this._blank, U.uCatch);
      gl.uniform2f(U.uTexel, texel[0], texel[1]);
      gl.uniform1f(U.uRadius, (u.smoothRadius || 0.006) * Math.min(w, h));
      gl.uniform1f(U.uSmooth, u.smooth);
      gl.uniform1f(U.uBrighten, u.brighten);
      gl.uniform1f(U.uBlemish, u.blemish || 0);
      gl.uniform1f(U.uDark, u.darkCircle || 0);
      gl.uniform1f(U.uShine, u.shine || 0);
      gl.uniform1f(U.uEyesAmt, u.eyes || 0);
      gl.uniform1f(U.uCatchAmt, u.catchlight || 0);
      gl.uniform1f(U.uTeethAmt, u.teeth || 0);
      gl.uniform1f(U.uLipAmt, u.lip || 0);
      gl.uniform1f(U.uBlushAmt, u.blush || 0);
      gl.uniform1f(U.uHairAmt, u.hair || 0);
      this._draw();
    }

    // 2) 배경 보케
    gl.bindFramebuffer(gl.FRAMEBUFFER, t.b.fbo);
    gl.viewport(0, 0, w, h);
    {
      const U = this._use(this.pBokeh);
      this._tex(0, t.a.tex, U.uTex);
      this._tex(1, this.tex.blur || t.a.tex, U.uBlur);
      this._tex(2, this.tex.glow || this._black, U.uGlow);
      this._tex(3, this.tex.person || this._blank, U.uPerson);
      gl.uniform1f(U.uBokeh, u.bokeh);
      gl.uniform1f(U.uLight, u.bokehLight);
      gl.uniform1f(U.uRadial, this.hasPerson ? 1 : 0);
      gl.uniform1f(U.uAspect, aspect);
      this._draw();
    }

    // 3) 햇빛 (가상 조명 리라이팅)
    let srcTex = t.b.tex;
    if (u.sunStrength > 0.002) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, t.a.fbo);
      gl.viewport(0, 0, w, h);
      const SU = this._use(this.pSun);
      this._tex(0, t.b.tex, SU.uTex);
      this._tex(1, this.tex.person || this._blank, SU.uPerson);
      this._tex(2, this.tex.face || this._blank, SU.uFace);
      gl.uniform1f(SU.uStrength, u.sunStrength);
      gl.uniform1f(SU.uGlow, u.sunGlow);
      gl.uniform1f(SU.uAspect, aspect);
      gl.uniform3f(SU.uLightDir, u.sunL[0], u.sunL[1], u.sunL[2]);
      gl.uniform3f(SU.uSunColor, u.sunColor[0], u.sunColor[1], u.sunColor[2]);
      gl.uniform3f(SU.uGlowColor, u.sunGlowColor[0], u.sunGlowColor[1], u.sunGlowColor[2]);
      gl.uniform2f(SU.uSunUV, u.sunUV[0], u.sunUV[1]);
      gl.uniform2f(SU.uPersonCenter, u.sunCenter[0], u.sunCenter[1]);
      this._draw();
      srcTex = t.a.tex;
    }

    // 4) 레퍼런스 색감 매칭
    if (u.matchStrength > 0.002 && u.refMean) {
      const dst = (srcTex === t.a.tex) ? t.b : t.a;
      gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fbo);
      gl.viewport(0, 0, w, h);
      const U = this._use(this.pMatch);
      this._tex(0, srcTex, U.uTex);
      gl.uniform1f(U.uStrength, u.matchStrength);
      gl.uniform3f(U.uSrcMean, u.srcMean[0], u.srcMean[1], u.srcMean[2]);
      gl.uniform3f(U.uSrcStd, u.srcStd[0], u.srcStd[1], u.srcStd[2]);
      gl.uniform3f(U.uRefMean, u.refMean[0], u.refMean[1], u.refMean[2]);
      gl.uniform3f(U.uRefStd, u.refStd[0], u.refStd[1], u.refStd[2]);
      this._draw();
      srcTex = dst.tex;
    }

    // 5) 그레이딩 → 화면
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, w, h);
    const U = this._use(this.pGrade);
    // 마지막 패스는 그리드 메쉬로 그린다 (얼굴형 워핑 + 좌표 뒤집기)
    gl.bindBuffer(gl.ARRAY_BUFFER, this._mesh.vbo);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this._mesh.ibo);
    this._tex(0, srcTex, U.uTex);
    this._tex(1, this.tex.skin || this._blank, U.uSkin);
    this._tex(2, this.tex.person || this._blank, U.uPerson);
    this._tex(3, this.tex.disp || this._blank, U.uDisp);
    gl.uniform1f(U.uWarp, this.hasWarp ? 1 : 0);
    gl.uniform2f(U.uTexel, texel[0], texel[1]);
    gl.uniform2f(U.uRes, w, h);
    gl.uniform1f(U.uAspect, aspect);
    gl.uniform1f(U.uSeed, u.seed || 0);
    gl.uniform1f(U.uMaskView, u.maskView ? 1 : 0);
    gl.uniform1f(U.uRot, u.rot || 0);
    gl.uniform1f(U.uZoom, u.zoom || 1);
    gl.uniform1f(U.uEv, u.ev);
    gl.uniform1f(U.uContrast, u.contrast);
    gl.uniform1f(U.uHigh, u.high);
    gl.uniform1f(U.uShadow, u.shadow);
    gl.uniform1f(U.uTemp, u.temp);
    gl.uniform1f(U.uTint, u.tint);
    gl.uniform1f(U.uSaturation, u.saturation);
    gl.uniform1f(U.uClarity, u.clarity);
    gl.uniform1f(U.uVignette, u.vignette);
    gl.uniform1f(U.uGrain, u.grain);
    gl.uniform3f(U.uLift, u.lift[0], u.lift[1], u.lift[2]);
    gl.uniform3f(U.uGain, u.gain[0], u.gain[1], u.gain[2]);
    gl.uniform3f(U.uGamma, u.gamma[0], u.gamma[1], u.gamma[2]);
    gl.uniform1f(U.uFade, u.fade);
    gl.uniform3f(U.uShadowTint, u.shadowTint[0], u.shadowTint[1], u.shadowTint[2]);
    gl.uniform3f(U.uHighTint, u.highTint[0], u.highTint[1], u.highTint[2]);
    gl.uniform1f(U.uShadowAmt, u.shadowAmt);
    gl.uniform1f(U.uHighAmt, u.highAmt);
    gl.uniform1f(U.uLookSat, u.lookSat);
    gl.uniform1f(U.uLookContrast, u.lookContrast);
    if (u.hslH) {
      gl.uniform1fv(U.uHslH, u.hslH);
      gl.uniform1fv(U.uHslS, u.hslS);
      gl.uniform1fv(U.uHslL, u.hslL);
    }
    gl.uniform1f(U.uBgBright, u.bgBright || 0);
    gl.uniform3f(U.uBgColor, u.bgColor[0], u.bgColor[1], u.bgColor[2]);
    gl.uniform1f(U.uBgMix, u.bgMix || 0);
    gl.drawElements(gl.TRIANGLES, this._mesh.count, gl.UNSIGNED_SHORT, 0);
  }

  dispose() {
    const gl = this.gl;
    for (const k of Object.keys(this.tex)) {
      if (this.tex[k]) gl.deleteTexture(this.tex[k]);
    }
    if (this._blank) gl.deleteTexture(this._blank);
    if (this._black && this._black !== this._blank) gl.deleteTexture(this._black);
    this._freeTargets();
    this.tex = {};
    gl.getExtension('WEBGL_lose_context')?.loseContext();
  }
}
