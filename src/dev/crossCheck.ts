// ============================================================
// エディタとゲームの「計算の照合」（開発用）
// ------------------------------------------------------------
// エディタ（editor.html の JavaScript）とゲーム（src/game の TypeScript）は、
// 発生・段の数え方・ダメージ・押し返し・ジャンプの高さを、同じ決まりで別々に計算している。
// 片方だけ直すと「エディタではつながるのに、ゲームではつながらない」が起きるので、
// F4 でエディタから戻るたびに、両方の答えを比べて食い違いを知らせる。
// ============================================================

import type { CharDef } from '../game/data/chardef.ts';
import { calcDamage, pushProgress, scalePct } from '../game/sim/dummy.ts';
import { jumpY } from '../game/sim/jumpmath.ts';
import { SUB } from '../game/fixed.ts';

/** エディタの editorFacts() が返すもの */
export interface EditorFacts {
  moves: Record<string, { total: number; startup: number | null; hitStarts: number[]; chainMax: number; damage: number[][]; counterDamage: number[] }>;
  /** 押し返し 40/60/100px の、各フレームまでに進んだ距離(px) */
  push: number[][];
  /** ジャンプの高さ(px)。添字＝踏み切ってからのフレーム */
  jump: number[];
  /** コンボ補正（％）。添字＝何個目の技か */
  scale: number[];
}

/** 食い違いの一覧（無ければ空） */
export function crossCheck(def: CharDef, ef: EditorFacts): string[] {
  const out: string[] = [];
  for (const [id, e] of Object.entries(ef.moves)) {
    const md = def.moves[id];
    if (!md) {
      out.push(`${id}：ゲームに技がない`);
      continue;
    }
    if (md.total !== e.total) out.push(`${id}：全体 エディタ${e.total}F／ゲーム${md.total}F`);
    if ((md.startup ?? null) !== e.startup) out.push(`${id}：発生 エディタ${e.startup}F／ゲーム${md.startup}F`);
    // 段の始まり（ゲームは FrameDef.group の切り替わり）
    const starts: number[] = [];
    md.frames.forEach((f, i) => {
      if (f.group >= 0 && (i === 0 || md.frames[i - 1].group !== f.group)) starts.push(i + 1);
    });
    if (starts.join(',') !== e.hitStarts.join(',')) out.push(`${id}：段の始まり エディタ[${e.hitStarts}]／ゲーム[${starts}]`);
    if (md.chainMax !== e.chainMax) out.push(`${id}：連打の上限 エディタ${e.chainMax}／ゲーム${md.chainMax}`);
    md.hits.forEach((h, i) => {
      [0, 1, 2].forEach((n) => {
        const g = calcDamage(def.rules, h.damage, 100, n, false);
        if (e.damage[i] && g !== e.damage[i][n]) out.push(`${id}：${i + 1}段目・${n + 1}つ目のダメージ エディタ${e.damage[i][n]}／ゲーム${g}`);
      });
      const gc = calcDamage(def.rules, h.damage, 100, 0, true);
      if (e.counterDamage[i] !== undefined && gc !== e.counterDamage[i]) out.push(`${id}：${i + 1}段目のカウンターダメージ エディタ${e.counterDamage[i]}／ゲーム${gc}`);
    });
  }
  // 押し返し：ゲームは 1px＝1000 で計算しているので、1px までの差は丸めの違いとして許す
  [40, 60, 100].forEach((t, ti) => {
    (ef.push[ti] || []).forEach((v, k) => {
      const g = pushProgress(t * SUB, def.pushFrames, k) / SUB;
      if (Math.abs(g - v) > 1) out.push(`押し返し${t}px の${k + 1}F目 エディタ${v}px／ゲーム${g.toFixed(1)}px`);
    });
  });
  ef.jump.forEach((v, k) => {
    const g = jumpY(def.jump, k) / SUB;
    if (Math.abs(g - v) > 1) out.push(`ジャンプ${k}F目の高さ エディタ${v}px／ゲーム${g.toFixed(1)}px`);
  });
  ef.scale.forEach((v, n) => {
    const g = scalePct(def.rules, n);
    if (g !== v) out.push(`コンボ補正 ${n + 1}つ目 エディタ${v}%／ゲーム${g}%`);
  });
  return out;
}
