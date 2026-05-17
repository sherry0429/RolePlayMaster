
/**
 * 消息编辑与删除
 * 自动拆分模块
 * 保持全局兼容模式
 */

function editMessage(idx) {
  if (!currentChatId || isStreaming || isCompressing || isReplaying) return;
  var chat = appData.chats[currentChatId];
  if (!chat || idx >= chat.messages.length) return;
  var msg = chat.messages[idx];
  var isUser = msg.role === 'user';

  // 使用弹框编辑
  showTextareaModal('编辑消息', msg.content, (val) => {
    var newContent = val.trim();
    if (!newContent) {
      showToast('内容不能为空', 'error');
      return;
    }
    // 编辑后删除从编辑起后续的所有消息
    chat.messages = chat.messages.slice(0, idx);
    chat.messages.push({ role: isUser ? 'user' : 'assistant', content: newContent });
    saveData();
    // 重置渲染数量，确保消息可见
    resetRenderedCount();
    renderMessages();

    // 如果是用户消息，编辑保存后触发新的 AI 请求
    if (isUser) {
      // 编辑消息相当于用户发送了消息，重置自动话题计数和计时器
      autoTopicCount = 0;
      lastActivityTime = Date.now();
      updateCountdownDisplay();
      requestAI();
    }
  });
}

function deleteMessage(idx) {
  if (!currentChatId || isStreaming || isCompressing || isReplaying) return;
  var chat = appData.chats[currentChatId];
  if (!chat || idx >= chat.messages.length) return;
  if (!confirm('确定删除这条消息吗？')) return;
  // 删除该消息及后续所有消息
  chat.messages = chat.messages.slice(0, idx);
  saveData();
  renderMessages();
}

