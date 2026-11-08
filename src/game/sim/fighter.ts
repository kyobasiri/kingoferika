// ============================================================
// キャラ1人の1フレーム分の計算
// ------------------------------------------------------------
// 1フレームの流れ（毎フレーム同じ順番で行う）：
//   0. 入力を履歴に書く
//   1. ヒットストップ中なら止まる（キャンセル入力だけは受け付けて予約）
//   2. 技を1フレーム進める（終わったら立ちなどに戻る。溜め・着地硬直もここ）
//   3. ジャンプ中なら空中の位置を進める（着地もここ）
//   4. 入力を見て、新しい技・動作を始める  ← 押したフレームにすぐ反応する
//   5. 地上の移動（歩き・技中の移動。上下の移動もここ）
//   6. このフレームに入ったときの出来事（飛び道具を出す・暗転）
// 新しい技は 4 で始まった時点で「1フレーム目」として画面に出る。
// つまり「ボタンを押したフレームに、技の1コマ目が描かれる」。
// ============================================================

import type { MoveDef } from '../data/chardef.ts';
import { numpad, buttonCount } from '../input/buttons.ts';
import { SUB, spread, toSub } from '../fixed.ts';
import { findCommand, findStep, inputAt, matchEntry, pressedBetween, recordInput, type CommandCtx, type CommandResult } from './commands.ts';
import { gapX, toWorld } from './boxes.ts';
import type { FighterState } from './state.ts';
import { dummyFrame } from './dummy.ts';
import { fallStartT as fallT } from './jumpmath.ts';
import { holdLevelAt, jumpY } from '../rules/index.ts';
import type { Tick } from './events.ts';

/** 自由に動ける状態（ここからなら何でも出せる） */
export const NEUTRAL_MOVES = new Set(['idle', 'walk_forward', 'walk_back', 'crouch_start', 'crouch', 'crouch_end', 'turn']);
const CROUCHING = new Set(['crouch_start', 'crouch']);
/** 振り向きの絵を出してよい状態 */
const TURN_ANIM_FROM = new Set(['idle', 'walk_forward', 'walk_back', 'turn']);

// 飛び道具を出す位置の初期値（エディタに項目ができたら spawn.x / spawn.y を使う）
const DEFAULT_SPAWN_X = 150;
const DEFAULT_SPAWN_Y = 190;

export function moveOf(t: Tick, f: FighterState): MoveDef {
  return t.ctx.def.moves[f.move] ?? t.ctx.def.moves.idle;
}

interface StartOpts {
  chain?: number;
  /** 同時押しの上書きを許す（普通の状態から出した技） */
  upgrade?: { buttons: number; frame: number };
}

/** 技・動作を始める（1フレーム目から） */
export function startMove(t: Tick, idx: number, id: string, opts: StartOpts = {}): void {
  const f = t.s.fighters[idx];
  if (!t.ctx.def.moves[id]) id = 'idle';
  f.move = id;
  f.moveFrame = 0;
  f.moveStartedAt = t.now;
  f.hitConnected = false;
  f.guardConnected = false;
  f.groupsDone = 0;
  f.holding = false;
  f.holdDone = false;
  f.holdT = 0;
  f.holdLevel = -1;
  f.chain = opts.chain ?? 0;
  f.upgradable = !!opts.upgrade;
  if (opts.upgrade) {
    f.startButtons = opts.upgrade.buttons;
    f.startFrame = opts.upgrade.frame;
  }
  const cat = t.ctx.def.moves[id].category;
  if (cat !== 'motion') t.events.push({ type: 'moveStart', owner: idx, move: id });
}

/** 押し合い判定どうしのすき間が近距離の範囲か（ボタンを押した瞬間に判定） */
function isNear(t: Tick, f: FighterState): boolean {
  const def = t.ctx.def;
  const d = t.s.dummy;
  const fr = moveOf(t, f).frames[f.moveFrame];
  const a = toWorld(f.x, f.y, f.facing, fr?.push ?? def.standPush);
  const b = toWorld(d.x, d.y, d.facing, dummyFrame(def, d).push ?? def.standPush);
  return gapX(a, b) <= def.nearGap;
}

