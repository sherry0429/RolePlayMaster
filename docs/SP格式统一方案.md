# System Prompt 格式统一方案

> 目标：把 SP 从「Markdown 标题 + XML 标签 + 【】锚点」的混合格式，统一为**单一机器可读格式（XML）**，
> 同时保持 **拆分说话人 / 拍照 / 记忆压缩** 三大功能不变，并让 SP 编辑区可以渲染成「区块卡片、分区修改」。
>
> 适用范围：网页版（`js/`）与桌面版（`tauriapp/src/js/core/`）——两者业务模块逐行同源，方案一次落地、两边覆盖。

---

## 一、现状分析

### 1.1 当前 SP 的真实长相

以群聊初始化 / 记忆压缩产出的 SP 为例：

```
# 任务定义
你现在是一个多角色扮演模拟引擎……
- 回复时以角色名字用【】开头。
- <trigger type="photo" character="角色名" />   ← XML 协议标签混进任务定义

# 角色设定
【林梦】                                        ← 【】锚点
  <外貌>身高165cm……</外貌>                      ← XML 字段
  <身份>XX大学……</身份>
  <性格>温柔细腻……</性格>

# 背景故事
（一句话场景）

# 当前状态
无

# 回复样例
【林梦】……                                     ← 【】锚点复用
```

三种记号各司其职却互相纠缠：

| 记号 | 本意 | 被谁解析 |
|---|---|---|
| `# 标题` | 区块分隔 | `extractSection()` / `removeSection()` / `cleanAndRepairSp()`（`18_记忆.js`） |
| `<外貌>` 等 XML 标签 | 角色字段 | `buildPhotoRequestMessages()`（`33_拍照.js`，三重正则兜底：XML → 冒号 → 全局） |
| `【角色名】` | 角色锚点 | `buildPhotoRequestMessages()`（按角色切段）、`parsePhotoPrompts()`、`parseSpeakerSegments()` |

### 1.2 各功能当前对 SP 的依赖

| 功能 | 读 SP 的方式 | 痛点 |
|---|---|---|
| **记忆压缩** | `PROMPT_MEMORY` 用自然语言描述模板让 AI 重新输出全文；`cleanAndRepairSp()` 用 4 步正则去代码块/JSON 包裹/前导废话，再用 `extractSection()` 从旧版补缺失区块 | AI 输出格式漂移（漏标题、改标题、加废话）全靠正则兜底，补区块逻辑只能处理 2 个硬编码区块（任务定义/回复样例） |
| **拍照** | `buildPhotoRequestMessages()` 对 SP 做 `【(.+?)】` 切段 → 再试 `<外貌>` XML → 再试 `外貌：`冒号 → 再全局扫 | 三重 fallback 正则，任何一层格式微调都会静默失败（拍出外貌不符的照片） |
| **说话人拆分** | `parseSpeakerSegments()` 解析 **AI 回复**中的 `【角色名】`（消息层，不解析 SP 本身） | 稳定，但规则只存在于 `任务定义` 的自然语言里，没有结构化声明 |
| **自动拍照触发** | `extractAndStripPhotoTrigger()` 解析 **AI 回复**尾部的 `<trigger type="photo" .../>`（消息层） | 同上；且该指令作为纯文本拼进 `任务定义`，无法开关、无法卡片化管理 |
| **SP 编辑** | 一个大 textarea，全文替换 | 无法分区修改，无法做区块卡片渲染 |
| **群聊初始化** | `generateGroupSystemPrompt()` / `PROMPT_GROUP_INIT_TEMPLATE` 手工拼接混合格式 | 两个文件各拼一份「任务定义」，模板漂移风险 |

### 1.3 结论

SP 是这个应用的**核心数据结构**，但它的 schema 只存在于三处正则和几段自然语言 prompt 里。
统一格式 = 把 schema 显式化，让「AI 写、App 读、人编辑」三方共用同一份契约。

---

## 二、设计目标与原则

