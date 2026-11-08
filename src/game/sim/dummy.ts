// ============================================================
// トレーニングのダミー（相手役）
// ------------------------------------------------------------
// 段階1の相手役。くらい・ガード・ジャンプ・ダウンだけを持つ簡単な相手で、
// コンボの数え方・補正・カウンター・押し返しを、ここで計算する。
// 段階2で本物の相手（2人目のキャラ）を作るときも、くらう側の決まりはこのファイルを元にする。
//
// ダミーの設定（トレーニングのメニュー＝数字キー8・9で切り替え）
//   mode：stand（ニュートラル・くらう）／crouch（しゃがみ・くらう）／guard（立ちガード）
//         ／crouchGuard（しゃがみガード）／jump（垂直ジャンプをくり返す）
//   counter：true なら、コンボの1つ目の技がカウンターヒットになる
// ============================================================

import type { CharDef, FrameDef, HitDef } from '../data/chardef.ts';
import type { HoldLevelData } from '../data/types.ts';
import { clamp } from '../fixed.ts';
import { calcDamage, fallStartT, jumpY, pushProgress, scalePct } from '../rules/index.ts';

// 押し返し・ダメージの式は rules（エディタと共通）。ほかのファイルからも使えるように、ここからも出す
export { calcDamage, pushProgress, scalePct };
import type { Tick } from './events.ts';
import type { DummyMode, DummyState } from './state.ts';

export const DUMMY_MODES: DummyMode[] = ['stand', 'crouch', 'guard', 'crouchGuard', 'jump'];
export const DUMMY_MODE_JP: Record<DummyMode, string> = {
  stand: 'ニュートラル（くらう）',
  crouch: 'しゃがみ（くらう）',
  guard: '立ちガード',
  crouchGuard: 'しゃがみガード',
  jump: '垂直ジャンプ',
};

/** ダウンしている時間(F)（仮。起き上がりの前に寝ている時間） */
const DOWN_FRAMES = 30;
/** コンボが終わってから、コンボ数を表示しておく時間(F) */
export const COMBO_SHOW_FRAMES = 90;

const GUARD_NOTE: Record<string, string> = { unblockable: 'ガード不能', low: '下段', overhead: '中段' };

const crouching = (d: DummyState) => d.mode === 'crouch' || d.mode === 'crouchGuard';
const guarding = (d: DummyState) => d.mode === 'guard' || d.mode === 'crouchGuard';
/** くらっている途中か（ここで当たればコンボが続く） */
export const inCombo = (d: DummyState) => d.act === 'hitstun' || d.act === 'airhit';
/** ダウン中・起き上がり中は当たらない */
export const dummyInvulnerable = (d: DummyState) => d.act === 'down' || d.act === 'getup';

function setAct(d: DummyState, act: DummyState['act']): void {
  d.act = act;
  d.actT = 0;
}

/** 技のフレーム（範囲外なら端のフレーム） */
function frameOf(def: CharDef, id: string, k: number, loop = false): FrameDef | null {
  const md = def.moves[id];
  if (!md || !md.frames.length) return null;
  if (loop) return md.frames[k % md.total];
  return md.frames[clamp(k, 0, md.total - 1)];
}

/** ダミーの今の絵と判定（キャラの技データの「くらい」「ガード」などの動作を使う） */
export function dummyFrame(def: CharDef, d: DummyState): FrameDef {
  let fr: FrameDef | null = null;
  switch (d.act) {
    case 'blockstun':
      fr = frameOf(def, crouching(d) ? 'guard_crouch' : 'guard_stand', d.actT);
      break;
    case 'hitstun':
      fr = frameOf(def, crouching(d) ? 'hit_crouch' : 'hit_stand', d.actT);
      break;
    case 'jump':
      fr = frameOf(def, 'jump', d.airT > 0 ? def.jump.pre + d.airT - 1 : d.actT);
      break;
    case 'land':
      fr = frameOf(def, 'land', d.actT);
      break;
    case 'airhit':
      fr = frameOf(def, 'hit_air', d.actT);
      break;
    case 'down':
      fr = frameOf(def, 'down', d.actT);
      break;
    case 'getup':
      fr = frameOf(def, 'getup', d.actT);
      break;
    default:
      // 何もしていないとき。ガードの設定なら構えておく
      if (d.mode === 'guard') fr = frameOf(def, 'guard_stand', 0);
      else if (d.mode === 'crouchGuard') fr = frameOf(def, 'guard_crouch', 0);
      else if (d.mode === 'crouch') fr = frameOf(def, 'crouch', d.actT, true);
      else fr = frameOf(def, 'idle', d.actT, true);
  }
  return fr ?? def.moves.idle.frames[0];
}

