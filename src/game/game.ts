// ============================================================
// ゲームの進行役（1秒60フレームの固定ループ）
// ------------------------------------------------------------
// ・計算（step）は必ず 1/60 秒に1回。描画は画面の更新ごとに最新の状態を描く。
//   120Hz・144Hz の画面でもゲームの速さは変わらない。
// ・60Hz の画面では毎回の間隔が少しゆれるので、16.67ms に近ければ「ちょうど1フレーム分」とみなす。
//   こうしないと、ゆれのせいで「計算0回の描画」「計算2回の描画」が混ざり、入力の反応が1Fぶれる。
// ・入力は計算の直前に読む（押したキーをいちばん新しい状態で拾う）。
// ・デバッグ用のキー（数字キー）：
//     1 判定表示  2 一時停止  3 コマ送り  4 状態を保存  5 保存した状態に戻す
//     6 決定性チェック  7 デバッグ表示  8 ダミーの状態  9 カウンターヒット  0 最初から
// ・エディタを開いている間は suspend() で止め、閉じたら applyCharacterFile() で
//   新しい技データに差し替えてから resume() で続きから動かす。
// ============================================================

import type { LoadedCharacter } from './data/loader.ts';
import type { CharacterFile } from './data/types.ts';
import { buildCharDef } from './data/chardef.ts';
import { GamepadInput, KeyboardInput } from './input/devices.ts';
import { BTN_MASK, DIR_MASK, buttonsText, numpad } from './input/buttons.ts';
import { cloneState, createInitialState, defaultStage, hashState, type GameState, type StageConfig } from './sim/state.ts';
import { step } from './sim/simulate.ts';
import type { SimContext } from './sim/events.ts';
import { Renderer, type DebugInfo, type InputLogEntry } from './render/renderer.ts';
import { Fx } from './render/fx.ts';
import { checkDeterminism } from './devtools/determinism.ts';
import { DUMMY_MODES, DUMMY_MODE_JP } from './sim/dummy.ts';

export interface GameOptions {
  /** training：トレーニング（ダメージの合計なども出す）／match：本番の対戦（コンボ数だけ） */
  mode?: 'training' | 'match';
}

const STEP_MS = 1000 / 60;
/** 60Hzの画面のゆれをこの幅(ms)まで吸収する */
const SNAP_MS = 2;
/** 処理が詰まったときに一度に追いつく最大フレーム数（それ以上は捨てる） */
const MAX_CATCHUP = 4;
const ARROWS = ['', '↙', '↓', '↘', '←', '・', '→', '↖', '↑', '↗'];

export class Game {
  private stage: StageConfig;
  private ctx: SimContext;
  private state: GameState;
  private saved: GameState | null = null;
  private renderer: Renderer;
  private loaded: LoadedCharacter;
  private fx = new Fx();
  private kb = new KeyboardInput();
  private pad = new GamepadInput(0);

  private raf = 0;
  private last = 0;
  private acc = 0;
  private running = false;
  private paused = false;
  private stepOnce = false;
  private showBoxes = true;
  private showDebug = true;

  // ---- 計測（表示用。ゲームの状態ではない） ----
  private fps = 60;
  private fpsCount = 0;
  private fpsTime = 0;
  /** 1秒あたりの計算の回数（60になっていれば正しい速さ） */
  private tps = 60;
  private tickCount = 0;
  private tickMs = 0;
  private pendingPress: { time: number; frame: number } | null = null;
  private latencyMs: number | null = null;
  private latencyFrames: number | null = null;
  private latencyHistory: number[] = [];
  private measureAfterDraw: number | null = null;
  private inputLog: InputLogEntry[] = [];
  private message = '';
  private messageUntil = 0;

  private onKey = (e: KeyboardEvent) => this.handleDebugKey(e);
  private training: boolean;

  constructor(canvas: HTMLCanvasElement, loaded: LoadedCharacter, opts: GameOptions = {}) {
    this.training = (opts.mode ?? 'training') === 'training';
    this.stage = defaultStage();
    this.ctx = { def: loaded.def, stage: this.stage };
    this.state = createInitialState(this.stage);
    this.loaded = loaded;
    this.renderer = new Renderer(canvas, loaded, this.stage);
    window.addEventListener('keydown', this.onKey);
  }

  // ---------------- エディタとの切り替え用 ----------------

