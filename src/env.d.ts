/// <reference types="vite/client" />

// .vue ファイルを TypeScript から読み込めるようにする宣言
declare module '*.vue' {
  import type { DefineComponent } from 'vue';
  const component: DefineComponent<object, object, unknown>;
  export default component;
}
