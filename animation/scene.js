/*
 * Signalpost product film (21.5 s, 1920x1080). Style: an animated system diagram on a control-room panel.
 * Story: an on-call engineer at night -> the real monitor list -> the list unfolds into a live diagram where
 * checks pass the outbound policy and a request to the cloud metadata address is refused -> Orders API fails
 * twice, an incident opens, two good checks resolve it (texts as the app writes them) -> the real phone status
 * page -> brand.
 */
const { ease, prog, tw, life, wave, h, place, createStage, attachPlayer } = Motion;

const C = {
  night: '#0b1b27',
  panel: '#0f2a3d',
  panel2: '#163a54',
  grid: '#1c3a50',
  line: '#3d5b70',
  ink: '#e8f1f6',
  ink2: '#a9bac6',
  signal: '#5fd0a5',
  amber: '#f2b04c',
  red: '#ff8a80',
  redDeep: '#b42318',
  white: '#ffffff',
  skin: '#c98f6b',
  hair: '#2a1d16',
  hoodie: '#2e6f8e',
  desk: '#3a2e25',
};
const DUR = 21.5;
const svg = document.getElementById('stage');
const stage = createStage({ duration: DUR, root: svg });

svg.appendChild(
  h('defs', {}, [
    h('clipPath', { id: 'screen' }, [h('rect', { x: 0, y: 0, width: 1056, height: 660, rx: 6 })]),
    h('clipPath', { id: 'phone' }, [h('rect', { x: 0, y: 0, width: 300, height: 600, rx: 26 })]),
    h('pattern', { id: 'grid', width: 48, height: 48, patternUnits: 'userSpaceOnUse' }, [
      h('path', { d: 'M48 0 H0 V48', fill: 'none', stroke: C.grid, 'stroke-width': 1 }),
    ]),
    h('radialGradient', { id: 'lamp', cx: '0.5', cy: '0.4', r: '0.6' }, [
      h('stop', { offset: '0', 'stop-color': '#2b5a74', 'stop-opacity': 0.55 }),
      h('stop', { offset: '1', 'stop-color': C.night, 'stop-opacity': 0 }),
    ]),
  ]),
);
svg.appendChild(h('rect', { width: 1920, height: 1080, fill: C.night }));

