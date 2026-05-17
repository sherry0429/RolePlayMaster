
/**
 * 快捷指令
 * 自动拆分模块
 * 保持全局兼容模式
 */

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
  var chat = appData.chats[currentChatId];
  if (!chat || chat.messages.length === 0) {
    showToast('请先发送消息再继续', 'error');
    return;
  }
  requestAI();
}