function commandCtx(t: Tick, f: FighterState, air: boolean, filter?: CommandCtx['filter']): CommandCtx {
  const inp = t.ctx.def.input;
  return { now: t.now, air, near: isNear(t, f), simultaneous: inp.simultaneous, buffer: inp.buffer, filter };
}

/** 技の最中に出せるもの（派生・キャンセル）を探す */
function findCancel(t: Tick, f: FighterState): CommandResult | null {
  const md = moveOf(t, f);
  const fn = f.moveFrame + 1; // 1始まりのフレーム番号
  if (md.derive && fn >= md.derive.from && fn <= md.derive.to) {
    // 派生は空振りでも出せる
    const r = findCommand(f, md.derive.entries, commandCtx(t, f, f.airborne));
    if (r) return r;
  }
  const c = md.cancel;
  if (c && fn >= c.from && fn <= c.to) {
    const connected = c.on === 'hit' ? f.hitConnected : c.on === 'hitguard' ? f.hitConnected || f.guardConnected : true;
    if (!connected) return null;
    const filter = (e: { move: string; need: string }) =>
      (e.need !== 'hit' || f.hitConnected) && (e.move !== f.move || f.chain < md.chainMax);
    return findCommand(f, c.entries, commandCtx(t, f, f.airborne, filter));
  }
  return null;
}

/** 技の最中に出す技を始める（連打キャンセルの回数も数える） */
function startCancel(t: Tick, idx: number, r: CommandResult): void {
  const f = t.s.fighters[idx];
  const chain = r.move === f.move ? f.chain + 1 : 1;
  f.consumedAt = t.now;
  startMove(t, idx, r.move, { chain });
}


/**
 * 技中の上下の移動で、技が終わったときに空中にいたら落とす。
 * ジャンプと同じ重力の放物線の、同じ高さの点から落ち始める（高さがジャンプの最高点より上なら最高点から）。
 */
function startFall(t: Tick, idx: number): void {
  const f = t.s.fighters[idx];
  f.airborne = true;
  f.airT = fallT(t.ctx.def.jump, f.y) - 1; // 次の airPhysics で +1 される
  f.jumpDir = 0;
  f.jumpFacing = f.facing;
  f.airAttackUsed = true; // 落ちている間は空中技を出さない（仮）
  startMove(t, idx, 'jump');
}

/** 技が終わったときの戻り先 */
function endMove(t: Tick, idx: number): void {
  const f = t.s.fighters[idx];
  const md = moveOf(t, f);
  if (f.airborne) {
    startMove(t, idx, 'jump');
    return;
  }
  if (f.y > 0) {
    startFall(t, idx);
    return;
  }
  const last = md.frames[md.frames.length - 1];
  if (f.move === 'crouch_start') startMove(t, idx, 'crouch');
  else if (f.move === 'crouch_end') startMove(t, idx, 'idle');
  // しゃがみ技の後は、しゃがんだまま戻る（立ち→しゃがみの移行を挟まない）
  else if (last && last.state === 'crouch') startMove(t, idx, 'crouch');
  else startMove(t, idx, 'idle');
}

/** 溜めの段階を更新する（上がったら演出に知らせる） */
function updateHoldLevel(t: Tick, idx: number): void {
  const f = t.s.fighters[idx];
  const h = moveOf(t, f).hold;
  if (!h) return;
  const lv = holdLevelAt(h.levels, f.holdT); // 段階の決め方は rules（エディタと共通）
  if (lv > f.holdLevel) {
    f.holdLevel = lv;
    t.events.push({ type: 'holdLevel', owner: idx, level: lv, x: f.x, y: -(f.y + 200 * SUB) });
  }
}

