/**
 * 图像生成供应商抽象层
 *
 * 拍照链路（28_photo.js）只关心「给一段 prompt，拿回一张图」，不关心背后是谁生成的。
 * 新增供应商只需两步：
 *   1) registerImageProvider({ id, label, isReady, generate })
 *   2) 在「设置 → 图像」里加一个子 Tab 配置块，并在 03_model / 04_storage 补默认值
 *
 * 约定：
 *   - isReady():  配置是否可用（决定拍照入口是否显示、是否真的去生成）
 *   - generate(prompt, { width, height }, signal) → Promise<{ dataUrl } | null>
 *     失败返回 null（由上层统一提示「图片生成失败」），AbortError 需原样抛出
 */

var _imageProviders = {};
var _imageProviderOrder = [];

/** 注册一个图像生成供应商 */
function registerImageProvider(def) {
  if (!def || !def.id) return;
  if (!_imageProviders[def.id]) _imageProviderOrder.push(def.id);
  _imageProviders[def.id] = def;
}

/** 当前使用的供应商 id（设置 → 图像 里的「使用中」） */
function activeImageProviderId() {
  return (appData.settings && appData.settings.imageProvider) || 'comfyui';
}

function getImageProvider(id) {
  return _imageProviders[id || activeImageProviderId()] || null;
}

function activeImageProvider() {
  return getImageProvider(activeImageProviderId());
}

/** 全部已注册供应商（按注册顺序） */
function listImageProviders() {
  return _imageProviderOrder.map(function (id) { return _imageProviders[id]; });
}

/** 切换当前供应商（同时保证只有一个是「启用」态） */
function setActiveImageProvider(id) {
  if (!_imageProviders[id]) return;
  appData.settings.imageProvider = id;
  // 互斥：只有当前供应商处于启用态，避免两个都开着造成歧义
  if (appData.settings.comfyui) appData.settings.comfyui.enabled = (id === 'comfyui');
  if (appData.settings.siliconflow) appData.settings.siliconflow.enabled = (id === 'siliconflow');
}

/** 拍照功能是否可用：当前供应商配置齐全 */
function isPhotoProviderReady() {
  var p = activeImageProvider();
  return !!(p && p.isReady());
}

/**
 * 统一生图入口：拿到 prompt 后交给当前供应商。
 * @returns {Promise<{dataUrl:string}|null>}
 */
async function callImageProvider(prompt, opts, signal) {
  var p = activeImageProvider();
  if (!p || !p.isReady()) return null;
  return await p.generate(prompt, opts || {}, signal);
}

/**
 * 带超时的 fetch。
 * - 用户取消 → AbortError（原样抛出，上层识别为「已取消」）
 * - 等待超时 → TimeoutError（与取消区分开，便于定位）
 */
async function fetchWithTimeout(url, options, timeoutSec, externalSignal) {
  var ctrl = new AbortController();
  var timedOut = false;
  var onExternalAbort = function () { ctrl.abort(); };
  if (externalSignal) {
    if (externalSignal.aborted) ctrl.abort();
    else externalSignal.addEventListener('abort', onExternalAbort);
  }
  var timer = setTimeout(function () {
    timedOut = true;
    ctrl.abort();
  }, Math.max(5, timeoutSec) * 1000);
  try {
    return await fetch(url, Object.assign({}, options, { signal: ctrl.signal }));
  } catch (e) {
    if (timedOut) {
      var terr = new Error('请求超时（超过 ' + timeoutSec + ' 秒）');
      terr.name = 'TimeoutError';
      throw terr;
    }
    throw e;
  } finally {
    clearTimeout(timer);
    if (externalSignal) externalSignal.removeEventListener('abort', onExternalAbort);
  }
}

/** 最近一次生图失败的完整详情（拍照流程会把它写进日志/聊天消息） */
var _lastImageGenError = null;

/** 统一的失败落日志：把请求参数、HTTP 状态、响应体、异常都记下来，便于用户自查 */
function logImageFailure(providerLabel, step, info) {
  info = info || {};
  _lastImageGenError = {
    provider: providerLabel,
    step: step,
    summary: info.summary || '',
    request: info.request || null,
    httpStatus: info.httpStatus !== undefined ? info.httpStatus : null,
    responseBody: info.responseBody !== undefined ? info.responseBody : null,
    error: info.error || null,
    elapsedMs: info.elapsedMs !== undefined ? info.elapsedMs : null,
    time: new Date().toLocaleString()
  };
  addProgramLog(LOG_TYPE_ERROR, {
    summary: '拍照失败 — ' + providerLabel + ' · ' + step + (info.summary ? '：' + info.summary : ''),
    chatName: (currentChatId && appData.chats[currentChatId]) ? appData.chats[currentChatId].name : '',
    detail: _lastImageGenError
  });
}

// ==================== 供应商 1：ComfyUI Local ====================

registerImageProvider({
  id: 'comfyui',
  label: 'ComfyUI Local',
  /** 本机 ComfyUI：启用 + 已上传工作流 */
  isReady: function () {
    var c = appData.settings.comfyui || {};
    return !!c.enabled && !!c.workflowJson;
  },
  generate: function (prompt, opts, signal) {
    // 具体实现在 28_photo.js（工作流注入 / 轮询 /history）
    return callComfyUI(prompt, opts.width, opts.height, signal);
  }
});

// ==================== 供应商 2：硅基流动 SiliconFlow ====================

