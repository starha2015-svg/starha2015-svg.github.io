/* PHOTH Studio — fal.ai 지우개 프록시 (Cloudflare Worker, 무료 플랜)
 *
 * 브라우저는 사진과 마스크(data URI)를 이 Worker로만 보내고,
 * FAL_KEY는 Worker Secret에만 있다. 결과 이미지는 원본 바이트 그대로 돌려준다.
 *
 * 엔드포인트
 *   GET  /health          → { ok, model }
 *   POST /erase           → image/png | image/jpeg (지우기 결과)
 *        headers: X-Photh-Auth: <PHOTH_TOKEN>, Content-Type: application/json
 *        body: { image: "data:image/jpeg;base64,...", mask: "data:image/png;base64,...",
 *                expand?: 0-50, model?: "best_quality" | ... }
 *
 * 필요한 Secret / Var
 *   FAL_KEY       (Secret)  fal.ai API 키
 *   PHOTH_TOKEN   (Secret)  PHOTH Studio 잠금 해제 토큰 (lock.js의 TOKEN 값)
 */

const FAL_MODEL = 'fal-ai/object-removal/mask';
const QUEUE_URL = `https://queue.fal.run/${FAL_MODEL}`;
const MAX_DATA_LEN = 24 * 1024 * 1024;   // data URI 문자열 길이 상한(약 18MB 원본)
const POLL_MS = 1200;
const POLL_LIMIT_MS = 85000;

const ALLOWED_ORIGINS = new Set([
  'https://starha2015-svg.github.io',
  'http://localhost:8000',
  'http://127.0.0.1:8000'
]);

function corsHeaders(origin) {
  const allow = ALLOWED_ORIGINS.has(origin) ? origin : 'https://starha2015-svg.github.io';
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Photh-Auth',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin'
  };
}

function json(obj, status, origin, extra) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...corsHeaders(origin),
      ...(extra || {})
    }
  });
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }
    if (url.pathname === '/health') {
      return json({ ok: true, model: FAL_MODEL, configured: !!env.FAL_KEY }, 200, origin);
    }
    if (url.pathname !== '/erase') return json({ ok: false, error: 'not_found' }, 404, origin);
    if (request.method !== 'POST') return json({ ok: false, error: 'method_not_allowed' }, 405, origin);
    if (origin && !ALLOWED_ORIGINS.has(origin)) return json({ ok: false, error: 'origin_not_allowed' }, 403, origin);

    const token = request.headers.get('x-photh-auth') || '';
    if (!env.PHOTH_TOKEN || token !== env.PHOTH_TOKEN) {
      return json({ ok: false, error: 'unauthorized' }, 401, origin);
    }
    if (!env.FAL_KEY) return json({ ok: false, error: 'fal_key_missing' }, 500, origin);

    let body;
    try {
      body = await request.json();
    } catch (e) {
      return json({ ok: false, error: 'bad_json' }, 400, origin);
    }

    const image = body && body.image;
    const mask = body && body.mask;
    if (typeof image !== 'string' || !/^data:image\/(jpeg|jpg|png|webp);base64,/.test(image)) {
      return json({ ok: false, error: 'bad_image' }, 400, origin);
    }
    if (typeof mask !== 'string' || !/^data:image\/(png|jpeg|jpg|webp);base64,/.test(mask)) {
      return json({ ok: false, error: 'bad_mask' }, 400, origin);
    }
    if (image.length > MAX_DATA_LEN || mask.length > MAX_DATA_LEN) {
      return json({ ok: false, error: 'too_large', max: MAX_DATA_LEN }, 413, origin);
    }

    const expand = Number(body.expand);
    const input = {
      image_url: image,
      mask_url: mask,
      model: typeof body.model === 'string' ? body.model : 'best_quality',
      mask_expansion: Number.isFinite(expand) ? Math.max(0, Math.min(50, Math.round(expand))) : 12,
      enable_safety_checker: true
    };

    const auth = { Authorization: `Key ${env.FAL_KEY}`, 'Content-Type': 'application/json' };

    // 1) 큐에 제출
    let job;
    try {
      const res = await fetch(QUEUE_URL, { method: 'POST', headers: auth, body: JSON.stringify(input) });
      const text = await res.text();
      if (!res.ok) {
        const low = /Exhausted balance|User is locked/i.test(text);
        return json({ ok: false, error: low ? 'fal_no_credit' : 'fal_submit_failed', status: res.status, detail: text.slice(0, 400) }, 502, origin);
      }
      job = JSON.parse(text);
    } catch (e) {
      return json({ ok: false, error: 'fal_unreachable', detail: String(e).slice(0, 300) }, 502, origin);
    }

    const statusUrl = job.status_url;
    const responseUrl = job.response_url;
    if (!statusUrl || !responseUrl) return json({ ok: false, error: 'fal_bad_submit', detail: job }, 502, origin);

    // 2) 완료까지 폴링
    const started = Date.now();
    let lastStatus = 'IN_QUEUE';
    while (Date.now() - started < POLL_LIMIT_MS) {
      await sleep(POLL_MS);
      let s;
      try {
        const res = await fetch(statusUrl, { headers: { Authorization: auth.Authorization } });
        s = await res.json();
      } catch (e) {
        continue;
      }
      lastStatus = s.status || lastStatus;
      if (lastStatus === 'COMPLETED') break;
      if (lastStatus === 'FAILED' || lastStatus === 'ERROR') {
        return json({ ok: false, error: 'fal_failed', detail: s }, 502, origin);
      }
    }
    if (lastStatus !== 'COMPLETED') {
      return json({ ok: false, error: 'timeout', status: lastStatus, ms: Date.now() - started }, 504, origin);
    }

    // 3) 결과 가져오기
    let out;
    try {
      const res = await fetch(responseUrl, { headers: { Authorization: auth.Authorization } });
      out = await res.json();
      if (!res.ok) return json({ ok: false, error: 'fal_result_failed', detail: out }, 502, origin);
    } catch (e) {
      return json({ ok: false, error: 'fal_result_unreachable', detail: String(e).slice(0, 300) }, 502, origin);
    }

    const file = out && out.images && out.images[0];
    if (!file || !file.url) return json({ ok: false, error: 'fal_no_image', detail: out }, 502, origin);

    // 4) 이미지 바이트를 그대로 스트리밍 (base64 변환 없이 CPU 절약)
    let imgRes;
    try {
      imgRes = await fetch(file.url, { cf: { cacheTtl: 0 } });
      if (!imgRes.ok) throw new Error('image fetch ' + imgRes.status);
    } catch (e) {
      return json({ ok: false, error: 'fal_image_unreachable', detail: String(e).slice(0, 300) }, 502, origin);
    }

    return new Response(imgRes.body, {
      status: 200,
      headers: {
        'Content-Type': file.content_type || imgRes.headers.get('Content-Type') || 'image/png',
        'Cache-Control': 'no-store',
        'X-Photh-Engine': FAL_MODEL,
        'X-Photh-Ms': String(Date.now() - started),
        ...corsHeaders(origin)
      }
    });
  }
};