/** 2. 技を1フレーム進める */
function advance(t: Tick, idx: number, input: number): void {
  const f = t.s.fighters[idx];
  const jump = t.ctx.def.jump;
  // 空中のジャンプの絵は「踏み切ってから何フレーム目か」で決めるので、ここでは進めない
  if (f.move === 'jump' && f.airborne) return;

  // 着地硬直：着地の絵を landLag フレーム続ける（絵が足りなければ最後の絵のまま）
  if (f.move === 'land') {
    if (f.landLag > 0) {
      f.landLag--;
      f.moveFrame = Math.min(f.moveFrame + 1, moveOf(t, f).total - 1);
    } else endMove(t, idx);
    return;
  }

  // 溜め：待つ範囲の最後まで来たときにボタンが押されていれば、範囲の最初に戻って待つ
  const h = moveOf(t, f).hold;
  if (h) {
    const held = (input & h.buttons) !== 0;
    if (f.holding) {
      if (held && f.holdT < h.max) {
        f.holdT++;
        updateHoldLevel(t, idx);
        f.moveFrame = f.moveFrame >= h.end ? h.start : f.moveFrame + 1;
        return;
      }
      // 離した（または最大まで待った）：待つ範囲の次のフレームから続ける
      f.holding = false;
      f.moveFrame = h.end;
    } else if (!f.holdDone && f.moveFrame === h.end && held) {
      f.holding = true;
      f.holdDone = true;
      f.holdT = 1;
      updateHoldLevel(t, idx);
      f.moveFrame = h.start;
      return;
    }
  }

  f.moveFrame++;
  // 踏み切りが終わったら空中へ
  if (f.move === 'jump' && f.moveFrame >= jump.pre) {
    f.airborne = true;
    f.airT = 0;
    f.jumpFacing = f.facing;
    return;
  }
  const md = moveOf(t, f);
  if (f.moveFrame >= md.total) {
    if (md.loop) f.moveFrame = 0;
    else endMove(t, idx);
  }
}

/** 3. 空中の位置（放物線の式で毎フレームの位置を出す。足し算の積み重ねによる誤差が出ない） */
function airPhysics(t: Tick, idx: number): void {
  const f = t.s.fighters[idx];
  if (!f.airborne) return;
  const j = t.ctx.def.jump;
  // 空中にいるのは airT = 1〜air のフレーム。air+1 フレーム目に着地
  const A = j.air + 1;
  f.airT++;
  const dist = f.jumpDir > 0 ? j.forwardDist : f.jumpDir < 0 ? j.backDist : 0;
  f.x += f.jumpFacing * f.jumpDir * spread(dist, A, f.airT - 1);
  if (f.airT >= A) {
    // 着地。空中技の途中なら、その技の着地硬直（無ければシステム設定の着地）
    const md = moveOf(t, f);
    const lag = f.move !== 'jump' && md.landing !== null ? md.landing : j.land;
    f.y = 0;
    f.airborne = false;
    f.airT = 0;
    f.airAttackUsed = false;
    if (lag <= 0) {
      startMove(t, idx, 'idle');
      return;
    }
    startMove(t, idx, 'land');
    f.landLag = lag - 1; // 着地した今のフレームを1F目として数える
    return;
  }
  // 高さは rules の放物線の式（エディタと共通）
  f.y = jumpY(j, f.airT);
  if (f.move === 'jump') {
    const md = moveOf(t, f);
    f.moveFrame = Math.min(j.pre + f.airT - 1, md.total - 1);
  }
}