1. **单一格式**：SP 全文只用一种语言，AI 产出它、App 解析它、UI 编辑它，不再有三格式混排。
2. **消息层协议与 SP 格式分离**：`【角色名】`（说话人）是 **AI 回复的协议**，不是 SP 的格式——保留不动，作为结构化 `<rule>` 声明进 SP。拍照自动触发则更进一步：从「回复里的特殊标记」升级为 **function call（`take_photo` 工具）**，由设置开关控制（默认关闭），SP 里不再携带任何拍照触发指令（详见第十章）。
3. **解析鲁棒**：格式损坏时能降级（保留旧版 / 补缺失节点），绝不因解析失败丢掉用户记忆。
4. **向后兼容**：旧版本 SP 懒迁移，原始文本永久保留，可回退。
5. **两端同源**：新增解析模块放进 `core/`（网页 `js/` 与 `tauriapp/src/js/core/` 各放一份同名文件），符合现有「复用而不是重写」的架构。

### 2.1 为什么选 XML 而不是 Markdown / YAML / JSON

| 候选 | 评价 |
|---|---|
| 纯 Markdown 标题 | 嵌套结构（每个角色 4 个字段）表达不了，解析仍靠正则——就是现状的根源 |
| YAML | LLM 写 YAML 缩进错误率高；正文多行文本需要转义或缩进纪律，压缩任务失败率会明显上升 |
| JSON | 多段中文散文塞进字符串转义地狱，LLM 最容易写坏；作为 system prompt 可读性最差 |
| **XML（类 HTML 标签）** | ✅ 现有 `<外貌>` 标签已证明 LLM 能稳定输出该风格；浏览器自带 `DOMParser`，解析零依赖；区块 ↔ 顶层标签天然一一对应，正好映射卡片；文本节点无需转义换行 |

> 关键洞察：现状里 LLM 其实已经在写 XML（`<外貌>`、`<trigger>`），只是被包在 Markdown 骨架里。
> 方案不是「引入新格式」，而是**去掉 Markdown 骨架，让 XML 收编全部结构**。

---

## 三、新格式定义（SPX：System Prompt XML）

### 3.1 完整示例

```xml
<roleplay_sp format="1">
  <task>
你现在是一个多角色扮演模拟引擎，负责驱动一个叙事世界。你的任务是：
- 严格遵循指定角色的身份、性格、知识背景和说话风格。
- 用户：根据关系和性格有对应亲密称呼，默认为你。
- 推动符合当前世界观下的合理剧情发展。
- 在需要时自动完成各角色之间的对话、必要时包括行动和内在心理描写。
  </task>

  <characters>
    <character name="林梦">
      <identity>XX大学文学系大二学生，学生会文艺部部长……</identity>
      <appearance>身高165cm，一头柔顺的黑色长发垂至腰际……</appearance>
      <personality>温柔细腻但内心坚韧，偶尔流露出俏皮的一面……</personality>
      <history>从小学习古筝，参加过多场市级演出……</history>
    </character>
    <character name="苏晴">
      <identity>……</identity>
      <appearance>……</appearance>
      <personality>……</personality>
      <history>……</history>
    </character>
  </characters>

  <backstory>深夜的图书馆闭馆前，林梦发现苏晴偷偷撕掉了自己借书卡上的预约记录……</backstory>

  <state>无</state>

  <samples>
    <sample char="林梦">「诶？你、你别突然凑这么近啦……书都要被你挡住了。」</sample>
    <sample char="苏晴">「迟到一分钟就要罚你陪我喝一杯咖啡，这可是规矩。」</sample>
  </samples>

  <rules>
    <rule id="speaker-format">回复时以角色名字用【】开头分段。除角色名外，消息内不再出现【】字符。旁白直接加在文本开始或结尾。</rule>
  </rules>
</roleplay_sp>
```

### 3.2 Schema 约定

| 顶层节点 | 必需 | 卡片名 | 说明 |
|---|---|---|---|
| `<task>` | ✅ | 任务定义 | 压缩时原封不动保留（对齐现有 PROMPT_MEMORY 规则） |
| `<characters>` | ✅ | 角色设定 | 内部 `name` 属性定位角色；四个子字段 `identity/appearance/personality/history` 对应现有 `<身份/外貌/性格/经历>` |
| `<backstory>` | ✅ | 背景故事 | ≤100 字（由压缩 prompt 约束） |
| `<state>` | ✅ | 当前状态 | 新增为标准区块（现有 SP 已有 `# 当前状态` 但解析器不认识它） |
| ~~`<items>`~~ | — | ~~特殊物品~~ | **已按需求移除**：解析时忽略、序列化不再输出；旧数据中的 `<items>` 在下次写入时消失 |
| `<samples>` | 可选 | 回复样例 | `char` 属性标记说话人 |
| `<rules>` | ✅ | 行为规则 | 结构化协议声明；`id="speaker-format"` 由 App 写入，压缩时**永不改写**。拍照触发**不放这里**——它走 function call（第十章），属于请求参数而非 SP 内容 |
| 根节点属性 `format="1"` | ✅ | — | 格式版本号，未来演进用 |