// ---------------- 押し返し（ヒットバック・ガードバック） ----------------

/** 当たったときに押し返しを始める（前の押し返しが残っていても、新しいものに置き換える） */
function startPushback(d: DummyState, dist: number, dir: 1 | -1, owner: number, delay: number): void {
  d.pushTotal = dist;
  d.pushFrame = 0;
  d.pushDelay = delay;
  d.pushDir = dir;
  d.pushOwner = owner;
  d.pushDone = 0;
}

/**
 * ヒットストップが明けてから pushFrames フレームかけてダミーを下げる。
 * ダミーが画面端で下がれないときは、下がれなかった分だけ攻撃した側が下がる。
 */
export function updatePushback(t: Tick): void {
  const { s, ctx } = t;
  const d = s.dummy;
  if (d.pushTotal <= 0) return;
  if (d.pushDelay > 0) {
    d.pushDelay--;
    return;
  }
  const n = ctx.def.pushFrames;
  const step = pushProgress(d.pushTotal, n, d.pushFrame) - pushProgress(d.pushTotal, n, d.pushFrame - 1);
  d.pushFrame++;
  const lo = ctx.stage.wallMargin;
  const hi = ctx.stage.width - ctx.stage.wallMargin;
  const want = d.x + d.pushDir * step;
  const nx = clamp(want, lo, hi);
  d.pushDone += Math.abs(nx - d.x);
  d.x = nx;
  const rest = Math.abs(want - nx);
  const f = d.pushOwner >= 0 ? s.fighters[d.pushOwner] : null;
  if (rest > 0 && f && !f.airborne) f.x = clamp(f.x - d.pushDir * rest, lo, hi);
  if (d.pushFrame >= n) d.pushTotal = 0;
}

// ---------------- 毎フレームの動き ----------------

export function updateDummy(t: Tick): void {
  const d = t.s.dummy;
  const def = t.ctx.def;
  const j = def.jump;
  if (d.comboShow > 0 && !inCombo(d)) d.comboShow--;
  if (d.hitstop > 0) {
    d.hitstop--;
    return;
  }
  d.actT++;
  const A = j.air + 1;
  switch (d.act) {
    case 'blockstun':
    case 'hitstun':
      d.stun--;
      if (d.stun <= 0) {
        const wasHit = d.act === 'hitstun';
        setAct(d, 'idle');
        if (wasHit) d.comboShow = COMBO_SHOW_FRAMES; // コンボ終了
      }
      break;
    case 'airhit':
      // 空中でくらった：落ちて、着地したらダウン（コンボ終了）
      d.airT++;
      if (d.airT >= A) {
        d.y = 0;
        d.airT = 0;
        setAct(d, 'down');
        d.comboShow = COMBO_SHOW_FRAMES;
      } else d.y = jumpY(j, d.airT);
      break;
    case 'jump':
      if (d.actT < j.pre) break; // 踏み切り
      d.airT++;
      if (d.airT >= A) {
        d.y = 0;
        d.airT = 0;
        setAct(d, 'land');
      } else d.y = jumpY(j, d.airT);
      break;
    case 'land':
      if (d.actT >= j.land) setAct(d, 'idle');
      break;
    case 'down':
      if (d.actT >= DOWN_FRAMES) setAct(d, 'getup');
      break;
    case 'getup':
      if (d.actT >= (def.moves.getup?.total ?? 30)) setAct(d, 'idle');
      break;
    default:
      if (d.mode === 'jump') {
        setAct(d, 'jump');
        d.airT = 0;
      }
  }
}

