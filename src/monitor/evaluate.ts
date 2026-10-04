export type MonitorState = 'unknown' | 'up' | 'degraded' | 'down';

export interface Counters {
  state: MonitorState;
  consecutiveFail: number;
  consecutiveOk: number;
  consecutiveSlow: number;
}

export interface Thresholds {
  failThreshold: number;
  recoverThreshold: number;
  degradedMs: number;
}

export interface CheckOutcome {
  ok: boolean;
  latencyMs: number | null;
}

export type Transition = 'down' | 'recovered' | null;

/**
 * State machine for one monitor. Flapping is damped on both sides: it takes `failThreshold` failed checks
 * in a row to go down (and open an incident) and `recoverThreshold` good checks in a row to come back (and
 * resolve it). Slow but successful checks mark the monitor degraded after the same number of slow checks;
 * degraded never opens an incident on its own.
 */
export function evaluate(
  prev: Counters,
  outcome: CheckOutcome,
  t: Thresholds,
): { next: Counters; transition: Transition; slow: boolean } {
  const slow = outcome.ok && outcome.latencyMs !== null && outcome.latencyMs > t.degradedMs;
  const consecutiveFail = outcome.ok ? 0 : prev.consecutiveFail + 1;
  const consecutiveOk = outcome.ok ? prev.consecutiveOk + 1 : 0;
  const consecutiveSlow = slow ? prev.consecutiveSlow + 1 : 0;

  let state = prev.state;
  let transition: Transition = null;
  if (prev.state === 'down') {
    if (consecutiveOk >= t.recoverThreshold) {
      state = consecutiveSlow >= t.failThreshold ? 'degraded' : 'up';
      transition = 'recovered';
    }
  } else if (consecutiveFail >= t.failThreshold) {
    state = 'down';
    transition = 'down';
  } else if (outcome.ok) {
    state =
      consecutiveSlow >= t.failThreshold ? 'degraded' : slow && prev.state === 'degraded' ? 'degraded' : 'up';
  } else if (prev.state === 'unknown') {
    // A first failure is not yet an outage, but it is not "up" either.
    state = 'unknown';
  }
  return { next: { state, consecutiveFail, consecutiveOk, consecutiveSlow }, transition, slow };
}
