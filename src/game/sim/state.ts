// ============================================================
// ゲームの状態（保存・復元するもの全部）
// ------------------------------------------------------------
// 決まりごと：
// ・中身は数値・文字列・真偽値・配列・素のオブジェクトだけにする（クラスや関数は入れない）。
//   → structuredClone で丸ごとコピーでき、そのまま保存・復元（巻き戻し）できる。
// ・位置などは整数（1px＝1000）。
// ・試合中に変わらないもの（技データなど）はここに入れない（CharDef 側）。
// ============================================================

import { SUB } from '../fixed.ts';

/** 入力履歴の長さ（フレーム）。必殺技コマンドや先行入力を見るのに使う */
export const HIST_LEN = 64;

export interface FighterState {
  /** 足元の位置（内部単位）。y は地面が0で上がプラス */
  x: number;
  y: number;
  /** 1＝右向き、-1＝左向き */
  facing: 1 | -1;

  /** 今の技（動作）のID と、その何フレーム目か（0始まり） */
  move: string;
  moveFrame: number;
  /** 今の技を始めたフレーム番号（表示・遅延の計測用） */
  moveStartedAt: number;

  // ---- ジャンプ ----
  airborne: boolean;
  /** 踏み切ってから何フレーム目か（1始まり） */
  airT: number;
  /** -1＝後ろ、0＝垂直、1＝前（踏み切った瞬間の向き基準） */
  jumpDir: -1 | 0 | 1;
  /** 踏み切ったときの向き（空中で向きは変わらない） */
  jumpFacing: 1 | -1;
  airAttackUsed: boolean;
  /** 着地硬直の残り（着地の絵を何フレーム続けるか） */
  landLag: number;

  // ---- 溜め（押しっぱなしで待つ） ----
  /** 今、待っているか */
  holding: boolean;
  /** この技で溜めを使い終えたか（1回の技で1回だけ） */
  holdDone: boolean;
  /** 待った時間(F) */
  holdT: number;
  /** 到達した段階（0始まり。届いていなければ -1） */
  holdLevel: number;

  // ---- 攻撃 ----
  /** ヒットストップの残り（この間は技が進まない） */
  hitstop: number;
  /** 今の技が当たった／ガードされた */
  hitConnected: boolean;
  guardConnected: boolean;
  /** 当て終わったヒットの印（ビット） */
  groupsDone: number;
  /** 同じ技を連打キャンセルした回数 */
  chain: number;
  /** ヒットストップが明けたら出す技（無ければ空文字） */
  pendingMove: string;

  // ---- 入力 ----
  /** 入力履歴（リングバッファ）。添字＝フレーム番号 % HIST_LEN */
  hist: number[];
  /** このフレーム番号までのボタン押しは使用済み（同じ押しで2回技を出さない） */
  consumedAt: number;
  /** 66/44 に使った入力のフレーム番号 */
  stepConsumedAt: number;
  /** 同時押しの上書き用：技を出したときのボタンとフレーム */
  startButtons: number;
  startFrame: number;
  /** 同時押しの上書きをしてよい技か（普通の状態から出した技だけ） */
  upgradable: boolean;
}

export interface ProjectileState {
  id: number;
  owner: number;
  move: string;
  /** 中心の位置（内部単位） */
  x: number;
  y: number;
  facing: 1 | -1;
  moveFrame: number;
  /** 進んだ距離（内部単位）と、出てからのフレーム数 */
  traveled: number;
  age: number;
  /** あと何回当たれるか／次に当たれるまでの待ち */
  hitsLeft: number;
  cooldown: number;
}

/** ダミーの設定（トレーニングのメニュー） */
export type DummyMode = 'stand' | 'crouch' | 'guard' | 'crouchGuard' | 'jump';
/** ダミーが今していること */
export type DummyAct = 'idle' | 'blockstun' | 'hitstun' | 'jump' | 'land' | 'airhit' | 'down' | 'getup';

/** 段階1の練習用ダミー（相手役）。動きは sim/dummy.ts */
export interface DummyState {
  x: number;
  /** 足元の高さ（内部単位、上がプラス） */
  y: number;
  facing: 1 | -1;
  /** 当たったときに光らせる残りフレーム */
  flash: number;
  /** 当てた回数（ヒット・ガード合計） */
  hits: number;

  // ---- 設定 ----
  mode: DummyMode;
  /** コンボの1つ目の技をカウンターヒットにする */
  counter: boolean;

  // ---- 動き ----
  act: DummyAct;
  /** 今の動きを始めてから何フレームか */
  actT: number;
  /** のけぞり・ガード硬直の残り */
  stun: number;
  /** ヒットストップの残り */
  hitstop: number;
  /** ジャンプ・空中くらいの「踏み切ってからのフレーム」 */
  airT: number;

