# Orbit 桌面构建

桌面壳复用 Web 界面和本机后端。以下构建方式面向 macOS，需要 Node.js ≥ 22.19.0、npm，以及提供 `swiftc` 的 Xcode Command Line Tools。

```sh
npm ci
npm run desktop:dev
```

此命令先检查并下载 Electron 运行时，再构建界面与桌面运行时并打开 Electron。首次启动需要联网下载，后续复用本地运行时。代码修改后需要退出并重新运行。开发启动器可读取本地 `.env.local`，不会把该文件打入安装包。

## 生成客户端包

```sh
npm run desktop:pack
```

Apple Silicon Mac 上输出 `desktop-dist/Orbit-macOS-arm64.zip`；架构跟随构建机器。解压后将 `Orbit.app` 放到固定位置，例如 `~/Applications/Orbit.app`，再打开。客户端已包含运行时，无需另装 Node.js。

当前使用本地 ad hoc 签名，打包前会验证签名，但**没有 Developer ID 签名或 Apple 公证**。在其他 Mac 上打开可能受到系统验证限制，不承诺即装即用。不要修改已经签名的应用包内容；详细流程见 [desktop-signing.md](scripts/desktop-signing.md)。

打包仅包含代码、静态资源、必要依赖和通知读取辅助程序，不包含 `.env.local`、本机数据目录或模型密钥。对外分发前仍应检查最终压缩包。

## 体验与系统权限

- 普通对话及内置演示不需要通知读取权限。自己的 DeepSeek API Key 在「设置 → 通用」配置。
- 微信真实采集默认关闭；用户主动开启后，需要在 macOS「隐私与安全性 → 完全磁盘访问」允许当前 Orbit。读取的是系统保留的通知片段，不是微信聊天数据库。
- 辅助功能通知读取器仅作为旧实现保留，默认采集方式不依赖其权限，也不需要保持通知中心界面展开。
- 更新本地签名构建后，系统权限可能需要重新绑定。应用不会自行授权或修改系统权限数据库。
- `Option+Space` 唤起快捷输入；关闭窗口会保留后台运行，`Command+Q` 完整退出。

客户端数据保存在 `~/Library/Application Support/Orbit/`，包括模型配置、`data/` 下的 SQLite、Markdown 记忆与产物。演示数据位于独立工作区；安装包不携带这些本机数据。

## 验证

```sh
npm run desktop:test
```

测试覆盖桌面桥接、草稿、权限边界与本地签名。无自动更新服务；Windows、Linux 及 Intel Mac 客户端尚未验证。