// ---------- night office ----------
const office = h('g');
svg.appendChild(office);
office.appendChild(
  h('rect', {
    x: 150,
    y: 120,
    width: 560,
    height: 420,
    rx: 10,
    fill: '#10283a',
    stroke: C.line,
    'stroke-width': 4,
  }),
);
const stars = [
  [210, 170],
  [300, 230],
  [420, 160],
  [520, 250],
  [630, 190],
  [360, 300],
  [600, 320],
];
stars.forEach(([x, y]) => office.appendChild(h('circle', { cx: x, cy: y, r: 3, fill: C.ink2 })));
office.appendChild(
  h('path', {
    d: 'M150 540 V430 H210 V380 H260 V450 H330 V360 H390 V420 H450 V340 H520 V460 H580 V400 H640 V470 H710 V540 Z',
    fill: '#0c2131',
  }),
);
const windows = h('g');
[
  [228, 400],
  [350, 380],
  [470, 360],
  [540, 420],
  [660, 420],
].forEach(([x, y]) =>
  windows.appendChild(h('rect', { x, y, width: 14, height: 18, fill: C.amber, opacity: 0.7 })),
);
office.appendChild(windows);
office.appendChild(h('rect', { x: 700, y: 0, width: 1220, height: 1080, fill: 'url(#lamp)' }));
const clockText = h('text', {
  x: 1600,
  y: 210,
  'text-anchor': 'middle',
  'font-size': 64,
  class: 'mono',
  fill: C.signal,
  text: '02:14',
});
office.appendChild(
  h('rect', {
    x: 1470,
    y: 140,
    width: 260,
    height: 100,
    rx: 12,
    fill: '#08131c',
    stroke: C.line,
    'stroke-width': 3,
  }),
);
office.appendChild(clockText);
// desk and monitor
office.appendChild(h('rect', { x: 760, y: 760, width: 980, height: 26, rx: 6, fill: C.desk }));
office.appendChild(h('rect', { x: 820, y: 786, width: 22, height: 220, fill: '#2a211b' }));
office.appendChild(h('rect', { x: 1660, y: 786, width: 22, height: 220, fill: '#2a211b' }));
const deskScreen = h('g');
deskScreen.appendChild(
  h('rect', {
    x: -230,
    y: -300,
    width: 460,
    height: 290,
    rx: 14,
    fill: '#08131c',
    stroke: C.line,
    'stroke-width': 6,
  }),
);
deskScreen.appendChild(h('rect', { x: -14, y: -10, width: 28, height: 50, fill: C.line }));
deskScreen.appendChild(h('rect', { x: -80, y: 36, width: 160, height: 10, rx: 4, fill: C.line }));
const miniRows = [0, 1, 2].map((i) => {
  const g = h('g', { transform: `translate(-190 ${-250 + i * 70})` }, [
    h('circle', { cx: 14, cy: 14, r: 12, fill: C.signal }),
    h('rect', { x: 40, y: 6, width: 200, height: 16, rx: 6, fill: C.ink2, opacity: 0.6 }),
    h('rect', { x: 280, y: 6, width: 90, height: 16, rx: 6, fill: C.signal, opacity: 0.7 }),
  ]);
  deskScreen.appendChild(g);
  return g;
});
office.appendChild(deskScreen);
const phoneOnDesk = h('rect', {
  x: 1500,
  y: 735,
  width: 70,
  height: 26,
  rx: 6,
  fill: '#0a1620',
  stroke: C.line,
  'stroke-width': 3,
});
office.appendChild(phoneOnDesk);

// engineer (side view), built from flat shapes
const engineer = h('g');
const chair = h('g', {}, [
  h('rect', { x: -150, y: -330, width: 40, height: 260, rx: 16, fill: '#24323d' }),
  h('rect', { x: -150, y: -110, width: 210, height: 34, rx: 12, fill: '#24323d' }),
  h('rect', { x: -40, y: -76, width: 18, height: 140, fill: '#1b252d' }),
]);
engineer.appendChild(chair);
engineer.appendChild(h('path', { d: 'M-30 -120 H120 L150 40 H118 L96 -80 H-30 Z', fill: '#2c3e50' }));
const torso = h('g');
torso.appendChild(h('path', { d: 'M-110 -330 C-110 -400 10 -410 30 -340 L40 -120 H-100 Z', fill: C.hoodie }));
const head = h('g');
head.appendChild(h('circle', { cx: -20, cy: -430, r: 58, fill: C.skin }));
head.appendChild(
  h('path', { d: 'M-80 -440 C-84 -500 20 -510 40 -450 C10 -470 -40 -470 -80 -440 Z', fill: C.hair }),
);
head.appendChild(h('path', { d: 'M-80 -440 C-90 -400 -70 -380 -60 -380 L-62 -440 Z', fill: C.hair }));
head.appendChild(h('circle', { cx: 18, cy: -432, r: 5, fill: '#1a1a1a' }));
const mouth = h('path', { fill: 'none', stroke: '#1a1a1a', 'stroke-width': 4, 'stroke-linecap': 'round' });
head.appendChild(mouth);
torso.appendChild(head);
const arm = h('path', {
  fill: 'none',
  stroke: C.hoodie,
  'stroke-width': 30,
  'stroke-linecap': 'round',
  'stroke-linejoin': 'round',
});
torso.appendChild(arm);
const hand = h('circle', { r: 16, fill: C.skin });
torso.appendChild(hand);
engineer.appendChild(torso);
office.appendChild(engineer);

