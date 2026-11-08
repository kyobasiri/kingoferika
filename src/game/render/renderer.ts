// ============================================================
// 描画（状態を見て絵を描くだけ。状態は書き換えない）
// ------------------------------------------------------------
// ・canvas の大きさは「高さ1000 × 16:9」の固定。画面に合わせた拡大縮小はCSSで行う。
// ・カメラは2人（段階1はエリカとダミー）の真ん中を映す。ズームはしない。
// ・判定の箱・フレーム情報・入力履歴・反応時間をデバッグ表示できる。
// ============================================================

import type { Box } from '../data/types.ts';
import type { CharDef, MoveDef } from '../data/chardef.ts';
import type { LoadedCharacter } from '../data/loader.ts';
import { SUB, clamp } from '../fixed.ts';
import type { GameState, StageConfig } from '../sim/state.ts';
import type { Fx } from './fx.ts';
import { DUMMY_MODE_JP, dummyFrame, dummyInvulnerable, inCombo } from '../sim/dummy.ts';

export interface InputLogEntry {
  text: string;
  frames: number;
}

export interface DebugInfo {
  /** 1秒あたりの描画回数（画面のリフレッシュレートに合わせて変わる） */
  fps: number;
  /** 1秒あたりの計算回数（常に60になるのが正しい） */
  tps: number;
  /** 最後に測った「キーを押してから、その技を描く命令を出すまで」の時間(ms) */
  latencyMs: number | null;
  latencyAvgMs: number | null;
  /** 押したフレームから技が始まるまでのフレーム数（0が理想） */
  latencyFrames: number | null;
  paused: boolean;
  hash: string;
  message: string;
  inputLog: InputLogEntry[];
  tickMs: number;
}

export interface RenderOptions {
  showBoxes: boolean;
  showDebug: boolean;
  /** トレーニングなら、コンボ数に加えてダメージの合計なども出す（本番の対戦ではコンボ数だけ） */
  training: boolean;
}

const COL = { hurt: '#4b8dff', push: '#f5c542', hit: '#ff4b5c', throw: '#3fd17a', clash: '#c77dff' };

interface TrailPoint {
  x: number;
  y: number;
  sprite: string;
  facing: number;
}

export class Renderer {
  readonly canvas: HTMLCanvasElement;
  private g: CanvasRenderingContext2D;
  private loaded: LoadedCharacter;
  private def: CharDef;
  private stage: StageConfig;
  private groundY: number;
  /** ステップの残像（描画専用） */
  private trail: TrailPoint[] = [];
  private camLeft = 0;

  constructor(canvas: HTMLCanvasElement, loaded: LoadedCharacter, stage: StageConfig) {
    this.canvas = canvas;
    this.loaded = loaded;
    this.def = loaded.def;
    this.stage = stage;
    canvas.width = stage.viewWidth;
    canvas.height = stage.viewHeight;
    // desynchronized：描いた絵をなるべく早く画面に出す（対応ブラウザのみ。遅延を減らす）
    const g = canvas.getContext('2d', { alpha: false, desynchronized: true });
    if (!g) throw new Error('canvas 2D が使えません');
    this.g = g;
    this.groundY = stage.viewHeight - stage.groundFromBottom;
    this.warmUp();
  }

  /**
   * アトラスの全ページを一度だけ描いておく。
   * 大きな画像は「初めて描いたとき」にGPUへ送る処理が走り、そのフレームが止まる。
   * 試合中（超必殺技の初回など）に止まらないよう、読み込み直後に済ませておく。
   */
  private warmUp(): void {
    for (const img of this.loaded.images) this.g.drawImage(img, 0, 0, 1, 1, 0, 0, 1, 1);
  }

  /** 技データを差し替えたとき（絵はそのまま） */
  setCharacter(loaded: LoadedCharacter): void {
    this.loaded = loaded;
    this.def = loaded.def;
    this.trail = [];
  }

