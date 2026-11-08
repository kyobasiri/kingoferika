// ============================================================
// 決定性チェック（同じ入力なら同じ結果になるか）
// ------------------------------------------------------------
// 1. 今の状態から、でたらめな入力で N フレーム進める → 指紋A
// 2. 同じ状態・同じ入力でもう一度 → 指紋B
// 3. 途中で保存し、そこから復元して残りを進める → 指紋C
// A・B・C が全部同じなら「状態を丸ごと保存・復元できて、結果も毎回同じ」。
// ブラウザ（数字キー6）と Node（npm run check:det）の両方から使える。
// ============================================================

import { BTN_K, BTN_P, BTN_S, DOWN, LEFT, RIGHT, UP } from '../input/buttons.ts';
import { cloneState, hashState, type GameState } from '../sim/state.ts';
import { step } from '../sim/simulate.ts';
import type { SimContext } from '../sim/events.ts';

/** でたらめな入力の列を作る（入力を作るのは計算の外なので Math.random を使ってよい） */
export function randomInputs(frames: number, seed = Date.now()): number[] {
  let x = seed >>> 0 || 1;
  const rnd = () => {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    return (x >>> 0) / 4294967296;
  };
  const out: number[] = [];
  let cur = 0;
  for (let i = 0; i < frames; i++) {
    // 数フレームごとに入力を変える（人の操作っぽく）
    if (rnd() < 0.25) {
      cur = 0;
      const h = rnd();
      if (h < 0.3) cur |= RIGHT;
      else if (h < 0.5) cur |= LEFT;
      const v = rnd();
      if (v < 0.15) cur |= UP;
      else if (v < 0.35) cur |= DOWN;
      if (rnd() < 0.2) cur |= BTN_P;
      if (rnd() < 0.2) cur |= BTN_K;
      if (rnd() < 0.15) cur |= BTN_S;
    }
    out.push(cur);
  }
  return out;
}

export interface DeterminismResult {
  ok: boolean;
  frames: number;
  hashA: string;
  hashB: string;
  hashC: string;
  ms: number;
}

export function checkDeterminism(start: GameState, ctx: SimContext, frames = 1200, seed?: number): DeterminismResult {
  const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
  const inputs = randomInputs(frames, seed);
  const run = (s: GameState, from: number, to: number) => {
    for (let i = from; i < to; i++) step(s, [inputs[i]], ctx);
    return s;
  };
  const a = run(cloneState(start), 0, frames);
  const b = run(cloneState(start), 0, frames);
  // 途中で保存 → 復元 → 続き
  const half = Math.floor(frames / 2);
  const mid = cloneState(run(cloneState(start), 0, half));
  const c = run(cloneState(mid), half, frames);
  const hashA = hashState(a);
  const hashB = hashState(b);
  const hashC = hashState(c);
  const t1 = typeof performance !== 'undefined' ? performance.now() : 0;
  return { ok: hashA === hashB && hashB === hashC, frames, hashA, hashB, hashC, ms: t1 - t0 };
}
