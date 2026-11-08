// ============================================================
// 判定の箱の計算
// ------------------------------------------------------------
// データの箱は「足元（飛び道具は中心）からの相対位置・右向き基準・px」。
// これをステージ上の位置（内部単位）に直して重なりを調べる。
// ステージ上の座標は「x：右がプラス、y：下がプラス（画面と同じ向き）」で、地面が y=0。
// ============================================================

import type { Box } from '../data/types.ts';
import { SUB } from '../fixed.ts';

export interface WorldBox {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/**
 * @param ox 基準点のx（内部単位）
 * @param oy 基準点の高さ（内部単位、上がプラス）
 * @param facing 1＝右向き、-1＝左向き（左右反転する）
 */
export function toWorld(ox: number, oy: number, facing: number, b: Box): WorldBox {
  const x1 = facing === 1 ? ox + b[0] * SUB : ox - (b[0] + b[2]) * SUB;
  const y1 = -oy + b[1] * SUB;
  return { x1, y1, x2: x1 + b[2] * SUB, y2: y1 + b[3] * SUB };
}

export function overlaps(a: WorldBox, b: WorldBox): boolean {
  return a.x1 < b.x2 && b.x1 < a.x2 && a.y1 < b.y2 && b.y1 < a.y2;
}

/** 箱どうしの横のすき間（重なっていれば0） */
export function gapX(a: WorldBox, b: WorldBox): number {
  return Math.max(0, b.x1 - a.x2, a.x1 - b.x2);
}

/** 2つの箱の重なりの中心（火花を出す位置） */
export function overlapCenter(a: WorldBox, b: WorldBox): { x: number; y: number } {
  const x1 = Math.max(a.x1, b.x1);
  const x2 = Math.min(a.x2, b.x2);
  const y1 = Math.max(a.y1, b.y1);
  const y2 = Math.min(a.y2, b.y2);
  return { x: Math.trunc((x1 + x2) / 2), y: Math.trunc((y1 + y2) / 2) };
}