**规则：**
- App 未识别的顶层标签 → 渲染为「自定义区块」卡片，原样保留（前向兼容）。
- 未识别的 `<character>` 子字段 → 归入该角色的「其他设定」折叠区。
- 序列化时按上表固定顺序输出；未知标签追加在 `<rules>` 之前。

---

## 四、三层协议架构

统一之后，整个系统明确分成三层，**互不渗透**：

```
┌─────────────────────────────────────────────────────┐
│  消息层协议（AI 回复格式 / 请求参数）                     │
│  · 说话人：  【角色名】正文分段      → parseSpeakerSegments │
│  · 拍照触发: function call take_photo（设置开关，默认关）  │
│  · 声明方式：说话人由 SP 的 <rules> 下发；拍照走 tools 参数 │
├─────────────────────────────────────────────────────┤
│  SP 层（唯一格式 = SPX / XML）                           │
│  · 存储：  spVersions[i].contentXml                     │
│  · 发送：  contentXml 原文作为 system 消息                │
│  · 产出：  记忆压缩 / 群聊初始化 → LLM 直接输出 SPX        │
├─────────────────────────────────────────────────────┤
│  编辑层（内存中的结构化模型，不落盘）                       │
│  · parseSp()  → { task, characters[], samples[], … }    │
│  · 卡片 UI 读写模型 → serializeSp() → contentXml         │
└─────────────────────────────────────────────────────┘
```

- **拆分说话人**：`parseSpeakerSegments()` / `hasSpeakerTags()` 一行不改。唯一变化是说话人规则从「任务定义里的自然语言」变成 `<rules>` 里的 `<rule id="speaker-format">`，语义完全一致，LLM 收到的指令不变。
- **拍照自动触发**：从「回复尾部 `<trigger>` 标签 + `extractAndStripPhotoTrigger()` 剥离」升级为 **function call**——`take_photo` 工具随聊天请求注入（设置开关，默认关闭），模型结构化调用，App 收到后走与现在完全相同的拍照管线。SP 从此不携带拍照触发指令，`29_群聊功能.js` 的 `photoTrigger` 字符串拼接与 `extractAndStripPhotoTrigger()` 在 tool 模式下整体退役（详见第十章）。
- **用户手动拍照**：📷 按钮 / `/拍照` → 选角色 → LLM 生成图像 prompt → ComfyUI，**链路一行不改**（它本来就是独立的 prompt 生成调用，不依赖回复标记）。

---

## 五、新增核心模块 `sp_format.js`

放在 `js/` 与 `tauriapp/src/js/core/`（映射序号建议 `00_prompts.js` 之前加载）。职责全部收口于此，**其他文件禁止再写 SP 相关正则**。

```javascript
// ============ sp_format.js —— SPX 格式唯一出入口 ============

const SPX_ROOT = 'roleplay_sp';
const SPX_FORMAT = 1;

/** 判断一段文本是否已是 SPX 格式 */
function isSpFormat(xmlText) { /* /^<\s*roleplay_sp\b/ 检测 */ }

/** 解析 SPX → 结构化模型（卡片数据源）
 *  使用 DOMParser('text/xml')，parsererror 时降级到容错正则提取器 */
function parseSp(xmlText) { /* → { task, characters:[{name,identity,appearance,personality,history,extra}], backstory, state, samples[], rules{}, unknown[] } */ }

/** 结构化模型 → SPX 文本（固定节点顺序，文本节点 escXml 转义） */
function serializeSp(model) { /* → xmlText */ }

/** 合并：以新版为主，从旧版补齐新版缺失/为空的节点（记忆压缩失败兜底）
 *  替代现有 cleanAndRepairSp 里只能补 2 个区块的硬编码逻辑 */
function mergeSp(newXml, prevXml) { /* 逐节点 diff：task/rules 用旧的，其余新节点空则填旧值 */ }

/** 旧混合格式 → SPX 迁移（懒迁移，导入/加载时按版本触发一次） */
function migrateLegacySp(legacyText) {
  // 1. extractSection 逐区块提取（复用现有正则，仅迁移期存在）
  // 2. 【角色名】切段 + <外貌>/<身份>/<性格>/<经历> 与 冒号 两种字段格式归一
  // 3. serializeSp() 输出；失败则原样返回并标记 migrationFailed
}

/** 从 SP 提取角色外貌（拍照专用，替代三重正则 fallback） */
function getAppearances(xmlText, onlyName) { /* parseSp 一次，按 name 过滤 */ }
```

