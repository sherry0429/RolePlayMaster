
/**
 * 全局状态
 * 自动拆分模块
 * 保持全局兼容模式
 */

var appData = null;     // 应用数据
var currentChatId = null; // 当前聊天 ID
var isStreaming = false;  // 是否正在流式输出
var isCompressing = false; // 是否正在压缩记忆
var abortController = null; // 用于中断请求
var programLog = [];     // 程序日志（最多 200 条，记录所有交互）

// 拍照功能状态
var isPhotoShooting = false;   // 是否正在拍摄中（仅用于防止并发拍照）
var photoAbortController = null; // 拍摄请求中止控制器

