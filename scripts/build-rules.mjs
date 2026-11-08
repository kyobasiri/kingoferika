// ============================================================
// 計算の決まり（src/game/rules）を、エディタ用の rules.js に書き出す
// ------------------------------------------------------------
//   npm run build:rules  → tools/editor/rules.js（アーティファクト版のエディタに一緒に載せる）
// 開発サーバー（npm run dev）は、F4 で開くエディタにこの関数でその場で作った rules.js を渡す。
// rules.js は自動で作るファイルなので、直接は書き換えない（直すのは src/game/rules/index.ts）。
// ============================================================

import { build } from 'vite';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

const BANNER = `// ============================================================
// rules.js（自動で作ったファイル。直接書き換えないでください）
// 元：src/game/rules/index.ts（npm run build:rules で作り直す）
// エディタとゲームが同じ「計算の決まり」を使うためのファイル。グローバル変数 GameRules になる。
// ============================================================
`;

/**
 * rules.js を作る。
 * @param {{ write?: boolean }} opts write=false ならファイルに書かず、中身の文字列を返す
 */
export async function buildRules({ write = true } = {}) {
  const out = await build({
    configFile: false,
    root,
    logLevel: 'silent',
    build: {
      lib: {
        entry: `${root}src/game/rules/index.ts`,
        name: 'GameRules',
        formats: ['iife'],
        fileName: () => 'rules.js',
      },
      outDir: `${root}tools/editor`,
      emptyOutDir: false,
      write: false,
      minify: false,
      target: 'es2020',
    },
  });
  const result = Array.isArray(out) ? out[0] : out;
  const chunk = result.output.find((o) => o.type === 'chunk');
  const code = BANNER + chunk.code;
  if (write) {
    const { writeFileSync } = await import('node:fs');
    writeFileSync(`${root}tools/editor/rules.js`, code, 'utf8');
  }
  return code;
}

// コマンドラインから実行されたとき
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  buildRules().then(() => console.log('tools/editor/rules.js を作りました'));
}
