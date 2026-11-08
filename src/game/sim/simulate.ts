// ============================================================
// ゲーム全体の1フレーム（計算の入口）
// ------------------------------------------------------------
//   step(状態, 全員の入力, 定義) → 演出への知らせ
// この関数は「状態を1フレーム進める」以外のことをしない。
// 画面・時刻・乱数（Math.random）・キーボードには一切触らない。
// だから、同じ状態から同じ入力を与えれば、何度やっても同じ結果になる。
// （リプレイ・トレモの巻き戻し・ロールバック対戦の土台）
// ============================================================

import { SUB, clamp } from '../fixed.ts';
import { overlapCenter, overlaps, toWorld } from './boxes.ts';
import { moveOf, updateFacing, updateFighter } from './fighter.ts';
import { dummyFrame, dummyInvulnerable, dummyTakeHit, updateDummy, updatePushback } from './dummy.ts';
import type { SimContext, SimEvent, Tick } from './events.ts';
import type { GameState } from './state.ts';

export { pushProgress } from './dummy.ts';

export function step(s: GameState, inputs: number[], ctx: SimContext): SimEvent[] {
  s.frame++;
  // 暗転は「次のフレームから」本人以外を止める
  const frozen = s.freeze > 0;
  if (frozen) s.freeze--;
  const t: Tick = { s, ctx, now: s.frame, frozen, events: [] };

  for (let i = 0; i < s.fighters.length; i++) updateFighter(t, i, inputs[i] ?? 0);
  if (!frozen) {
    updateProjectiles(t);
    updateDummy(t);
    updatePushback(t);
  }
  resolvePush(t);
  for (let i = 0; i < s.fighters.length; i++) updateFacing(t, i, s.dummy.x);
  // ダミーは地上で動けるときだけ向きを変える
  if (s.dummy.y === 0 && s.dummy.act === 'idle') s.dummy.facing = s.fighters[0].x >= s.dummy.x ? 1 : -1;
  checkHits(t);
  if (!frozen && s.dummy.flash > 0) s.dummy.flash--;
  if (!frozen && s.freeze === 0) s.freezeOwner = -1;
  return t.events;
}

/** 飛び道具を進める。届く距離・消えるまでの時間を過ぎたか、ステージの外に出たら消す */
function updateProjectiles(t: Tick): void {
  const { s, ctx } = t;
  const margin = 300 * SUB;
  s.projectiles = s.projectiles.filter((p) => {
    const md = ctx.def.moves[p.move];
    if (!md) return false;
    p.moveFrame = md.loop ? (p.moveFrame + 1) % md.total : Math.min(p.moveFrame + 1, md.total - 1);
    const v = (md.data.speed ?? 0) * SUB;
    p.x += p.facing * v;
    p.traveled += Math.abs(v);
    p.age++;
    if (p.cooldown > 0) p.cooldown--;
    const pr = md.projectile;
    if (pr.range > 0 && p.traveled >= pr.range) return false;
    if (pr.life > 0 && p.age >= pr.life) return false;
    return p.x > -margin && p.x < ctx.stage.width + margin;
  });
}

/**
 * 押し合い：両者の押し合い判定が重なったら、半分ずつ離す。
 * 画面端で片方が下がれないときは、残りの分をもう片方が下がる。
 * どちらかに押し合い判定が無いコマならすり抜ける。上下に離れていれば重ならない（飛び越えられる）。
 */
function resolvePush(t: Tick): void {
  const { s, ctx } = t;
  const f = s.fighters[0];
  const d = s.dummy;
  const st = ctx.stage;
  const lo = st.wallMargin;
  const hi = st.width - st.wallMargin;
  const fr = moveOf(t, f).frames[f.moveFrame];
  const dp = dummyFrame(ctx.def, d).push;
  if (fr && fr.push && dp) {
    const a = toWorld(f.x, f.y, f.facing, fr.push);
    const b = toWorld(d.x, d.y, d.facing, dp);
    if (overlaps(a, b)) {
      const ov = Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1);
      // どちらが左か（同じ位置なら向きで決める）
      const fLeft = f.x < d.x || (f.x === d.x && f.facing === 1);
      const sign = fLeft ? -1 : 1;
      const half = Math.trunc(ov / 2);
      let fx = f.x + sign * (ov - half);
      let dx = d.x - sign * half;
      // 画面端で止まった分は相手側に回す
      const dClamped = clamp(dx, lo, hi);
      fx += dClamped - dx;
      dx = dClamped;
      const fClamped = clamp(fx, lo, hi);
      dx += fClamped - fx;
      f.x = fClamped;
      d.x = clamp(dx, lo, hi);
    }
  }
  // ステージの外・画面の外には出られない（2人の距離は見える範囲まで）
  f.x = clamp(f.x, lo, hi);
  const maxDist = st.viewWidth * SUB - st.wallMargin * 2;
  f.x = clamp(f.x, d.x - maxDist, d.x + maxDist);
}

