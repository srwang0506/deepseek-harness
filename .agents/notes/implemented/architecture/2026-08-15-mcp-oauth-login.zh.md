# Agent Note：MCP OAuth 登录 — SDK 授权流程 + loopback 重定向，以及 get/logout

Status: implemented

[English](2026-08-15-mcp-oauth-login.md) | 中文

## 问题

`dsh mcp` 只能添加、列出与删除服务器，却无法认证它们：需要 OAuth 的 Streamable HTTP MCP 服务器在终端不可达；无法查看单个服务器的配置，也无法清除已存凭据。

## 决策

**登录流程位于 `dsh-mcp-client`，搭内置 MCP SDK。** `loginMcpServer(url, options)` 端到端运行 MCP Authorization 序列：`discoverOAuthServerInfo`（受保护资源元数据 + well-known 回退）、`startAuthorization`（PKCE）、在授权前先绑定的 loopback 重定向监听（使重定向 URI 携带真实端口）、detached 浏览器打开与 `exchangeAuthorization`。SDK 的失败形态塑造了代码：对不可达服务器，元数据发现返回 `undefined` 而不是抛错，因此 loopback 等待带有超时（`timeoutMs`，默认五分钟），把「重定向永远不来」变成响亮错误。打开器是 shell 模板（`{url}` 占位符，经 shell 引号包裹），因为 SDK 的查询参数含 `&`；`DSH_MCP_OPEN_COMMAND` 覆盖它，也让流程可用 `curl` 测试。

**凭据存放于 `$DSH_HOME/mcp-auth.json` 与行的 headers。** `dsh mcp login <name>` 把交换得到的令牌存入按服务器名索引的主目录 JSON 文档，并设置该行的 `Authorization: Bearer` 头；`dsh mcp logout <name>` 两者皆清。`dsh mcp get <name>` 打印单个服务器的配置，bearer 头以 `(set)` 掩盖。

## 后果

`login.ts` 达到逐文件 100% 覆盖——传给 SDK 的 `setTimeout` 回调以具名函数加 reject holder 传递，而非匿名箭头，因为本工具链的 v8 插桩不认领无法归属的定时器回调；`rejectLoginTimeout` 同时充当可直接测试的超时原语。登录流程由本地 mock 授权服务器（发现、自动批准的 `/authorize`、`/token`）在单元测试中覆盖，并由真实启动器 e2e 以 `curl` 为打开器驱动 `dsh mcp add/login/get/logout`。平台打开器分支经 `process.platform` 桩获得单元覆盖。

## 备选方案

- **从零实现 OAuth**：SDK 已附带发现、PKCE、令牌交换与容忍 CORS 的重试；复用它免费获得规范一致性。
- **经 settings 区段把令牌交给客户端**：bearer 头是传输自身的缝隙；写入行让连接配置集中一处。
- **设备码流程**：MCP Authorization 规定授权码 + PKCE 流程并附可选扩展；浏览器流程是可互操作的基线，loopback 监听也很小。
