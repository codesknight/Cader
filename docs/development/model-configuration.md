# 模型配置与运行

配置目录统一使用用户指定的 `config/models/`。原 `configs/` 保留 Python 诊断客户端的历史示例。

```text
config/
  models/MainAgent.yaml      # Flash 主 Agent
  models/SubAgent.yaml       # Pro 文本子 Agent
  models/VisionAgent.yaml    # Flash 视觉子 Agent
  runtime.yaml               # 并发、深度、预算、已审查只读工具
  mcp/AutoCAD.example.yaml
  mcp/AutoCAD.local.yaml      # 本机路径，已忽略
prompts/static/
  MainAgent.md
  SubAgent.md
```

根 `.env` 只需设置 `DEEPSEEK_API_KEY=...`。YAML 使用 `api_key_env: DEEPSEEK_API_KEY`
引用变量名，禁止写密钥值。`.env.example` 只给空变量；`.env` 和本机 MCP 配置不提交。

```powershell
pnpm install --frozen-lockfile
pnpm models
```

`models` 检查 YAML 并显示 credentialConfigured 布尔值，不发模型请求，也不打印密钥。
每个模型可配置 model、base_url、input、输出上限、reasoning_effort 和 timeout_ms。
新增其他工作模型时，文件名与 id 一致，并在 runtime.yaml 的 subagent_profiles 注册。
只有 runtime 指定的主 profile 可使用 main 角色和 can_delegate=true。

当前 DeepSeek Flash 支持图像；Pro 配置为 text-only。更改 input 声明不会赋予模型新的能力。
默认关闭 thinking，以有界输出做 M0 smoke；需要推理时可明确配置 low/high/max。

## 真实模型与 AutoCAD-MCP smoke

将 `config/mcp/AutoCAD.example.yaml` 复制为 `AutoCAD.local.yaml`，填写独立 MCP 环境的
Python executable 和仓库 cwd。本机已配置用户指定的 AutoCAD_MCP 路径；没有修改上游源码。

```powershell
pnpm live-smoke --mcp config/mcp/AutoCAD.local.yaml
pnpm live-smoke --mcp config/mcp/AutoCAD.local.yaml --image benchmark/fixtures/vision-calibration.png --expected-image benchmark/fixtures/vision-calibration.expected.json
```

该命令会调用真实模型 API、连接本机 MCP，验证只读 CAD 工具、主/子返回，以及可选视觉校准。
校准期望值只由 verifier 读取，传给模型的是实际图片。图像路径必须位于工作区；主 Agent
仅能把已登记的 image_ref 交给视觉子 Agent。当前命令不绘制、保存或删除 CAD 实体。
上游 COM 后端在没有运行中的 AutoCAD 时可能启动一个实例并创建默认空白文档。

原始记录放 `.cader/runs/live-*/`：脱敏配置、JSONL 事件、verification.json、summary.md。
时间戳使用 UTC；开发文档使用 Asia/Shanghai。配置记录不含密钥值，不保存隐藏推理。
未提供图像时视觉项为 null；没有独立期望值时不把“接受图片”算成视觉正确性通过。

CI 只运行无需凭据的 fixture / 单元测试，不触发付费请求。Live smoke 是 headless Cader
组合，不等于已经验证 DSH Web UI、实际 CAD 图片评测或绘图保存闭环。
