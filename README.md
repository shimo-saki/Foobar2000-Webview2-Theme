- - - # foobar2000 Web Theme

      > v2.4.0 — 全面审查修复 · 渲染层模块化 · 含引号标签查询修复 · SDK 1.13.0 · 详见 [guide.html](default/guide.html#changelog)

      这是一个专为 foobar2000 设计的现代化网页风格主题（Theme）。它提供了一个基于 Web 技术构建的用户界面，包含了发现音乐、媒体库管理、强大的播放控制以及独特的视觉效果。

      ## 图片展示

      <div style="overflow-x: auto; overflow-y: hidden; white-space: nowrap; display: flex; gap: 12px; scroll-behavior: smooth; padding: 4px 0;">
        <img src="img/(13).png" alt="(13)" style="height: 280px; width: auto; border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.15); flex-shrink: 0;">
        <img src="img/(1).png" alt="(1)" style="height: 280px; width: auto; border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.15); flex-shrink: 0;">
        <img src="img/(2).png" alt="(2)" style="height: 280px; width: auto; border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.15); flex-shrink: 0;">
        <img src="img/(3).png" alt="(3)" style="height: 280px; width: auto; border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.15); flex-shrink: 0;">
        <img src="img/(4).png" alt="(4)" style="height: 280px; width: auto; border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.15); flex-shrink: 0;">
        <img src="img/(5).png" alt="(5)" style="height: 280px; width: auto; border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.15); flex-shrink: 0;">
        <img src="img/(6).png" alt="(6)" style="height: 280px; width: auto; border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.15); flex-shrink: 0;">
        <img src="img/(7).png" alt="(7)" style="height: 280px; width: auto; border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.15); flex-shrink: 0;">
        <img src="img/(8).png" alt="(8)" style="height: 280px; width: auto; border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.15); flex-shrink: 0;">
        <img src="img/(9).png" alt="(9)" style="height: 280px; width: auto; border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.15); flex-shrink: 0;">
        <img src="img/(10).png" alt="(10)" style="height: 280px; width: auto; border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.15); flex-shrink: 0;">
        <img src="img/(11).png" alt="(11)" style="height: 280px; width: auto; border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.15); flex-shrink: 0;">
        <img src="img/(12).png" alt="(12)" style="height: 280px; width: auto; border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.15); flex-shrink: 0;">
      </div>
      > [!tip]
      >
      > 拖动滑块查看全部展示图片

      ## 特性亮点

      - **现代化界面**: 采用简洁大气的设计风格，响应式布局，适配桌面使用习惯。
      - **发现与探索**: 专属的“发现”页面，展示推荐专辑、随机曲目和最近播放。
      - **黑胶唱盘效果**: 独特的 Vinyl 动画视觉播放器，还原真实听歌体验。
      - **动态歌词**: 集成歌词显示功能，支持卡拉 OK 逐字高亮效果。
      - **媒体库管理**: 支持按艺术家、专辑等维度浏览和管理本地音乐库。
      - **内置编辑功能**: 无需离开界面即可在“标签编辑器”中修改歌曲元数据。
      - **批量操作**: 支持多选曲目进行批量管理。

      ## 前置要求

      - **foobar2000**: 请确保已安装 foobar2000 音频播放器。
      - **foo-ui-webview2**: 这是一个运行此主题所必需的 foobar2000 组件。请前往 http://github.com/NereaFantasia/foo_ui_webview2 下载并安装  (或通过其他可靠渠道获取)。

      ## 安装与配置

      1. **获取主题**: 将本项目（`foobar2000_web_theme`）下载或克隆到本地。
      2. **定位文件夹**: 确保你知道包含 `index.html` 文件的目录路径。
      3. **配置 foo-ui-webview2**:
         - 在 foobar2000 界面中，找到 perfrance (首选项)。
         - 选择显示->选择 webview

      ## 项目结构

      - `index.html`: 主题的主入口文件，负责构建整个应用界面结构。
      - `guide.html`: 包含详细的版本更新日志(Changelog)、功能特性说明以及键盘快捷键指南。
      - `css/`: 存放样式表文件 (`layout.css`, `components.css`, `utilities.css` 等)，负责页面的视觉呈现。
      - `js/`: 核心业务逻辑与渲染模块 — `core.js` (API 封装 / 状态管理)、`ui.js` (渲染基础层) 加 7 个功能模块 (`ui-playlist.js` 歌单 / `ui-library.js` 媒体库 / `ui-lyrics.js` 歌词 / `ui-queue.js` 播放队列 / `ui-nowplaying.js` 沉浸式 / `ui-tags.js` 标签编辑 / `ui-discover.js` 发现页)，以及交互绑定 (`controls.js`) 与初始化编排 (`app.js`)。
      - `sdk/`: 存放与 foobar2000 核心交互的 API 桥接文件 (`bridge.global.js` 等，当前 v1.13.0)，需与已安装插件版本匹配；用于实现播放控制、媒体库访问等功能。
      - `static/`: 存放静态资源文件，如图片 (`img/`) 等。

      ## 使用指南

      - **侧边栏导航**: 使用左侧边栏切换“发现”、“播放列表”、“媒体库”和“搜索”功能。
      - **播放控制**: 底部控制栏提供播放/暂停、上一首/下一首、进度条拖拽及音量调节功能。
      - **查看歌词**: 音乐播放时，右侧面板将显示实时歌词。点击底部或右上角的全屏/模式切换按钮，可进入沉浸式播放模式。
      - **编辑标签**: 在歌曲列表中右键点击曲目，选择“编辑标签”即可修改元数据。