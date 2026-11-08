// ============================================================
// エディタのJSON → ゲームで使いやすい形（CharDef）に作り替える
// ------------------------------------------------------------
// ・技のコマ（dur付き）を「1ゲームフレーム＝1要素」の配列に展開する。
//   計算側は def.moves[技].frames[今のフレーム] を見るだけで済む。
// ・コマンド（エディタで選んだ cmd。古いデータは文字のコマンド）を、判定しやすい表に変える。
// ・ここで作るものは試合中に変わらない「定義」。ゲームの状態（保存・復元するもの）とは分ける。
// ・段の数え方・移動・初期値・コマンドの読み方などの「決まり」は rules/ にあり、エディタと共通。
// DOMを使わないので、Node（決定性チェック）からも使える。
// ============================================================

import type { AtlasFile, Box, CharacterFile, CommandData, FrameStateName, HoldLevelData, InvName, MoveData } from './types.ts';
import { BTN_K, BTN_P, BTN_S, buttonCount } from '../input/buttons.ts';
import { toSub } from '../fixed.ts';
import { DEFAULTS, commandOf, frameMoves, hitGroups, hitValue, rulesFromSystem, totalFrames, type Rules } from '../rules/index.ts';

/** 1段分の性能（1段目の値に、その段だけの値を重ねたもの） */
export interface HitDef {
  damage: number;
  chip: number;
  hitstun: number;
  blockstun: number;
  hitstop: number;
  knockdown: boolean;
  guard: string;
  meterOnHit: number;
  meterOnGuard: number;
  guardDamage: number;
  /** ヒットバック・ガードバック（内部単位） */
  hitPush: number;
  guardPush: number;
}

/** 1ゲームフレーム分の情報 */
export interface FrameDef {
  /** 元のコマの番号（エディタの何コマ目か、0始まり） */
  index: number;
  /** 表示する絵（別名は解決済み） */
  sprite: string;
  state: FrameStateName;
  inv: InvName;
  hit: Box[];
  throwBoxes: Box[];
  clash: Box[];
  hurt: Box[];
  push: Box | null;
  /** このフレームで進む距離（内部単位、前がプラス） */
  dx: number;
  /** このフレームで上がる高さ（内部単位、上がプラス） */
  dy: number;
  /** 何ヒット目の攻撃判定か（攻撃判定が無ければ -1） */
  group: number;
}

/** キャンセル・派生の行き先として出せる技（入力の条件つき） */
export interface CommandEntry {
  move: string;
  /** 必要なボタン（全部押されていること） */
  buttons: number;
  /** 受け付ける方向（テンキー） */
  dirs: number[];
  air: boolean;
  /** 近距離・遠距離の指定 */
  range: 'near' | 'far' | null;
  /** 当たっていることが条件か（追加入力技の ":hit" など） */
  need: 'any' | 'hit';
  /** 大きいほど優先 */
  score: number;
}

/** 溜め（押しっぱなしで待つ） */
export interface HoldDef {
  /** 押しっぱなしにするボタン（どれか1つでも押されていれば待つ） */
  buttons: number;
  /** 繰り返すフレームの範囲（ゲームフレームの添字、両端含む） */
  start: number;
  end: number;
  /** 最大の待ち時間(F) */
  max: number;
  levels: HoldLevelData[];
}

export interface MoveDef {
  id: string;
  data: MoveData;
  category: string;
  /** 全体フレーム数 */
  total: number;
  loop: boolean;
  frames: FrameDef[];
  /** 発生（最初に攻撃判定が出るフレーム、1始まり）。無ければ null */
  startup: number | null;
  /** キャンセル受付（1始まりのフレーム） */
  cancel: { from: number; to: number; on: string; entries: CommandEntry[] } | null;
  /** 派生受付（空振りでも可） */
  derive: { from: number; to: number; entries: CommandEntry[] } | null;
  /** 段ごとの性能（添字＝FrameDef.group） */
  hits: HitDef[];
  chainMax: number;
  /** 空中技の着地硬直(F)。空中技でなければ null */
  landing: number | null;
  hold: HoldDef | null;
  /** 飛び道具の設定 */
  projectile: { range: number; life: number; hitCount: number; hitInterval: number };
}