  // ---- コンボ ----
  /** 今の（または最後の）コンボのヒット数と合計ダメージ */
  combo: number;
  comboDamage: number;
  /** コンボに入った技の数（補正は技単位）と、最後の技の区別 */
  comboMoves: number;
  comboKey: string;
  /** コンボが終わってから表示しておく残りフレーム */
  comboShow: number;
  /** 最後の1発のダメージと補正（％） */
  lastDamage: number;
  lastScale: number;
  /** 最後にガードしたときの削りダメージ */
  lastChip: number;

  // ---- 押し返し（ヒットバック・ガードバック）----
  /** 押し返す距離の合計（内部単位）。0なら押し返し中ではない */
  pushTotal: number;
  /** 何フレーム押し返したか */
  pushFrame: number;
  /** 押し返しを始めるまでの待ち（＝ヒットストップの間） */
  pushDelay: number;
  /** 押し返す向き（1＝右へ下がる） */
  pushDir: 1 | -1;
  /** 押した人（画面端で代わりに下がる人）。飛び道具なら -1 */
  pushOwner: number;
  /** 今回の押し返しで実際に下がった距離（表示用） */
  pushDone: number;
  /** 最後に受けた攻撃をガードできたか（表示用） */
  lastGuarded: boolean;
}

export interface GameState {
  /** 今が何フレーム目か（0から数える） */
  frame: number;
  /** 乱数の種（使うときは rng.ts の関数で進める）。段階1では未使用 */
  rng: number;
  /** 暗転の残りフレームと、暗転させた人 */
  freeze: number;
  freezeOwner: number;
  nextId: number;
  fighters: FighterState[];
  dummy: DummyState;
  projectiles: ProjectileState[];
}

/** ステージの大きさ（試合中に変わらない設定） */
export interface StageConfig {
  /** 見える範囲（px）。高さ1000に対して16:9 */
  viewWidth: number;
  viewHeight: number;
  /** ステージ全体の幅＝見える範囲の2倍（内部単位） */
  width: number;
  /** 画面端から何px内側までしか行けないか（内部単位） */
  wallMargin: number;
  /** 画面下から地面までの高さ（px） */
  groundFromBottom: number;
}

export function defaultStage(): StageConfig {
  const viewHeight = 1000;
  const viewWidth = Math.round((viewHeight * 16) / 9); // 1778
  return {
    viewWidth,
    viewHeight,
    width: viewWidth * 2 * SUB,
    wallMargin: 60 * SUB,
    groundFromBottom: 100,
  };
}

function newFighter(x: number, facing: 1 | -1): FighterState {
  return {
    x,
    y: 0,
    facing,
    move: 'idle',
    moveFrame: 0,
    moveStartedAt: 0,
    airborne: false,
    airT: 0,
    jumpDir: 0,
    jumpFacing: facing,
    airAttackUsed: false,
    landLag: 0,
    holding: false,
    holdDone: false,
    holdT: 0,
    holdLevel: -1,
    hitstop: 0,
    hitConnected: false,
    guardConnected: false,
    groupsDone: 0,
    chain: 0,
    pendingMove: '',
    hist: new Array<number>(HIST_LEN).fill(0),
    consumedAt: -1,
    stepConsumedAt: -1,
    startButtons: 0,
    startFrame: -1,
    upgradable: false,
  };
}

/** 試合開始時の状態。ステージの真ん中を挟んで向かい合う */
export function createInitialState(stage: StageConfig): GameState {
  const center = stage.width / 2;
  const half = 250 * SUB;
  return {
    frame: 0,
    rng: 0x12345678,
    freeze: 0,
    freezeOwner: -1,
    nextId: 1,
    fighters: [newFighter(center - half, 1)],
    dummy: {
      x: center + half,
      y: 0,
      facing: -1,
      flash: 0,
      hits: 0,
      mode: 'stand',
      counter: false,
      act: 'idle',
      actT: 0,
      stun: 0,
      hitstop: 0,
      airT: 0,
      combo: 0,
      comboDamage: 0,
      comboMoves: 0,
      comboKey: '',
      comboShow: 0,
      lastDamage: 0,
      lastScale: 100,
      lastChip: 0,
      pushTotal: 0,
      pushFrame: 0,
      pushDelay: 0,
      pushDir: 1,
      pushOwner: -1,
      pushDone: 0,
      lastGuarded: false,
    },
    projectiles: [],
  };
}

/** 状態を丸ごとコピー（保存・巻き戻し用） */
export function cloneState(s: GameState): GameState {
  return structuredClone(s);
}

/** 状態の指紋（同じ状態なら必ず同じ値）。決定性チェックに使う */
export function hashState(s: GameState): string {
  const text = JSON.stringify(s);
  // FNV-1a（32bit）
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}
