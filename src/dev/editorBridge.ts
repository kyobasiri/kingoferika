// ============================================================
// 判定エディタとゲームの橋渡し（開発用）
// ------------------------------------------------------------
// エディタ（tools/editor/editor.html）は手を加えずにそのまま使い、
// 同じオリジンの iframe として開いて、エディタの中の変数・関数を外から呼ぶ。
//
// エディタ側で使っているもの（エディタを新しい版に差し替えるときは、これらが残っていること）：
//   DATA, ATLAS, IMGS, curMove, gf          … 変数
//   perFrameBoxes, migrate, refreshAll, renderChar, selectMove, totalFrames,
//   loadPages, pageList, editorFacts         … 関数
// ============================================================

import type { AtlasFile, CharacterFile } from '../game/data/types.ts';
import type { EditorFacts } from './crossCheck.ts';

/** iframe の中のグローバルスコープでコードを実行する（let で宣言された変数にも届く） */
type EvalWindow = Window & { eval: (code: string) => unknown };

export class EditorBridge {
  readonly iframe: HTMLIFrameElement;
  private ready: Promise<void>;
  private loadedId = '';

  constructor(iframe: HTMLIFrameElement, url: string) {
    this.iframe = iframe;
    this.ready = new Promise((resolve, reject) => {
      iframe.onload = () => {
        // エディタは画像を読み終えてから画面を作るので、それを待つ
        const started = performance.now();
        const wait = () => {
          try {
            if ((this.run('IMGS.length') as number) > 0) return resolve();
          } catch {
            /* まだ準備中 */
          }
          if (performance.now() - started > 60000) return reject(new Error('エディタの読み込みが終わりません'));
          setTimeout(wait, 100);
        };
        wait();
      };
    });
    iframe.src = url;
  }

  private get win(): EvalWindow {
    const w = this.iframe.contentWindow as EvalWindow | null;
    if (!w) throw new Error('エディタが開いていません');
    return w;
  }

  /** エディタの中でコードを実行して結果を返す */
  private run(code: string): unknown {
    return this.win.eval(code);
  }

  whenReady(): Promise<void> {
    return this.ready;
  }

  /**
   * ゲームが使っているデータをエディタに入れる（最初に開いたときだけ）。
   * 以後はエディタの中身が正しいものとして、閉じるたびにゲームとファイルへ反映する。
   */
  loadOnce(file: CharacterFile, atlas: AtlasFile): void {
    if (this.loadedId === file.character.id) return;
    this.loadedId = file.character.id;
    const w = this.win as EvalWindow & Record<string, unknown>;
    // JSON の受け渡しは文字列で行う（別のウィンドウのオブジェクトを混ぜない）
    w.__gameData = JSON.stringify(file);
    w.__gameAtlas = JSON.stringify(atlas);
    this.run(`(() => {
      const d = JSON.parse(window.__gameData);
      const otherChar = !DATA.character || DATA.character.id !== d.character.id;
      if (otherChar) ATLAS = JSON.parse(window.__gameAtlas);
      DATA = perFrameBoxes(migrate(d));
      if (!DATA.moves[curMove]) curMove = Object.keys(DATA.moves)[0];
      if (otherChar) loadPages(pageList()).then(ims => { IMGS = ims; refreshAll(); });
      refreshAll(); renderChar();
    })()`);
  }

  /** ゲームで今出している技・フレームをエディタで選ぶ */
  select(moveId: string, frame: number): void {
    // ゲームだけにある動作は、元になった技を開く
    const id = moveId === 'crouch_end' ? 'crouch_start' : moveId;
    this.run(`(() => {
      if (!DATA.moves[${JSON.stringify(id)}]) return;
      selectMove(${JSON.stringify(id)});
      gf = Math.max(0, Math.min(${frame | 0}, totalFrames() - 1));
      refreshAll();
    })()`);
  }

  /** エディタの今の内容（書き出しの「キャラ＋システム」と同じもの） */
  getData(): CharacterFile {
    return JSON.parse(this.run('JSON.stringify(DATA)') as string) as CharacterFile;
  }

  /** エディタの計算結果（ゲームの計算と照合するため）。古いエディタで関数が無ければ null */
  getFacts(): EditorFacts | null {
    const text = this.run(`typeof editorFacts === 'function' ? JSON.stringify(editorFacts()) : ''`) as string;
    return text ? (JSON.parse(text) as EditorFacts) : null;
  }

  /** エディタの中でキーが押されたときに呼ぶ */
  onKey(handler: (e: KeyboardEvent) => void): void {
    this.win.addEventListener('keydown', handler);
  }

  focus(): void {
    this.iframe.focus();
    this.iframe.contentWindow?.focus();
  }
}

/** 開発サーバーにキャラのデータを保存してもらう */
export async function saveCharacterFile(file: CharacterFile): Promise<void> {
  const res = await fetch('/__dev/save-char', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    // エディタの書き出しと同じ形式（1文字インデント）
    body: JSON.stringify({ id: file.character.id, json: JSON.stringify(file, null, 1) }),
  });
  const r = (await res.json()) as { ok: boolean; error?: string };
  if (!r.ok) throw new Error(r.error || '保存できませんでした');
}
