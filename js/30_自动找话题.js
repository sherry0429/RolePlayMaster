
/**
 * 自动找话题
 * 自动拆分模块
 * 保持全局兼容模式
 */

var autoTopicTimer = null;
var lastActivityTime = Date.now();
var autoTopicCount = 0; // 当前连续触发次数
var autoTopicCountdownTimer = null; // 倒计时定时器
var isAutoTopicRunning = false; // 互斥锁，防止并发触发

