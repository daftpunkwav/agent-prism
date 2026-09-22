# `@agentprism/sandbox`

> 语言：**简体中文** | [English](README.md)

Shell 安全策略：`DenyListSandboxPolicy` 拒绝受保护根目录的递归强制删除、格式化、
裸设备写入、根目录擦除与 fork bomb；日常命令如 echo、git、npm、范围内删除与管道
安装全部通过。`toBeforeExecute` 把策略接入 registry 的 `beforeExecute` hook，只
审查 `bash` tool。

## 依赖

- Runtime：仅 `contracts`。