  /** 計算1フレームごとに呼ぶ（残像の記録） */
  onTick(s: GameState): void {
    const f = s.fighters[0];
    const md = this.def.moves[f.move];
    if (md?.data.afterimage) {
      const fr = md.frames[f.moveFrame];
      if (fr) this.trail.push({ x: f.x, y: f.y, sprite: fr.sprite, facing: f.facing });
      if (this.trail.length > 8) this.trail.shift();
    } else if (this.trail.length) {
      this.trail.shift();
    }
  }

  /** ステージ上の位置（内部単位、yは下がプラス）→ 画面のpx */
  private toScreen = (x: number, y: number): [number, number] => [(x - this.camLeft) / SUB, this.groundY + y / SUB];

  private updateCamera(s: GameState): void {
    const view = this.stage.viewWidth * SUB;
    const center = (s.fighters[0].x + s.dummy.x) / 2;
    this.camLeft = clamp(center, view / 2, this.stage.width - view / 2) - view / 2;
  }

  draw(s: GameState, fx: Fx, opt: RenderOptions, dbg: DebugInfo | null): void {
    const g = this.g;
    this.updateCamera(s);
    this.drawBackground();

    const f = s.fighters[0];
    const d = s.dummy;
    const frozen = s.freeze > 0 || s.freezeOwner >= 0;

    // ダミー（エリカの絵を薄く。くらい・ガード・ジャンプ・ダウンの動作を使う）
    const dSprite = dummyFrame(this.def, d).sprite;
    this.drawSprite(dSprite, d.x, d.y, d.facing, 0.5, false);
    if (d.flash > 0) this.drawSprite(dSprite, d.x, d.y, d.facing, Math.min(1, d.flash / 10) * 0.8, true);
    // ダミーの設定を頭の上に
    {
      const [hx, hy] = this.toScreen(d.x, -(d.y + 420 * SUB));
      g.save();
      g.font = 'bold 22px sans-serif';
      g.fillStyle = d.mode === 'guard' || d.mode === 'crouchGuard' ? '#8cc8ff' : '#c9d1ff';
      g.textAlign = 'center';
      g.fillText(DUMMY_MODE_JP[d.mode] + (d.counter ? '＋カウンター' : ''), hx, hy);
      g.restore();
    }

    // 暗転（本人以外を暗くする）
    if (frozen) {
      g.fillStyle = 'rgba(0,0,10,0.6)';
      g.fillRect(0, 0, this.canvas.width, this.canvas.height);
    }

    // 残像
    this.trail.forEach((p, i) => this.drawSprite(p.sprite, p.x, p.y, p.facing, 0.12 + (0.25 * i) / this.trail.length, false));

    // エリカ
    const md = this.def.moves[f.move];
    const fr = md?.frames[f.moveFrame];
    if (fr) {
      // 溜めている間は、待った時間に合わせて紫に脈打つ
      if (f.holding) {
        const pulse = 0.25 + 0.2 * Math.sin(s.frame * 0.4) + 0.1 * Math.max(0, f.holdLevel + 1);
        g.save();
        g.shadowColor = '#b388ff';
        g.shadowBlur = 20 + 10 * Math.max(0, f.holdLevel + 1);
        this.drawSprite(fr.sprite, f.x, f.y, f.facing, Math.min(1, pulse + 0.5), false);
        g.restore();
      }
      this.drawSprite(fr.sprite, f.x, f.y, f.facing, 1, false);
    }

    // 飛び道具
    for (const p of s.projectiles) {
      const pm = this.def.moves[p.move];
      const pf = pm?.frames[p.moveFrame];
      if (pf) this.drawSprite(pf.sprite, p.x, p.y, p.facing, 1, false);
    }

    fx.draw(g, this.toScreen);
    if (fx.superFlash > 0) {
      g.fillStyle = `rgba(255,255,255,${(fx.superFlash / 10) * 0.35})`;
      g.fillRect(0, 0, this.canvas.width, this.canvas.height);
    }

    if (opt.showBoxes) this.drawAllBoxes(s);
    this.drawCombo(s, opt.training);
    if (opt.showDebug && dbg) this.drawDebug(s, dbg);
  }