/** 硅基流动当前只支持这一个模型（实测 1024x1024 / 768x1024 / 1024x768 / 1328x1328 等尺寸均可用） */
var SILICONFLOW_MODEL = 'Tongyi-MAI/Z-Image-Turbo';

function siliconflowSettings() {
  if (!appData.settings.siliconflow) {
    appData.settings.siliconflow = {
      enabled: false,
      apiHost: 'https://api.siliconflow.cn',
      apiKey: '',
      model: SILICONFLOW_MODEL,
      defaultWidth: 1024,
      defaultHeight: 1024,
      steps: 8,
      guidance: 7.5,
      negativePrompt: '',
      timeout: 120
    };
  }
  return appData.settings.siliconflow;
}

registerImageProvider({
  id: 'siliconflow',
  label: '硅基流动',
  isReady: function () {
    var s = siliconflowSettings();
    return !!s.enabled && !!s.apiKey;
  },
  generate: async function (prompt, opts, signal) {
    var s = siliconflowSettings();
    var apiHost = (s.apiHost || 'https://api.siliconflow.cn').replace(/\/+$/, '');
    var url = apiHost + '/v1/images/generations';

    var width = opts.width || s.defaultWidth || 1024;
    var height = opts.height || s.defaultHeight || 1024;

    // 固定单一模型：Tongyi-MAI/Z-Image-Turbo（Turbo 模型，步数少即可出图）
    var body = {
      model: SILICONFLOW_MODEL,
      prompt: prompt,
      image_size: width + 'x' + height,
      batch_size: 1,
      num_inference_steps: Math.max(1, Math.min(100, parseInt(s.steps, 10) || 8))
    };
    if (s.negativePrompt) body.negative_prompt = s.negativePrompt;
    var model = body.model;

    // 请求快照（不含 API Key），失败时原样记入日志便于核对
    var reqInfo = {
      url: url,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ***' },
      body: body
    };
    var t0 = Date.now();

    try {
      addProgramLog(LOG_TYPE_PHOTO, {
        summary: '硅基流动生成图片（' + body.model + '）',
        chatName: (currentChatId && appData.chats[currentChatId] ? appData.chats[currentChatId].name : '') + LOG_NAME_PHOTO,
        detail: '模型：' + body.model +
          '\n尺寸：' + body.image_size +
          '\n步数：' + body.num_inference_steps +
          (body.guidance_scale !== undefined ? '\n引导系数：' + body.guidance_scale : '') +
          (body.cfg !== undefined ? '\nCFG：' + body.cfg : '') +
          '\n\nPrompt:\n' + prompt
      });

      var resp = await fetchWithTimeout(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + s.apiKey
        },
        body: JSON.stringify(body)
      }, parseInt(s.timeout, 10) || 120, signal);

      if (!resp.ok) {
        var errText = await resp.text();
        logImageFailure('硅基流动', '生成接口返回 HTTP ' + resp.status, {
          request: reqInfo,
          httpStatus: resp.status,
          responseBody: String(errText).slice(0, 3000),
          elapsedMs: Date.now() - t0
        });
        return null;
      }

      var data = await resp.json();
      var imgUrl = data && data.images && data.images[0] && data.images[0].url;
      if (!imgUrl) {
        logImageFailure('硅基流动', '响应中没有图片地址', {
          request: reqInfo,
          httpStatus: resp.status,
          responseBody: JSON.stringify(data).slice(0, 3000),
          elapsedMs: Date.now() - t0
        });
        return null;
      }

      // 返回的 URL 仅 1 小时有效 → 立即下载并存为 dataURL
      var dlResp;
      try {
        dlResp = await fetchWithTimeout(imgUrl, {}, parseInt(s.timeout, 10) || 120, signal);
      } catch (dlErr) {
        if (dlErr.name === 'AbortError') throw dlErr;
        logImageFailure('硅基流动', '下载生成的图片失败', {
          request: { url: imgUrl.split('?')[0], method: 'GET' },
          error: dlErr.name + ': ' + dlErr.message,
          elapsedMs: Date.now() - t0
        });
        return null;
      }
      if (!dlResp.ok) {
        logImageFailure('硅基流动', '图片下载返回 HTTP ' + dlResp.status, {
          request: { url: imgUrl.split('?')[0], method: 'GET' },
          httpStatus: dlResp.status,
          elapsedMs: Date.now() - t0
        });
        return null;
      }
      var blob = await dlResp.blob();
      var dataUrl;
      try {
        dataUrl = await blobToBase64(blob);
      } catch (convErr) {
        logImageFailure('硅基流动', '图片数据转换失败', {
          request: { url: imgUrl.split('?')[0] },
          error: convErr.name + ': ' + convErr.message,
          elapsedMs: Date.now() - t0
        });
        return null;
      }

      addProgramLog(LOG_TYPE_PHOTO, {
        summary: '硅基流动出图完成',
        chatName: (currentChatId && appData.chats[currentChatId] ? appData.chats[currentChatId].name : '') + LOG_NAME_PHOTO,
        detail: { seed: data.seed, timings: data.timings, model: body.model }
      });
      return { dataUrl: dataUrl };
    } catch (e) {
      if (e.name === 'AbortError') throw e;
      console.error('硅基流动调用失败', e);
      logImageFailure('硅基流动', e.name === 'TimeoutError' ? '请求超时' : '请求异常', {
        request: reqInfo,
        error: e.name + ': ' + e.message,
        elapsedMs: Date.now() - t0
      });
      return null;
    }
  }
});