/** 4a. 自由に動ける状態での入力の判断 */
function neutralDecide(t: Tick, idx: number, dir: number): void {
  const f = t.s.fighters[idx];
  const def = t.ctx.def;
  // ① 攻撃（先行入力・同時押しを含む）
  const r = findCommand(f, def.commands, commandCtx(t, f, false));
  if (r) {
    f.consumedAt = t.now;
    startMove(t, idx, r.move, { upgrade: { buttons: r.buttons, frame: t.now } });
    return;
  }
  // ② ステップ（66 / 44）
  const st = findStep(f, t.now, def.input.stepWindow, def.input.buffer);
  const stepMove = st ? (st.dir > 0 ? def.steps.forward : def.steps.back) : null;
  if (st && stepMove) {
    f.stepConsumedAt = st.frame;
    startMove(t, idx, stepMove);
    return;
  }
  // ③ ジャンプ
  if (dir >= 7) {
    startMove(t, idx, 'jump');
    f.jumpDir = (dir - 8) as -1 | 0 | 1;
    return;
  }
  // ④ しゃがみ
  if (dir <= 3) {
    if (!CROUCHING.has(f.move)) startMove(t, idx, 'crouch_start');
    return;
  }
  // ⑤ 歩き・立ち
  if (dir === 6) {
    if (f.move !== 'walk_forward') startMove(t, idx, 'walk_forward');
  } else if (dir === 4) {
    if (f.move !== 'walk_back') startMove(t, idx, 'walk_back');
  } else if (CROUCHING.has(f.move)) {
    startMove(t, idx, 'crouch_end');
  } else if (f.move === 'walk_forward' || f.move === 'walk_back') {
    startMove(t, idx, 'idle');
  }
}

/**
 * 4b. 同時押しの上書き
 * Pを押した次のフレームにKが来たら、出始めのPを投げに切り替える。
 * 「同時押しを待ってから出す」作りにすると単発の技がいつも遅れるので、
 * 先に出しておいて、同時押しの幅の間だけ上書きを許す。
 */
function tryUpgrade(t: Tick, idx: number): boolean {
  const f = t.s.fighters[idx];
  if (!f.upgradable || f.airborne || f.hitConnected) return false;
  const def = t.ctx.def;
  const elapsed = t.now - f.startFrame;
  if (elapsed <= 0 || elapsed >= def.input.simultaneous || elapsed !== f.moveFrame) return false;
  const extra = pressedBetween(f, f.consumedAt + 1, t.now);
  if (!(extra & ~f.startButtons)) return false;
  const buttons = f.startButtons | extra;
  const dir = numpad(inputAt(f, f.startFrame), f.facing);
  const near = isNear(t, f);
  const before = matchEntry(def.commands, f.startButtons, dir, false, near);
  const after = matchEntry(def.commands, buttons, dir, false, near);
  if (!after || after.move === f.move) return false;
  if (before && buttonCount(after.buttons) <= buttonCount(before.buttons)) return false;
  f.consumedAt = t.now;
  startMove(t, idx, after.move, { upgrade: { buttons, frame: f.startFrame } });
  return true;
}

/** 4. 入力を見て、新しい技・動作を始める */
function decide(t: Tick, idx: number, input: number): void {
  const f = t.s.fighters[idx];
  const def = t.ctx.def;
  const dir = numpad(input, f.facing);

  if (f.airborne) {
    // 空中通常技（1回のジャンプで1回）
    if (f.move === 'jump' && !f.airAttackUsed) {
      const r = findCommand(f, def.commands, commandCtx(t, f, true));
      if (r) {
        f.consumedAt = t.now;
        f.airAttackUsed = true;
        startMove(t, idx, r.move);
        return;
      }
    }
    const r = findCancel(t, f);
    if (r) startCancel(t, idx, r);
    return;
  }
  if (NEUTRAL_MOVES.has(f.move)) {
    neutralDecide(t, idx, dir);
    return;
  }
  // 踏み切り中は、方向を入れ直すと前・垂直・後ろを変えられる
  if (f.move === 'jump') {
    if (dir >= 7) f.jumpDir = (dir - 8) as -1 | 0 | 1;
    return;
  }
  // 技の最中：十字キーでは動かない。同時押しの上書き → 派生・キャンセル
  if (tryUpgrade(t, idx)) return;
  const r = findCancel(t, f);
  if (r) startCancel(t, idx, r);
}

