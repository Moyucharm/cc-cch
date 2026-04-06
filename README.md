# CCH Proxy

> 轻量级 HTTP 代理服务，为 LLM API 请求添加校验签名。

## 背景

某些 API 服务会对请求进行完整性校验。本代理通过在请求体中注入特定的哈希签名，使请求能够通过服务端验证。

## 支持平台

| 平台 | 入口文件 | 部署方式 | 优势 |
|------|----------|----------|------|
| **Node.js** | `proxy.mjs` | VPS / 本地运行 | 稳定、无冷启动 |
| **Deno** | `deno.mjs` | Deno Deploy / 本地 | 免费边缘部署 |
| **Cloudflare Workers** | `src/worker.js` | CF Workers | 免费、全球边缘 |

## 快速开始

### Node.js

```bash
git clone https://github.com/Moyucharm/cc-cch.git
cd cc-cch
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
wrangler login
wrangler deploy
```

## 使用方式

### 1. 启动代理

代理默认监听 `http://127.0.0.1:9876`

### 2. 配置客户端

将目标 API 的 `baseURL` 指向代理服务：

```
http://127.0.0.1:9876/proxy/<编码后的目标URL>
```

**示例**：

```json
{
  "baseURL": "http://127.0.0.1:9876/proxy/https%3A%2F%2Fapi.example.com%2Fv1"
}
```

### URL 编码规则

```
原始目标: https://api.example.com/v1
编码后:   https%3A%2F%2Fapi.example.com%2Fv1

代理 URL: http://127.0.0.1:9876/proxy/<编码后的目标URL>
```

JavaScript 编码：`encodeURIComponent("https://api.example.com/v1")`

## 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `CCH_PROXY_PORT` | `9876` | 监听端口 |
| `CCH_MAX_RETRIES` | `3` | 上游失败最大重试次数 |
| `CCH_TIMEOUT` | `120000` | 上游请求超时 (ms) |

Node.js 示例：

```bash
CCH_PROXY_PORT=9999 CCH_TIMEOUT=60000 npm start
```

## 部署指南

### Deno Deploy

1. 登录 [Deno Deploy](https://deno.com/deploy)
2. 创建新项目，链接 GitHub 仓库
3. 设置入口文件为 `deno.mjs`
4. 在 Dashboard 配置环境变量（可选）

部署后获得类似 `https://your-project.deno.dev` 的 URL。

### Cloudflare Workers

1. 安装 Wrangler：

   ```bash
   npm install -g wrangler
   ```

2. 登录 Cloudflare：

   ```bash
   wrangler login
   ```

3. 部署：

   ```bash
   wrangler deploy
   ```

4. （可选）配置自定义域名：修改 `wrangler.toml`

部署后获得类似 `https://cch-proxy.<your-subdomain>.workers.dev` 的 URL。

### VPS / 自建服务器

推荐使用 PM2 管理进程：

```bash
npm install -g pm2
pm2 start proxy.mjs --name cch-proxy
pm2 save
pm2 startup
```

## 技术原理

### 签名计算流程

```
原始请求 body (JSON)
       │
       ▼
┌─────────────────────────┐
│ 在 system 字段中        │
│ 注入 cch=00000 占位符   │
└─────────────────────────┘
       │
       ▼
┌─────────────────────────┐
│ xxhash64(body, seed)    │
└─────────────────────────┘
       │
       ▼
┌─────────────────────────┐
│ 取 hash 低 20 bits      │
│ → 5 位十六进制字符串    │
└─────────────────────────┘
       │
       ▼
┌─────────────────────────┐
│ 替换 cch=00000          │
│ → cch=<hash>            │
└─────────────────────────┘
       │
       ▼
  转发到上游 API
```

### 安全说明

- 代理不修改 API Key，仅注入签名
- 所有请求日志仅在本地记录
- 上游通信直接透传，不存储任何数据

## 功能特性

| 功能 | 状态 |
|------|------|
| 签名自动注入 | ✅ |
| xxhash64 哈希计算 | ✅ |
| 多上游渠道支持 | ✅ |
| 空回复自动重试 | ✅ |
| SSE 流式透传 | ✅ |
| Node.js 支持 | ✅ |
| Deno 支持 | ✅ |
| CF Workers 支持 | ✅ |

## 项目结构

```
cc-cch/
├── src/
│   ├── cch.js          # 核心签名计算逻辑（平台无关）
│   └── worker.js       # Cloudflare Workers 入口
├── proxy.mjs           # Node.js 入口
├── deno.mjs            # Deno 入口
├── wrangler.toml       # CF Workers 配置
├── package.json        # npm 配置
├── README.md           # 本文档
└── reference.md        # 技术参考
```

## License

MIT