  /** 一時的に止める（状態はそのまま残る） */
  suspend(): void {
    if (!this.running) return;
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  /** 止めたところから続ける */
  resume(): void {
    // エディタにいる間に押した・離したキーの影響を残さない
    this.kb.reset();
    this.acc = 0;
    this.pendingPress = null;
    this.start();
  }

  /** 今使っているキャラのデータ（エディタに渡す） */
  get character(): LoadedCharacter {
    return this.loaded;
  }

  /** 今の技とフレーム（エディタで同じところを開くため） */
  get currentMove(): { move: string; frame: number } {
    const f = this.state.fighters[0];
    return { move: f.move, frame: f.moveFrame };
  }

  /**
   * 技データを差し替える（絵＝アトラスはそのまま）。
   * 位置などの状態は残し、今の技が無くなった・短くなった場合だけ立ちに戻す。
   */
  applyCharacterFile(file: CharacterFile): void {
    const def = buildCharDef(file, this.loaded.atlas);
    this.loaded = { ...this.loaded, file, def };
    this.ctx = { def, stage: this.stage };
    this.renderer.setCharacter(this.loaded);
    for (const f of this.state.fighters) {
      const md = def.moves[f.move];
      if (!md || f.moveFrame >= md.total) {
        f.move = f.airborne ? 'jump' : 'idle';
        f.moveFrame = 0;
        f.hitstop = 0;
        f.pendingMove = '';
      }
      if (f.pendingMove && !def.moves[f.pendingMove]) f.pendingMove = '';
    }
    this.state.projectiles = this.state.projectiles.filter((p) => {
      const md = def.moves[p.move];
      return !!md && p.moveFrame < md.total;
    });
    // 保存してあった状態も、古い技データのものなので捨てる
    this.saved = null;
  }

  /** 画面に短い知らせを出す */
  notify(text: string): void {
    this.toast(text);
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    this.fpsTime = this.last;
    this.raf = requestAnimationFrame(this.frame);
  }

  destroy(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
    window.removeEventListener('keydown', this.onKey);
    this.kb.dispose();
  }

  /** 画面の更新ごとに呼ばれる */
  private frame = (now: number): void => {
    if (!this.running) return;
    let dt = now - this.last;
    this.last = now;
    if (Math.abs(dt - STEP_MS) < SNAP_MS) dt = STEP_MS;
    this.acc += dt;
    if (this.acc > STEP_MS * MAX_CATCHUP) this.acc = STEP_MS * MAX_CATCHUP;

    if (this.paused) {
      this.acc = 0;
      if (this.stepOnce) {
        this.stepOnce = false;
        this.tick(now);
      }
    } else {
      // 少しだけ早めに計算する（acc がわずかに足りないだけで1回分待たないように）
      while (this.acc >= STEP_MS - 0.5) {
        this.acc -= STEP_MS;
        this.tick(now);
      }
    }

    this.draw(now);
    this.raf = requestAnimationFrame(this.frame);
  };

  /** 計算を1フレーム進める */
  private tick(now: number): void {
    const t0 = performance.now();
    this.tickCount++;
    // 入力は計算の直前に読む
    const k = this.kb.sample();
    const p = this.pad.sample(now);
    const bits = k.bits | p.bits;
    const pressTime = k.pressTime ?? p.pressTime;

    const prevStart = this.state.fighters[0].moveStartedAt;
    const events = step(this.state, [bits], this.ctx);
    this.fx.handle(events);
    this.fx.tick();
    this.renderer.onTick(this.state);
    this.logInput(bits);

    // 反応の計測：押したキーで新しい動作が始まったら、描画の後に時間を測る
    const f = this.state.fighters[0];
    if (pressTime !== null) this.pendingPress = { time: pressTime, frame: this.state.frame };
    // 立ちに戻る・着地などはボタンへの反応ではないので数えない
    const passive = f.move === 'idle' || f.move === 'land' || f.move === 'crouch' || f.move === 'crouch_end' || f.move === 'turn';
    if (this.pendingPress && !passive && f.moveStartedAt !== prevStart && f.moveStartedAt === this.state.frame) {
      this.latencyFrames = this.state.frame - this.pendingPress.frame;
      this.measureAfterDraw = this.pendingPress.time;
      this.pendingPress = null;
    } else if (this.pendingPress && this.state.frame - this.pendingPress.frame > 30) {
      this.pendingPress = null;
    }
    this.tickMs = performance.now() - t0;
  }

  private draw(now: number): void {
    this.fpsCount++;
    if (now - this.fpsTime >= 500) {
      this.fps = (this.fpsCount * 1000) / (now - this.fpsTime);
      this.tps = (this.tickCount * 1000) / (now - this.fpsTime);
      this.fpsCount = 0;
      this.tickCount = 0;
      this.fpsTime = now;
    }
    if (this.message && now > this.messageUntil) this.message = '';
    const dbg: DebugInfo | null = this.showDebug
      ? {
          fps: this.fps,
          tps: this.tps,
          latencyMs: this.latencyMs,
          latencyAvgMs: this.latencyHistory.length
            ? this.latencyHistory.reduce((a, b) => a + b, 0) / this.latencyHistory.length
            : null,
          latencyFrames: this.latencyFrames,
          paused: this.paused,
          hash: this.showDebug ? hashState(this.state) : '',
          message: this.message,
          inputLog: this.inputLog,
          tickMs: this.tickMs,
        }
      : null;
    this.renderer.draw(this.state, this.fx, { showBoxes: this.showBoxes, showDebug: this.showDebug, training: this.training }, dbg);
    if (this.measureAfterDraw !== null) {
      // 描く命令を出し終えた時刻 − キーを押した時刻（実際に光るのはこの後の画面更新）
      this.latencyMs = performance.now() - this.measureAfterDraw;
      this.latencyHistory.push(this.latencyMs);
      if (this.latencyHistory.length > 20) this.latencyHistory.shift();
      this.measureAfterDraw = null;
    }
  }

  /** 入力履歴の表示（トレモでよくある「方向＋ボタン、何F続いたか」） */
  private logInput(bits: number): void {
    const f = this.state.fighters[0];
    const dir = numpad(bits & DIR_MASK, f.facing);
    const text = `${ARROWS[dir]} ${buttonsText(bits & BTN_MASK)}`;
    const top = this.inputLog[0];
    if (top && top.text === text) top.frames = Math.min(top.frames + 1, 999);
    else {
      this.inputLog.unshift({ text, frames: 1 });
      if (this.inputLog.length > 18) this.inputLog.pop();
    }
  }

  private toast(text: string): void {
    this.message = text;
    this.messageUntil = performance.now() + 2500;
  }

  private handleDebugKey(e: KeyboardEvent): void {
    if (e.repeat) return;
    switch (e.code) {
      case 'Digit1':
        this.showBoxes = !this.showBoxes;
        break;
      case 'Digit2':
        this.paused = !this.paused;
        this.toast(this.paused ? '一時停止（3でコマ送り）' : '再開');
        break;
      case 'Digit3':
        if (this.paused) this.stepOnce = true;
        break;
      case 'Digit4':
        this.saved = cloneState(this.state);
        this.toast(`保存しました（F${this.state.frame}）`);
        break;
      case 'Digit5':
        if (this.saved) {
          this.state = cloneState(this.saved);
          this.toast(`F${this.state.frame} に戻しました`);
        } else this.toast('まだ保存していません（4で保存）');
        break;
      case 'Digit6': {
        const r = checkDeterminism(this.state, this.ctx, 1800);
        this.toast(r.ok ? `決定性OK：${r.frames}F×3回が一致（${r.ms.toFixed(0)}ms）` : `決定性NG：${r.hashA} / ${r.hashB} / ${r.hashC}`);
        break;
      }
      case 'Digit7':
        this.showDebug = !this.showDebug;
        break;
      case 'Digit8': {
        // ダミーの設定は計算に影響するので、ゲームの状態として持つ（保存・復元にも含まれる）
        const d = this.state.dummy;
        d.mode = DUMMY_MODES[(DUMMY_MODES.indexOf(d.mode) + 1) % DUMMY_MODES.length];
        this.toast(`ダミー：${DUMMY_MODE_JP[d.mode]}`);
        break;
      }
      case 'Digit9':
        this.state.dummy.counter = !this.state.dummy.counter;
        this.toast(this.state.dummy.counter ? 'ダミー：カウンターヒットにする' : 'ダミー：カウンターヒットなし');
        break;
      case 'Digit0':
        this.state = createInitialState(this.stage);
        this.toast('最初の位置に戻しました');
        break;
      default:
        return;
    }
    e.preventDefault();
  }
}