### 5.1 解析容错策略（LLM 写坏 XML 时）

按优先级降级，任何一级成功即止：

1. `DOMParser` 严格解析成功 → 标准路径。
2. 解析报错 → 预清洗：剥离 \`\`\` 包裹 / JSON 抽取 / 前导废话（沿用 `cleanAndRepairSp` 第一、二、三步，收编进本模块）后重试。
3. 仍失败 → 容错正则提取器：`<tag>…</tag>` 贪心配对 + `<character name="…">` 属性提取，重建模型。
4. 若内容其实是**旧版 Markdown 结构**（模型没按 SPX 模板输出）→ 走 `migrateLegacySp()` 迁移后再合并（兜底，不丢用户记忆）。
5. 全部失败（空输出/无法识别的垃圾文本）→ `compressChat()` 放弃写入新版本，保留旧版；
   同时把 AI 原始返回写进程序日志（`LOG_TYPE_MEMORY`），便于定位格式问题（**宁可记忆不更新，不可记忆损坏**）。

---

## 六、各功能改造对照

### 6.1 记忆压缩（`18_记忆.js` + `00_prompts.js`）

**新 `PROMPT_MEMORY`（模板从「描述格式」变成「填空」）：**

```
请对以上对话内容进行分析总结，按下面的 XML 模板输出更新后的完整 <roleplay_sp>：
- <task> 节点原封不动保留。
- <characters> 更新每个角色的 identity/appearance/personality/history，
  appearance 与 history 尽可能详细；description 中不涉及无关内容。
- <backstory> 只记录世界观与重大事件，不超过 100 字。
- <samples> 每个角色一句生活化的台词，体现性格，char 属性填角色名。
- <rules> 节点整体原样保留，禁止修改。
- <state> 根据最新剧情更新当前状态。

当前 <roleplay_sp> 如下（在此基础上更新）：
{当前SPX}

