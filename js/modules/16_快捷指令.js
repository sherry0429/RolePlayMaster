/**
     * 模块: 快捷指令
     * 该文件由自动拆分工具生成
     * 后续建议继续手动细化
     */

    import { state } from '../core/state.js';
    import * as CONSTANTS from '../core/constants.js';

    function triggerMemory() {
  if (isStreaming || isCompressing) return;
  if (!currentChatId) {
    showToast('请先开始一个对话', 'error');
    return;
  }
  compressChat();
}

function triggerContinue() {
  if (isStreaming || isCompressing) return;
  if (!currentChatId) {
    showToast('请先开始一个对话', 'error');
    return;
  }
  const chat = appData.chats[currentChatId];
  if (!chat || chat.messages.length === 0) {
    showToast('请先发送消息再继续', 'error');
    return;
  }
  requestAI();
}