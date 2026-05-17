/**
     * 模块: 发送消息
     * 该文件由自动拆分工具生成
     * 后续建议继续手动细化
     */

    import { state } from '../core/state.js';
    import * as CONSTANTS from '../core/constants.js';

    function handleInputKeydown(e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
}

function autoResizeInput() {
  const ta = document.getElementById('userInput');
  ta.style.height = 'auto';
  ta.style.height = Math.min(ta.scrollHeight, 120) + 'px';
}

function sendMessage() {
  if (isStreaming || isCompressing || isReplaying) return;
  const input = document.getElementById('userInput');
  const text = input.value.trim();
  if (!text) return;
  // 用户发送消息，重置自动话题触发计数和计时器
  autoTopicCount = 0;
  lastActivityTime = Date.now();
  updateCountdownDisplay();
  if (!currentChatId) {
    newChat();
  }

  // /记忆 命令：立即触发 System Prompt 更新，消息不进入聊天
  if (text === '/记忆') {
    input.value = '';
    input.style.height = 'auto';
    compressChat();
    return;
  }

  // /继续 命令：继续输出新的助手消息，不新增用户气泡
  if (text === '/继续') {
    input.value = '';
    input.style.height = 'auto';
    if (!currentChatId) {
      showToast('请先开始一个对话', 'error');
      return;
    }
    const chat = appData.chats[currentChatId];
    if (!chat || chat.messages.length === 0) {
      showToast('请先发送消息再继续', 'error');
      return;
    }
    // 直接触发 AI 继续请求
    requestAI();
    return;
  }

  const chat = appData.chats[currentChatId];
  chat.messages.push({ role: 'user', content: text });
  saveData();
  input.value = '';
  input.style.height = 'auto';
  // 重置渲染数量，确保新消息可见
  resetRenderedCount();
  renderMessages();
  // 发送 AI 请求
  requestAI();
}