<script setup lang="ts">
// ============================================================
// 画面の切り替えだけを受け持つ（タイトル ⇔ 対戦画面）
// ゲームの中身はここには書かない
// ============================================================
import { ref } from 'vue';
import TitleMenu from './components/TitleMenu.vue';
import GameView from './components/GameView.vue';

const screen = ref<'title' | 'game'>('title');
</script>

<template>
  <TitleMenu v-if="screen === 'title'" @start="screen = 'game'" />
  <GameView v-else @exit="screen = 'title'" />
</template>
