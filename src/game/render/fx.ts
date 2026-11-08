// ============================================================
// 演出（火花・暗転の光など）
// ------------------------------------------------------------
// 計算から届いた知らせ（SimEvent）を見て出すだけの、見た目専用の部分。
// ゲームの状態には入れない（保存・復元・決定性の対象外）ので、
// ここでは Math.random を使ってよい。
// 将来の音もこの層に置く。
// ============================================================

import type { SimEvent } from '../sim/events.ts';

interface Spark {
  /** ステージ上の位置（内部単位） */
  x: number;
  y: number;
  angle: number;
  speed: number;
  len: number;
  life: number;
  maxLife: number;
  /** ガードされたときは青白い火花 */
  guard: boolean;
}

interface Ring {
  x: number;
  y: number;
  life: number;
  maxLife: number;
  color: string;
  size: number;
}

/** 浮かび上がる文字（「ガード不能」「溜め段階2」など） */
interface FloatText {
  text: string;
  x: number;
  y: number;
  life: number;
  maxLife: number;
  color: string;
}

export class Fx {
  private sparks: Spark[] = [];
  private rings: Ring[] = [];
  private texts: FloatText[] = [];
  /** 暗転開始の光（残りフレーム） */
  superFlash = 0;

  /** 計算1フレームごとに、そのフレームの知らせを受け取る */
  handle(events: SimEvent[]): void {
    for (const e of events) {
      if (e.type === 'hit') {
        const n = e.power >= 15 ? 16 : 10;
        for (let i = 0; i < n; i++) {
          const maxLife = 8 + Math.floor(Math.random() * 6);
          this.sparks.push({
            x: e.x,
            y: e.y,
            angle: Math.random() * Math.PI * 2,
            speed: 6 + Math.random() * (e.power >= 15 ? 14 : 9),
            len: 18 + Math.random() * 30,
            life: maxLife,
            maxLife,
            guard: e.guard,
          });
        }
        this.rings.push({ x: e.x, y: e.y, life: 8, maxLife: 8, color: e.guard ? '160,210,255' : '255,240,200', size: 70 });
        if (e.note) this.texts.push({ text: e.note, x: e.x, y: e.y - 60_000, life: 40, maxLife: 40, color: e.counter ? '#ffd166' : '#ff8a8a' });
      } else if (e.type === 'superFreeze') {
        this.superFlash = 10;
      } else if (e.type === 'holdLevel') {
        // 溜めの段階が上がった：紫の輪と文字
        this.rings.push({ x: e.x, y: e.y, life: 14, maxLife: 14, color: '200,150,255', size: 160 + e.level * 40 });
        this.texts.push({ text: `溜め 段階${e.level + 1}`, x: e.x, y: e.y - 220_000, life: 36, maxLife: 36, color: '#d7b8ff' });
      }
    }
  }

  /** 計算1フレームごとに進める（描画の回数とは無関係に、同じ速さで動く） */
  tick(): void {
    for (const s of this.sparks) s.life--;
    for (const r of this.rings) r.life--;
    for (const x of this.texts) x.life--;
    this.sparks = this.sparks.filter((s) => s.life > 0);
    this.rings = this.rings.filter((r) => r.life > 0);
    this.texts = this.texts.filter((x) => x.life > 0);
    if (this.superFlash > 0) this.superFlash--;
  }

  /** @param toScreen ステージ上の位置（内部単位、yは下がプラス）→ 画面のpx */
  draw(g: CanvasRenderingContext2D, toScreen: (x: number, y: number) => [number, number]): void {
    g.save();
    g.globalCompositeOperation = 'lighter';
    for (const r of this.rings) {
      const [sx, sy] = toScreen(r.x, r.y);
      const k = 1 - r.life / r.maxLife;
      g.strokeStyle = `rgba(${r.color},${(1 - k) * 0.9})`;
      g.lineWidth = 6 * (1 - k) + 1;
      g.beginPath();
      g.arc(sx, sy, 20 + k * r.size, 0, Math.PI * 2);
      g.stroke();
    }
    for (const s of this.sparks) {
      const [sx, sy] = toScreen(s.x, s.y);
      const age = s.maxLife - s.life;
      const d = s.speed * age;
      const x1 = sx + Math.cos(s.angle) * d;
      const y1 = sy + Math.sin(s.angle) * d;
      const x2 = x1 + Math.cos(s.angle) * s.len * (s.life / s.maxLife);
      const y2 = y1 + Math.sin(s.angle) * s.len * (s.life / s.maxLife);
      g.strokeStyle = s.guard
        ? `rgba(140,${190 + Math.floor(65 * (s.life / s.maxLife))},255,${s.life / s.maxLife})`
        : `rgba(255,${200 + Math.floor(55 * (s.life / s.maxLife))},120,${s.life / s.maxLife})`;
      g.lineWidth = 3;
      g.beginPath();
      g.moveTo(x1, y1);
      g.lineTo(x2, y2);
      g.stroke();
    }
    g.globalCompositeOperation = 'source-over';
    g.font = 'bold 30px sans-serif';
    g.textAlign = 'center';
    for (const x of this.texts) {
      const [sx, sy] = toScreen(x.x, x.y);
      const age = x.maxLife - x.life;
      g.globalAlpha = Math.min(1, x.life / 10);
      g.fillStyle = '#000';
      g.fillText(x.text, sx + 2, sy - age + 2);
      g.fillStyle = x.color;
      g.fillText(x.text, sx, sy - age);
    }
    g.restore();
  }
}
