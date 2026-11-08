// ============================================================
// 計算 → 演出 への知らせ
// ------------------------------------------------------------
// 計算（sim）は音や火花を直接出さず、「何が起きたか」をこの形で返すだけ。
// 演出側（render/fx.ts）がそれを見て火花などを出す。
// こうしておくと、巻き戻し（ロールバック）で計算をやり直しても、
// 演出が二重に出たり、計算が演出の都合で変わったりしない。
// ============================================================

import type { CharDef } from '../data/chardef.ts';
import type { GameState, StageConfig } from './state.ts';

export type SimEvent =
  | { type: 'hit'; owner: number; x: number; y: number; power: number; guard: boolean; counter: boolean; damage: number; note?: string }
  /** 溜めの段階が上がった（x, y は演出を出す位置。y は下がプラス） */
  | { type: 'holdLevel'; owner: number; level: number; x: number; y: number }
  | { type: 'moveStart'; owner: number; move: string }
  | { type: 'superFreeze'; owner: number; length: number }
  | { type: 'spawn'; owner: number; id: number };

/** 計算に使う、試合中に変わらないもの */
export interface SimContext {
  def: CharDef;
  stage: StageConfig;
}

/** 1フレーム分の計算で持ち回る作業用の入れ物（状態ではない） */
export interface Tick {
  s: GameState;
  ctx: SimContext;
  now: number;
  /** このフレームは暗転で止まっているか（暗転させた本人以外） */
  frozen: boolean;
  events: SimEvent[];
}
