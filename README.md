# Codex LAN Notify

在 Linux 上运行 Codex CLI，通过内网把 hook 事件发送到 Windows 或 macOS 的桌面通知。Linux 端是静态 Go 二进制，不需要额外运行时；桌面端是 Electron 托盘程序。没有云服务或远程常驻进程。

## 桌面端

安装并启动 `Codex LAN Notify`。Windows ZIP 可解压后直接运行其中的 `Codex LAN Notify.exe`。程序窗口关闭后仍在托盘运行；通过托盘菜单退出。首次启动会生成 key。设置页可查看内网 IP、端口和 key，调整通知事件，测试本机通知并查看最近 500 条记录。

默认监听 `0.0.0.0:19280`，确保桌面系统防火墙允许 Linux 主机访问该端口，系统通知权限已启用。局域网 HTTP 不加密，key 和元数据会以明文传输；只在可信内网使用。重置 key 后，需要更新所有发送器的配置。

## Linux 接入

将对应架构的 `codex-hook-linux-amd64` 或 `codex-hook-linux-arm64` 复制到 Linux，使用绝对路径运行，例如：

```sh
mkdir -p "$HOME/.local/bin" "$HOME/.config/codex-hook"
cp codex-hook-linux-amd64 "$HOME/.local/bin/codex-hook"
chmod 755 "$HOME/.local/bin/codex-hook"
```

创建 `~/.config/codex-hook/config.json`（从桌面应用的配置示例复制并填写）：

```json
{
  "url": "http://192.168.1.100:19280",
  "key": "桌面应用生成的key",
  "source": "my-linux-server"
}
```

```sh
chmod 600 "$HOME/.config/codex-hook/config.json"
"$HOME/.local/bin/codex-hook" test
"$HOME/.local/bin/codex-hook" hooks
```

`test` 会在桌面显示测试通知。`hooks` 输出完整的 JSON 配置，其中命令使用发送器和配置文件的绝对路径；可用 `--config /path/config.json` 指定其他配置文件。如果 `~/.codex/hooks.json` 不存在，可将输出保存为该文件；如果已存在，**先备份，再将输出的各事件数组合并到现有 `hooks` 对象**，保留原有 hook，不要直接覆盖。每个事件下可以有多个 handler。也可合并到项目 `.codex/hooks.json`。

在 Codex CLI 中运行 `/hooks`，审核并信任新增 hook。确认远程 CLI 版本支持命令型 hooks，且没有被管理策略禁用。详见 [Codex Hooks 官方文档](https://learn.chatgpt.com/docs/hooks)。`SessionEnd` 始终同步运行；其他生成的 hook 配置请求后台执行，具体可用性取决于 Codex 版本。

默认只弹出 `Stop` 和 `PermissionRequest`。其余事件可在桌面事件设置中开启；未开启的事件仍记录。测试事件始终弹窗，暂停提醒时除外。记录包含事件类型、时间、主机、会话 ID、目录及可选工具名，不发送提示词和工具内容。HTTP 返回成功表示事件已存储，并不保证操作系统最终显示了通知。

若连接失败，检查桌面应用是否运行、监听状态、key、路由和防火墙；Linux 错误记录在配置文件旁的 `codex-hook.log`。发送失败会短暂重试一次，hook 静默返回成功，不阻断 Codex；不会离线补发。

## 开发、测试与打包

需要 Go、Node.js 和 npm。Linux 运行端不需要这些依赖。

```sh
npm ci
npm test
go test ./...
npm start
npm run build:linux-sender
npm run build:mac  # 在 macOS 构建 arm64 DMG
npm run build:win  # 在 Windows 构建 x64 安装包
npx electron-builder --win zip --x64  # 构建 Windows 免安装包
```

构建产物位于 `dist/`。macOS 签名、公证和 Windows 签名需要自行提供相应证书和 electron-builder 环境配置；未签名包可能触发系统安全提示。未设置证书时生成的包仅用于本地测试。跨平台系统通知、托盘、系统权限和安装行为需要分别在目标 Windows x64 与 macOS arm64 真机验证。

## GitHub Actions 发布

向 GitHub 推送 `v` 开头的版本标签（例如 `v1.0.0`）会触发构建；所有构建和测试成功后，流水线自动创建对应 Release，附带 Windows x64 ZIP、macOS arm64 ZIP 以及 Linux amd64/arm64 发送器。推送到 `main`、提交 PR 或手动运行只构建并保留短期 Actions artifacts，不创建 Release。

```sh
git tag v1.0.0
git push origin v1.0.0
```

Windows ZIP 解压后运行 `Codex LAN Notify.exe`；macOS ZIP 解压后运行 `.app`。流水线不配置代码签名或 Apple 公证，系统可能提示应用来自未知开发者。使用前请确认下载来源并在系统设置中允许打开。
