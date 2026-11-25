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

/* ── 1) 인물 리터칭: 피부 마스크 기반 에지 보존 스무딩 + 톤 업 ── */
const FRAG_RETOUCH = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uTex;
uniform sampler2D uSkin;
uniform vec2 uTexel;
uniform float uRadius;
uniform float uSmooth;
uniform float uBrighten;

float gs(float x, float s){ return exp(-(x * x) / (2.0 * s * s)); }

void main(){
  vec3 c = texture(uTex, vUv).rgb;
  float skin = texture(uSkin, vUv).r;

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

  if (uBrighten > 0.001 && skin > 0.003) {
    float l = dot(c, vec3(0.299, 0.587, 0.114));
    float protect = 1.0 - smoothstep(0.74, 0.99, l);
    vec3 lifted = mix(c, vec3(1.0), 0.17) * 1.015;
    float lg = dot(lifted, vec3(0.299, 0.587, 0.114));
    lifted = mix(lifted, vec3(lg), 0.11);
    c = mix(c, lifted, clamp(uBrighten * skin * protect, 0.0, 1.0));
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

  vec3 bgc = mix(sharp, texture(uBlur, vUv).rgb, uBokeh);

  vec3 glow = texture(uGlow, vUv).rgb;
  float gl = max(glow.r, max(glow.g, glow.b));
  float orb = smoothstep(0.035, 0.26, gl);
  bgc += glow * orb * uLight * (0.55 + 0.75 * uBokeh);

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

/* ── 4) 색감 그레이딩 (프리셋 룩 + 세부 슬라이더 + 비네팅/그레인) ── */
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

void main(){
  vec3 c = texture(uTex, vUv).rgb;

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

  // 선명도 (국소 대비)
  if (abs(uClarity) > 0.002) {
    vec2 d = uTexel * 5.0;
    float bl = 0.0;
    bl += luma(texture(uTex, vUv + vec2(-d.x, 0.0)).rgb);
    bl += luma(texture(uTex, vUv + vec2( d.x, 0.0)).rgb);
    bl += luma(texture(uTex, vUv + vec2(0.0, -d.y)).rgb);
    bl += luma(texture(uTex, vUv + vec2(0.0,  d.y)).rgb);
    bl += luma(texture(uTex, vUv + vec2(-d.x, -d.y)).rgb);
    bl += luma(texture(uTex, vUv + vec2( d.x, -d.y)).rgb);
    bl += luma(texture(uTex, vUv + vec2(-d.x,  d.y)).rgb);
    bl += luma(texture(uTex, vUv + vec2( d.x,  d.y)).rgb);
    bl *= 0.125;
    float detail = luma(c) - bl;
    c += detail * uClarity * 0.9;
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
    float sk = texture(uSkin, vUv).r;
    float pe = texture(uPerson, vUv).r;
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
    this.pGrade = this._program(FRAG_GRADE, VERT_FLIP);
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
      uniforms[info.name] = gl.getUniformLocation(p, info.name);
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

  setMasks({ skin, person }) {
    const gl = this.gl;
    if (this.tex.skin && this.tex.skin !== this._blank) gl.deleteTexture(this.tex.skin);
    if (this.tex.person && this.tex.person !== this._blank) gl.deleteTexture(this.tex.person);
    this.tex.skin = skin ? this._upload(skin) : this._blank;
    this.tex.person = person ? this._upload(person) : null;
    this.hasPerson = !!person;
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
      gl.uniform2f(U.uTexel, texel[0], texel[1]);
      gl.uniform1f(U.uRadius, (u.smoothRadius || 0.006) * Math.min(w, h));
      gl.uniform1f(U.uSmooth, u.smooth);
      gl.uniform1f(U.uBrighten, u.brighten);
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

    // 3) 레퍼런스 색감 매칭
    let srcTex = t.b.tex;
    if (u.matchStrength > 0.002 && u.refMean) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, t.a.fbo);
      gl.viewport(0, 0, w, h);
      const U = this._use(this.pMatch);
      this._tex(0, t.b.tex, U.uTex);
      gl.uniform1f(U.uStrength, u.matchStrength);
      gl.uniform3f(U.uSrcMean, u.srcMean[0], u.srcMean[1], u.srcMean[2]);
      gl.uniform3f(U.uSrcStd, u.srcStd[0], u.srcStd[1], u.srcStd[2]);
      gl.uniform3f(U.uRefMean, u.refMean[0], u.refMean[1], u.refMean[2]);
      gl.uniform3f(U.uRefStd, u.refStd[0], u.refStd[1], u.refStd[2]);
      this._draw();
      srcTex = t.a.tex;
    }

    // 4) 그레이딩 → 화면
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, w, h);
    const U = this._use(this.pGrade);
    this._tex(0, srcTex, U.uTex);
    this._tex(1, this.tex.skin || this._blank, U.uSkin);
    this._tex(2, this.tex.person || this._blank, U.uPerson);
    gl.uniform2f(U.uTexel, texel[0], texel[1]);
    gl.uniform2f(U.uRes, w, h);
    gl.uniform1f(U.uAspect, aspect);
    gl.uniform1f(U.uSeed, u.seed || 0);
    gl.uniform1f(U.uMaskView, u.maskView ? 1 : 0);
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
    this._draw();
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
