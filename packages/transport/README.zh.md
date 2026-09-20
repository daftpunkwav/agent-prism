# transport/

> 语言：**简体中文** | [English](README.md)

Hono HTTP 薄协议层。`http-runtime` 是只含 middleware、health check 与 error mapping
的外壳；八个 `route-*` leaf 各挂载一个领域路由，全部由组合根 `apps/server` 显式装配。
外壳绝不 import route leaf，package 层零环。

## Subpackages

| Package | 职责 | 挂接位置 |
|---|---|---|
| [`http-runtime/`](http-runtime/README.md) | HTTP 外壳：`createHttpApplication`、共享路由 pipeline，含 `HttpApp`、`assertBodySize` 与 JSON body 解析，以及 `HttpApplicationDeps` | 由 route leaf 与组合根消费 |
| [`route-arena/`](route-arena/README.md) | Arena run、查询与 judge 路由：`registerArenaRoutes` | 挂载到外壳 |
| [`route-builder/`](route-builder/README.md) | Builder session、CRUD、热更新与流式 chat 路由：`registerBuilderRoutes` | 挂载到外壳 |
| [`route-projects/`](route-projects/README.md) | Project 路由：`registerProjectRoutes` | 挂载到外壳 |
| [`route-provider/`](route-provider/README.md) | Provider config 路由：`registerProviderRoutes` | 挂载到外壳 |
| [`route-workspace/`](route-workspace/README.md) | Workspace 文件路由：`registerWorkspaceRoutes` | 挂载到外壳 |
| [`route-sessions/`](route-sessions/README.md) | Session 读取路由：`registerSessionRoutes` | 挂载到外壳 |
| [`route-threads/`](route-threads/README.md) | 持久 agent-thread 路由，含 fork 与 resume 以及 SSE：`registerThreadRoutes` | 挂载到外壳 |
| [`route-settings/`](route-settings/README.md) | Runtime knob 与 memory 状态路由：`registerSettingsRoutes` | 挂载到外壳 |

### URL 命名空间

leaf 名与 URL 命名空间在 API 表面早于 leaf 拆分处存在分歧：`route-provider` 提供
`/api/settings/provider*`，`route-projects` 与 `route-workspace` 提供在
`/api/arena/*` 下，其余 leaf 提供顶层 `/api/<domain>`。这些路径为客户端兼容而保留；
新领域必须挂载顶层 `/api/<domain>`。