export interface CharDef {
  id: string;
  name: string;
  hp: number;
  /** 歩く速さ（内部単位/F） */
  walkForward: number;
  walkBack: number;
  jump: { pre: number; air: number; land: number; height: number; forwardDist: number; backDist: number };
  moves: Record<string, MoveDef>;
  /** 普通の状態から出せる技の表（優先度の高い順） */
  commands: CommandEntry[];
  /** 66 / 44 で出す動作 */
  steps: { forward: string | null; back: string | null };
  input: { simultaneous: number; buffer: number; special: number; stepWindow: number };
  nearGap: number;
  /** 押し返しにかかる時間(F) */
  pushFrames: number;
  /** 立ちの押し合い判定（ダミー用） */
  standPush: Box;
  standHurt: Box[];
  /** カウンターヒット・コンボ補正（システム設定。％は整数にしてある） */
  rules: Rules;
}

const ALL_DIRS = [1, 2, 3, 4, 5, 6, 7, 8, 9];
const DOWN_DIRS = [1, 2, 3];
const STAND_DIRS = [4, 5, 6, 7, 8, 9];

/** 別名をたどって本当の絵の名前にする */
export function resolveSprite(atlas: AtlasFile, name: string): string {
  let n = name;
  for (let i = 0; i < 8; i++) {
    if (atlas.frames[n]) return n;
    const next = atlas.aliases?.[n];
    if (!next) break;
    n = next;
  }
  return n;
}

/** "P+K" "6+P+S" などのボタン部分をビットに */
function parseButtons(tokens: string[]): number {
  let b = 0;
  for (const t of tokens) {
    const v = t.trim();
    if (v === 'P') b |= BTN_P;
    else if (v === 'K') b |= BTN_K;
    else if (v === 'S') b |= BTN_S;
  }
  return b;
}

interface ParsedCommand {
  buttons: number;
  dirs: number[];
  /** 方向の指定の細かさ（2：ぴったり、1：下まとめ等、0：どれでも） */
  specificity: number;
  air: boolean;
  range: 'near' | 'far' | null;
  /** 普通の状態から単独で出せるか（追加入力技・派生技は false） */
  standalone: boolean;
  step: 'forward' | 'back' | null;
}

/** エディタで選んだコマンド（cmd）を読む */
export function parseCmd(c: CommandData): ParsedCommand | null {
  if (!c || c.use === 'none') return null;
  const standalone = c.use === 'normal';
  if (c.dir === '66' || c.dir === '44') {
    return { buttons: 0, dirs: [c.dir === '66' ? 6 : 4], specificity: 2, air: false, range: null, standalone, step: c.dir === '66' ? 'forward' : 'back' };
  }
  const buttons = parseButtons((c.buttons || '').split('+'));
  if (!buttons) return null;
  let dirs = ALL_DIRS;
  let specificity = 0;
  if (c.dir === 'stand') {
    dirs = STAND_DIRS;
    specificity = 1;
  } else if (c.dir === 'down') {
    dirs = DOWN_DIRS;
    specificity = 1;
  } else if (/^[1-9]$/.test(c.dir)) {
    dirs = [Number(c.dir)];
    specificity = 2;
  }
  return { buttons, dirs, specificity, air: !!c.air, range: c.range || null, standalone, step: null };
}

/** 技のコマンド（cmd が無い古いデータは、rules の cmdFromText で文字から作る） */
function parsedOf(m: MoveData): ParsedCommand | null {
  return parseCmd(commandOf(m));
}

/** 優先度：ボタンの数が多いほど上 → 必殺技系を通常技より上 → 方向の指定が細かいほど上 */
function scoreOf(p: ParsedCommand, category: string): number {
  const special = category === 'special' || category === 'super' || category === 'max' ? 50 : 0;
  return buttonCount(p.buttons) * 100 + special + p.specificity * 10;
}

function entryOf(move: string, p: ParsedCommand, category: string, need: 'any' | 'hit' = 'any', bonus = 0): CommandEntry {
  return { move, buttons: p.buttons, dirs: p.dirs, air: p.air, range: p.range, need, score: scoreOf(p, category) + bonus };
}

const sortEntries = (list: CommandEntry[]) => list.sort((a, b) => b.score - a.score);

// 段階1で「普通の状態から出す技」として扱う分類
// （MAX超必殺技は体力条件、ガードキャンセルはガード硬直中のみなので、段階2以降）
const STANDALONE_CATEGORIES = new Set(['normal', 'special', 'super', 'throw']);

