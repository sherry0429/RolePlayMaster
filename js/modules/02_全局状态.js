/**
     * 模块: 全局状态
     * 该文件由自动拆分工具生成
     * 后续建议继续手动细化
     */

    import { state } from '../core/state.js';
    import * as CONSTANTS from '../core/constants.js';

    let appData = null;     // 应用数据
let currentChatId = null; // 当前聊天 ID
let isStreaming = false;  // 是否正在流式输出
let isCompressing = false; // 是否正在压缩记忆
let abortController = null; // 用于中断请求
let requestLog = [];     // 最近请求日志（内存中，仅保留最近 N 条）