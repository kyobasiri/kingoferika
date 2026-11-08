// ============================================================
// 入力履歴からコマンドを読み取る
// ------------------------------------------------------------
// ・ボタンは「押した瞬間（前のフレームは離れていた）」だけを数える。
// ・同時押し：3F以内に押したボタンはまとめて1つの入力とみなす。
// ・先行入力：動けない間に押したボタンも、8F以内なら動けるようになった瞬間に出す。
// ・66/44：前（後ろ）を2回たたく。
// どれも「今のフレームで判断して、待たない」作り（反応を遅らせない）。
// ============================================================

import { BTN_MASK, DOWN, LEFT, RIGHT, UP, numpad } from '../input/buttons.ts';
import type { CommandEntry } from '../data/chardef.ts';
import { HIST_LEN, type FighterState } from './state.ts';

/** 入力を履歴に書く */
export function recordInput(f: FighterState, frame: number, bits: number): void {
  f.hist[frame % HIST_LEN] = bits;
}

/** あるフレームの入力（最近 HIST_LEN フレーム分だけ有効） */
export function inputAt(f: FighterState, frame: number): number {
  if (frame < 0) return 0;
  return f.hist[frame % HIST_LEN];
}

/** そのフレームで新しく押されたボタン */
export function pressedAt(f: FighterState, frame: number): number {
  return inputAt(f, frame) & ~inputAt(f, frame - 1) & BTN_MASK;
}

/** from〜to（両端含む）の間に新しく押されたボタンを全部まとめる */
export function pressedBetween(f: FighterState, from: number, to: number): number {
  let b = 0;
  for (let t = from; t <= to; t++) b |= pressedAt(f, t);
  return b;
}

export interface CommandCtx {
  now: number;
  air: boolean;
  near: boolean;
  /** 同時押しとみなすフレーム数 */
  simultaneous: number;
  /** 先行入力のフレーム数 */
  buffer: number;
  /** 追加の条件（キャンセルの可否など） */
  filter?: (e: CommandEntry) => boolean;
}

export interface CommandResult {
  move: string;
  entry: CommandEntry;
  /** まとめて押されたボタン */
  buttons: number;
  /** 押したフレーム */
  pressFrame: number;
}

/** ボタン・方向・状況に合う技を表から探す（表は優先度の高い順に並んでいる） */
export function matchEntry(
  entries: CommandEntry[],
  buttons: number,
  dir: number,
  air: boolean,
  near: boolean,
  filter?: (e: CommandEntry) => boolean,
): CommandEntry | null {
  for (const e of entries) {
    if (e.air !== air) continue;
    if ((e.buttons & ~buttons) !== 0) continue; // 必要なボタンが全部押されているか
    if (!e.dirs.includes(dir)) continue;
    if (e.range === 'near' && !near) continue;
    if (e.range === 'far' && near) continue;
    if (filter && !filter(e)) continue;
    return e;
  }
  return null;
}

/**
 * まだ使っていないボタン押しを新しい順に調べ、出せる技があれば返す。
 * 一番新しい押しが今のフレームなら、待たずにその場で出す（遅延0）。
 */
export function findCommand(f: FighterState, entries: CommandEntry[], c: CommandCtx): CommandResult | null {
  const lo = Math.max(c.now - c.buffer, f.consumedAt + 1);
  for (let t = c.now; t >= lo; t--) {
    if (!pressedAt(f, t)) continue;
    // 押したフレームの前後（同時押しの幅）で押されたボタンをまとめる
    const w = c.simultaneous - 1;
    const buttons = pressedBetween(f, Math.max(t - w, f.consumedAt + 1), Math.min(t + w, c.now));
    // 方向は「ボタンを押した瞬間」のもの。前後は今の向き基準
    const dir = numpad(inputAt(f, t), f.facing);
    const e = matchEntry(entries, buttons, dir, c.air, c.near, c.filter);
    if (e) return { move: e.move, entry: e, buttons, pressFrame: t };
  }
  return null;
}

/** 向きを考えた横方向（1＝前、-1＝後ろ、0＝無し）。上下が入っていたら0（ステップにしない） */
function horiz(bits: number, facing: number): number {
  if (bits & (UP | DOWN)) return 0;
  const l = (bits & LEFT) !== 0;
  const r = (bits & RIGHT) !== 0;
  if (l === r) return 0;
  return (r ? 1 : -1) * facing;
}

/** 前（後ろ）を新しく入れたフレームか */
function tapAt(f: FighterState, t: number): number {
  const h = horiz(inputAt(f, t), f.facing);
  if (h === 0) return 0;
  return horiz(inputAt(f, t - 1), f.facing) === h ? 0 : h;
}

/**
 * 66 / 44 を探す。2回目のたたきが先行入力の範囲内で、
 * 1回目との間が window フレーム以内なら成立。
 * @returns dir：1＝前ステップ、-1＝後ろステップ。無ければ null
 */
export function findStep(f: FighterState, now: number, window: number, buffer: number): { dir: number; frame: number } | null {
  const lo = Math.max(now - buffer, f.stepConsumedAt + 1);
  for (let t2 = now; t2 >= lo; t2--) {
    const s = tapAt(f, t2);
    if (!s) continue;
    for (let t1 = t2 - 1; t1 >= t2 - window; t1--) {
      if (t1 <= f.stepConsumedAt) break;
      if (tapAt(f, t1) === s) return { dir: s, frame: t2 };
    }
  }
  return null;
}

