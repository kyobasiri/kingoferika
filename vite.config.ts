import { defineConfig, type Plugin } from 'vite';
import vue from '@vitejs/plugin-vue';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildRules } from './scripts/build-rules.mjs';

const root = fileURLToPath(new URL('.', import.meta.url));

/**
 * 開発用：判定エディタをゲームの中から開くための仕組み（npm run dev のときだけ動く）
 * ------------------------------------------------------------
 * ① /chars/<キャラID>/__editor.html で tools/editor/editor.html を返す。
 *    キャラのフォルダの中に見せかけるので、エディタが読む画像（atlas_0.webp など）が
 *    そのまま public/chars/<キャラID>/ から読める。
 * ② POST /__dev/save-char でエディタの内容を public/chars/<キャラID>/<キャラID>.all.json に保存する。
 * ③ /chars/<キャラID>/rules.js で、src/game/rules から作った「計算の決まり」を返す（エディタとゲームで共通の計算）。
 *    src/game/rules を直すと、次にエディタを開いたときから新しい決まりになる。
 * ビルド（公式サイトに載せるもの）には、エディタも保存の仕組みも入らない。
 */
function devEditorPlugin(): Plugin {
  return {
    name: 'moon-erika-dev-editor',
    apply: 'serve',
    configureServer(server) {
      // rules.js は作るのに少し時間がかかるので、src/game/rules が変わるまで作ったものを使い回す
      let rulesCache: Promise<string> | null = null;
      server.watcher.on('change', (file) => {
        if (/src[\\/]game[\\/]rules[\\/]/.test(file)) rulesCache = null;
      });
      server.middlewares.use((req, res, next) => {
        const url = (req.url || '').split('?')[0];

        // ① エディタを返す
        const m = url.match(/^\/chars\/([a-z0-9_]+)\/__editor\.html$/);
        if (m && req.method === 'GET') {
          const html = readFileSync(`${root}tools/editor/editor.html`, 'utf8');
          res.setHeader('Content-Type', 'text/html; charset=utf-8');
          res.setHeader('Cache-Control', 'no-store');
          res.end(html);
          return;
        }

        // ③ 計算の決まり（rules.js）
        if (/^\/chars\/[a-z0-9_]+\/rules\.js$/.test(url) && req.method === 'GET') {
          rulesCache ??= buildRules({ write: false });
          rulesCache
            .then((code) => {
              res.setHeader('Content-Type', 'text/javascript; charset=utf-8');
              res.setHeader('Cache-Control', 'no-store');
              res.end(code);
            })
            .catch((e) => {
              rulesCache = null;
              res.statusCode = 500;
              res.end(`// rules.js を作れませんでした：${String(e)}`);
            });
          return;
        }

        // ② 技データを保存する
        if (url === '/__dev/save-char' && req.method === 'POST') {
          let body = '';
          req.on('data', (c) => (body += c));
          req.on('end', () => {
            try {
              const { id, json } = JSON.parse(body) as { id: string; json: string };
              // キャラIDは英小文字・数字・_ だけ（フォルダの外に書き込ませない）
              if (!/^[a-z0-9_]+$/.test(id)) throw new Error('キャラIDが不正です');
              const dir = `${root}public/chars/${id}`;
              if (!existsSync(dir)) throw new Error(`フォルダがありません：public/chars/${id}`);
              JSON.parse(json); // 壊れたJSONは保存しない
              writeFileSync(`${dir}/${id}.all.json`, json, 'utf8');
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ ok: true }));
            } catch (e) {
              res.statusCode = 400;
              res.end(JSON.stringify({ ok: false, error: String(e) }));
            }
          });
          return;
        }
        next();
      });
    },
    // 保存したJSONの変更でページが再読み込みされないようにする（ゲームには直接反映するため）
    handleHotUpdate({ file }) {
      if (/public[\\/]chars[\\/].*\.json$/.test(file)) return [];
    },
  };
}

// base: './' にしておくと、公式サイトの /game/ のような下の階層や、
// 将来の Tauri（ファイルから読み込む）でも同じビルドがそのまま動く
export default defineConfig({
  base: './',
  plugins: [vue(), devEditorPlugin()],
  build: {
    target: 'es2022',
  },
});
