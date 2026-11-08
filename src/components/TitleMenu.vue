<script setup lang="ts">
// ============================================================
// タイトル画面（メニュー）。Vue はこういう「画面の部品」だけに使う
// ============================================================
import { onMounted, onUnmounted } from 'vue';

const emit = defineEmits<{ start: [] }>();

// Enter でも始められるように
function onKey(e: KeyboardEvent) {
  if (e.code === 'Enter' || e.code === 'KeyJ') emit('start');
}
onMounted(() => window.addEventListener('keydown', onKey));
onUnmounted(() => window.removeEventListener('keydown', onKey));
</script>

<template>
  <main class="title">
    <h1>ムーンエリカ</h1>
    <p class="sub">段階1：骨組み（開発版）</p>
    <button class="start" @click="emit('start')">トレーニング開始（Enter）</button>

    <section class="help">
      <h2>操作</h2>
      <table>
        <tbody>
        <tr><th>移動</th><td>WASD または 矢印キー（ゲームパッド：十字・左スティック）</td></tr>
        <tr><th>P / K / S</th><td>J / K / L（パッド：X□ / A× / B○）</td></tr>
        <tr><th>P+K（投げ）</th><td>U（パッド：Y△）、または J と K を同時に</td></tr>
        <tr><th>全部ボタン</th><td>I（パッド：R1）</td></tr>
        <tr><th>ステップ</th><td>前を2回（66）／後ろを2回（44）</td></tr>
        </tbody>
      </table>
      <h2>技（仮のコマンド）</h2>
      <table>
        <tbody>
        <tr><th>月回転</th><td>S → 回転中に P（月押し出し）／ K（置き対空）</td></tr>
        <tr><th>対空</th><td>↘ + S（3+S）</td></tr>
        <tr><th>突進</th><td>← + S（4+S、後ろ）</td></tr>
        <tr><th>超必殺</th><td>→ + P + S（6+P+S）／ → + I</td></tr>
        <tr><th>前K（中段）</th><td>→ + K</td></tr>
        </tbody>
      </table>
      <h2>開発用</h2>
      <table>
        <tbody>
        <tr><th>1〜7, 0</th><td>判定表示／一時停止／コマ送り／保存／復元／決定性チェック／デバッグ表示／最初から</td></tr>
        <tr><th>8</th><td>ダミーの状態：ニュートラル → しゃがみ → 立ちガード → しゃがみガード → 垂直ジャンプ</td></tr>
        <tr><th>9</th><td>ダミーをカウンターヒットにする／しない</td></tr>
        <tr><th>F4</th><td>判定エディタと切り替え（npm run dev のときだけ）。今出している技が開き、戻ると変更が反映・保存される</td></tr>
        <tr><th>Esc</th><td>この画面に戻る</td></tr>
        </tbody>
      </table>
    </section>
  </main>
</template>

<style scoped>
.title {
  max-width: 760px;
  margin: 0 auto;
  padding: 48px 20px;
  text-align: center;
}
h1 {
  font-size: 56px;
  margin: 0;
  letter-spacing: 0.1em;
  color: #ffe9a8;
}
.sub {
  opacity: 0.7;
  margin: 8px 0 32px;
}
.start {
  font-size: 22px;
  padding: 14px 36px;
  border: 0;
  border-radius: 10px;
  background: #ffe28a;
  color: #1b1d2b;
  cursor: pointer;
}
.start:hover {
  background: #fff0b8;
}
.help {
  margin-top: 40px;
  text-align: left;
}
.help h2 {
  font-size: 16px;
  margin: 24px 0 8px;
  color: #aab4ff;
}
table {
  width: 100%;
  border-collapse: collapse;
  font-size: 14px;
}
th {
  width: 140px;
  text-align: left;
  font-weight: normal;
  opacity: 0.7;
  padding: 4px 8px;
  vertical-align: top;
}
td {
  padding: 4px 8px;
}
tr + tr {
  border-top: 1px solid #ffffff14;
}
</style>