// ---------- the real monitor list ----------
const monitor = h('g');
svg.appendChild(monitor);
monitor.appendChild(
  h('rect', {
    x: -26,
    y: -26,
    width: 1108,
    height: 712,
    rx: 22,
    fill: '#08131c',
    stroke: C.line,
    'stroke-width': 4,
  }),
);
monitor.appendChild(
  h('image', {
    href: '../docs/screenshots/admin-monitors.png',
    x: 0,
    y: 0,
    width: 1056,
    height: 660,
    'clip-path': 'url(#screen)',
    preserveAspectRatio: 'xMidYMin slice',
  }),
);
const k = 1056 / 1440;
// Rows of the three demo monitors in the screenshot (state column), used for the scan highlight.
const rowYs = [250, 320, 390].map((y) => y * k);
const scan = h('rect', { x: 8, width: 1040, height: 62 * k, rx: 8, fill: C.signal, opacity: 0.18 });
monitor.appendChild(scan);

// ---------- live system diagram ----------
const diagram = h('g');
svg.appendChild(diagram);
diagram.appendChild(h('rect', { width: 1920, height: 1080, fill: C.panel }));
diagram.appendChild(h('rect', { width: 1920, height: 1080, fill: 'url(#grid)' }));
const SP = { x: 470, y: 600 };
const GATE = { x: 800, y: 600 };
const NODES = [
  { name: 'Storefront', x: 1420, y: 380 },
  { name: 'Orders API', x: 1420, y: 560 },
  { name: 'Sign-in service', x: 1420, y: 740 },
];
const META = { x: 1080, y: 190 };
diagram.appendChild(
  h('rect', {
    x: 1150,
    y: 270,
    width: 560,
    height: 580,
    rx: 22,
    fill: 'none',
    stroke: C.line,
    'stroke-width': 3,
    'stroke-dasharray': '12 10',
  }),
);
diagram.appendChild(
  h('text', {
    x: 1170,
    y: 300,
    'font-size': 22,
    class: 'mono',
    fill: C.ink2,
    text: 'internal network (no route out)',
  }),
);
const links = h('g', { fill: 'none', stroke: C.line, 'stroke-width': 4 });
diagram.appendChild(links);
NODES.forEach((n) =>
  links.appendChild(h('path', { d: `M${SP.x} ${SP.y} L${GATE.x} ${GATE.y} L${n.x - 130} ${n.y}` })),
);
links.appendChild(
  h('path', {
    d: `M${SP.x} ${SP.y} L${GATE.x} ${GATE.y} L${META.x - 120} ${META.y}`,
    'stroke-dasharray': '8 10',
  }),
);
// Signalpost node
const spNode = h('g', { transform: `translate(${SP.x} ${SP.y})` }, [
  h('rect', {
    x: -120,
    y: -100,
    width: 240,
    height: 200,
    rx: 30,
    fill: C.panel2,
    stroke: C.signal,
    'stroke-width': 5,
  }),
  h('path', {
    d: 'M-60 20 L-28 20 L-10 -36 L14 50 L32 0 L64 0',
    fill: 'none',
    stroke: C.signal,
    'stroke-width': 10,
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
  }),
  h('text', {
    y: 150,
    'text-anchor': 'middle',
    'font-size': 34,
    class: 'head',
    fill: C.ink,
    text: 'Signalpost',
  }),
]);
diagram.appendChild(spNode);
// policy gate
const gate = h('g', { transform: `translate(${GATE.x} ${GATE.y})` }, [
  h('rect', {
    x: -26,
    y: -250,
    width: 52,
    height: 500,
    rx: 16,
    fill: '#0b2233',
    stroke: C.ink2,
    'stroke-width': 4,
  }),
  h('path', {
    d: 'M0 -40 L28 -28 V2 C28 24 14 36 0 44 C-14 36 -28 24 -28 2 V-28 Z',
    fill: C.panel2,
    stroke: C.signal,
    'stroke-width': 4,
  }),
  h('text', {
    y: 300,
    'text-anchor': 'middle',
    'font-size': 26,
    class: 'head',
    fill: C.ink,
    text: 'Outbound policy',
  }),
  h('text', {
    y: 334,
    'text-anchor': 'middle',
    'font-size': 20,
    class: 'mono',
    fill: C.ink2,
    text: 'allowlist · DNS · pinned · no redirects',
  }),
]);
diagram.appendChild(gate);
const gateFlash = h('rect', {
  x: GATE.x - 26,
  y: GATE.y - 250,
  width: 52,
  height: 500,
  rx: 16,
  fill: C.red,
  opacity: 0,
});
diagram.appendChild(gateFlash);
// metadata target
const meta = h('g', { transform: `translate(${META.x} ${META.y})` }, [
  h('path', {
    d: 'M-110 30 C-140 30 -140 -20 -104 -24 C-100 -64 -40 -70 -24 -40 C-4 -76 60 -66 62 -22 C104 -24 110 30 76 30 Z',
    fill: '#132f43',
    stroke: C.ink2,
    'stroke-width': 4,
  }),
  h('text', { x: 140, y: -6, 'font-size': 24, class: 'mono', fill: C.ink2, text: '169.254.169.254' }),
  h('text', { x: 140, y: 26, 'font-size': 22, fill: C.ink2, text: 'cloud metadata' }),
]);
diagram.appendChild(meta);
const refused = h('g', {}, [
  h('rect', {
    x: 0,
    y: -26,
    width: 400,
    height: 52,
    rx: 10,
    fill: '#3d1c1a',
    stroke: C.red,
    'stroke-width': 3,
  }),
  h('text', {
    x: 18,
    y: 8,
    'font-size': 22,
    class: 'mono',
    fill: C.red,
    text: 'refused: link-local address',
  }),
]);
diagram.appendChild(refused);
// service nodes
const nodeViews = NODES.map((n) => {
  const g = h('g', { transform: `translate(${n.x} ${n.y})` });
  const box = h('rect', {
    x: -130,
    y: -56,
    width: 260,
    height: 112,
    rx: 18,
    fill: C.panel2,
    stroke: C.signal,
    'stroke-width': 5,
  });
  const lamp = h('circle', { cx: -92, cy: 0, r: 16, fill: C.signal });
  const label = h('text', { x: -62, y: 9, 'font-size': 28, class: 'head', fill: C.ink, text: n.name });
  const ring = h('circle', {
    cx: -92,
    cy: 0,
    r: 16,
    fill: 'none',
    stroke: C.signal,
    'stroke-width': 4,
    opacity: 0,
  });
  [box, lamp, ring, label].forEach((e) => g.appendChild(e));
  diagram.appendChild(g);
  return { g, box, lamp, ring };
});
const failBadge = h('g', {}, [
  h('rect', {
    x: 0,
    y: -22,
    width: 150,
    height: 44,
    rx: 22,
    fill: '#3d1c1a',
    stroke: C.red,
    'stroke-width': 3,
  }),
  h('text', { x: 75, y: 8, 'text-anchor': 'middle', 'font-size': 22, class: 'mono', fill: C.red }),
]);
diagram.appendChild(failBadge);
const pulses = h('g');
diagram.appendChild(pulses);
const pulsePool = Array.from({ length: 10 }, () => {
  const c = h('circle', { r: 11, fill: C.signal });
  pulses.appendChild(c);
  return c;
});
// incident card and overall state, in the app's own words
const incident = h('g');
diagram.appendChild(incident);
incident.appendChild(
  h('rect', {
    x: 0,
    y: 0,
    width: 640,
    height: 190,
    rx: 16,
    fill: '#0b2233',
    stroke: C.line,
    'stroke-width': 3,
  }),
);
const incTitle = h('text', {
  x: 28,
  y: 52,
  'font-size': 32,
  class: 'head',
  fill: C.ink,
  text: 'Orders API is not responding',
});
const incStatus = h('text', { x: 28, y: 98, 'font-size': 26, 'font-weight': 600, fill: C.red });
const incBody = h('text', { x: 28, y: 146, 'font-size': 21, fill: C.ink2 });
const incBody2 = h('text', { x: 28, y: 176, 'font-size': 21, fill: C.ink2 });
[incTitle, incStatus, incBody, incBody2].forEach((e) => incident.appendChild(e));
const overall = h('g');
diagram.appendChild(overall);
const overallBox = h('rect', { x: 0, y: 0, width: 460, height: 76, rx: 14, stroke: 'none' });
const overallText = h('text', { x: 28, y: 50, 'font-size': 32, class: 'head' });
overall.appendChild(overallBox);
overall.appendChild(overallText);