// ---------------- 当たったとき ----------------

export interface HitInfo {
  hd: HitDef;
  /** 溜めの段階（無ければ null） */
  level: HoldLevelData | null;
  /** 同じ技かどうかの区別（コンボ補正は「技単位」で数える） */
  key: string;
  /** 押し返す向き */
  dir: 1 | -1;
  /** 攻撃した人（飛び道具なら -1。画面端で代わりに下がる人） */
  owner: number;
}

export interface HitResult {
  guarded: boolean;
  counter: boolean;
  damage: number;
  /** 両者が止まる時間（カウンターなら長くなる） */
  stop: number;
  /** 画面に出す知らせ（「ガード不能」「COUNTER」など） */
  note?: string;
}

/** ダミーに攻撃が当たった。ガード・くらい・コンボ・ダメージ・押し返しを決める */
export function dummyTakeHit(t: Tick, info: HitInfo): HitResult {
  const d = t.s.dummy;
  const def = t.ctx.def;
  const r = def.rules;
  const hd = info.hd;
  const lv = info.level;
  const attr = lv?.guard || hd.guard || 'any';
  const air = d.y > 0;

  // ---- ガードできるか（構えていて、くらっていない・地上にいる・ガード属性が合う） ----
  const canGuardNow = guarding(d) && !air && (d.act === 'idle' || d.act === 'blockstun');
  const attrOk = attr !== 'unblockable' && !(attr === 'low' && !crouching(d)) && !(attr === 'overhead' && crouching(d));
  if (canGuardNow && attrOk) {
    setAct(d, 'blockstun');
    d.stun = hd.blockstun + (lv?.blockstun ?? 0);
    d.hitstop = hd.hitstop;
    d.lastChip = hd.chip;
    d.lastGuarded = true;
    startPushback(d, hd.guardPush, info.dir, info.owner, hd.hitstop);
    return { guarded: true, counter: false, damage: 0, stop: hd.hitstop };
  }
  let note = canGuardNow && !attrOk ? GUARD_NOTE[attr] : undefined;

  // ---- コンボ：くらっている途中に当たれば続き、そうでなければ1から ----
  const first = !inCombo(d);
  if (first) {
    d.combo = 0;
    d.comboDamage = 0;
    d.comboMoves = 0;
    d.comboKey = '';
  }
  if (info.key !== d.comboKey) {
    d.comboMoves++; // コンボ補正は技単位（多段技も1つと数える）
    d.comboKey = info.key;
  }
  const n = d.comboMoves - 1; // コンボの何個目の技か（0始まり）
  const counter = d.counter && n === 0; // カウンターはコンボの1つ目の技だけ
  const scale = scalePct(r, n);
  const damage = calcDamage(r, hd.damage, lv?.damage ?? 100, n, counter);
  d.combo++;
  d.comboDamage += damage;
  d.lastDamage = damage;
  d.lastScale = scale;
  d.comboShow = 0;
  d.lastGuarded = false;

  // カウンターの「のけぞり・ヒットストップが長くなる」は最初の1発だけ
  const bonus = counter && first;
  const stop = hd.hitstop + (bonus ? r.counterHitstop : 0);
  d.hitstop = stop;
  if (bonus) note = note ?? r.counterText;

  // ---- くらいの動き ----
  const knockdown = lv?.knockdown ?? hd.knockdown;
  if (air) {
    // 空中でくらった：その高さから落ちて、着地したらダウン
    d.airT = fallStartT(def.jump, d.y) - 1;
    setAct(d, 'airhit');
  } else if (knockdown) {
    setAct(d, 'down');
    d.comboShow = COMBO_SHOW_FRAMES; // ダウンしたらコンボ終了
  } else {
    setAct(d, 'hitstun');
    d.stun = hd.hitstun + (lv?.hitstun ?? 0) + (bonus ? r.counterHitstun : 0);
  }
  startPushback(d, hd.hitPush, info.dir, info.owner, stop);
  return { guarded: false, counter, damage, stop, note };
}
