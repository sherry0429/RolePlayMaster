// 模块: 自动找话题

    let autoTopicTimer = null;
let lastActivityTime = Date.now();
let autoTopicCount = 0; // 当前连续触发次数
let autoTopicCountdownTimer = null; // 倒计时定时器
let isAutoTopicRunning = false; // 互斥锁，防止并发触发