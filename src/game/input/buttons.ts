// ============================================================
// 入力を1つの整数（ビットの組み合わせ）で表す
// ------------------------------------------------------------
// 1フレーム分の入力＝「どのキーが押されているか」を1つの数値にまとめる。
// 数値なので、履歴の保存・比較・ネット送信がとても軽い。
// ============================================================

export const UP = 1;
export const DOWN = 2;
export const LEFT = 4;
export const RIGHT = 8;
export const BTN_P = 16;
export const BTN_K = 32;
export const BTN_S = 64;

export const DIR_MASK = UP | DOWN | LEFT | RIGHT;
export const BTN_MASK = BTN_P | BTN_K | BTN_S;

/**
 * 画面上の上下左右を、向きを考えたテンキー表記（6＝前、4＝後ろ、2＝下）に変える。
 * facing：1＝右向き、-1＝左向き。
 * 左右同時押し・上下同時押しはどちらも「入っていない」扱い（仮）。
 */
export function numpad(bits: number, facing: number): number {
  const l = (bits & LEFT) !== 0;
  const r = (bits & RIGHT) !== 0;
  const u = (bits & UP) !== 0;
  const d = (bits & DOWN) !== 0;
  let h = 0;
  if (r && !l) h = 1;
  else if (l && !r) h = -1;
  h *= facing; // 左向きのときは左が「前」
  let v = 0;
  if (u && !d) v = 1;
  else if (d && !u) v = -1;
  return 5 + h + v * 3;
}

/** ボタンのビットを文字に（表示用） */
export function buttonsText(bits: number): string {
  let s = '';
  if (bits & BTN_P) s += 'P';
  if (bits & BTN_K) s += 'K';
  if (bits & BTN_S) s += 'S';
  return s;
}

/** 押されているボタンの数 */
export function buttonCount(bits: number): number {
  return ((bits & BTN_P) ? 1 : 0) + ((bits & BTN_K) ? 1 : 0) + ((bits & BTN_S) ? 1 : 0);
}
