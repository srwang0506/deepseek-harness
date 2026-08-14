# DeepSeek Harness

[English](README.md) | 中文

DeepSeek Harness（`dsh`）是由 [DeepSeek AI](https://deepseek.com) 开发的开源 agent harness（智能体框架）。

它采用**一切皆插件**的架构，并由 [Cordis](https://github.com/cordiverse/cordis) 驱动，其设计参见论文 [_A Programming Paradigm for Spatiotemporal Composability_](https://github.com/cordiverse/paper)。

## 开发者预览

DeepSeek Harness 目前处于 _开发者预览_ 阶段，正在快速迭代。**未来将出现破坏兼容性的变更。**

## 原生发行版

本 fork 发布 macOS App、macOS CLI、Linux 服务器 CLI 与 Windows CLI。请只选择一个安装场景；App 与 CLI 不会捆绑安装。每种安装都会校验 Release 哈希，并在替换前备份已有目标。

### macOS 桌面 App

仅支持 Apple 芯片；安装图形 App，不安装 CLI：

```sh
curl -fsSL https://github.com/srwang0506/deepseek-harness/releases/latest/download/install.sh | sh -s -- macos-app
```

### macOS CLI

仅支持 Apple 芯片；安装 `dsh`，不安装桌面 App：

```sh
curl -fsSL https://github.com/srwang0506/deepseek-harness/releases/latest/download/install.sh | sh -s -- macos-cli
```

### Linux x64 服务器

```sh
curl -fsSL https://github.com/srwang0506/deepseek-harness/releases/latest/download/install.sh | sh -s -- linux-x64
```

### Linux ARM64 服务器

```sh
curl -fsSL https://github.com/srwang0506/deepseek-harness/releases/latest/download/install.sh | sh -s -- linux-arm64
```

### Windows

```powershell
irm https://github.com/srwang0506/deepseek-harness/releases/latest/download/install.ps1 | iex windows-x64
```

CLI 在 macOS 与 Linux 上链接为 `~/.local/bin/dsh`，在 Windows 上链接为 `%LOCALAPPDATA%\DeepSeek Harness\bin\dsh.cmd`。DeepSeek 仍是默认模型；GPT 模型可选用浏览器 OAuth、设备码 OAuth 或 OpenAI Platform API key。安装路径、服务器登录、SSH 隧道、构建方式与安全说明请查看[原生发行指南](desktop/README.md)。

## 运行

### 通过 `npm` 运行

安装 `Node.js`，然后运行：

```sh
npx @deepseek-ai/dsh            # interactive terminal client
npx @deepseek-ai/dsh "task"     # run one task and exit
npx @deepseek-ai/dsh web        # Web UI
```

`dsh` 是一个 Codex 风格的交互式终端客户端。裸 `dsh` 会在你的终端里打开全屏会话；`dsh "任务"` 执行一个任务并打印结果；`dsh web` 启动浏览器 UI，默认地址为 `http://127.0.0.1:3080`。详见 [Web UI 指南](docs/user/guide/index.md)。

### 从源码运行

如需从仓库源码运行：

```sh
git clone https://github.com/deepseek-ai/deepseek-harness.git
cd deepseek-harness
pnpm install
pnpm run build
pnpm dsh            # interactive terminal client
pnpm dsh "task"     # run one task and exit
pnpm dsh web        # Web UI
```

## 社区与支持

- 欢迎通过 [GitHub Discussions](https://github.com/deepseek-ai/deepseek-harness/discussions) 提交反馈或 bug 报告。
- 为你的插件仓库添加 [`dsh-plugin`](https://github.com/topics/dsh-plugin) 话题，便于被发现。
- 欢迎加入 DeepSeek Harness 企微群：扫码添加企微小助手并填写入群问卷，完成后小助手会邀请你入群。

<table>
  <thead>
    <tr>
      <th align="center">企微小助手</th>
      <th align="center">入群问卷</th>
      <th align="center">微信公众号</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td align="center"><img src="assets/community-wecom-assistant.png" alt="DeepSeek Harness 企微小助手二维码" width="180" height="180"></td>
      <td align="center"><a href="https://trtgsjkv6r.feishu.cn/share/base/form/shrcnIt5twSVdLGD52KJBckGCgg"><img src="assets/community-wecom-survey.png" alt="DeepSeek Harness 入群问卷二维码" width="180" height="180"></a></td>
      <td align="center"><img src="assets/community-wechat-official-account.png" alt="DeepSeek Harness 团队微信公众号二维码" width="180" height="180"></td>
    </tr>
  </tbody>
</table>

## 参与贡献

参见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 开发

请先阅读[开发指南](docs/development.md)与[架构文档](docs/architecture.md)。

面向 agent：请遵循 [AGENTS.md](AGENTS.md)。

## 许可证

[MIT](LICENSE)

第三方依赖及其许可证见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