// ---------- phone with the real status page ----------
const phone = h('g');
svg.appendChild(phone);
phone.appendChild(
  h('rect', {
    x: -16,
    y: -16,
    width: 332,
    height: 632,
    rx: 40,
    fill: '#05090d',
    stroke: C.line,
    'stroke-width': 4,
  }),
);
phone.appendChild(
  h('image', {
    href: '../docs/screenshots/mobile.png',
    x: 0,
    y: 0,
    width: 300,
    height: 649,
    'clip-path': 'url(#phone)',
    preserveAspectRatio: 'xMidYMin slice',
  }),
);
const notif = h('g', {}, [
  h('rect', {
    x: 0,
    y: 0,
    width: 360,
    height: 100,
    rx: 18,
    fill: '#0b2233',
    stroke: C.signal,
    'stroke-width': 3,
  }),
  h('text', { x: 24, y: 42, 'font-size': 24, class: 'mono', fill: C.signal, text: 'incident.resolved' }),
  h('text', { x: 24, y: 76, 'font-size': 22, fill: C.ink2, text: 'Orders API · signed webhook' }),
]);
svg.appendChild(notif);

// ---------- end card ----------
const end = h('g');
svg.appendChild(end);
end.appendChild(h('rect', { width: 1920, height: 1080, fill: C.panel }));
end.appendChild(h('rect', { width: 1920, height: 1080, fill: 'url(#grid)', opacity: 0.6 }));
end.appendChild(h('rect', { x: 0, y: 1060, width: 1920, height: 20, fill: C.signal }));
const mark = h('g', {}, [
  h('rect', {
    x: -90,
    y: -90,
    width: 180,
    height: 180,
    rx: 42,
    fill: C.panel2,
    stroke: C.signal,
    'stroke-width': 6,
  }),
  h('path', {
    d: 'M-54 22 L-24 22 L-8 -36 L14 52 L32 0 L58 0',
    fill: 'none',
    stroke: C.signal,
    'stroke-width': 11,
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
  }),
]);
end.appendChild(mark);
const title = h('text', {
  x: 960,
  y: 640,
  'text-anchor': 'middle',
  'font-size': 130,
  class: 'head',
  fill: C.ink,
  text: 'Signalpost',
});
const tag = h('text', {
  x: 960,
  y: 712,
  'text-anchor': 'middle',
  'font-size': 40,
  fill: C.ink2,
  text: 'Uptime monitoring with a locked-down outbound policy',
});
const repo = h('text', {
  x: 960,
  y: 800,
  'text-anchor': 'middle',
  'font-size': 30,
  class: 'mono',
  fill: C.signal,
  text: 'github.com/gad-rapaport/signalpost',
});
[title, tag, repo].forEach((e) => end.appendChild(e));

