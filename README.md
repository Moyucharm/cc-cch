# CCH Proxy

Claude Code CCH 注入代理，让 OpenCode 伪装成 Claude Code CLI 请求 Anthropic API。

## 支持平台

| 平台 | 入口文件 | 部署方式 |
|------|----------|----------|
| **Node.js** | `proxy.mjs` | VPS / 本地运行 |
| **Deno** | `deno.mjs` | Deno Deploy / 本地运行 |
| **Cloudflare Workers** | `src/worker.js` | CF Workers 边缘部署 |

## 快速开始

### Node.js

```bash
npm install
npm start
```

### Deno

```bash
deno run --allow-net --allow-read --allow-env deno.mjs
```

### Cloudflare Workers

```bash
npm install -g wrangler
wrangler deploy
```

## 使用方式

代理运行后，将 OpenCode 的 Anthropic 渠道 `baseURL` 改为：

```
http://127.0.0.1:9876/proxy/<编码后的目标URL>/messages
```

**示例**：目标 `https://api.milki.top/v1`

```json
{
  "baseURL": "http://127.0.0.1:9876/proxy/https%3A%2F%2Fapi.milki.top%2Fv1"
}
```

编码规则：`encodeURIComponent("https://api.milki.top/v1")`

## 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `CCH_PROXY_PORT` | 9876 | 监听端口 |
| `CCH_MAX_RETRIES` | 3 | 最大重试次数 |
| `CCH_TIMEOUT` | 120000 | 超时时间 (ms) |

## 部署指南

### Deno Deploy

1. 创建 [Deno Deploy](https://deno.com/deploy) 账号
2. 新建项目，链接 GitHub 仓库
3. 入口文件设置为 `deno.mjs`
4. 环境变量在 Dashboard 配置

### Cloudflare Workers

1. 安装 Wrangler: `npm install -g wrangler`
2. 登录: `wrangler login`
3. 部署: `wrangler deploy`
4. 配置自定义域名（可选）

部署后获得类似 `https://cch-proxy.<subdomain>.workers.dev` 的 URL。

## 功能

- ✅ CCH 自动注入 (xxhash64 + 低 20 bits)
- ✅ 多上游渠道支持 (URL 编码)
- ✅ 空回复自动重试 (最多 3 次)
- ✅ SSE 流式响应透传
- ✅ 多平台支持 (Node / Deno / CF Worker)

## 原理

详见 [reference.md](./reference.md)
