<script setup lang="ts">
// ============================================================
// 対戦画面。canvas を1枚置いて、ゲーム本体（Game）に渡すだけ
// ------------------------------------------------------------
// ・ゲームの計算・描画は Game の中で行い、Vue は毎フレームの更新に関わらない
//   （Vue の画面更新がゲームのフレームを遅らせないようにするため）
// ・読み込み中の表示と、Esc でタイトルに戻る処理
// ・開発中だけ：F4 で判定エディタと切り替える
//     ゲーム → エディタ：ゲームを止め、今出している技をエディタで開く
//     エディタ → ゲーム：エディタの内容をゲームに反映し、ファイルにも保存して続きから動かす
// ============================================================
import { onMounted, onUnmounted, ref } from 'vue';
import { Game, loadCharacter } from '../game/index.ts';
import { EditorBridge, saveCharacterFile } from '../dev/editorBridge.ts';
import { crossCheck } from '../dev/crossCheck.ts';

const emit = defineEmits<{ exit: [] }>();

const CHAR_ID = 'moon_erika';
/** 開発サーバー（npm run dev）のときだけ true。公式サイトに載せるビルドでは false */
const isDev = import.meta.env.DEV;

const canvas = ref<HTMLCanvasElement | null>(null);
const editorFrame = ref<HTMLIFrameElement | null>(null);
const loading = ref(true);
const progress = ref(0);
const progressText = ref('');
const error = ref('');
const editorOpen = ref(false);
const editorStatus = ref('');
let game: Game | null = null;
let bridge: EditorBridge | null = null;
let disposed = false;
let switching = false;

// ---------------- エディタとの切り替え ----------------

async function openEditor() {
  if (!game || !editorFrame.value || switching) return;
  switching = true;
  game.suspend();
  editorOpen.value = true;
  try {
    if (!bridge) {
      // 初回だけ iframe にエディタを読み込む（2回目からは開いたままのものを表示するだけ）
      editorStatus.value = 'エディタを読み込み中…';
      bridge = new EditorBridge(editorFrame.value, `${import.meta.env.BASE_URL}chars/${CHAR_ID}/__editor.html`);
      await bridge.whenReady();
      bridge.onKey((e) => {
        if (e.code === 'F4') {
          e.preventDefault();
          closeEditor();
        }
      });
    }
    const c = game.character;
    bridge.loadOnce(c.file, c.atlas);
    const cur = game.currentMove;
    bridge.select(cur.move, cur.frame);
    editorStatus.value = '';
    bridge.focus();
  } catch (e) {
    editorStatus.value = e instanceof Error ? e.message : String(e);
  } finally {
    switching = false;
  }
}

async function closeEditor() {
  if (!game || switching) return;
  switching = true;
  editorOpen.value = false;
  // ゲーム側でキーを受け取れるよう、iframe からフォーカスを戻す
  editorFrame.value?.blur();
  window.focus();
  try {
    if (bridge) {
      const data = bridge.getData();
      game.applyCharacterFile(data);
      // エディタとゲームの計算が同じ答えになっているかを照合（食い違いは開発者ツールのコンソールに一覧）
      const facts = bridge.getFacts();
      const diffs = facts ? crossCheck(game.character.def, facts) : [];
      if (diffs.length) console.warn('エディタとゲームの計算の食い違い', diffs);
      const checkText = !facts ? '' : diffs.length ? `　※計算の食い違い${diffs.length}件（コンソール参照）` : '　計算の照合OK';
      try {
        await saveCharacterFile(data);
        game.notify('エディタの変更を反映しました（ファイルにも保存）' + checkText);
      } catch (e) {
        game.notify('反映しました（ファイルへの保存は失敗：' + (e instanceof Error ? e.message : String(e)) + '）' + checkText);
      }
    }
  } catch (e) {
    game.notify('反映できませんでした：' + (e instanceof Error ? e.message : String(e)));
  } finally {
    game.resume();
    switching = false;
  }
}

function onKey(e: KeyboardEvent) {
  if (e.code === 'Escape' && !editorOpen.value) emit('exit');
  if (e.code === 'F4' && isDev) {
    e.preventDefault();
    if (editorOpen.value) closeEditor();
    else openEditor();
  }
}

onMounted(async () => {
  window.addEventListener('keydown', onKey);
  try {
    // public/ に置いたファイルは BASE_URL からの相対で読む（公式サイトの下の階層でも動く）
    const dir = `${import.meta.env.BASE_URL}chars/${CHAR_ID}/`;
    const loaded = await loadCharacter(dir, `${CHAR_ID}.all.json`, (r, text) => {
      progress.value = r;
      progressText.value = text;
    });
    if (disposed || !canvas.value) return;
    // 今はトレーニングだけ。対戦モードを作ったら mode: 'match' で出す（コンボ数だけ表示）
    game = new Game(canvas.value, loaded, { mode: 'training' });
    game.start();
    loading.value = false;
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  }
});

onUnmounted(() => {
  disposed = true;
  window.removeEventListener('keydown', onKey);
  game?.destroy();
  game = null;
});
</script>

<template>
  <div class="wrap">
    <canvas ref="canvas" class="screen" />

    <!-- 開発中だけ：判定エディタ（F4で切り替え） -->
    <div v-if="isDev" v-show="editorOpen" class="editor">
      <div class="editor-bar">
        <button @click="closeEditor">◀ ゲームに戻る（F4）</button>
        <span>戻ると、変更がゲームに反映され、public/chars/{{ CHAR_ID }}/{{ CHAR_ID }}.all.json に保存されます</span>
        <span v-if="editorStatus" class="status">{{ editorStatus }}</span>
      </div>
      <iframe ref="editorFrame" class="editor-frame" title="判定エディタ" />
    </div>

    <div v-if="loading" class="overlay">
      <template v-if="!error">
        <p>読み込み中… {{ progressText }}</p>
        <div class="bar"><div class="fill" :style="{ width: progress * 100 + '%' }" /></div>
      </template>
      <p v-else class="err">{{ error }}</p>
    </div>
  </div>
</template>

<style scoped>
.wrap {
  position: relative;
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #000;
}
/* 内部の大きさは 1778×1000 固定。表示だけ画面に合わせて縮める（縦横比は保つ） */
.screen {
  width: min(100vw, calc(100vh * 16 / 9));
  height: auto;
  aspect-ratio: 16 / 9;
  display: block;
}
.editor {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  background: #111;
  z-index: 10;
}
.editor-bar {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 6px 12px;
  background: #1b1d2b;
  font-size: 13px;
  color: #aab4ff;
}
.editor-bar button {
  padding: 6px 14px;
  border: 0;
  border-radius: 6px;
  background: #ffe28a;
  color: #1b1d2b;
  cursor: pointer;
  font-size: 14px;
}
.editor-bar .status {
  color: #ffe28a;
}
.editor-frame {
  flex: 1;
  width: 100%;
  border: 0;
  background: #fff;
}
.overlay {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  background: #07080f;
  z-index: 20;
}
.bar {
  width: 320px;
  height: 8px;
  border-radius: 4px;
  background: #ffffff22;
  overflow: hidden;
}
.fill {
  height: 100%;
  background: #ffe28a;
  transition: width 0.15s;
}
.err {
  color: #ff8a8a;
}
</style>
