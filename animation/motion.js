/*
 * motion.js: a tiny deterministic animation toolkit for SVG scenes.
 *
 * Every visual property is a pure function of time t (seconds). The renderer calls window.seek(t) for each
 * frame, so a render is reproducible frame by frame and any moment can be inspected directly.
 * Classic script (no modules) so the same file works in the live preview and in headless rendering.
 */
(function () {
  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));

  const ease = {
    linear: (x) => x,
    inQuad: (x) => x * x,
    outQuad: (x) => 1 - (1 - x) * (1 - x),
    inOutQuad: (x) => (x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2),
    outCubic: (x) => 1 - Math.pow(1 - x, 3),
    inCubic: (x) => x * x * x,
    inOutCubic: (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2),
    outQuint: (x) => 1 - Math.pow(1 - x, 5),
    inOutSine: (x) => -(Math.cos(Math.PI * x) - 1) / 2,
    outExpo: (x) => (x === 1 ? 1 : 1 - Math.pow(2, -10 * x)),
    inExpo: (x) => (x === 0 ? 0 : Math.pow(2, 10 * x - 10)),
    outBack: (x, s = 1.70158) => 1 + (s + 1) * Math.pow(x - 1, 3) + s * Math.pow(x - 1, 2),
    inBack: (x, s = 1.70158) => (s + 1) * x * x * x - s * x * x,
  };

  /** 0..1 progress of t through [start, start + dur]. */
  const prog = (t, start, dur) => (dur <= 0 ? (t >= start ? 1 : 0) : clamp((t - start) / dur));
  const lerp = (a, b, p) => a + (b - a) * p;
  /** Value of a tween at time t. */
  const tw = (t, start, dur, from, to, e = ease.outCubic) => lerp(from, to, e(prog(t, start, dur)));
  /** Visible window with fades: 0 before, ramps in, 1, ramps out, 0 after. */
  const life = (t, start, end, fadeIn = 0.25, fadeOut = 0.25) =>
    t < start || t > end
      ? 0
      : Math.min(ease.outQuad(prog(t, start, fadeIn)), 1 - ease.inQuad(prog(t, end - fadeOut, fadeOut)));
  /** Deterministic pseudo-random in [0, 1) from an integer seed. */
  const rand = (seed) => {
    const x = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
    return x - Math.floor(x);
  };
  /** Small periodic motion for idle life (breathing, floating). */
  const wave = (t, period = 2, amp = 1, phase = 0) => Math.sin(((t + phase) / period) * Math.PI * 2) * amp;

  const NS = 'http://www.w3.org/2000/svg';
  /** Creates an SVG element: h('rect', { x: 1 }, [children]). */
  function h(tag, attrs = {}, children = []) {
    const el = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v === undefined || v === null) continue;
      if (k === 'text') el.textContent = v;
      else el.setAttribute(k, String(v));
    }
    for (const c of [].concat(children)) if (c) el.appendChild(c);
    return el;
  }
  /** Sets transform and opacity in one call. Values are rounded to keep edges crisp. */
  function place(el, { x = 0, y = 0, s = 1, sx, sy, r = 0, o, ox = 0, oy = 0 } = {}) {
    const scaleX = sx ?? s;
    const scaleY = sy ?? s;
    el.setAttribute(
      'transform',
      `translate(${x.toFixed(2)} ${y.toFixed(2)}) rotate(${r.toFixed(3)} ${ox} ${oy}) translate(${ox} ${oy}) scale(${scaleX.toFixed(4)} ${scaleY.toFixed(4)}) translate(${-ox} ${-oy})`,
    );
    if (o !== undefined) el.setAttribute('opacity', clamp(o).toFixed(3));
  }

  /** A timeline is a list of draw functions, each called with t on every seek. */
  function createStage({ width = 1920, height = 1080, duration, fps = 30, root }) {
    const draws = [];
    const stage = {
      width,
      height,
      duration,
      fps,
      root,
      add(fn) {
        draws.push(fn);
        return stage;
      },
      seek(t) {
        const time = clamp(t, 0, duration);
        for (const fn of draws) fn(time);
        return time;
      },
    };
    window.__duration = duration;
    window.__fps = fps;
    window.seek = (t) => stage.seek(t);
    return stage;
  }

  /** Optional on-page player for previewing in a browser; hidden when rendering (?render=1). */
  function attachPlayer(stage) {
    if (new URLSearchParams(location.search).has('render')) {
      document.documentElement.classList.add('is-render');
      stage.seek(0);
      return;
    }
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const bar = document.createElement('div');
    bar.className = 'player';
    bar.innerHTML =
      '<button type="button" aria-label="Play">Play</button><input type="range" min="0" step="0.01" aria-label="Time"><output>0.0 s</output>';
    document.body.appendChild(bar);
    const [btn, range, out] = [
      bar.querySelector('button'),
      bar.querySelector('input'),
      bar.querySelector('output'),
    ];
    range.max = String(stage.duration);
    let playing = false;
    let t = 0;
    let last = 0;
    const show = () => {
      stage.seek(t);
      range.value = String(t);
      out.textContent = `${t.toFixed(1)} s`;
    };
    const frame = (now) => {
      if (!playing) return;
      t += (now - last) / 1000;
      last = now;
      if (t >= stage.duration) {
        t = stage.duration;
        playing = false;
        btn.textContent = 'Play';
      }
      show();
      if (playing) requestAnimationFrame(frame);
    };
    btn.addEventListener('click', () => {
      playing = !playing;
      btn.textContent = playing ? 'Pause' : 'Play';
      if (playing) {
        if (t >= stage.duration) t = 0;
        last = performance.now();
        requestAnimationFrame(frame);
      }
    });
    range.addEventListener('input', () => {
      t = Number(range.value);
      show();
    });
    // Reduced motion: show a representative still and let the viewer choose to play.
    t = reduce ? stage.duration * 0.62 : 0;
    show();
  }

  window.Motion = { ease, prog, lerp, tw, life, rand, wave, clamp, h, place, createStage, attachPlayer };
})();
