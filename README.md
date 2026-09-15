# CloudMusic — foobar2000 WebView2 主题

> **v2.5.1** — 歌词显示与解析修复 · 多编码识别修正 · 沉浸式 3D 斜墙歌词

这是一个专为 foobar2000 音频播放器设计的网易云风格主题。基于 WebView2 构建，提供了发现音乐、媒体库管理、强大的播放控制以及独特的黑胶视觉效果。

## 图片展示

<table>
  <tr>
    <td><img src="img/(13).png" alt="(13)" style="width:100%; border-radius:8px; box-shadow:0 4px 12px rgba(0,0,0,0.15);"></td>
    <td><img src="img/(2).png" alt="(2)" style="width:100%; border-radius:8px; box-shadow:0 4px 12px rgba(0,0,0,0.15);"></td>
    <td><img src="img/(3).png" alt="(3)" style="width:100%; border-radius:8px; box-shadow:0 4px 12px rgba(0,0,0,0.15);"></td>
  </tr>
  <tr>
    <td><img src="img/(4).png" alt="(4)" style="width:100%; border-radius:8px; box-shadow:0 4px 12px rgba(0,0,0,0.15);"></td>
    <td><img src="img/(5).png" alt="(5)" style="width:100%; border-radius:8px; box-shadow:0 4px 12px rgba(0,0,0,0.15);"></td>
    <td><img src="img/(6).png" alt="(6)" style="width:100%; border-radius:8px; box-shadow:0 4px 12px rgba(0,0,0,0.15);"></td>
  </tr>
  <tr>
    <td><img src="img/(7).png" alt="(7)" style="width:100%; border-radius:8px; box-shadow:0 4px 12px rgba(0,0,0,0.15);"></td>
    <td><img src="img/(8).png" alt="(8)" style="width:100%; border-radius:8px; box-shadow:0 4px 12px rgba(0,0,0,0.15);"></td>
    <td><img src="img/(9).png" alt="(9)" style="width:100%; border-radius:8px; box-shadow:0 4px 12px rgba(0,0,0,0.15);"></td>
  </tr>
  <tr>
    <td><img src="img/(10).png" alt="(10)" style="width:100%; border-radius:8px; box-shadow:0 4px 12px rgba(0,0,0,0.15);"></td>
    <td><img src="img/(11).png" alt="(11)" style="width:100%; border-radius:8px; box-shadow:0 4px 12px rgba(0,0,0,0.15);"></td>
    <td><img src="img/(12).png" alt="(12)" style="width:100%; border-radius:8px; box-shadow:0 4px 12px rgba(0,0,0,0.15);"></td>
  </tr>
</table>

## 核心特性

- **现代化 Web 界面**: 采用简洁大气的设计风格，支持响应式布局，专为桌面端优化。
- **沉浸式黑胶体验**: 独特的 Vinyl 动画播放器，包含唱片旋转和唱针动画，还原真实听歌氛围。
- **沉浸式 3D 歌词墙**: 全屏歌词可切换为“整块歌词贴在一面斜墙上”的 CSS 3D 透视效果，当前行从墙面微微鼓起，并带随封面主色调联动的柔光。开关在右上角、状态记忆、默认关闭。
- **发现与探索**: 专属“发现”页面，展示推荐专辑、随机曲目和最近播放记录。
- **动态歌词**: 支持逐行与**逐字**（ESLyric `<mm:ss.xx>` 精准歌词）高亮、**双语/翻译同刻成组显示**（原文 + 译文作为一组一起高亮、一起居中，任一行都不会丢）、点行跳转与独立的全屏歌词模式。内置 8 层编码检测引擎，可正确识别 GBK/GB18030、UTF-8、UTF-16 等编码的 LRC 文件。
- **强大的媒体库**: 支持按艺术家、专辑等维度浏览与管理本地音乐。
- **内置标签编辑**: 无需离开界面即可在“标签编辑器”中修改歌曲元数据；多选后可批量编辑标签或批量从歌单删除。
- **播放队列管理**: 抽屉式播放队列，支持拖拽排序。

## 环境要求

