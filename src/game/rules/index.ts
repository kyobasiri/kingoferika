// ============================================================
// 計算の決まり（エディタとゲームで共通）
// ------------------------------------------------------------
// 発生の数え方・段の数え方・技中の移動・押し返し・ジャンプの高さ・ダメージと補正・
// コマンドの読み方・初期値を、ここ1か所にだけ書く。
//
//   ゲーム   … src/game の中からそのまま import して使う
//   エディタ … `npm run build:rules` で tools/editor/rules.js に書き出し、
//              editor.html が <script src="rules.js"> で読み込む（グローバル変数 GameRules）
//              F4 で開くエディタには、開発サーバーがその場で作った rules.js を渡す
//
// 決まりを変えるときは、このファイルだけを直す（エディタとゲームの両方に効く）。
// ここに書く関数は、技データ（JSON）と数値だけを受け取り、DOM や時刻・乱数は使わない。
// 距離・高さは「1px＝1000」の整数（SUB）で返す。エディタは 1000 で割って px にして表示する。
// ============================================================

import type { CommandData, FrameData, HitData, HoldLevelData, MoveData, SystemData } from '../data/types.ts';

/** 1px を何単位で表すか */
export const SUB = 1000;

/** 項目が無いときの初期値（エディタの入力欄の初期値もこれを使う） */
export const DEFAULTS = {
  walkForward: 4, // px/F
  walkBack: 3, // px/F
  stepWindow: 12, // 66/44 の2回目までの受付(F)
  hitPush: 40, // ヒットバック(px)
  guardPush: 60, // ガードバック(px)
  pushFrames: 8, // 押し返しにかかる時間(F)
  chainMax: 3, // 連打キャンセルの上限(回)
  hitstop: 10, // ヒットストップ(F)
  spawnX: 150, // 飛び道具を出す位置：前へ(px)
  spawnY: 190, // 飛び道具を出す位置：高さ(px)
  hitInterval: 6, // 飛び道具が次に当たるまで(F)
  nearGap: 40, // 近距離とみなす押し合い判定のすき間(px)
  jump: { pre: 4, air: 38, land: 3, height: 450, forwardDist: 320 },
};

/** 整数の割り算（0の方向へ切り捨て） */
function idiv(a: number, b: number): number {
  return Math.trunc(a / b);
}

/** total を n 回に分けたときの i 回目（0始まり）。n 回分を足すと必ず total */
function spread(total: number, n: number, i: number): number {
  return idiv(total * (i + 1), n) - idiv(total * i, n);
}

// ---------------- コマとフレーム ----------------

/** コマの表示フレーム数（最低1） */
export function dur(f: FrameData): number {
  return Math.max(1, f.dur | 0);
}

/** 技の全体フレーム数 */
export function totalFrames(m: MoveData): number {
  return m.frames.reduce((s, f) => s + dur(f), 0);
}

/** g フレーム目（0始まり）が何コマ目か（0始まり） */
export function frameIndexAt(m: MoveData, g: number): number {
  let t = 0;
  for (let i = 0; i < m.frames.length; i++) {
    t += dur(m.frames[i]);
    if (g < t) return i;
  }
  return Math.max(0, m.frames.length - 1);
}

/** i コマ目（0始まり）が始まるフレーム（0始まり） */
export function frameStart(m: MoveData, i: number): number {
  let t = 0;
  for (let k = 0; k < i; k++) t += dur(m.frames[k]);
  return t;
}

/** 攻撃判定か投げ判定のあるコマか */
export function isActive(f: FrameData | undefined): boolean {
  return !!f && !!((f.hit && f.hit.length) || (f.throw && f.throw.length));
}

/**
 * 段（1ヒット）の一覧。攻撃判定のあるコマが続いている間は同じ段。
 * 攻撃判定のないコマを挟むか、コマの newHit（エディタの「次の段」）で次の段になる。
 * from / to はコマ番号（0始まり）、g0 はその段が始まるフレーム（0始まり）。
 */
export function hitGroups(m: MoveData): { from: number; to: number; g0: number }[] {
  const out: { from: number; to: number; g0: number }[] = [];
  let t = 0;
  let cur: { from: number; to: number; g0: number } | null = null;
  m.frames.forEach((f, i) => {
    if (isActive(f)) {
      if (!cur || f.newHit) {
        cur = { from: i, to: i, g0: t };
        out.push(cur);
      } else cur.to = i;
    } else cur = null;
    t += dur(f);
  });
  return out;
}