// ---------- captions ----------
const capBack = h('rect', {
  x: 96,
  y: 52,
  height: 84,
  rx: 10,
  fill: '#08131c',
  stroke: C.signal,
  'stroke-width': 2,
});
const capText = h('text', { x: 124, y: 108, 'font-size': 44, class: 'head', fill: C.ink });
svg.appendChild(capBack);
svg.appendChild(capText);
const CAPS = [
  [0.5, 3.8, 'Is everything up? Know before your customers do.'],
  [4.3, 7.6, 'Signalpost checks every service, every 30 seconds.'],
  [8.1, 10.0, 'Each check passes the outbound policy first.'],
  [10.2, 12.3, 'A request to cloud metadata never leaves.'],
  [12.6, 14.9, 'Two failures in a row open an incident.'],
  [15.1, 16.9, 'Two good checks close it.'],
  [17.3, 19.4, 'Customers see the same story on the status page.'],
];
const capWidth = (s) => s.length * 20.5 + 64;

// Path helpers for pulses: Signalpost -> gate -> target.
function along(points, p) {
  const segs = [];
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    const d = Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
    segs.push(d);
    total += d;
  }
  let dist = p * total;
  for (let i = 0; i < segs.length; i++) {
    if (dist <= segs[i] || i === segs.length - 1) {
      const f = Math.min(1, dist / segs[i]);
      return {
        x: points[i].x + (points[i + 1].x - points[i].x) * f,
        y: points[i].y + (points[i + 1].y - points[i].y) * f,
      };
    }
    dist -= segs[i];
  }
  return points[points.length - 1];
}
const route = (n) => [
  { x: SP.x + 120, y: SP.y },
  { x: GATE.x, y: GATE.y },
  { x: n.x - 130, y: n.y },
];

