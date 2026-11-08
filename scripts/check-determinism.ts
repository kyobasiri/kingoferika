// ============================================================
// Node で決定性チェックを行う（ブラウザ無しで計算部分だけ動かす）
//   npm run check:det
// 計算部分がDOMに依存していないことの確認にもなる。
// ============================================================

import { readFileSync } from 'node:fs';
import { buildCharDef } from '../src/game/data/chardef.ts';
import type { AtlasFile, CharacterFile } from '../src/game/data/types.ts';
import { createInitialState, defaultStage } from '../src/game/sim/state.ts';
import { checkDeterminism } from '../src/game/devtools/determinism.ts';

const dir = new URL('../public/chars/moon_erika/', import.meta.url);
const file = JSON.parse(readFileSync(new URL('moon_erika.all.json', dir), 'utf8')) as CharacterFile;
const atlas = JSON.parse(readFileSync(new URL('atlas.json', dir), 'utf8')) as AtlasFile;
const def = buildCharDef(file, atlas);
const stage = defaultStage();
const ctx = { def, stage };

let allOk = true;
for (let seed = 1; seed <= 20; seed++) {
  const r = checkDeterminism(createInitialState(stage), ctx, 3600, seed);
  allOk &&= r.ok;
  console.log(`seed ${String(seed).padStart(2)}: ${r.ok ? 'OK ' : 'NG '} A=${r.hashA} B=${r.hashB} C=${r.hashC}`);
}
console.log(allOk ? '決定性チェック：すべて一致' : '決定性チェック：不一致あり');
process.exit(allOk ? 0 : 1);
