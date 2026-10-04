import { describe, expect, it } from 'vitest';
import { evaluate, type Counters } from '../../src/monitor/evaluate.js';

const t = { failThreshold: 2, recoverThreshold: 2, degradedMs: 500 };
const start: Counters = { state: 'unknown', consecutiveFail: 0, consecutiveOk: 0, consecutiveSlow: 0 };

function run(outcomes: { ok: boolean; ms?: number }[], from = start) {
  let c = from;
  const transitions: (string | null)[] = [];
  const states: string[] = [];
  for (const o of outcomes) {
    const r = evaluate(c, { ok: o.ok, latencyMs: o.ok ? (o.ms ?? 100) : null }, t);
    c = r.next;
    transitions.push(r.transition);
    states.push(c.state);
  }
  return { c, transitions, states };
}

describe('monitor state machine', () => {
  it('becomes up on the first good check', () => {
    expect(run([{ ok: true }]).states).toEqual(['up']);
  });

  it('needs consecutive failures to go down, and opens exactly one transition', () => {
    const r = run([{ ok: true }, { ok: false }, { ok: true }, { ok: false }, { ok: false }, { ok: false }]);
    expect(r.states).toEqual(['up', 'up', 'up', 'up', 'down', 'down']);
    expect(r.transitions).toEqual([null, null, null, null, 'down', null]);
  });

  it('needs consecutive successes to recover', () => {
    const down = run([{ ok: false }, { ok: false }]).c;
    const r = run([{ ok: true }, { ok: false }, { ok: true }, { ok: true }], down);
    expect(r.states).toEqual(['down', 'down', 'down', 'up']);
    expect(r.transitions).toEqual([null, null, null, 'recovered']);
  });

  it('a first failure from unknown is not an outage yet', () => {
    expect(run([{ ok: false }]).states).toEqual(['unknown']);
  });

  it('marks degraded after repeated slow checks and clears on a fast one', () => {
    const r = run([
      { ok: true, ms: 900 },
      { ok: true, ms: 900 },
      { ok: true, ms: 950 },
      { ok: true, ms: 80 },
    ]);
    expect(r.states).toEqual(['up', 'degraded', 'degraded', 'up']);
    expect(r.transitions.every((x) => x === null)).toBe(true);
  });

  it('recovers into degraded when the recovering checks are slow', () => {
    const down = run([{ ok: false }, { ok: false }]).c;
    const r = run(
      [
        { ok: true, ms: 900 },
        { ok: true, ms: 900 },
      ],
      down,
    );
    expect(r.states.at(-1)).toBe('degraded');
    expect(r.transitions.at(-1)).toBe('recovered');
  });

  it('respects thresholds of one', () => {
    const r = evaluate(
      start,
      { ok: false, latencyMs: null },
      { failThreshold: 1, recoverThreshold: 1, degradedMs: 500 },
    );
    expect(r.transition).toBe('down');
  });
});