/** 5. 地上の移動 */
function groundMove(t: Tick, idx: number): void {
  const f = t.s.fighters[idx];
  if (f.airborne) return;
  const def = t.ctx.def;
  const fr = moveOf(t, f).frames[f.moveFrame];
  let dx = fr ? fr.dx : 0;
  if (f.move === 'walk_forward') dx += def.walkForward;
  else if (f.move === 'walk_back') dx -= def.walkBack;
  f.x += f.facing * dx;
  // 技中の上下の移動（地面より下には行かない）
  if (fr && fr.dy) f.y = Math.max(0, f.y + fr.dy);
}

/** 6. このフレームに入ったときの出来事 */
function frameEnter(t: Tick, idx: number): void {
  const f = t.s.fighters[idx];
  const md = moveOf(t, f);
  const fn = f.moveFrame + 1;
  const sp = md.data.spawn;
  if (sp && fn === sp.frame && t.ctx.def.moves[sp.move]) {
    // 同じ飛び道具は画面に1つまで
    if (!t.s.projectiles.some((p) => p.owner === idx && p.move === sp.move)) {
      const id = t.s.nextId++;
      t.s.projectiles.push({
        id,
        owner: idx,
        move: sp.move,
        x: f.x + f.facing * toSub(sp.x ?? DEFAULT_SPAWN_X),
        y: f.y + toSub(sp.y ?? DEFAULT_SPAWN_Y),
        facing: f.facing,
        moveFrame: 0,
        traveled: 0,
        age: 0,
        hitsLeft: t.ctx.def.moves[sp.move].projectile.hitCount,
        cooldown: 0,
      });
      t.events.push({ type: 'spawn', owner: idx, id });
    }
  }
  const sf = md.data.superFreeze;
  if (sf && fn === sf.from && sf.length > 0) {
    // 暗転：次のフレームから length フレームの間、本人以外が止まる
    t.s.freeze = sf.length;
    t.s.freezeOwner = idx;
    t.events.push({ type: 'superFreeze', owner: idx, length: sf.length });
  }
}

/** キャラ1人の1フレーム */
export function updateFighter(t: Tick, idx: number, input: number): void {
  const f = t.s.fighters[idx];
  // 0. 入力は止まっている間も履歴に書く（先行入力・コマンドのため）
  recordInput(f, t.now, input);
  if (t.frozen && t.s.freezeOwner !== idx) return;

  // 1. ヒットストップ中
  if (f.hitstop > 0) {
    f.hitstop--;
    if (!f.pendingMove) {
      const r = findCancel(t, f);
      if (r) {
        // ヒットストップが明けた最初のフレームに出す（1Fも無駄にしない）
        f.pendingMove = r.move;
        f.chain = r.move === f.move ? f.chain + 1 : 1;
        f.consumedAt = t.now;
      }
    }
    return;
  }

  // 2. 進める（予約したキャンセルがあればそれを始める）
  if (f.pendingMove) {
    const id = f.pendingMove;
    const chain = f.chain;
    f.pendingMove = '';
    startMove(t, idx, id, { chain });
  } else {
    advance(t, idx, input);
  }
  // 3. 空中
  airPhysics(t, idx);
  // 4. 入力
  decide(t, idx, input);
  // 5. 地上の移動
  groundMove(t, idx);
  // 6. 出来事
  frameEnter(t, idx);
}

/** 自由に動ける状態なら相手（段階1はダミー）の方を向く */
export function updateFacing(t: Tick, idx: number, targetX: number): void {
  const f = t.s.fighters[idx];
  if (f.airborne || !NEUTRAL_MOVES.has(f.move)) return;
  const dx = targetX - f.x;
  if (Math.abs(dx) < 1000) return; // ほぼ重なっているときは向きを変えない
  const want: 1 | -1 = dx > 0 ? 1 : -1;
  if (want === f.facing) return;
  // 仕様書：先に向きを切り替えてから「振り返り→向き直り」を再生する
  f.facing = want;
  if (TURN_ANIM_FROM.has(f.move)) startMove(t, idx, 'turn');
}
