# AutoCAD-MCP 接入调研

日期：2026-11-18。只读检查相邻项目，未修改其源码和未提交改动。

## 版本与来源

- 远端 main 调研快照：`5e8379835c7dced142e6fcf9339741975b8dfae0`。
- 实机使用的本地 HEAD：`2f44d7b1edf8c973e6ed2abdb2003c1f78b545dd`。
- 本地分支有未提交开发改动，因此本轮实机结果不能当作远端 main 的可复现发布测试。
- 上游 [server.py](https://github.com/codesknight/AutoCAD-MCP/blob/5e8379835c7dced142e6fcf9339741975b8dfae0/src/autocad_mcp/server.py)、[pyproject.toml](https://github.com/codesknight/AutoCAD-MCP/blob/5e8379835c7dced142e6fcf9339741975b8dfae0/pyproject.toml)。许可证为 [MIT](https://github.com/codesknight/AutoCAD-MCP/blob/5e8379835c7dced142e6fcf9339741975b8dfae0/LICENSE)。

## 实际接口

- 默认：`python -m autocad_mcp.server`，MCP stdio。
- HTTP：增加 `--http`，MCP Streamable HTTP，host `127.0.0.1`、port `8931`、路径 `/mcp`。
- CAD COM 与 MCP HTTP 是不同层；在研的 CAD HTTP Bridge 也是另一层。
- MCP v1 服务端环境独立存在；Cader 本轮也锁定标准 SDK `mcp==1.28.1`。
- `tools/list` 实际发现 36 个工具，不假定设计文档的 `general_*` 名称已存在。
- 真实只读调用 `list_layers` 返回 JSON 字符串数组；本轮成功返回 2 个图层。
- 最终 Cader CLI 复验连续两次超时；工具发现仍成功。详见 smoke 记录，不视为稳定接入通过。

## 接入限制

当前 Cader 保留上游原始工具名和 schema，只提供显式的 `list_layers` 探测。
不根据工具描述或缺失的 annotations 自动授予写权限。Gateway 命名空间映射、能力声明、
统一错误契约均待后续实现。MCP `isError` 与 JSON 响应格式都必须检查。

上游按进程维护 CAD 会话；不要启动多个进程并发写同一图纸。实机只读探测启动临时 stdio
服务，断开后释放后端，不关闭或保存图纸。图层名称和其他私有绘图内容不进入公开报告。
若下次上游工具集合、后端默认配置或 commit 变化，重新执行发现和只读 smoke。
