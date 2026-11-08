// ============================================================
// キーボード・ゲームパッドから入力を読む（ブラウザ専用の部分）
// ------------------------------------------------------------
// 操作の快適さのための工夫：
// ・キーが押された瞬間に「押された印（latch）」を付ける。
//   フレームの間に押して離した短いタップも、次のフレームで必ず拾える。
// ・押した時刻（event.timeStamp）を覚えておき、画面に出るまでの時間を測れるようにする。
// ============================================================

import { UP, DOWN, LEFT, RIGHT, BTN_P, BTN_K, BTN_S } from './buttons.ts';

/** 1回分の読み取り結果 */
export interface InputSample {
  bits: number;
  /** 前回の読み取りから今回までに新しく押されたキーの最初の時刻（無ければ null） */
  pressTime: number | null;
}

/** キーボードの割り当て（仕様書：WASD移動、J=P、K=K、L=S、U=P+K、I=P+K+S）。矢印キーでも動ける */
export const DEFAULT_KEYMAP: Record<string, number> = {
  KeyW: UP,
  KeyS: DOWN,
  KeyA: LEFT,
  KeyD: RIGHT,
  ArrowUp: UP,
  ArrowDown: DOWN,
  ArrowLeft: LEFT,
  ArrowRight: RIGHT,
  KeyJ: BTN_P,
  KeyK: BTN_K,
  KeyL: BTN_S,
  KeyU: BTN_P | BTN_K,
  KeyI: BTN_P | BTN_K | BTN_S,
};

export class KeyboardInput {
  private keymap: Record<string, number>;
  private down = new Set<string>();
  private latch = 0;
  private firstPress: number | null = null;
  private onDown = (e: KeyboardEvent) => this.handleDown(e);
  private onUp = (e: KeyboardEvent) => this.handleUp(e);
  private onBlur = () => this.down.clear();

  constructor(keymap: Record<string, number> = DEFAULT_KEYMAP) {
    this.keymap = keymap;
    window.addEventListener('keydown', this.onDown);
    window.addEventListener('keyup', this.onUp);
    // 別のウィンドウに移ったらキーを離したことにする（押しっぱなしで歩き続けるのを防ぐ）
    window.addEventListener('blur', this.onBlur);
  }

  private handleDown(e: KeyboardEvent): void {
    const b = this.keymap[e.code];
    if (b === undefined) return;
    e.preventDefault(); // ページのスクロールなどを止める
    if (e.repeat) return; // 押しっぱなしの自動連打は無視
    this.down.add(e.code);
    this.latch |= b;
    if (this.firstPress === null) this.firstPress = e.timeStamp;
  }

  private handleUp(e: KeyboardEvent): void {
    if (this.keymap[e.code] === undefined) return;
    e.preventDefault();
    this.down.delete(e.code);
  }

  /** 押しているキーを全部離したことにする（エディタから戻ったときなど） */
  reset(): void {
    this.down.clear();
    this.latch = 0;
    this.firstPress = null;
  }

  /** 1フレームに1回呼ぶ。今押されているキー＋この間に一瞬だけ押されたキー */
  sample(): InputSample {
    let bits = this.latch;
    for (const code of this.down) bits |= this.keymap[code] ?? 0;
    const pressTime = this.firstPress;
    this.latch = 0;
    this.firstPress = null;
    return { bits, pressTime };
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onDown);
    window.removeEventListener('keyup', this.onUp);
    window.removeEventListener('blur', this.onBlur);
  }
}

/**
 * ゲームパッド（Gamepad API の標準配置）
 * 仕様書：X(□)=P、A(×)=K、B(○)=S、Y(△)=P+K、R1=P+K+S
 * ゲームパッドは押した瞬間の通知が無いので、フレームごとに状態を読む。
 */
export class GamepadInput {
  private index: number;
  private prev = 0;
  constructor(index = 0) {
    this.index = index;
  }

  sample(now: number): InputSample {
    const pads = typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : [];
    const gp = pads[this.index];
    if (!gp) {
      this.prev = 0;
      return { bits: 0, pressTime: null };
    }
    const b = (i: number) => !!gp.buttons[i] && gp.buttons[i].pressed;
    let bits = 0;
    if (b(2)) bits |= BTN_P;
    if (b(0)) bits |= BTN_K;
    if (b(1)) bits |= BTN_S;
    if (b(3)) bits |= BTN_P | BTN_K;
    if (b(5)) bits |= BTN_P | BTN_K | BTN_S;
    if (b(12)) bits |= UP;
    if (b(13)) bits |= DOWN;
    if (b(14)) bits |= LEFT;
    if (b(15)) bits |= RIGHT;
    // 左スティック（半分以上倒したら入力）
    const ax = gp.axes[0] ?? 0;
    const ay = gp.axes[1] ?? 0;
    if (ax < -0.5) bits |= LEFT;
    if (ax > 0.5) bits |= RIGHT;
    if (ay < -0.5) bits |= UP;
    if (ay > 0.5) bits |= DOWN;
    const pressed = bits & ~this.prev;
    this.prev = bits;
    return { bits, pressTime: pressed ? now : null };
  }
}
