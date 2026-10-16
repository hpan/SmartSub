# AGENTS.md — SmartSub 项目 Agent 指南

## 项目概述

SmartSub（妙幕）是一款 Electron + Next.js 桌面应用，用于音视频字幕生成、翻译、校对、配音和合成。
上游项目：https://github.com/buxuku/SmartSub
用户 fork：https://github.com/hpan/SmartSub

## Git 工作流

```
origin   = git@github.com:hpan/SmartSub.git   （用户的 fork，push 目标）
upstream = git@github.com:buxuku/SmartSub.git  （上游作者，merge 来源）
```

- 本地 `main` 分支开发
- 从 `upstream/main` 合并上游更新：`git merge upstream/main --no-edit`
- 推送到 `origin/main`：`git push origin main`
- 有冲突时解决后 `git add` + `git commit --no-edit`
- 合并后注意检查新依赖是否需要 `yarn install`

## 技术栈

- **框架**：Electron + Next.js 14 + React + TypeScript
- **UI**：Tailwind CSS + shadcn/ui（`@/components/ui/*`）
- **状态管理**：React hooks + localStorage 持久化
- **IPC 通信**：主进程（`main/`）↔ 渲染进程（`renderer/`），通过 `window.ipc.invoke` 调用
- **打包**：electron-builder，构建入口 `main/background.ts` → webpack → `app/background.js`
- **文档**：Docusaurus（`docs/` 目录）

## 项目结构

```
main/                              # Electron 主进程
  background.ts                    # 入口，注册所有 IPC handler
  helpers/
    audioVisualize/                # 音画合成（configManager + IPC handlers）
    videoDownload/                 # 抓取下载（downloadExecutor, videoInfoParser, douyinDownloader, xhsDownloader, ytdlpManager, renameAfterDownload）
    workspace.ts                   # 工作台（B站监控、任务流水线、节目匹配规则）
    imaUploader.ts                 # IMA 知识库上传
    ipcSpeedHandlers.ts            # 变速处理
    ipcVideoCropHandlers.ts        # 视频裁片
    ipcVideoTrimHandlers.ts        # 音频裁割
    watermarkScrub/                # 水印去除
    logger.ts, storeManager.ts     # 通用工具

renderer/                          # Next.js 渲染进程
  components/
    grab/                          # 抓取页面组件（GrabPanel, TaskProgressCard, VideoInfoCard, DownloadSettingsSheet）
    audioVisualize/                # 音画组件（AudioVisualizePanel, ProgramConfigPanel）
    speed/                         # 变速组件（SpeedPanel）
    videoCrop/                     # 裁片组件（VideoCropPanel）
    videoTrim/                     # 裁割组件（VideoTrimPanel → AudioCutPanel）
    audioExtract/                  # 音频提取组件
    watermarkScrub/                # 祛印组件
    Layout.tsx                     # 全局布局，含侧边栏导航
  pages/[locale]/
    workspace.tsx                  # 工作台页面
    grab.tsx                       # 抓取页面
    audioVisualize.tsx             # 音画合成页面
    audioVisualizeConfig.tsx       # 节目配置页面
    globalStyleConfig.tsx          # 通用样式设置页面
    videoCrop.tsx                  # 裁片页面（工坊标签页之一）
    audioCut.tsx                   # 裁割页面（工坊标签页之一）
    audioExtract.tsx               # 音频提取页面
  public/locales/{zh,en}/         # 国际化文件

tools/
  douyin-dl/                       # 抖音下载器（Python 脚本）
  xhs-dl/                          # 小红书下载器（Python 脚本）
  audio-visualize/                 # 频谱渲染（Python 脚本）

types/
  audioVisualize.ts                # 音画相关类型
  videoDownload.ts                 # 下载相关类型（DownloadTask, DownloadVideoInfo 等）
```

## 关键数据路径

```
~/Library/Application Support/smartsub-dev/
  audio-visualize/programs.json    # 节目配置（封面、Logo、水印等）
  workspace-tasks.json             # 工作台任务记录
  workspace-log.json               # 监控日志
  workspace-known-bvids.json       # 已处理的 BV 号（去重）
  workspace-last-processed.json    # 各节目最后处理时间
  download-config.json             # 下载配置
  parameter-configs/               # 参数配置
~/.smartsub_ima_config.json        # IMA 知识库配置
```

## 用户偏好（重要）

### 必须遵守

- **自测再提交**：每次改动完成后必须自行测试验证，确认无误后再让用户测试。用户多次强调这一点。
- **中文界面**：所有 UI 文字使用中文
- **中文回复**：与用户沟通使用中文
- **紧凑布局**：尽量节省垂直空间，能合并的行要合并，输入框搞窄一点
- **拖拽支持**：所有文件选择器（音频、视频、字幕、图片上传）必须支持拖拽上传
- **日期时间双位对齐**：如 `09/01 08:05`，不用 `9/1 8:5`
- **菜单名称**：工坊（workshop）、工作台（workspace）、节目配置（program config）
- **预览与最终一致**：音画预览中的标题换行、字幕样式必须与最终生成视频完全一致

### UI 设计原则

- 文件名过长时截断 + 省略号，不撑破容器
- 操作图标（打开链接、复制、打开文件夹）用小图标，放在合适位置
- 同一系列的组件使用相同的类名体系
- 合理利用空间，有些左右摆、有些上下摆
- 宽度分配：下载/封面/IMA 用 w-08，裁割用 w-12，改名用更宽

## 常用命令

```bash
yarn dev              # 开发模式启动
yarn build            # 构建
yarn install          # 安装依赖（合并上游后需要）
npx tsc --noEmit      # TypeScript 类型检查（path alias 报错是已有的，不影响构建）
```

## 节目匹配规则（工作台）

工作台通过以下维度识别 B 站节目：

| 节目               | 播出日 | 预计时间   | 关键词         |
| :----------------- | :----- | :--------- | :------------- |
| 大摩宏观策略谈     | 周一   | 中午12点后 | 大摩、宏观策略 |
| 大摩周期论剑       | 周三   | 中午12点后 | 大摩、周期     |
| 大摩新经济热点前瞻 | 周五   | 中午12点后 | 大摩、新经济   |
| 中金宏观策略周论   | 周一   | 中午12点后 | 中金、CICC     |
| 招商宏观周周谈     | 周日   | 晚21点后   | 招商、张静静   |
| 华创宏观张瑜旬度   | 周日   | 晚21点后   | 华创、张瑜     |

- 排除时长 < 30 分钟的视频（研报 AI 合成等）
- 使用 Firefox Cookie 访问 B 站
- 监控频率：每 30 分钟一次（测试期每 5 分钟）

## 任务流水线（工作台）

```
下载 → 改名 → 裁割 → 封面 → IMA上传 → 音画合成
```

- 改名规则：`{日期}-{栏目名}：{标题}`
- 封面保存至节目的 `Cover` 子目录
- IMA 按节目名路由到对应知识库目录
- 失败任务支持重试，支持停止整个流水线

## 已知限制

- `npx tsc --noEmit` 会报 path alias 错误（`@/components/ui/*`, `lib/utils`），这是已有的 TS 配置问题，不影响实际构建
- `tools/douyin-dl/douyin-downloader` 是嵌入的 git 子仓库，已加入 `.gitignore`
- `.bak` 文件不提交，已加入 `.gitignore`