  private drawBackground(): void {
    const g = this.g;
    const W = this.canvas.width;
    const H = this.canvas.height;
    const sky = g.createLinearGradient(0, 0, 0, this.groundY);
    sky.addColorStop(0, '#0d1030');
    sky.addColorStop(1, '#2a2f5c');
    g.fillStyle = sky;
    g.fillRect(0, 0, W, this.groundY);
    g.fillStyle = '#1b1d2b';
    g.fillRect(0, this.groundY, W, H - this.groundY);
    // 床の目盛り（100pxごと。動いている感じが分かるように）
    g.strokeStyle = 'rgba(255,255,255,0.12)';
    g.fillStyle = 'rgba(255,255,255,0.35)';
    g.font = '16px monospace';
    g.lineWidth = 1;
    const startPx = Math.floor(this.camLeft / SUB / 100) * 100;
    for (let px = startPx; px <= startPx + W + 100; px += 100) {
      const [sx] = this.toScreen(px * SUB, 0);
      const big = px % 500 === 0;
      g.beginPath();
      g.moveTo(sx + 0.5, this.groundY);
      g.lineTo(sx + 0.5, this.groundY + (big ? 40 : 15));
      g.stroke();
      if (big) g.fillText(String(px), sx + 4, this.groundY + 36);
    }
    // 地面の線
    g.strokeStyle = 'rgba(255,255,255,0.4)';
    g.beginPath();
    g.moveTo(0, this.groundY + 0.5);
    g.lineTo(W, this.groundY + 0.5);
    g.stroke();
    // ステージの端
    for (const edge of [this.stage.wallMargin, this.stage.width - this.stage.wallMargin]) {
      const [sx] = this.toScreen(edge, 0);
      if (sx < -2 || sx > W + 2) continue;
      g.strokeStyle = 'rgba(255,120,120,0.5)';
      g.beginPath();
      g.moveTo(sx, 0);
      g.lineTo(sx, this.groundY);
      g.stroke();
    }
  }

  /**
   * 絵を1枚描く。(x, y) は足元（エフェクトは中心）の位置（内部単位、yは上がプラス）。
   * エディタの drawSprite と同じく、拡大縮小と横ずらし（sprites[].scale / dx）に対応。
   */
  private drawSprite(name: string, x: number, y: number, facing: number, alpha: number, white: boolean): void {
    const fr = this.loaded.atlas.frames[name];
    if (!fr) return;
    const img = this.loaded.images[fr.page || 0];
    if (!img) return;
    const sb = this.loaded.file.sprites[name] || {};
    const k = (sb.scale || 100) / 100;
    const [sx, sy] = this.toScreen(x, -y);
    const g = this.g;
    g.save();
    g.globalAlpha = alpha;
    if (white) g.globalCompositeOperation = 'lighter';
    g.translate(Math.round(sx), Math.round(sy));
    if (facing < 0) g.scale(-1, 1);
    g.translate(sb.dx || 0, 0);
    g.scale(k, k);
    g.drawImage(img, fr.x, fr.y, fr.w, fr.h, -fr.pivotX, -fr.pivotY, fr.w, fr.h);
    g.restore();
  }

  private box(b: Box, ox: number, oy: number, facing: number, color: string): void {
    const g = this.g;
    const [sx, sy] = this.toScreen(ox, -oy);
    const x = facing === 1 ? sx + b[0] : sx - b[0] - b[2];
    const y = sy + b[1];
    g.fillStyle = color + '33';
    g.fillRect(x, y, b[2], b[3]);
    g.strokeStyle = color;
    g.lineWidth = 2;
    g.strokeRect(x + 0.5, y + 0.5, b[2] - 1, b[3] - 1);
  }

