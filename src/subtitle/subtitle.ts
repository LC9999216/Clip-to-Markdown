/**
 * 字幕页外壳（Task 6）：仅静态导航与设置入口。
 * 字幕加载、轨道切换、缓存与播放同步由 Task 7/8 在此文件实现。
 */

function openSettings(): void {
  chrome.runtime.openOptionsPage();
}

function boot(): void {
  const settings = document.getElementById('action-settings');
  if (settings instanceof HTMLButtonElement) settings.onclick = openSettings;
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
  boot();
}

export {};