// Orders API timeline (node 1): fails at 12.9 and 13.5 -> incident 13.7; recovers 15.3, 15.9 -> resolved.
const ORDERS_FAIL = [12.9, 13.5];
const ORDERS_OK = [15.3, 15.9];
// Regular checks for the other two nodes and for Orders API before and after the failure.
const CHECKS = [];
for (let t0 = 8.2; t0 < 17; t0 += 0.9) {
  CHECKS.push({ node: 0, t: t0 });
  CHECKS.push({ node: 2, t: t0 + 0.3 });
  if (t0 < 12.2) CHECKS.push({ node: 1, t: t0 + 0.6 });
}
ORDERS_FAIL.forEach((t) => CHECKS.push({ node: 1, t: t - 0.7, fail: true }));
ORDERS_OK.forEach((t) => CHECKS.push({ node: 1, t: t - 0.7 }));

stage.add((t) => {
  // Office: 0-4.1 and again 16.9-19.6.
  const officeOn = Math.max(life(t, 0, 4.1, 0.3, 0.4), life(t, 16.9, 19.7, 0.4, 0.3));
  office.setAttribute('opacity', officeOn.toFixed(3));
  const late = t > 10;
  place(engineer, { x: 700, y: 880 });
  place(deskScreen, { x: 1240, y: 760 });
  const lean = late ? ease.inOutCubic(prog(t, 17.4, 0.8)) : 0;
  place(torso, { r: late ? -8 * lean : wave(t, 3, 1.5), ox: -40, oy: -120 });
  mouth.setAttribute('d', `M2 -404 Q14 ${(-404 + (late ? lean * 10 : -2)).toFixed(1)} 26 -404`);
  // Arm reaches the keyboard early; holds the phone late.
  const handEarly = { x: 150 + wave(t, 0.5, 6), y: -150 };
  const handLate = { x: 60, y: -300 };
  const hx = late ? tw(t, 17.2, 0.6, handEarly.x, handLate.x, ease.inOutCubic) : handEarly.x;
  const hy = late ? tw(t, 17.2, 0.6, handEarly.y, handLate.y, ease.inOutCubic) : handEarly.y;
  arm.setAttribute('d', `M-30 -320 Q40 -230 ${hx.toFixed(1)} ${hy.toFixed(1)}`);
  place(hand, { x: hx, y: hy });
  miniRows.forEach((r, i) =>
    r.setAttribute('opacity', (0.6 + 0.4 * Math.abs(wave(t + i * 0.4, 2, 1))).toFixed(3)),
  );
  clockText.textContent = t < 10 ? '02:14' : '02:19';
  phoneOnDesk.setAttribute('opacity', late ? (1 - prog(t, 17.2, 0.3)).toFixed(3) : 1);
  place(windows, { o: 0.7 + 0.3 * wave(t, 4, 1) });

  // Monitor with the real admin list: 3.9-8.0, zooming out of the desk screen.
  const monOn = life(t, 3.9, 8.1, 0.45, 0.35);
  const grow = ease.inOutCubic(prog(t, 3.9, 0.8));
  place(monitor, {
    x: 1010 + (432 - 1010) * grow,
    y: 470 + (250 - 470) * grow,
    s: 0.43 + 0.57 * grow,
    o: monOn,
  });
  const scanP = prog(t, 5.0, 2.4);
  const row = Math.min(2, Math.floor(scanP * 3));
  scan.setAttribute('y', (rowYs[row] - 8).toFixed(1));
  scan.setAttribute('opacity', (life(t, 5.0, 7.4, 0.2, 0.2) * 0.22).toFixed(3));

  // Diagram: 7.8-17.0.
  const diaOn = life(t, 7.8, 17.0, 0.5, 0.4);
  diagram.setAttribute('opacity', diaOn.toFixed(3));
  place(spNode, { x: SP.x, y: SP.y, s: tw(t, 7.9, 0.6, 0.6, 1, ease.outBack) });
  nodeViews.forEach((v, i) =>
    place(v.g, { x: NODES[i].x + (1 - ease.outBack(prog(t, 8.0 + i * 0.12, 0.6))) * 160, y: NODES[i].y }),
  );

  // Pulses.
  let used = 0;
  const flashes = [0, 0, 0];
  for (const c of CHECKS) {
    const p = prog(t, c.t, 0.7);
    if (p > 0 && p < 1 && used < pulsePool.length) {
      const pos = along(route(NODES[c.node]), ease.inOutQuad(p));
      const el = pulsePool[used++];
      el.setAttribute('fill', c.fail && p > 0.8 ? C.red : C.signal);
      place(el, { x: pos.x, y: pos.y, o: 1 });
    }
    if (t >= c.t + 0.7 && t < c.t + 1.1)
      flashes[c.node] = Math.max(flashes[c.node], 1 - prog(t, c.t + 0.7, 0.4));
  }
  // The metadata request: leaves at 10.3, stopped at the gate at 10.75, bounces back.
  const mp = prog(t, 10.3, 0.45);
  if (mp > 0 && mp < 1 && used < pulsePool.length) {
    const el = pulsePool[used++];
    el.setAttribute('fill', C.amber);
    const pos = along(
      [
        { x: SP.x + 120, y: SP.y },
        { x: GATE.x - 30, y: GATE.y - 40 },
      ],
      ease.inQuad(mp),
    );
    place(el, { x: pos.x, y: pos.y, o: 1 });
  }
  const back = prog(t, 10.75, 0.5);
  if (back > 0 && back < 1 && used < pulsePool.length) {
    const el = pulsePool[used++];
    el.setAttribute('fill', C.red);
    place(el, { x: GATE.x - 30 - back * 140, y: GATE.y - 40 - Math.sin(back * Math.PI) * 60, o: 1 - back });
  }
  for (let i = used; i < pulsePool.length; i++) pulsePool[i].setAttribute('opacity', 0);
  gateFlash.setAttribute('opacity', (life(t, 10.7, 11.3, 0.05, 0.4) * 0.55).toFixed(3));
  place(refused, {
    x: GATE.x - 430,
    y: GATE.y - 300,
    o: life(t, 10.8, 12.4, 0.2, 0.3),
    s: tw(t, 10.8, 0.3, 0.8, 1, ease.outBack),
  });

  // Orders API state.
  const down = t >= 13.5 + 0.0 && t < 15.95;
  const failing = t >= 12.9 && t < 15.95;
  nodeViews.forEach((v, i) => {
    const bad = i === 1 && failing;
    v.box.setAttribute('stroke', bad ? C.red : C.signal);
    v.lamp.setAttribute('fill', bad ? C.red : C.signal);
    v.ring.setAttribute('stroke', bad ? C.red : C.signal);
    v.ring.setAttribute('r', (16 + (1 - flashes[i]) * 26).toFixed(1));
    v.ring.setAttribute('opacity', flashes[i].toFixed(3));
    place(v.g, {
      x:
        NODES[i].x +
        (1 - ease.outBack(prog(t, 8.0 + i * 0.12, 0.6))) * 160 +
        (bad && down ? wave(t, 0.15, 3) : 0),
      y: NODES[i].y,
    });
  });
  const fails = t >= 13.5 && t < 15.3 ? 2 : t >= 12.9 && t < 15.3 ? 1 : 0;
  failBadge.childNodes[1].textContent = `${fails} failed`;
  place(failBadge, {
    x: NODES[1].x + 150,
    y: NODES[1].y,
    o: fails && t < 15.4 ? 1 : 0,
    s: tw(t, fails === 2 ? 13.5 : 12.9, 0.25, 0.7, 1, ease.outBack),
  });

  // Incident card and overall state.
  const resolved = t >= 15.95;
  place(incident, {
    x: 120,
    y: 280 - (1 - ease.outBack(prog(t, 13.7, 0.5))) * 120,
    o: life(t, 13.7, 17.0, 0.2, 0.3),
  });
  incStatus.textContent = resolved ? 'Resolved' : 'Investigating';
  incStatus.setAttribute('fill', resolved ? C.signal : C.red);
  incBody.textContent = resolved
    ? 'Checks are passing again. Down for about 1 min.'
    : 'Automatic checks are failing: the service answered with HTTP 503.';
  // The app's full sentence; the second line only exists for the open incident.
  incBody2.textContent = resolved ? '' : 'We are looking into it.';
  const showOverall = t >= 13.7;
  overallBox.setAttribute('fill', resolved ? '#12352a' : '#3d1c1a');
  overallText.setAttribute('fill', resolved ? C.signal : C.red);
  overallText.textContent = resolved ? 'All systems operational' : 'Partial outage';
  place(overall, { x: 120, y: 180, o: showOverall ? life(t, 13.7, 17.0, 0.2, 0.3) : 0 });

  // Phone with the real status page and the webhook notification.
  const phoneOn = life(t, 17.6, 19.7, 0.4, 0.3);
  place(phone, { x: 1180, y: 300 + (1 - ease.outCubic(prog(t, 17.6, 0.6))) * 120, o: phoneOn, r: -3 });
  place(notif, {
    x: 1540,
    y: 440,
    o: Math.min(phoneOn, prog(t, 18.2, 0.3)),
    s: tw(t, 18.2, 0.4, 0.8, 1, ease.outBack),
  });

  // End.
  end.setAttribute('opacity', prog(t, 19.5, 0.5).toFixed(3));
  place(mark, { x: 960, y: 400, s: tw(t, 19.7, 0.6, 0.4, 1, ease.outBack), r: tw(t, 19.7, 0.6, -12, 0) });
  [title, tag, repo].forEach((e, i) =>
    place(e, { y: tw(t, 19.95 + i * 0.15, 0.5, 30, 0), o: prog(t, 19.95 + i * 0.15, 0.4) }),
  );

  const cap = CAPS.find(([a, b]) => t >= a && t <= b);
  if (cap) {
    const o = life(t, cap[0], cap[1], 0.25, 0.25);
    capText.textContent = cap[2];
    capBack.setAttribute('width', capWidth(cap[2]).toFixed(0));
    place(capText, { x: tw(t, cap[0], 0.4, -16, 0), o });
    place(capBack, { x: tw(t, cap[0], 0.4, -16, 0), o });
  } else {
    capText.setAttribute('opacity', 0);
    capBack.setAttribute('opacity', 0);
  }
});

attachPlayer(stage);
