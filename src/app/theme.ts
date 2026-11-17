// 皮相（UI 主题）的读取与落地。
//
// 和水墨 / 霓虹两套 3D 场景皮肤一一对应：切主题时同时做两件事——
// 给 <html data-theme> 让 theme.css 换一套变量，再让 Renderer.setTheme() 换一套 3D 皮肤。
//
// 存 localStorage 而不是存档：这是"看起来什么样"，不属于游戏进度，
// 换设备/清档都不该丢失，也不必进 PersistedState 的迁移链。

export type UiTheme = 'ink' | 'cyber';

export const THEME_OPTIONS: Array<{ id: UiTheme; name: string }> = [
  { id: 'ink', name: '水墨' },
  { id: 'cyber', name: '霓虹' },
];

const STORAGE_KEY = 'zhiyu-theme';

export function isUiTheme(v: unknown): v is UiTheme {
  return v === 'ink' || v === 'cyber';
}

// localStorage 在隐私模式/被禁用时会抛，读不到就当水墨
export function readTheme(): UiTheme {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return isUiTheme(raw) ? raw : 'ink';
  } catch {
    return 'ink';
  }
}

export function saveTheme(theme: UiTheme): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // 存不下就只在本次会话生效，不影响使用
  }
}

// 把主题挂到 <html> 上，theme.css 里 :root[data-theme='cyber'] 覆盖变量
export function applyThemeToDom(theme: UiTheme): void {
  document.documentElement.dataset.theme = theme;
}