直接输出完整 XML，以 <roleplay_sp 开头、</roleplay_sp> 结尾，不要任何额外说明。
```

要点：
- 把**当前 SP 全文**放进压缩 prompt（现有实现也是把 sp.content 作为 system 消息发送，等价），AI 做增量改写而不是凭记忆重写，漂移率大幅下降。
- `rules` 节点声明为禁改——说话人格式与拍照触发指令从此不会被压缩过程弄丢（现状里这两条规则混在任务定义中，AI 总结时有可能改写）。
- `cleanAndRepairSp()` → 删除，替换为 `parseSp()` + `mergeSp()`（见 5.1）。
- tauriapp 的 `getMemoryPrompt()` 自定义覆盖机制保留，只是默认值换成新模板。

**版本数据结构微调：**

```javascript
// 旧
spVersions[i] = { version, content, lastIndex }
// 新（content 字段名不变，内容变成 SPX；新增 format 标记便于灰度）
spVersions[i] = { version, content, lastIndex, format: 1, legacyContent? }
```

### 6.2 拍照（`33_拍照功能.js`）

- `buildPhotoRequestMessages()` 中 40 行三重正则 → 一行：
  `var appSections = getAppearances(sp.content, specificCharacter);`
- 群像/单人从 `character` 节点精确取 `appearance`，不再有「XML 标签没匹配到就退到冒号格式」的静默失败。
- **用户手动拍照链路一行不改**：📷 按钮 / `/拍照` → 选角色 → `buildPhotoRequestMessages()` 让 LLM 生成图像 prompt → ComfyUI。这条链路只被手动入口调用，且 getAppearances 让它的外貌提取更准了。
- **AI 自动触发**改走 function call（见第十章）：工具回调里直接复用 `takePhotoForCharacter(characterName)`，即同一套「LLM 生成图像 prompt → ComfyUI」管线，只是入口从「解析回复标记」换成「解析 tool_calls」。
- `PROMPT_TAKE_PHOTO_*`（图像 prompt 生成的指令，非回复解析）**不变**；`extractAndStripPhotoTrigger()` 在 tool 模式开启后不再被聊天流调用。

### 6.3 说话人拆分（`17_流式.js`）

- `parseSpeakerSegments()` / `hasSpeakerTags()` / 桌面版 `02_bubble.js` 复用链 **零改动**。
- 规则声明迁移到 `<rule id="speaker-format">`，由群聊初始化和迁移逻辑写入。

### 6.4 群聊初始化（`29_群聊.js` + `00_prompts.js`）

- `generateGroupSystemPrompt()` → `buildSpTemplate(charList, { photoTriggerEnabled })`：用 `serializeSp()` 从空模型生成骨架，任务定义文案与规则文案集中到 `sp_format.js` 顶部的常量区（消灭 `29_群聊.js` 与 `00_prompts.js` 两份硬编码任务定义的重复）。
- `PROMPT_GROUP_INIT_TEMPLATE` → 要求 AI 输出各 `<character>` 节点 + `<backstory>` + `<samples>`，App 用 `mergeSp()` 合入骨架（AI 只填空，不碰 task/rules）。
- `autoInitGroupChat()` 里「先 removeSection 再重新拼任务定义」的两步手术 → 一次 `mergeSp()`。

### 6.5 SP 编辑 UI（`19_SP显示与编辑.js` / tauriapp `17_sp_panel.js`）

从「一个大 textarea」升级为区块卡片；**展示区（#spDisplay）与编辑区使用同一套彩色区块配色**（任务=靛紫、角色=青、背景=琥珀、状态=绿、样例=粉、规则=灰、自定义=虚线灰），深浅主题各自一组色值：

```
┌ SP v12 · 1/3  ◀ ▶ ┐
│ ┌─ 📋 任务定义 ────┐ │  ← parseSp().task
│ │ (textarea)      │ │
│ └─────────────────┘ │
│ ┌─ 👥 角色设定 ─────┐ │
│ │ ▾ 林梦           │ │  ← 每角色一张子卡片
│ │   身份 / 外貌 /   │ │     4 字段独立输入框
│ │   性格 / 经历     │ │
│ │ ▾ 苏晴  [+角色]  │ │
│ └─────────────────┘ │
│ ┌─ 📖 背景故事 ────┐ │
│ ┌─ 📍 当前状态 ────┐ │
│ ┌─ 💬 回复样例 ────┐ │  ← char 属性下拉选择角色
│ ┌─ ⚙️ 行为规则 ────┐ │  ← speaker-format（说话人格式声明）
│ └─────────────────┘ │
│        [保存] [源码模式] │
└─────────────────────┘
```

> 拍照自动触发的开关**不在 SP 卡片里**——它属于应用行为（请求是否注入 tools），放在设置 → 图像 分页（见 10.4），与 ComfyUI 开关相邻。

- 「保存」= 模型 `serializeSp()` → 更新 `spVersions[viewIndex].content`。
- 保留「源码模式」tab（直接编辑 SPX 全文），高级用户兜底；保存时 `parseSp()` 校验，失败给出行级错误提示。
- **桌面版注意**：SP 面板复用网页版 DOM，卡片样式写在 `legacy.css` 或 `panels.css`，无需动 shell。

### 6.6 日志（`23_log抽屉.js`）

`addProgramLog` 的 detail 里 SP 展示不变（仍是文本）。可选增强：记忆压缩日志 detail 传 `serializeSp()` 前后的 diff 摘要，方便排查压缩质量。

---

## 七、迁移与兼容策略

1. **数据兼容（读时迁移）**
   - `selectChat()` / `getCurrentSpVersion()` 返回前检查：`content` 不以 `<roleplay_sp` 开头 → `migrateLegacySp()`，结果写回 `content`，原文存 `legacyContent`，`format: 1`，`saveData()`。
   - 用户手动编辑过的旧版本同样迁移（迁移是无损的：提取不到的区块整体塞进 `unknown[]` 并序列化保留）。
2. **旧分享链接 / 导入 JSON**：`applyImportedData()` 后对全部 chats 跑一遍批量迁移。
3. **回退**：`legacyContent` 保留在版本对象里；设置面板提供「恢复原始格式」入口（走 `legacyContent`），调试期出现压缩质量回退时可快速切回。
4. **网页版 ↔ 桌面版**：`sp_format.js` 两端同名同实现，导出 JSON 结构一致，互通无损。
5. **灰度开关**：设置 → 记忆 分页加「使用新版 XML System Prompt」开关（默认开）。关闭时压缩 prompt 走旧模板 + 旧解析。观察 1~2 周后移除开关与旧代码路径。

---

## 八、实施计划

| 阶段 | 内容 | 涉及文件 |
|---|---|---|
| **P1 格式内核** | 新增 `sp_format.js`（parse/serialize/merge/migrate/getAppearances + 容错降级） + 单元自测函数（用真实旧 SP 样本跑迁移 round-trip） | 新文件，两端各一份 |
| **P2 读路径切换** | 拍照 `getAppearances()` 接入；读时迁移 + legacyContent；设置加灰度开关 | `33_拍照.js`、`03_数据结构.js`/`04_存储.js`、`10_设置区.js` |
| **P3 写路径切换** | 新 `PROMPT_MEMORY` + `parseSp/mergeSp` 替换 `cleanAndRepairSp`；群聊初始化改模板填充 | `00_prompts.js`、`18_记忆.js`、`29_群聊.js` |
| **P4 卡片编辑 UI** | SP 面板区块卡片 + 源码模式 + 校验 | `19_SP显示与编辑.js`、tauriapp `17_sp_panel.js`、CSS |
| **P5 清理** | 删除 `extractSection`/`removeSection`/`cleanAndRepairSp`/`buildPhotoRequestMessages` 内嵌正则、灰度开关与旧模板 | 上述文件 |
| **P6 自动拍照→工具**（独立可交付） | `tool_registry.js` + `take_photo` 注入/聚合/收尾；tool 消息过滤；`autoPhotoTool` 开关（默认关）；删除 photoTrigger SP 拼接 | `15_发送.js`、`17_流式.js`、`12/31_渲染.js`、`14_编辑删除.js`、`18_记忆.js`、`10_设置区.js`、`29_群聊.js`、新文件（详见第十章 10.5） |

**验收清单：**
- [ ] 旧 SP 打开后自动迁移，任务定义/角色四字段/样例无一丢失（unknown 区块保底）；任务定义里拼接的 `PROMPT_AUTO_PHOTO_TRIGGER` 指令被剥离（拍照触发已迁出 SP）
- [ ] 记忆压缩 20 次抽检：产出全部为合法 SPX；人为注入坏输出（markdown 包裹/JSON/截断）时正确降级，不丢版本
- [ ] 群聊拍照：`getAppearances` 命中率 100%（旧格式迁移后）；手动拍照与迁移前体验一致
- [ ] 说话人拆分在网页版聊天区与桌面版气泡堆/浮层表现与迁移前一致
- [ ] 卡片编辑保存后重新解析无 diff（round-trip 幂等）
- [ ] 导出 JSON → 网页版/桌面版互相导入正常

---

## 九、风险与对策

| 风险 | 对策 |
|---|---|
| LLM 偶尔输出非法 XML（未转义 `<`、截断） | 5.1 四级降级；`task`/`rules` 来自旧版合并，最坏情况只丢 `characters` 更新 |
| XML 转义导致 token 略增 | 仅角色名/属性需转义，正文节点原样；实测增量 <5%，换来的是确定性解析 |
| 用户手写 SP 习惯旧格式 | 源码模式保留；格式检测失败时提示「检测到旧格式，是否自动转换」 |
| 桌面版与网页版代码漂移 | `sp_format.js` 放 `core/` 沿用现有同步约定（MAP.md 登记新文件） |
| 压缩后 `rules` 被改坏导致说话人/拍照失效 | `rules` 节点压缩时禁改 + `mergeSp()` 强制以旧版 `rules` 为准 |

---

## 十、拍照自动触发升级为 Function Tool

> 明确约束（与用户对齐）：
> 1. 只支持 DeepSeek（原生支持 function calling），**不做多供应商能力探测与降级矩阵**；
> 2. AI 自动触发做成**设置开关，默认关闭**；关闭时行为与现在完全一致（无自动拍照）；
> 3. **用户手动拍照链路一行不改**（📷 按钮 / `/拍照` → 选角色 → LLM 生成图像 prompt → ComfyUI）；
> 4. 自动触发只改「入口」：从解析回复里的 `<trigger>` 标签 → 解析 `tool_calls`。
>    入口之后的管线（`takePhotoForCharacter()` → `buildPhotoRequestMessages()` 让 LLM 生成图像 prompt → `callComfyUI()`）**原样复用**。

### 10.1 现有流程 vs 新流程

```
【现有】AI 自动触发
  聊天请求 → AI 回复尾部带 <trigger type="photo" character="名" />
    → extractAndStripPhotoTrigger() 剥离标签（流式期间还要边流边剥）
    → takePhotoForCharacter(名)
    → buildPhotoRequestMessages()：SP 外貌 + 最近 20 条消息 → LLM 生成图像 prompt
    → callComfyUI() → 渲染照片消息

