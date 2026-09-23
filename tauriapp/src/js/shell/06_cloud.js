/**
 * 06_cloud.js —— 云端同步传输层
 *
 * 背景（这是桌面版必须自己解决的一个硬问题）：
 *   桌面端 WebView 的来源是 tauri://localhost，云端接口默认在 https://poecurrency.top，
 *   两者不同源。而带 Authorization 头的请求会先触发 CORS 预检（OPTIONS），
 *   该服务端既不处理预检、也不返回任何 Access-Control-Allow-Origin 头，
 *   于是 WebView 内核直接拦截请求，前端只能拿到 onerror
 *   —— 表现为「网络错误，请检查云端地址是否可访问」。
 *
 *   网页版之所以一切正常，是因为它与接口同源，根本不涉及跨域。
 *
 * 因此这里把云端请求交给原生侧代发（src-tauri/src/lib.rs 的 cloud_get / cloud_post）：
 * 原生请求不受同源策略约束，且能顺带用 Channel 上报真实下载进度。
 *
 * 浏览器预览（非 Tauri 环境）下自动回退为直接请求，行为与网页版一致；
 * 但如果接口与页面不同源，浏览器同样会拦截——这是浏览器内核的限制，无法在页面内绕开。
 */

/** 是否由原生侧代发云端请求 */
function cloudUsesNative() {
  return !!(window.ShellNative && ShellNative.available);
}

/**
 * 创建下载进度通道。
 * 说明：Tauri 的 Channel 不能作为可选参数（Rust 侧 Option<Channel<T>> 无法反序列化），
 * 所以这里必须给出一个通道，未传 onProgress 时消息会被直接丢弃。
 */
function cloudCreateProgressChannel(onProgress) {
  var core = window.__TAURI__ && window.__TAURI__.core;
  if (!core || typeof core.Channel !== 'function') return null;
  var ch = new core.Channel();
  ch.onmessage = function (msg) {
    if (msg && typeof msg.loaded === 'number' && typeof onProgress === 'function') {
      onProgress(msg.loaded, msg.total || 0);
    }
  };
  return ch;
}

/** 把各种异常统一成可读文案 */
function cloudErrorMessage(e) {
  if (!e) return '未知错误';
  if (typeof e === 'string') return e;
  return e.message ? e.message : String(e);
}

/**
 * 云端请求统一入口（「同步到云端」与「从云端同步」都走这里）。
 *
 * @param {'GET'|'POST'} method
 * @param {string} url      完整请求地址
 * @param {string} token    同步 Token
 * @param {string} [body]   POST 请求体（JSON 字符串）
 * @param {(loaded:number,total:number)=>void} [onProgress] 仅原生 GET 有效
 * @returns {Promise<{ok:boolean, status:number, body:string}>}
 *          结构与 fetch Response 对齐，但 body 是「字符串」而非方法。
 */
async function cloudRequest(method, url, token, body, onProgress) {
  // ---------- 桌面端：原生代发 ----------
  if (cloudUsesNative()) {
    var args = { url: url, token: token };
    if (method === 'POST') args.body = body || '';
    if (method === 'GET') {
      var ch = cloudCreateProgressChannel(onProgress);
      if (!ch) {
        // 理论上不会发生：Channel 与 invoke 来自同一个全局 API 包
        throw new Error('当前运行环境缺少进度通道接口，无法发起云端请求');
      }
      args.onProgress = ch;
    }

    var reply;
    try {
      reply = await ShellNative.invoke(method === 'POST' ? 'cloud_post' : 'cloud_get', args);
    } catch (e) {
      // 原生侧已经把连接失败/超时等情况整理成中文文案
      throw new Error(cloudErrorMessage(e));
    }
    if (!reply || typeof reply !== 'object') {
      throw new Error('云端请求未返回数据');
    }
    return {
      ok: !!reply.ok,
      status: reply.status || 0,
      body: reply.body || ''
    };
  }

  // ---------- 浏览器预览：直接请求 ----------
  var init = {
    method: method,
    cache: 'no-store',
    headers: { 'Authorization': 'Bearer ' + token }
  };
  if (method === 'POST') {
    init.headers['Content-Type'] = 'application/json';
    init.body = body || '';
  }

  var resp;
  try {
    resp = await fetch(url, init);
  } catch (e) {
    throw new Error('网络错误，请检查云端地址是否可访问'
      + '（浏览器预览模式受同源策略限制，若云端接口未开启 CORS 会被浏览器直接拦截，请在桌面版中使用）');
  }
  return { ok: resp.ok, status: resp.status, body: await resp.text() };
}
