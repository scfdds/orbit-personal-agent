# 微信通知插件

把 Orbit 里的微信通知读取能力拆成一个本地插件，让其他 Agent 也能查询这些 Context。它读取 macOS 系统保留的通知片段，提供 MCP 工具和一份使用说明；不需要运行 Orbit，也不需要给插件配置模型 API Key。

例如可以问 Agent：

> 最近微信里有什么需要我留意的变化？请附上原始消息。
>
> 查一下周末出游的消息，大家目前分别什么时候有空？

插件提供消息，分析由你接入的 Agent 完成。当前只支持微信，不发送消息，也不读取微信自己的聊天数据库。

## 先运行演示

需要 Node.js 24 或更新版本。演示使用内存中的虚构消息，不读取本机通知、不申请系统权限，也不写入真实数据目录。

**使用源码：**

```sh
git clone https://github.com/scfdds/orbit-personal-agent.git
cd orbit-personal-agent/plugins/wechat-notifications
npm ci
npm run build
node dist/cli.mjs config --format codex --demo
```

将输出追加到 Codex 的 MCP 配置中；其他支持本地 MCP 的客户端可以用 `--format json` 生成配置。输出包含当前 Node 和插件的绝对路径，不需要手动替换占位符。重新连接后，可以让 Agent 查看微信通知演示。

`npm run demo` 或 `node dist/cli.mjs demo` 会直接启动 stdio MCP 服务，等待宿主连接；它不是交互式聊天命令，没有客户端连接时不会打印演示内容。

**使用 GitHub Release ZIP：**