/**
 * 発生・持続・硬直（数え方の決まり）
 *   発生 st：最初に攻撃判定が出るフレーム（当たるフレームを含めて数える。発生5F＝5F目に当たる）
 *   持続 ac：最初の攻撃判定から最後の攻撃判定まで
 *   硬直 rc：最後の攻撃判定の後から、技の終わりまで
 * first / lastA は 0 始まりのフレーム番号。攻撃判定が無ければ st は null。
 */
export function calcFrames(m: MoveData): { tot: number; st: number | null; ac: number; rc: number; first: number; lastA: number } {
  const tot = totalFrames(m);
  let first = -1;
  let lastA = -1;
  for (let g = 0; g < tot; g++) {
    if (isActive(m.frames[frameIndexAt(m, g)])) {
      if (first < 0) first = g;
      lastA = g;
    }
  }
  if (first < 0) return { tot, st: null, ac: 0, rc: 0, first: -1, lastA: -1 };
  return { tot, st: first + 1, ac: lastA - first + 1, rc: tot - lastA - 1, first, lastA };
}

/**
 * 有利フレーム ＝ 相手の硬直 −（その段が当たった後に、自分が動けない残りフレーム）
 * ヒットストップは両者止まるので入れない。hitStart はその段の発生（1始まり）。
 */
export function advantage(tot: number, hitStart: number, stun: number): number {
  return stun - (tot - hitStart);
}

/** 後ろへ動く技か（44・後ろ移動。dist は「距離」なので向きをここで決める） */
export function isBackwardMove(id: string, m: MoveData): boolean {
  return m.cmd?.dir === '44' || m.command === '44' || id.endsWith('_back');
}

/**
 * 技中の移動を、1フレームごとの量（SUB）にする。
 *   dx：前がプラス。コマの mx を表示フレーム数で均等に割る（mx の無い移動技は dist を全体に均等に）
 *   dy：上がプラス。コマの my を表示フレーム数で均等に割る
 */
export function frameMoves(id: string, m: MoveData): { dx: number[]; dy: number[] } {
  const total = totalFrames(m);
  const hasMx = m.frames.some((f) => f.mx);
  const distSub = !hasMx && m.dist ? Math.round(m.dist * SUB) * (isBackwardMove(id, m) ? -1 : 1) : 0;
  const dx: number[] = [];
  const dy: number[] = [];
  let g = 0;
  for (const f of m.frames) {
    const d = dur(f);
    const mx = Math.round((f.mx || 0) * SUB);
    const my = Math.round((f.my || 0) * SUB);
    for (let j = 0; j < d; j++) {
      dx.push(distSub ? spread(distSub, total, g) : spread(mx, d, j));
      dy.push(spread(my, d, j));
      g++;
    }
  }
  return { dx, dy };
}

/** g フレーム目（0始まり）までに進んだ距離・上がった高さの合計（SUB、g フレーム目の分も含む） */
export function movedAt(id: string, m: MoveData, g: number): { x: number; y: number } {
  const { dx, dy } = frameMoves(id, m);
  let x = 0;
  let y = 0;
  for (let k = 0; k <= g && k < dx.length; k++) {
    x += dx[k];
    y += dy[k];
  }
  return { x, y };
}

// ---------------- 段ごとの性能 ----------------

/**
 * 段ごとの値。1段目（i=0）は技そのものの値、2段目以降は hits[i] にあればその値、無ければ1段目の値。
 * 項目が無ければ undefined（初期値は呼ぶ側で決める）。
 */
export function hitValue<T = number>(m: MoveData, i: number, k: keyof HitData): T | undefined {
  const o = i > 0 && m.hits ? m.hits[i] : undefined;
  if (o && o[k] !== undefined) return o[k] as T;
  return (m as unknown as Record<string, unknown>)[k] as T | undefined;
}

// ---------------- 押し返し・ジャンプ ----------------

/**
 * 押し返しの k フレーム目（0始まり）までに進んだ合計。
 * 最初が速く、だんだん遅くなる（重み N, N-1, …, 1）。合計は必ず total ぴったり。
 */
export function pushProgress(total: number, n: number, k: number): number {
  if (k < 0) return 0;
  if (k >= n - 1) return total;
  const S = (n * (n + 1)) / 2;
  const C = (k + 1) * n - (k * (k + 1)) / 2;
  return idiv(total * C, S);
}

export interface JumpParams {
  air: number;
  /** 最高点（SUB） */
  height: number;
}

/**
 * 踏み切ってから t フレーム目の高さ（SUB）。
 * 高さ ＝ 4 × 最高点 × t × (A − t) ÷ A²（A ＝ 滞空 + 1。t = A/2 で最高点、t = A で着地）
 */
