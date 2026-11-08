// ============================================================
// エディタが書き出すJSONの形（読み込む側の型）
// ------------------------------------------------------------
// moon_erika.all.json（キャラ＋システム）と atlas.json の形をそのまま書いたもの。
// エディタ側で項目が増えても壊れないよう、使う項目だけを型にしている。
// ============================================================

/** 判定の箱 [x, y, 幅, 高さ]。足元の基準点からの相対位置・右向き基準（yは上がマイナス） */
export type Box = [number, number, number, number];

export type FrameStateName = 'stand' | 'crouch' | 'air' | 'down';
export type InvName = 'none' | 'full' | 'strike' | 'throw';

/** 技の1コマ（表示フレーム数 dur の間、同じ絵を出す） */
export interface FrameData {
  sprite: string;
  dur: number;
  state?: FrameStateName;
  inv?: InvName;
  hit?: Box[];
  throw?: Box[];
  clash?: Box[];
  /** コマ固有のくらい判定（エディタの「コマごと」形式のとき） */
  hurt?: Box[];
  push?: Box | null;
  /** このコマで進む距離(px)。前がプラス */
  mx?: number;
  /** ここから新しいヒットとして数える */
  newHit?: boolean;
  /** このコマで上がる高さ(px)。上がプラス */
  my?: number;
  phase?: string;
}

/** 段ごとの性能。2段目以降で「1段目（技そのものの値）と違う項目」だけを持つ */
export interface HitData {
  damage?: number;
  chip?: number;
  hitstun?: number;
  blockstun?: number;
  hitstop?: number;
  knockdown?: boolean;
  guard?: string;
  meterOnHit?: number;
  meterOnGuard?: number;
  guardDamage?: number;
  /** ヒットバック・ガードバック：当たった相手が下がる距離(px) */
  hitPush?: number;
  guardPush?: number;
}

/** 選ぶ形のコマンド（エディタ v21 から） */
export interface CommandData {
  /** normal：普通に出せる／followup：キャンセル・派生でだけ／guard：ガード中／none：コマンドなし */
  use: 'normal' | 'followup' | 'guard' | 'none';
  /** any／stand（下以外）／down（1・2・3）／'1'〜'9'／'66'／'44' */
  dir: string;
  /** "P" "P+K" など。無ければ空 */
  buttons: string;
  air: boolean;
  range: '' | 'near' | 'far';
}

/** 溜めの段階ごとの効果 */
export interface HoldLevelData {
  /** 待った時間がこれ以上なら（F） */
  at: number;
  /** ダメージ(%) */
  damage?: number;
  hitstun?: number;
  blockstun?: number;
  guard?: string;
  knockdown?: boolean;
}

/** 溜め：押しっぱなしで、コマ from〜to を繰り返して待つ */
export interface HoldData {
  /** 'P' 'K' 'S' または 'any'（コマンドのボタンのどれか） */
  button: string;
  /** 繰り返すコマの番号（1始まり） */
  from: number;
  to: number;
  /** 最大の待ち時間(F) */
  max: number;
  levels?: HoldLevelData[];
}

export interface MoveData {
  label?: string;
  cmd?: CommandData;
  /** 空中技の着地硬直(F) */
  landing?: number;
  hold?: HoldData;
  /** 飛び道具：届く距離(px)・消えるまで(F)・当たる回数・次に当たるまでの間隔(F) */
  range?: number;
  life?: number;
  hitCount?: number;
  hitInterval?: number;
  category: string; // motion / normal / special / super / max / throw / projectile / guard_cancel
  command?: string;
  frames: FrameData[];
  loop?: boolean;
  damage?: number;
  hitstun?: number;
  blockstun?: number;
  hitstop?: number;
  knockdown?: boolean;
  guard?: string;
  cancel?: string[];
  cancelWindow?: { from: number; to: number; on?: string };
  derive?: string[];
  deriveWindow?: { from: number; to: number };
  chainMax?: number;
  spawn?: { move: string; frame: number; x?: number; y?: number };
  speed?: number;
  superFreeze?: { from: number; length: number };
  dist?: number;
  afterimage?: boolean;
  /** 段ごとの性能（エディタ v19 から）。添字＝何段目か（0始まり） */
  hits?: HitData[];
  chip?: number;
  meterOnHit?: number;
  meterOnGuard?: number;
  guardDamage?: number;
  hitPush?: number;
  guardPush?: number;
}

export interface SpriteBoxes {
  hurt?: Box[];
  push?: Box | null;
  /** エディタで絵だけ拡大縮小・横ずらししたとき */
  scale?: number;
  dx?: number;
}

export interface SystemData {
  fps?: number;
  input?: { simultaneousWindow?: number; specialWindow?: number; buffer?: number; stepWindow?: number };
  jump?: { pre?: number; air?: number; land?: number; height?: number; forwardDist?: number; backDist?: number };
  nearRange?: { gap?: number };
  stage?: { ceiling?: number };
  counterHit?: { hitstunBonus?: number; damageRate?: number; hitstopBonus?: number; showText?: string };
  comboScaling?: { perMove?: number; minRate?: number };
  /** 押し返し。pushFrames＝押し返しにかかる時間(F) */
  pushback?: { pushFrames?: number };
  [key: string]: unknown;
}

export interface CharacterInfo {
  id: string;
  name: string;
  hp?: number;
  standHeight?: number;
  atlas: string;
  /** 歩く速さ(px/F) */
  walkForward?: number;
  walkBack?: number;
  /** ジャンプ（キャラごと）。無ければシステム設定のジャンプ */
  jumpHeight?: number;
  jumpAir?: number;
  jumpForward?: number;
  jumpBack?: number;
}

export interface CharacterFile {
  version: number;
  character: CharacterInfo;
  system: SystemData;
  sprites: Record<string, SpriteBoxes>;
  moves: Record<string, MoveData>;
}

export interface AtlasFrame {
  w: number;
  h: number;
  pivotX: number;
  pivotY: number;
  page: number;
  x: number;
  y: number;
  pivot?: string;
}

export interface AtlasFile {
  meta: { pages: { image: string; w: number; h: number }[]; standHeight?: number };
  frames: Record<string, AtlasFrame>;
  /** 同じ絵を別の名前で使うときの対応表（別名 → 本当の名前） */
  aliases?: Record<string, string>;
}