/** 攻撃判定とダミーのくらい判定の重なり。当たったらダミー側の処理（dummy.ts）に渡す */
function checkHits(t: Tick): void {
  const { s, ctx } = t;
  const d = s.dummy;
  const hurtNow = () =>
    dummyInvulnerable(d) ? [] : dummyFrame(ctx.def, d).hurt.map((b) => toWorld(d.x, d.y, d.facing, b));

  for (let i = 0; i < s.fighters.length; i++) {
    const f = s.fighters[i];
    if (t.frozen && s.freezeOwner !== i) continue;
    const md = moveOf(t, f);
    const fr = md.frames[f.moveFrame];
    if (!fr || fr.group < 0 || !fr.hit.length) continue; // 投げ判定は段階2で
    const bit = 1 << fr.group;
    if (f.groupsDone & bit) continue; // このヒットは当て済み
    const hurt = hurtNow();
    let hitAt: { x: number; y: number } | null = null;
    for (const hb of fr.hit) {
      const a = toWorld(f.x, f.y, f.facing, hb);
      for (const b of hurt) if (overlaps(a, b)) hitAt = overlapCenter(a, b);
      if (hitAt) break;
    }
    if (!hitAt) continue;
    // 当たった段の性能（2回以上当たる技は段ごとに違う）と、溜めの段階
    const hd = md.hits[fr.group];
    const level = md.hold && f.holdLevel >= 0 ? md.hold.levels[f.holdLevel] : null;
    const r = dummyTakeHit(t, { hd, level, key: `f${i}:${f.moveStartedAt}`, dir: f.facing, owner: i });
    f.groupsDone |= bit;
    // ガードされたら「ガードされた」扱い（ヒット時のみのキャンセルは出せない）
    if (r.guarded) f.guardConnected = true;
    else f.hitConnected = true;
    f.hitstop = r.stop;
    d.flash = r.stop + 4;
    d.hits++;
    t.events.push({ type: 'hit', owner: i, x: hitAt.x, y: hitAt.y, power: r.stop, guard: r.guarded, counter: r.counter, damage: r.damage, note: r.note });
  }

  if (t.frozen) return;
  s.projectiles = s.projectiles.filter((p) => {
    const md = ctx.def.moves[p.move];
    const fr = md?.frames[p.moveFrame];
    if (!fr || p.cooldown > 0 || fr.group < 0) return true;
    const hurt = hurtNow();
    for (const hb of fr.hit) {
      const a = toWorld(p.x, p.y, p.facing, hb);
      for (const b of hurt) {
        if (!overlaps(a, b)) continue;
        const c = overlapCenter(a, b);
        // 飛び道具の押し返しは、画面端でも撃った人は下がらない（owner = -1）
        const r = dummyTakeHit(t, { hd: md.hits[fr.group], level: null, key: `p${p.id}`, dir: p.facing, owner: -1 });
        d.flash = r.stop + 4;
        d.hits++;
        t.events.push({ type: 'hit', owner: p.owner, x: c.x, y: c.y, power: r.stop, guard: r.guarded, counter: r.counter, damage: r.damage, note: r.note });
        // 当たる回数が残っていれば、間隔をあけてもう一度当たる。残っていなければ消える
        p.hitsLeft--;
        if (p.hitsLeft > 0) {
          p.cooldown = md.projectile.hitInterval;
          return true;
        }
        return false;
      }
    }
    return true;
  });
}
