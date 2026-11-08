// ============================================================
// 整数で計算するための道具
// ------------------------------------------------------------
// 位置や速さは「1px ＝ 1000」の整数で持つ（小数を使わない）。
// 小数は環境によって計算結果の最後の桁がずれることがあり、
// 将来のロールバック対戦で左右の画面がずれる原因になるため。
// ============================================================

/** 1px を何単位で表すか */
export const SUB = 1000;

/** px → 内部単位（データ読み込み時だけ使う。結果は必ず整数） */
export function toSub(pxValue: number): number {
  return Math.round(pxValue * SUB);
}

/** 内部単位 → px（描画用。小数になってよい） */
export function toPx(sub: number): number {
  return sub / SUB;
}

/** 整数の割り算（0の方向へ切り捨て） */
export function idiv(a: number, b: number): number {
  return Math.trunc(a / b);
}

/**
 * total を n 回に分けて配るときの i 回目（0始まり）の量。
 * 毎回の量は整数で、n 回分を足すと必ず total ぴったりになる。
 * 例：spread(10, 3, i) → 3, 3, 4
 */
export function spread(total: number, n: number, i: number): number {
  return idiv(total * (i + 1), n) - idiv(total * i, n);
}

/** 範囲内に収める */
export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
