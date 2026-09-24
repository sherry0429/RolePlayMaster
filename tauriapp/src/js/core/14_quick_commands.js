
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
  // 先弹框确认，用户确认后再压缩（压缩会消耗 token 并改写 System Prompt）
  confirmDialog('整理当前对话的记忆并更新 System Prompt 吗？', {
    title: '记忆整理',
    okText: '开始整理'
  }).then(function (ok) {
    if (!ok) return;
    // 日志：手动触发记忆功能（确认后才记录并执行）
    addProgramLog(LOG_TYPE_MEMORY, {
      summary: '手动触发记忆功能',
      chatName: (appData.chats[currentChatId] || {}).name || ''
    });
    compressChat();
  });
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

