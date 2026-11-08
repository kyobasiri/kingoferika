// ============================================================
// キャラのデータと画像を読み込む（ブラウザ専用）
// ------------------------------------------------------------
// public/chars/<キャラID>/ に、エディタの書き出したファイルをそのまま置く。
//   moon_erika.all.json … 技データ＋システム設定
//   atlas.json / atlas_*.webp … 絵
// エディタで調整 → 書き出し → このフォルダに上書き、で反映される。
// ============================================================

import type { AtlasFile, CharacterFile } from './types.ts';
import { buildCharDef, type CharDef } from './chardef.ts';

export interface LoadedCharacter {
  file: CharacterFile;
  atlas: AtlasFile;
  def: CharDef;
  /** アトラスのページ画像（atlas.meta.pages と同じ順） */
  images: HTMLImageElement[];
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`読み込めません：${url}（${res.status}）`);
  return (await res.json()) as T;
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = async () => {
      // 描画の最初の1回で画像の展開待ちが起きないよう、先に展開しておく
      try {
        await img.decode();
      } catch {
        /* decode 非対応でも表示はできる */
      }
      resolve(img);
    };
    img.onerror = () => reject(new Error(`画像を読み込めません：${url}`));
    img.src = url;
  });
}

/**
 * @param dir  例："./chars/moon_erika/"
 * @param file 例："moon_erika.all.json"
 * @param onProgress 0〜1 の進み具合
 */
export async function loadCharacter(
  dir: string,
  file: string,
  onProgress?: (ratio: number, text: string) => void,
): Promise<LoadedCharacter> {
  onProgress?.(0, '技データ');
  const data = await fetchJson<CharacterFile>(dir + file);
  const atlas = await fetchJson<AtlasFile>(dir + (data.character.atlas || 'atlas.json'));
  const pages = atlas.meta.pages;
  let done = 0;
  onProgress?.(0.05, `画像 0/${pages.length}`);
  const images = await Promise.all(
    pages.map((p) =>
      loadImage(dir + p.image).then((img) => {
        done++;
        onProgress?.(0.05 + (0.95 * done) / pages.length, `画像 ${done}/${pages.length}`);
        return img;
      }),
    ),
  );
  const def = buildCharDef(data, atlas);
  return { file: data, atlas, def, images };
}
