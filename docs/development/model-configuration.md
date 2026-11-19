# 模型配置与运行

配置目录统一使用 `configs/`，不再保留并行的 `config/`、根 `prompts/` 或根 `skills/`。

```text
configs/
  models/MainAgent.yaml      # Flash 主 Agent
  models/SubAgent.yaml       # Pro 文本子 Agent
  models/VisionAgent.yaml    # Flash 视觉子 Agent
  runtime.yaml               # 并发、深度、预算、已审查只读工具
  mcp/AutoCAD.example.yaml
  mcp/AutoCAD.local.yaml      # 本机路径，已忽略
  mcp/python-http.example.json
  mcp/python-stdio.example.json
  mcp/python.local.json       # Python 诊断客户端本机配置，已忽略
  prompts/static/MainAgent.md
  prompts/static/SubAgent.md
  skills/cad-inspection/SKILL.md
  skills/catalog.yaml
  skills/cad-redraw-review/SKILL.md
  skills/cad-redraw-review/references/assessment-format.md
```

根 `.env` 只需设置 `DEEPSEEK_API_KEY=...`。YAML 使用 `api_key_env: DEEPSEEK_API_KEY`
引用变量名，禁止写密钥值。`.env.example` 只给空变量；`.env` 和本机 MCP 配置不提交。

`runtime.yaml` 管运行限制和已注册模型；`models/` 管模型 profile；`mcp/` 管连接；
`prompts/static/` 管稳定角色规则；`skills/` 管按需加载的指引。
Available 仍由运行时按当前模型、工具 schema、Skill 目录和预算动态组装，不保存易过期的工具清单。
Skill 清单显式列出 name、description、roles、mode 与 resource ID → Markdown 路径。
当前 cad-inspection 对全部角色可见；cad-redraw-review 仅对 main / vision 可见。
未注册目录不会自动被发现；资源只能按注册 ID 加载，不执行文件或开放新工具。
加载器拒绝重复名称、错误角色、额外 command 字段、越界路径/链接及超过 64 KiB 的资源；
SKILL.md frontmatter 的 name 必须与清单一致。清单是发现元数据的来源，正文是按需上下文。

2026-11-19 迁移：旧 `config/*` 对应 `configs/*`，根 `prompts/`、`skills/` 分别迁入
`configs/prompts/`、`configs/skills/`；旧 `configs/local.mcp.json` 对应
`configs/mcp/python.local.json`。已有本机文件原样迁移，不复制真实配置进 Git。
外部脚本需同步参数路径，加载器不回退旧位置；历史日志保留当时路径。
MCP YAML 的相对 `cwd` 以配置文件所在目录解析，迁移后目录深度不变。
Python JSON 和 DSH YAML 仍是不同 schema，不能互换。

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

将 `configs/mcp/AutoCAD.example.yaml` 复制为 `AutoCAD.local.yaml`，填写独立 MCP 环境的
Python executable 和仓库 cwd。本机已配置用户指定的 AutoCAD_MCP 路径；没有修改上游源码。

```powershell
pnpm live-smoke --mcp configs/mcp/AutoCAD.local.yaml
pnpm live-smoke --mcp configs/mcp/AutoCAD.local.yaml --image benchmark/fixtures/vision-calibration.png --expected-image benchmark/fixtures/vision-calibration.expected.json
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


## 交互终端中的选择

面向用户的完整配置与操作步骤见[CLI 中文使用手册](../cli/README.zh-CN.md#configuration) / [English User Guide](../cli/README.md#configuration)。

/model列出configs/models的注册ID，/model <ID>只切换主会话所用模型，保留主Agent角色与子Agent权限。
configs/domains/catalog.yaml提供/domain的general/electrical指导；专业选择不授予新工具或写权限。
配置根.env与YAML在启动/装配时读取，修改后重启终端。/mcp use选择配置；不自动启动AutoCAD或切换服务端COM/HTTP。
/skills off仅取消预加载，角色可见的按需技能目录仍可用。完整说明见[交互终端指南](../architecture/interactive-terminal.md)。