  private drawAllBoxes(s: GameState): void {
    const f = s.fighters[0];
    const d = s.dummy;
    const dfr = dummyFrame(this.def, d);
    if (!dummyInvulnerable(d)) for (const b of dfr.hurt) this.box(b, d.x, d.y, d.facing, COL.hurt);
    if (dfr.push) this.box(dfr.push, d.x, d.y, d.facing, COL.push);
    const md = this.def.moves[f.move];
    const fr = md?.frames[f.moveFrame];
    if (fr) {
      for (const b of fr.hurt) this.box(b, f.x, f.y, f.facing, COL.hurt);
      if (fr.push) this.box(fr.push, f.x, f.y, f.facing, COL.push);
      for (const b of fr.hit) this.box(b, f.x, f.y, f.facing, COL.hit);
      for (const b of fr.throwBoxes) this.box(b, f.x, f.y, f.facing, COL.throw);
    }
    for (const p of s.projectiles) {
      const pf = this.def.moves[p.move]?.frames[p.moveFrame];
      if (!pf) continue;
      for (const b of pf.hit) this.box(b, p.x, p.y, p.facing, COL.hit);
      for (const b of pf.clash) this.box(b, p.x, p.y, p.facing, COL.clash);
    }
    // 足元の基準点
    const [sx, sy] = this.toScreen(f.x, -f.y);
    this.g.fillStyle = '#fff';
    this.g.fillRect(sx - 6, sy - 1, 12, 2);
    this.g.fillRect(sx - 1, sy - 6, 2, 12);
  }

  /**
   * コンボの表示（相手側の上）。2ヒット以上で「○ HITS」。本番の対戦でも出す。
   * トレーニングでは、1ヒットでもダメージ・合計・補正を出す。
   */
  private drawCombo(s: GameState, training: boolean): void {
    const d = s.dummy;
    const live = inCombo(d);
    if (!live && d.comboShow <= 0) return;
    if (d.combo < 1) return;
    const g = this.g;
    // 相手が画面の右にいれば右上、左にいれば左上
    const right = d.x >= s.fighters[0].x;
    const x = right ? this.canvas.width - 40 : 40;
    const fade = live ? 1 : Math.min(1, d.comboShow / 30);
    g.save();
    g.globalAlpha = fade;
    g.textAlign = right ? 'right' : 'left';
    let y = 250;
    if (d.combo >= 2) {
      g.font = 'bold italic 72px sans-serif';
      g.fillStyle = '#000';
      g.fillText(`${d.combo}`, x + 3, y + 3);
      g.fillStyle = live ? '#ffe28a' : '#c9b26a';
      g.fillText(`${d.combo}`, x, y);
      const w = g.measureText(`${d.combo}`).width;
      g.font = 'bold italic 32px sans-serif';
      g.fillStyle = '#fff';
      g.fillText('HITS', right ? x - w - 12 : x + w + 12, y);
      y += 44;
    }
    if (training) {
      g.font = 'bold 26px sans-serif';
      g.fillStyle = '#000';
      const lines = [
        `合計ダメージ ${d.comboDamage}`,
        `最後の1発 ${d.lastDamage}（補正 ${d.lastScale}%）`,
      ];
      lines.forEach((l, i) => {
        g.fillStyle = '#000';
        g.fillText(l, x + 2, y + i * 34 + 2);
        g.fillStyle = i === 0 ? '#ffffff' : '#c9d1ff';
        g.fillText(l, x, y + i * 34);
      });
    }
    g.restore();
  }