【新】AI 自动触发（开关开启时）
  聊天请求（附 tools: [take_photo]）
    → AI 正常输出对话内容，另发 tool_calls: [{name:"take_photo", arguments:{character:"名"}}]
    → 解析 tool_calls（流式聚合，正文天然无标记）
    → takePhotoForCharacter(名)        ← 与现有完全相同
    → LLM 生成图像 prompt → callComfyUI() → 渲染照片消息   ← 与现有完全相同

【不变】用户手动触发
  📷 按钮 / /拍照 → 选角色 → takePhotoForCharacter() → …（完全不涉及 tools）
```

变化只在最前面两步：**触发信号的载体**从「正文里的文本标记」变成「响应里的结构化 tool_calls」。

### 10.2 工具定义

```json
{
  "type": "function",
  "function": {
    "name": "take_photo",
    "description": "当剧情出现值得拍照记录的画面（角色外貌/服装/发型/场景/姿势/表情明显变化、剧情重要节点或名场面、用户要求拍照或合影）时调用。先正常输出对话内容，再调用本工具。每个角色每次最多调用一次。",
    "parameters": {
      "type": "object",
      "properties": {
        "character": {
          "type": "string",
          "description": "要拍照的角色名，必须与角色设定中的名字完全一致"
        }
      },
      "required": ["character"]
    }
  }
}
```

- 工具参数**只带 `character`**，不带画面描述——图像 prompt 仍由 `buildPhotoRequestMessages()` 那次专门调用生成（含 SP 外貌设定 + 最近消息上下文），与现在手动拍照的质量完全一致。保持最小改动。
- 触发条件的自然语言描述（原 `PROMPT_AUTO_PHOTO_TRIGGER` 的四条规则）收进工具的 `description`——它从「SP 里的永久指令」变成「随请求注入的参数」，SP 保持纯净。
- 多角色连拍：模型可在一次响应里返回多个 tool_calls（parallel tool calls），逐个调用 `takePhotoForCharacter()`，与现在支持多个 `<trigger>` 标签的行为对齐。

### 10.3 聊天请求与消息流处理

**注入条件**（`17_流式AI请求.js` / `15_发送消息.js` 构建请求体处）：

```javascript
// settings.autoPhotoTool 默认 false；ComfyUI 未启用时开关置灰
if (appData.settings.autoPhotoTool && appData.settings.comfyui?.enabled) {
  body.tools = [TAKE_PHOTO_TOOL];
  // 不设 tool_choice，默认 "auto"：模型自主决定何时调用
}
```

**流式聚合**：`17_流式AI请求.js` 的流处理循环里增加 `tool_calls` 增量分支——
按 `delta.tool_calls[i].index` 聚合 `id` / `function.name` / `arguments`（arguments 是分片字符串，需拼接）。
正文 content 增量的处理不变。

**收尾与历史记录**（关键协议细节）：

```
finish 后：
  1. 追加 assistant 消息到 chat.messages：
     { role:"assistant", content: 正文, tool_calls: [...] }   ← 与流式渲染共用同一条
  2. 每个 tool_call 追加一条本地合成结果：
     { role:"tool", tool_call_id, content:'{"status":"accepted"}', hidden:true }
     （协议要求 tool_calls 后必须紧跟 tool 消息；拍照是 fire-and-forget，无需模型确认）
  3. 对每个 tool_call 执行 takePhotoForCharacter(character)（异步，不阻塞界面）
  4. 不发起新一轮模型调用