export function buildCharDef(file: CharacterFile, atlas: AtlasFile): CharDef {
  const sys = file.system || {};
  const moves: Record<string, MoveDef> = {};
  const parsed: Record<string, ParsedCommand | null> = {};
  for (const [id, m] of Object.entries(file.moves)) parsed[id] = parsedOf(m);

  const boxesOf = (sprite: string) => file.sprites[sprite] || {};

  // ---- 1. 技ごとにフレームを展開 ----
  for (const [id, m] of Object.entries(file.moves)) {
    const frames: FrameDef[] = [];
    const total = totalFrames(m);
    // 技中の移動（1フレームごと）と段（1ヒット）の数え方は rules と共通
    const moves1 = frameMoves(id, m);
    const groups = hitGroups(m);
    const groupOf = (index: number) => groups.findIndex((gr) => index >= gr.from && index <= gr.to);
    const group = groups.length - 1;
    let g = 0;
    const frameStart: number[] = []; // コマの番号 → 最初のゲームフレーム
    m.frames.forEach((f, index) => {
      const d = Math.max(1, f.dur | 0);
      frameStart.push(g);
      const sprite = resolveSprite(atlas, f.sprite);
      const sb = boxesOf(sprite);
      const gr = groupOf(index);
      for (let j = 0; j < d; j++) {
        frames.push({
          index,
          sprite,
          state: f.state || 'stand',
          inv: f.inv || 'none',
          hit: f.hit || [],
          throwBoxes: f.throw || [],
          clash: f.clash || [],
          hurt: f.hurt || sb.hurt || [],
          push: f.push !== undefined ? f.push : sb.push ?? null,
          dx: moves1.dx[g],
          dy: moves1.dy[g],
          group: gr,
        });
        g++;
      }
    });
    frameStart.push(g);
    const firstActive = frames.findIndex((f) => f.group >= 0);

    // 段ごとの性能：1段目は技そのものの値、2段目以降は hits[i] にある項目だけ上書き（rules の hitValue）
    const hits: HitDef[] = [];
    for (let i = 0; i <= group; i++) {
      const v = <T,>(k: Parameters<typeof hitValue>[2], def: T): T => hitValue<T>(m, i, k) ?? def;
      hits.push({
        damage: v('damage', 0),
        chip: v('chip', 0),
        hitstun: v('hitstun', 0),
        blockstun: v('blockstun', 0),
        hitstop: v('hitstop', DEFAULTS.hitstop),
        knockdown: v('knockdown', false),
        guard: v('guard', 'any'),
        meterOnHit: v('meterOnHit', 0),
        meterOnGuard: v('meterOnGuard', 0),
        guardDamage: v('guardDamage', 0),
        hitPush: toSub(v('hitPush', DEFAULTS.hitPush)),
        guardPush: toSub(v('guardPush', DEFAULTS.guardPush)),
      });
    }

    // 溜め：コマの番号（1始まり）をゲームフレームの範囲に直す
    let hold: HoldDef | null = null;
    if (m.hold && m.frames.length) {
      const h = m.hold;
      const from = Math.min(Math.max(1, h.from | 0), m.frames.length);
      const to = Math.min(Math.max(from, h.to | 0), m.frames.length);
      // 'any' はコマンドのボタンのどれか（無ければS）
      const btn = h.button === 'any' ? parsed[id]?.buttons || BTN_S : parseButtons([h.button]) || BTN_S;
      hold = {
        buttons: btn,
        start: frameStart[from - 1],
        end: frameStart[to] - 1,
        max: Math.max(1, h.max | 0),
        levels: [...(h.levels || [])].sort((a, b) => (a.at | 0) - (b.at | 0)),
      };
    }

    moves[id] = {
      id,
      data: m,
      category: m.category,
      total,
      loop: !!m.loop,
      frames,
      startup: firstActive >= 0 ? firstActive + 1 : null,
      cancel: null,
      derive: null,
      hits,
      // 連打キャンセルの上限。未設定ならエディタの表示と同じ3回
      chainMax: m.chainMax ?? DEFAULTS.chainMax,
      landing: parsed[id]?.air ? (m.landing ?? sys.jump?.land ?? DEFAULTS.jump.land) : null,
      hold,
      projectile: {
        range: toSub(m.range || 0),
        life: m.life || 0,
        hitCount: Math.max(1, m.hitCount || 1),
        hitInterval: Math.max(1, m.hitInterval ?? DEFAULTS.hitInterval),
      },
    };
  }

  // 立ち上がり（しゃがみ→立ち）は、しゃがみ移行と同じ絵を使う（仕様書：同じ1枚を使う）
  if (moves.crouch_start && !moves.crouch_end) {
    moves.crouch_end = { ...moves.crouch_start, id: 'crouch_end' };
  }

  // ---- 2. 普通の状態から出せる技の表と、66/44 ----
  const commands: CommandEntry[] = [];
  const steps: CharDef['steps'] = { forward: null, back: null };
  for (const [id, m] of Object.entries(file.moves)) {
    const p = parsed[id];
    if (!p || !p.standalone) continue;
    if (p.step) {
      // ステップは「動作」の技だけ（ガードキャンセル移動は段階2で）
      if (m.category === 'motion' && !steps[p.step]) steps[p.step] = id;
      continue;
    }
    if (STANDALONE_CATEGORIES.has(m.category)) commands.push(entryOf(id, p, m.category));
  }
  sortEntries(commands);

  // ---- 3. キャンセル先・派生先 ----
  const categoryEntries = (cat: string) => commands.filter((e) => file.moves[e.move]?.category === cat);
  for (const md of Object.values(moves)) {
    const m = md.data;
    if (m.cancel && m.cancel.length) {
      const entries: CommandEntry[] = [];
      for (const t of m.cancel) {
        const [target, cond] = t.split(':');
        if (target === 'special' || target === 'super' || target === 'max') {
          entries.push(...categoryEntries(target).map((e) => ({ ...e })));
          continue;
        }
        const need: CommandEntry['need'] = cond === 'hit' ? 'hit' : 'any';
        const own = commands.filter((e) => e.move === target);
        if (own.length) {
          // 普通に出せる技（小足の連打など）は、その技のコマンドで受け付ける
          entries.push(...own.map((e) => ({ ...e, need, score: e.score + 1000 })));
        } else {
          // 追加入力技（キャンセル・派生でだけ出す技）は、ボタンだけで受け付ける
          const p = parsed[target];
          const cat = file.moves[target]?.category || 'normal';
          if (p && !p.step) entries.push(entryOf(target, { ...p, dirs: ALL_DIRS, specificity: 0 }, cat, need, 1000));
        }
      }
      // 受付の初期値は「持続の最初から硬直の最初4Fまで」
      const lastActive = md.frames.reduce((a, f, i) => (f.group >= 0 ? i : a), -1);
      const w = m.cancelWindow;
      md.cancel = {
        from: w?.from ?? (md.startup ?? 1),
        to: w?.to ?? lastActive + 1 + 4,
        on: w?.on ?? 'hitguard',
        entries: sortEntries(entries),
      };
    }
    if (m.derive && m.derive.length) {
      const entries: CommandEntry[] = [];
      for (const t of m.derive) {
        const [target, btn] = t.split(':');
        if (!moves[target]) continue;
        const buttons = parseButtons((btn || '').split('+'));
        if (!buttons) continue;
        entries.push({ move: target, buttons, dirs: ALL_DIRS, air: false, range: null, need: 'any', score: buttonCount(buttons) * 100 + 1000 });
      }
      md.derive = {
        from: m.deriveWindow?.from ?? 1,
        to: m.deriveWindow?.to ?? md.total,
        entries: sortEntries(entries),
      };
    }
  }

  // ---- 4. キャラの数値（キャラ設定 → 無ければシステム設定 → 無ければ初期値） ----
  const j = sys.jump || {};
  const idle = moves.idle?.frames[0];
  const ch = file.character;
  const J = DEFAULTS.jump;
  const fwd = ch.jumpForward ?? j.forwardDist ?? J.forwardDist;
  return {
    id: ch.id,
    name: ch.name,
    hp: ch.hp ?? 1000,
    walkForward: toSub(ch.walkForward ?? DEFAULTS.walkForward),
    walkBack: toSub(ch.walkBack ?? DEFAULTS.walkBack),
    jump: {
      pre: j.pre ?? J.pre,
      air: ch.jumpAir ?? j.air ?? J.air,
      land: j.land ?? J.land,
      height: toSub(ch.jumpHeight ?? j.height ?? J.height),
      forwardDist: toSub(fwd),
      backDist: toSub(ch.jumpBack ?? j.backDist ?? fwd),
    },
    moves,
    commands,
    steps,
    input: {
      simultaneous: sys.input?.simultaneousWindow ?? 3,
      buffer: sys.input?.buffer ?? 8,
      special: sys.input?.specialWindow ?? 10,
      stepWindow: sys.input?.stepWindow ?? DEFAULTS.stepWindow,
    },
    nearGap: toSub(sys.nearRange?.gap ?? DEFAULTS.nearGap),
    pushFrames: Math.max(1, sys.pushback?.pushFrames ?? DEFAULTS.pushFrames),
    standPush: idle?.push ?? [-40, -280, 80, 280],
    standHurt: idle?.hurt ?? [],
    rules: rulesFromSystem(sys),
  };
}

/** 技の「何F目」（1始まり）を表示用に */
export function frameLabel(md: MoveDef, moveFrame: number): string {
  return `${moveFrame + 1}/${md.total}F`;
}