从 [GitHub Release](https://github.com/scfdds/orbit-personal-agent/releases/tag/wechat-notifications-v0.1.0) 下载 Apple Silicon 的 `orbit-wechat-notifications-macos-arm64-0.1.0.zip`，解压到固定目录。Intel Mac 请按源码步骤本机构建，打包脚本会生成 `x64` 版本。ZIP 包含打包后的 JavaScript 和原生读取器，安装 Node.js 24 后即可运行下面的命令，无需 `npm ci` 或编译：

```sh
cd /你的解压目录/wechat-notifications
node dist/cli.mjs config --format codex --demo
```

源码下载包不包含编译产物，需要按源码步骤构建。当前原生程序使用临时签名，未做 Apple 公证；不同 macOS 版本的运行与授权提示可能不同。

## 接入真实通知

真实采集仅支持 macOS，默认关闭。安装插件不会开启采集。

源码用户先安装 Xcode Command Line Tools 并构建读取器；Release ZIP 用户跳过这一步：

```sh
xcode-select --install
npm run build:native
```

然后在插件目录中设置允许的通知来源。下面的标题是示例，请替换成你自己的通知标题：

```sh
node dist/cli.mjs enable --source "周末出游群" --source "项目讨论群"
```

`--source` 按通知标题精确匹配，每次 `enable` 都替换允许范围。如果你希望让 Agent 读取所有微信通知，可以明确选择：

```sh
node dist/cli.mjs enable --all
```

在 macOS「系统设置 → 隐私与安全性 → 完全磁盘访问」中，授权实际启动读取器的终端或 Agent 客户端。授权主体由 macOS 按启动链判断；终端运行成功，并不表示另一个客户端也已获准。请根据运行时的权限诊断确认，插件不会修改系统权限。

在真实配置下重连 MCP，或在终端检查：

```sh
node dist/cli.mjs doctor
node dist/cli.mjs doctor --probe
node dist/cli.mjs config --format codex
```

`doctor` 只检查环境；`doctor --probe` 会尝试一次已开启的真实采集，仅打印状态和计数。配置生成后仍需加到宿主中并重新连接。授权后若之前的进程已停止或报错，重连 MCP 或重新运行 `collect`。

Mac、微信和采集进程需要运行，且微信实际产生了系统通知。**不需要展开通知中心或让横幅一直显示。** 从 Agent 客户端启动的采集随 MCP 连接运行；要在退出客户端后继续采集，可以另开终端保持以下进程运行：

```sh
node dist/cli.mjs collect
```

按 `Ctrl+C` 结束。这个版本不会安装开机服务，也不会自动唤醒 Agent 分析新消息；主动提醒由宿主安排。

## 作为插件安装

本目录同时提供 portable Agent Plugins、Codex 兼容和 Claude Code 的清单。手动 MCP 配置是最直接的接入方式，插件方式另外附带一份帮助 Agent 正确使用通知的 Skill。

### Codex / 支持本地插件的 OpenAI 客户端

先完成源码构建。仓库根目录已有 `.agents/plugins/marketplace.json`，在支持本地 marketplace 的客户端中将仓库作为本地源添加：

```sh
cd /你的目录/orbit-personal-agent
codex plugin marketplace add .
```

重新启动客户端，在插件目录选择 **Orbit local plugins**，安装「微信通知」。如果当前客户端没有这个入口，使用前面的 `config --format codex` 接入即可。两种方式选一种，避免同一个服务注册两次。

portable `mcp.json` 使用宿主提供的 `${PLUGIN_ROOT}` 定位安装目录，要求客户端能找到 Node.js 24。若桌面客户端找不到 `node`，使用 CLI 生成的绝对路径 MCP 配置。源码的构建产物和依赖不会由 marketplace 自动生成，须先在本地构建再安装。

该方式依据 [OpenAI 本地插件与 marketplace 文档](https://developers.openai.com/plugins/build/plugins)。这是 GitHub 分发的本地插件，**未上架官方公共插件目录**；公共目录中的本地 MCP 提交另有[准入要求](https://developers.openai.com/plugins/deploy/desktop-only)。

### Claude Code

构建后，在本机加载插件目录：

```sh
claude --plugin-dir /你的目录/orbit-personal-agent/plugins/wechat-notifications
```

`.mcp.json` 使用 `${CLAUDE_PLUGIN_ROOT}`，Skill 位于 `skills/`。这是本地 Claude Code 插件，不是给 claude.ai 网页上传的云端连接器。格式见 [Claude Code 插件文档](https://code.claude.com/docs/en/plugins-reference)。

## 工具与控制

| MCP 工具 | 用途 |
| --- | --- |
| `wechat_status` | 查看当前采集状态、范围和限制 |
| `wechat_sources` | 列出允许读取且已采集到的通知来源 |
| `wechat_recent` | 查询近期片段，可限定来源和时间 |
| `wechat_search` | 搜索通知标题和正文 |
| `wechat_read` | 读取指定来源的片段，支持分页 |

工具返回原文、通知时间和消息 ID，便于 Agent 引用。所有 MCP 工具均为读取工具；扩大范围、清空数据等操作只能通过本地 CLI 完成。

```sh
node dist/cli.mjs status
node dist/cli.mjs disable
node dist/cli.mjs clear --yes
```

`disable` 停止采集，并立即禁止工具读取缓存；运行中的采集器会在约 1 秒内检查到关闭状态。`clear --yes` 先关闭采集，再清除插件缓存，不删除系统通知。以后重新开启，系统仍保留的通知可能被再次采集。

## 数据和边界

- 只读查询系统通知数据库，每 2 秒检查最近 24 小时、最多 1000 条微信记录；去重后，仅允许范围内的片段进入插件缓存和工具输出。
- 本地缓存默认保留 7 天，最多 10000 条，在读取或采集时清理过期记录；退出程序或停用后不会定时删除，立即清除可用 `clear --yes`。可在 `enable` 时加 `--retention-days 14`（1–90 天）。保留 7 天不代表能补读过去 7 天的聊天记录。
- 默认数据目录为 `~/Library/Application Support/Orbit WeChat Notifications/`，包含 `config.json` 和 `notifications.sqlite`；可用 `--data-dir /绝对路径` 或 `ORBIT_WECHAT_DATA_DIR` 指定其他位置。目录权限为 `0700`，文件为 `0600`。不与 Orbit 的数据目录共享。
- 通知可能截断、合并或遗漏，不含完整历史、附件或自己的回复。时间是系统通知投递时间；来源按标题识别，不是可靠的微信账号 ID，同名联系人或群可能无法区分。
- 插件不调用模型、不向网络服务上传消息；**工具返回的消息会进入宿主 Agent 的上下文**，后续处理遵循该宿主的设置。停用插件不会删除宿主已经保存的对话。
- 系统通知数据库不是稳定的公开接口，macOS 更新后可能需要适配。微信的通知权限、预览设置及前台状态也会影响可见内容。

## 开发与验证

```sh
npm ci
npm run build
npm test
npm run build:native
npm run test:native
npm run pack:plugin
```

单元测试和 MCP 集成测试使用临时目录与虚构数据；原生 `--self-test` 创建合成数据库。测试不读取真实系统通知，也不需要模型密钥或完全磁盘访问权限。原生构建与测试仅在 macOS 运行。

仓库提供 [GitHub Actions 配置示例](https://github.com/scfdds/orbit-personal-agent/blob/main/plugins/wechat-notifications/docs/github-actions.example.yml)，目前未启用远程 CI；需要时可将它放到仓库的 `.github/workflows/notification-plugin.yml`。

```text
src/                    CLI、MCP、本地存储和采集管理
native/                 从 Orbit 提取的 Swift 通知读取器
skills/                 Agent 使用说明
plugin.json, mcp.json    portable 插件清单
.codex-plugin/          Codex 兼容清单
.claude-plugin/         Claude Code 清单
.mcp.json               Claude Code 的本地 MCP 配置
tests/                  合成数据测试
```