export function jumpY(j: JumpParams, t: number): number {
  const A = j.air + 1;
  return idiv(4 * j.height * t * (A - t), A * A);
}

/** 高さ y から落ち始めるときの「踏み切ってからのフレーム」（落ちる側。最高点より上なら最高点） */
export function fallStartT(j: JumpParams, y: number): number {
  const A = j.air + 1;
  let tt = Math.ceil(A / 2);
  while (tt < A && jumpY(j, tt) > y) tt++;
  return tt;
}

// ---------------- ダメージ・コンボ補正・カウンター ----------------

/** カウンターヒット・コンボ補正の決まり（％は整数） */
export interface Rules {
  counterHitstun: number;
  counterHitstop: number;
  counterDamagePct: number;
  counterText: string;
  perMovePct: number;
  minPct: number;
}

/** システム設定から決まりを作る（小数の倍率は、ここで整数の％にする） */
export function rulesFromSystem(sys: SystemData | undefined): Rules {
  return {
    counterHitstun: sys?.counterHit?.hitstunBonus ?? 3,
    counterHitstop: sys?.counterHit?.hitstopBonus ?? 5,
    counterDamagePct: Math.round((sys?.counterHit?.damageRate ?? 1.2) * 100),
    counterText: sys?.counterHit?.showText ?? 'COUNTER',
    perMovePct: Math.round((sys?.comboScaling?.perMove ?? 0.1) * 100),
    minPct: Math.round((sys?.comboScaling?.minRate ?? 0.5) * 100),
  };
}

/** コンボの n 個目（0始まり）の技の補正（％）。技単位で数える（多段技も1つ） */
export function scalePct(r: Rules, n: number): number {
  return Math.max(r.minPct, 100 - r.perMovePct * n);
}

/** ダメージ ＝ 技のダメージ ×（溜めの％）× コンボ補正 ×（カウンターなら倍率）。端数は切り捨て */
export function calcDamage(r: Rules, base: number, holdPct: number, n: number, counter: boolean): number {
  return idiv(base * holdPct * scalePct(r, n) * (counter ? r.counterDamagePct : 100), 1_000_000);
}

/** 溜めで、待った時間 waited で届いている段階（0始まり。届いていなければ -1） */
export function holdLevelAt(levels: HoldLevelData[] | undefined, waited: number): number {
  let lv = -1;
  [...(levels || [])].sort((a, b) => (a.at | 0) - (b.at | 0)).forEach((l, i) => {
    if (waited >= (l.at | 0)) lv = i;
  });
  return lv;
}

// ---------------- コマンド ----------------

/**
 * 文字のコマンド（"2+P" "方向+S（仮）" "P（近距離）" "空中K" "66" "月回転中にP" など）を、
 * 選ぶ形（cmd）に変える。cmd の無い古いデータは、ゲームもエディタもこれで読む。
 */
export function cmdFromText(text: string, cat: string): CommandData {
  const raw = (text || '').trim();
  const note = (raw.match(/（([^）]*)）/) || [])[1] || '';
  let base = raw.replace(/（[^）]*）/g, '').trim();
  const c: CommandData = { use: 'normal', dir: 'any', buttons: '', air: false, range: '' };
  if (cat === 'projectile' || !base || /つかまれ/.test(raw)) {
    c.use = 'none';
    return c;
  }
  if (/ガード硬直中/.test(raw)) c.use = 'guard';
  else if (/ヒット時|中に/.test(raw)) c.use = 'followup';
  base = base.replace(/^.*中に/, '').replace(/^ガード硬直中に?/, '');
  if (base.startsWith('空中')) {
    c.air = true;
    base = base.slice(2);
  }
  if (base === '66' || base === '44') {
    c.dir = base;
    return c;
  }
  const tk = base.split('+').map((x) => x.trim()).filter(Boolean);
  const normalStand = cat === 'normal' && !c.air;
  if (tk[0] === '方向') c.dir = 'any';
  else if (/^[1-9]$/.test(tk[0] || '')) c.dir = tk[0] === '2' && cat === 'normal' ? 'down' : tk[0];
  else c.dir = normalStand ? 'stand' : 'any';
  c.buttons = ['P', 'K', 'S'].filter((b) => tk.includes(b)).join('+');
  if (!c.buttons) c.use = 'none';
  c.range = /近距離/.test(note) ? 'near' : /遠距離/.test(note) ? 'far' : '';
  if (cat === 'motion' && c.use !== 'none') c.use = 'none';
  return c;
}

/** 技のコマンド（cmd があればそれ、無ければ文字から作る） */
export function commandOf(m: MoveData): CommandData {
  return m.cmd ?? cmdFromText(m.command || '', m.category || 'motion');
}
