/**
 * Background Service Worker 入口（ESM，manifest 中 type: "module"）。
 * 仅做装配：注册消息/端口处理器，并在首次安装时打印一条中文提示。
 * 硬性约束：启动阶段不发起任何网络请求、不读取 Key、不弹通知。
 */
import { registerMessageHandler, registerPortHandler } from './handlers';

registerMessageHandler();
registerPortHandler();

// 点击工具栏图标打开设置页（action 未配置 default_popup，故由本监听器接管）。
// chrome.action / chrome.runtime.openOptionsPage 均无需额外权限。
chrome.action.onClicked.addListener(() => {
  chrome.runtime.openOptionsPage();
});

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    console.log('[boss-ai] 扩展已安装：请先在设置页配置服务商与 API Key，再在 BOSS直聘 页面使用。');
  }
});