1.  **foobar2000**: 确保已安装 foobar2000 音频播放器。
2.  **foo-ui-webview2**: 运行此主题所必需的 foobar2000 组件插件。请前往 [GitHub - NereaFantasia/foo_ui_webview2](http://github.com/NereaFantasia/foo_ui_webview2) 下载并安装对应版本。

## 安装指南

1.  **获取主题**: 将本项目（`foobar2000_web_theme`）下载或克隆到本地。
2.  **定位路径**: 确认包含 `index.html` 文件的目录绝对路径。
3.  **配置插件**:
    *   打开 foobar2000，进入 `文件 -> 参数选项` (或按 `Ctrl+P`)。
    *   依次进入 `显示` -> `WebView` 选项。
    *   选择打开文件(或类似入口设置) 将下载的主题放入其中 （例如 "foobar2000-v2\webview-ui\default\index.html" ）。

## 项目结构

本项目采用模块化结构，便于维护和二次开发：

- `index.html`: 单页应用入口，构建整个应用界面结构（侧边栏、主页、弹窗等）。
- `guide.html`: 包含详细的版本更新日志、功能特性说明及键盘快捷键指南。
- `css/`: 样式表目录。
    - `layout.css`: 整体布局（侧边栏、主内容区、底部栏）。
    - `components.css`: 各功能组件样式（歌单页、发现页、歌词、播放控制、黑胶唱盘）。
    - `utilities.css`: 通用工具类（弹窗、上下文菜单、提示条）。
- `js/`: 核心业务逻辑与渲染模块。
    - `core.js`: API 封装与状态管理。
    - `lyric-core.js`: 多编码歌词引擎（8 层编码检测 + LRC/ESLRC 模块化解析 + 同刻行归组）。
    - `ui.js`: 基础渲染层。
    - `ui-lyrics.js`: 歌词面板加载与渲染。
    - `ui-discover.js`, `ui-playlist.js`, `ui-library.js`: 各主要页面的视图逻辑。
    - `ui-nowplaying.js`: 沉浸式播放模式（黑胶动画 + 歌词 3D 斜墙）。
    - `ui-tags.js`: 标签编辑器与批量编辑 / 批量删除逻辑。
    - `controls.js`: 播放控制交互绑定。
    - `app.js`: 初始化入口。
- `sdk/`: API 桥接文件 (`bridge.global.js` 等)，负责与 foobar2000 核心交互。
- `static/`: 静态资源文件（图片、占位符 SVG）。

## 快捷键与操作

- **侧边栏导航**: 使用左侧边栏切换“发现”、“播放列表”、“媒体库”和“搜索”功能。
- **播放控制**: 底部控制栏提供播放/暂停、上一首/下一首、进度条拖拽及音量调节。
- **全屏歌词/沉浸模式**: 点击底部或右上角的全屏按钮进入黑胶沉浸模式。
- **编辑标签**: 在歌曲列表中右键点击曲目，选择“编辑标签”进行修改；多选 2 首及以上时，底部批量栏可批量编辑标签或从歌单删除（右键到已选中的曲目会整组删除）。
- **沉浸式 3D 斜墙**: 进入沉浸模式后，点右上角“显示模式”左侧的小圆钮切换（亮起为开启，状态自动记忆）。

## 更新摘要 · v2.5.1

- **GBK 中文歌词不再被误判为乱码**: 原评分让 euc-kr / windows-874 / windows-1251 仅凭“出现即加分”就能胜过 GBK（本地 582 个歌词文件中 75 个中招，占可判定样本的 13.8%）。改为按脚本纯度评分、只对不可伪造的决定性标记（假名占比、谚文纯度）给高权重，同一语料复测为 0 误判。
- **逐字歌词**: 支持 ESLyric 的 `<mm:ss.xx>` 精准歌词标记（此前会把标记当正文原样显示）。
- **翻译/音译同刻行**: 归为一组显示（主行 + 副行），整组一起高亮与居中，不再“只亮一行”也不丢行；纯文本歌词不再被误当作同步歌词。
- **格式兼容**: `[h:mm:ss]`、`[mm:ss.xx-N]` 等变体不再被整首当纯文本；负时间标签按负值解析。
- **标签编辑数据安全**: 多值标签（数组）不再因“未改动也被判为已改动”而被压成单值；写入过程中关闭编辑器不再报错。
- **批量删除**: 批量操作栏新增「从歌单删除」，右键命中多选时删除整组；锁定/自动歌单不再出现该操作（此前点了会静默失败）。
- **其他修复**: 搜索并发时旧结果覆盖新结果、ESLyric 开关连点失效、`playlist.replaceAllAndPlay` 参数名、版本号显示不一致、移除无调用者的旧解析代码与编码记忆层。
- **新功能**: 沉浸式 **3D 斜墙歌词**（真 CSS 3D 透视 + 当前行鼓起 + 随封面色柔光，可开关、默认关）。

详细更新日志与功能指南见 [`default/guide.html`](default/guide.html)。

## 贡献与反馈

如果您喜欢这个主题，欢迎在 Gitee 或 GitHub 上为我们点亮 Star。

如遇到问题或有任何建议，请移步项目 Issues 页提交反馈。