```

- **`hidden:true` 消息的渲染/遍历过滤**：`12_消息渲染.js`、`31_消息分页渲染.js` 跳过 `role:"tool"`
  与带 `tool_calls` 的纯工具消息（content 为空时）；`18_记忆.js` 的 `msgsToCompress` 切片同样过滤
  （或保留——对压缩无害，建议过滤以省 token）；`14_消息编辑与删除.js` 不允许编辑 tool 消息。
- **历史膨胀**：tool 对体积小；记忆压缩按 lastIndex 滚动，旧消息整体折进摘要，无需额外清理。
- **空 content 防御**：若模型只调工具不输出对话（罕见），按现有「触发拍照」体验继续即可
  （照片照拍）；若想更稳妥，可在 content 为空时追加一条「请继续对话」的 user 消息触发补全，与现状一致从简。

### 10.4 设置与默认行为

设置 → 图像 分页，ComfyUI 配置上方新增：

```
[ ] AI 自动拍照    剧情出现值得记录的画面时自动拍摄照片（需启用 ComfyUI）
```

- `settings.autoPhotoTool`，**默认 false**——升级后行为与现在完全一致（现状下 AI 自动触发本就只在群聊且 ComfyUI 开启时通过 SP 指令生效）。
- 开关开启 → 聊天请求注入 tools，同时 `PROMPT_AUTO_PHOTO_TRIGGER` 指令**不再写入 SP**（`29_群聊功能.js` 的 `photoTrigger` 拼接逻辑删除）。
- 开关关闭 → 请求不带 tools，无自动拍照；手动拍照不受影响。
- `generateGroupSystemPrompt()` / `buildSpTemplate()` 因此简化：不再需要 `photoTriggerEnabled` 参数。

### 10.5 对实施计划的影响

- P1~P5 不变；`<rules>` 节点只承载 `speaker-format`，schema 更简。
- 新增 **P6（独立可交付）**：
  1. `tool_registry.js`（新文件，两端 core 各一份）：`TAKE_PHOTO_TOOL` 常量 + 注入判断 + tool_calls 聚合/收尾逻辑；
  2. `15_发送消息.js` / `17_流式AI请求.js`：请求注入 + 流式聚合 + 消息收尾写入；
  3. `12/31_渲染.js`、`14_编辑删除.js`、`18_记忆.js`：tool 消息过滤；
  4. `10_设置区.js`：`autoPhotoTool` 开关；`29_群聊.js`：删除 photoTrigger 拼接；
  5. 桌面版预留 `play_animation` 工具位（`01_avatar.js` 已有动画入口，同一注册表即插即用）。

### 10.6 风险与对策

| 风险 | 对策 |
|---|---|
| 模型调用工具时角色名与设定不一致 | 回调内复用现有 `findCharacter()` 校验；找不到时 toast + 日志，不打断聊天 |
| 模型频繁/不当调用工具 | description 已限定触发条件；可在开关旁提供「每次回复最多拍照数」上限（默认 2，超出忽略并记日志） |
| DeepSeek 特定版本 tools 行为差异 | 仅针对 DeepSeek 适配；开关默认关闭，出问题用户可自行关闭，回退路径 = 现状 |
| tool 消息混入渲染/压缩/编辑 | 10.3 的 `hidden` 标记 + 各遍历点过滤，列入 P6 验收 |
| 手动与自动并发拍照 | 复用现有 `isPhotoShooting` 互斥锁，自动触发回调里检查忙态则排队或跳过（记日志） |

**验收补充（并入第八章清单）：**
- [ ] 开关关闭：请求体无 tools 字段，聊天/手动拍照行为与现状逐字节一致
- [ ] 开关开启：AI 回复正文无任何标记残留（含流式过程）；tool_calls 正确触发拍照，图像 prompt 质量与手动一致
- [ ] 多角色同帧：一次响应多个 tool_calls 全部执行，每人一张
- [ ] 刷新页面后重新发送消息：历史中的 assistant(tool_calls) + tool 对不导致 DeepSeek 报错
- [ ] 压缩触发时 tool 消息被正确过滤/折叠，压缩产出不含工具噪声