  private drawDebug(s: GameState, dbg: DebugInfo): void {
    const g = this.g;
    const f = s.fighters[0];
    const md: MoveDef | undefined = this.def.moves[f.move];
    const fr = md?.frames[f.moveFrame];
    const lines: string[] = [
      `F ${s.frame}   計算 ${dbg.tps.toFixed(0)}回/秒（1回 ${dbg.tickMs.toFixed(2)}ms）   描画 ${dbg.fps.toFixed(0)}回/秒` +
        (dbg.paused ? '   [一時停止中]' : ''),
      `技 ${md?.data.label ?? f.move} (${f.move})  ${f.moveFrame + 1}/${md?.total ?? 0}F` +
        (md?.startup ? `  発生${md.startup}F` : '') +
        (md && md.hits.length > 1 && fr && fr.group >= 0 ? `  ${fr.group + 1}/${md.hits.length}段目` : '') +
        (f.hitstop ? `  ヒットストップ残り${f.hitstop}` : '') +
        (f.chain > 1 ? `  連打${f.chain}` : '') +
        (f.holding || f.holdLevel >= 0 ? `  溜め ${f.holdT}F${f.holdLevel >= 0 ? `（段階${f.holdLevel + 1}）` : ''}${f.holding ? ' 待ち中' : ''}` : '') +
        (f.move === 'land' ? `  着地硬直 残り${f.landLag}F` : ''),
      `状態 ${fr?.state ?? '-'}  無敵 ${fr?.inv ?? '-'}  コマ${(fr?.index ?? 0) + 1}「${fr?.sprite ?? ''}」`,
      `位置 x=${(f.x / SUB).toFixed(1)} y=${(f.y / SUB).toFixed(1)}  向き${f.facing > 0 ? '右' : '左'}` + (f.airborne ? `  空中${f.airT}F` : ''),
      `反応 ${dbg.latencyMs === null ? '-' : dbg.latencyMs.toFixed(1) + 'ms'}（平均 ${dbg.latencyAvgMs === null ? '-' : dbg.latencyAvgMs.toFixed(1) + 'ms'}）` +
        `  押してから開始まで ${dbg.latencyFrames === null ? '-' : dbg.latencyFrames + 'F'}`,
      `ダミー ${DUMMY_MODE_JP[s.dummy.mode]}（8）${s.dummy.counter ? '・カウンター' : ''}（9）  ${s.dummy.act}${s.dummy.stun > 0 ? ' 残り' + s.dummy.stun + 'F' : ''}  距離 ${((s.dummy.x - f.x) * f.facing / SUB).toFixed(0)}px` +
        (s.dummy.lastGuarded && s.dummy.lastChip ? `  削り ${s.dummy.lastChip}` : '') +
        (s.dummy.pushTotal > 0 || s.dummy.pushDone > 0
          ? `  ${s.dummy.lastGuarded ? 'ガードバック' : 'ヒットバック'} ${(s.dummy.pushDone / SUB).toFixed(0)}px`
          : ''),
      `状態の指紋 ${dbg.hash}`,
    ];
    g.save();
    g.font = '20px monospace';
    g.fillStyle = 'rgba(0,0,0,0.55)';
    g.fillRect(10, 10, 900, lines.length * 26 + 14);
    g.fillStyle = '#e8ecff';
    lines.forEach((l, i) => g.fillText(l, 20, 36 + i * 26));
    // 入力履歴（新しいものが上）
    g.fillStyle = 'rgba(0,0,0,0.45)';
    g.fillRect(10, 216, 170, dbg.inputLog.length * 24 + 10);
    g.font = '18px monospace';
    dbg.inputLog.forEach((e, i) => {
      g.fillStyle = i === 0 ? '#ffe28a' : '#c9d1ff';
      g.fillText(`${String(e.frames).padStart(3)} ${e.text}`, 20, 238 + i * 24);
    });
    if (dbg.message) {
      g.font = '24px sans-serif';
      const w = g.measureText(dbg.message).width;
      g.fillStyle = 'rgba(0,0,0,0.7)';
      // デバッグ表示に重ならない高さに出す
      g.fillRect(this.canvas.width / 2 - w / 2 - 20, 300, w + 40, 44);
      g.fillStyle = '#fff';
      g.fillText(dbg.message, this.canvas.width / 2 - w / 2, 330);
    }
    g.restore();
  }
}
