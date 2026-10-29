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

### 将 hook 注册到 Codex

`test` 成功只说明发送器可以连接桌面。`codex-hook hooks` **只打印配置，不会自动修改 Codex 配置文件**。把程序放入 `.local/bin` 或 PATH 不会让 Codex 自动发现它。如果你将程序命名为 `codex-hooks`，请相应替换下面命令中的名称。

请在运行 Codex 的同一台 Linux、同一个用户下执行：

```sh
hook_dir="${CODEX_HOME:-$HOME/.codex}"
mkdir -p "$hook_dir"

# 不覆盖已有 hook 配置；已有文件时打印待合并的配置
if [ -e "$hook_dir/hooks.json" ]; then
  echo "已有配置，请先备份，再手动合并：$hook_dir/hooks.json"
  "$HOME/.local/bin/codex-hook" hooks
else
  (set -C; "$HOME/.local/bin/codex-hook" hooks > "$hook_dir/hooks.json")
fi
```

如果发送器使用自定义配置路径，生成时使用 `codex-hook hooks --config /绝对路径/config.json`，并将输出保存或合并到同一 `hooks.json`。生成结果包含发送器及其配置文件的绝对路径；移动程序或配置文件后应重新生成对应定义。已有文件时，将各事件数组中的条目追加到现有 `hooks` 对象，保留其他 hook，避免整体覆盖。

保存后退出并重新启动 Codex CLI，输入 `/hooks`，审核并信任新增定义。列表按 `Stop`、`PermissionRequest` 等事件组织，不一定显示名为 `codex-hook` 的“工具”。修改定义后可能需要重新信任。

### Codex 如何加载和执行 hook

这是基于配置文件的事件订阅，不是安装一个 MCP 工具，也不需要模型通过提示词记住它：

1. Codex 从活动配置层加载 `hooks.json`，也支持 `config.toml` 中的内联 `[hooks]` 表。
2. 每个事件配置一个或多个命令 handler；事件触发且定义已信任时，Codex 启动指定命令。
3. Codex 把事件 JSON 写入命令的标准输入；本项目的 `send` 命令提取元数据，通过 HTTP 转发到桌面。

用户级默认路径是 `~/.codex/hooks.json`；自定义 `CODEX_HOME` 时应使用对应目录。项目级也可以使用 `<项目>/.codex/hooks.json`，但项目配置层必须受信任。本项目推荐独立 `hooks.json`，**无需修改已有 `config.toml`**；同一层中混用两种表示会被合并并可能产生警告。不要在两处重复注册同一发送器，否则可能产生重复通知。

确认远程 CLI 版本支持命令型 hooks、功能未关闭且未被管理策略禁用。`SessionEnd` 始终同步运行；其他生成的 hook 配置请求后台执行，具体可用性取决于 Codex 版本。详见 [Codex Hooks 官方文档](https://learn.chatgpt.com/docs/hooks)。

### `/hooks` 看不到配置时

先重启 CLI，然后在启动 Codex 的同一个终端检查：

```sh
codex --version
printf 'CODEX_HOME=%s\n' "${CODEX_HOME:-未设置}"
ls -l "${CODEX_HOME:-$HOME/.codex}/hooks.json"
cat "${CODEX_HOME:-$HOME/.codex}/hooks.json"
```

检查文件是否实际存在、JSON 是否完整、命令路径是否正确，以及是否用了不同用户、容器或 `CODEX_HOME`。排查时无需分享包含 key 的 `~/.config/codex-hook/config.json`。

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
