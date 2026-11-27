# REQ-052：局部坐标与视觉联合验证

日期2026-11-27（Asia/Shanghai），Cader dev.14；关联[Cader #20](https://github.com/codesknight/Cader/issues/20)、Milestone3。独立MCP配套[PR48](https://github.com/codesknight/AutoCAD-MCP/pull/48)，提交7291468；未把整图未完成说成已验收。

## 离线

`pnpm typecheck`、`pnpm test` **331/331**、`pnpm smoke`通过。smoke为实际DSH组件夹具，realModelEvaluated/cadEvaluated/fullAppProfileEvaluated均false。新增实际DSH测试证明源/视觉worker不继承主Agent旧last_visual/CAD历史而Main仍保留；BASE裁片一次转换、OCR两轮冻结bounds、外部裁片拒绝、raw JSON schema、scope/对象/空缺陷ID拒绝、真实详情hash复用、partial编译清单和不可观测时不盲修均覆盖。

actual-stdio测试覆盖局部截图参数进入审计原请求与受控入口、实际PNG尺寸核验、窗口/像素/configuration证明不符拒绝、旧服务原生前拒绝，unknown原有反例保留。PNG与模型均明确为夹具，不冒充真实CAD。

独立AutoCAD-MCP `python -m pytest -q`最终**304 passed / 34 skipped**；34个CAD集成测试需显式开启，不能说它们通过。实际stdio工具发现脚本已运行，仅同步export_current_view实际schema基线；此前一次基线失败保留。

## 真实原生局部截图

使用此前已隔离PID180452、生产COM控制器/capture模块，本轮原始大图Agent生成的owned工作图；不连接用户其他原始实例。根据实际文字bbox导出原生局部PNG，QHD介质**2560×1440**，18061 bytes，SHA256 cc1d92777506a8c09c7ad145df5682fcdc8505a746e8912887e0bbd9397e2da9。实看文字清晰，原DWG hash与实体数量保持。

打印前配置读回加强后的另一原生probe：同分辨率、14108 bytes、SHA256 8efed9fdf77cdb3639521330954d54259c4b3f87dbeb3fa948004b5117f84a91，configuration_verified/restoration_verified/cleanup_verified均true。该次对象为实际线实体；前次文字与本次加强读回分别记录，不混成未执行的单一测试。两次均无文档创建/打开/保存/激活/关闭、无几何修改；只临时改动并恢复打印设置。

这些probe不等于完整Agent回归。window/fit是受控窗口信息，pixel_to_world仍null，不虚报精确像素映射。

## 原始大图真实模型与AutoCAD

参考始终为用户原始img_001.png（4967×3509），SHA256 541f0f75b878e4ca2f053ca975b5aa8e19e4db1bd87bec0199c30f7b7f314f1b；完整原始请求，仅增加独占DWG输出意图。生产InteractiveSession/Task/DSH/MCP，模型自主选择工具/多轮调用；不注入固定几何操作序列或用简单圆替代。

私有运行根`.cader/runs/progressive-scope-20261127/`，旧原始文件和unknown屏障基线30份。所有原始工具轨迹、图像/视觉、源报告、检查点和失败留私有目录，公开仅脱敏结论。

生产默认预算命令：
```powershell
pnpm build
node benchmark/run-progressive-case.mjs --live-smoke --approve-cad-task --mcp <本轮配置> --workspace <全新目录> --task-file <UTF-8原始请求> --checkpoint-pause-resume
```

| 运行 | 结论 |
|---|---|
| original-default | 初版联调，局部绘图已有确认写入；窗口参数遗漏observedArguments，在native前拒绝，视觉未评审不得通过。2M累计token停止，旧日志保留。 |
| original-mapped | 补齐映射后真实原生2560×1440图像进入Vision，实际批次pass、中断及同连接恢复均已发生；仍出现旧区域last_visual污染独立worker，被据此修复。没有将uncertain强制改pass。 |
| original-isolated | 补充原始像素范围时初版误用DSH value-schema DSL不支持的minimum，0CAD装配失败；已切raw JSON schema并用actual DSH测试，原失败保留。 |
| original-final | 显式4M回归完成：47确认/0未知、36实体DWG20711字节，P1只读重开通过；同任务/连接/文档/native ID、一次新建、累计预算和起始时间不变量均通过。最终因4,012,928累计token暂停，部分区域partial_verified，整图false。该轮尚未包含最后的geometry_only与小图元近景补修，不作为其验收证据。 |
| original-contract-final | 生产默认2M/8192：7确认/0未知，58模型步、893,326 tokens后服务返回QUOTA（不是本地预算耗尽，不能仅凭码断言余额不足）；1个完整批次pass，第二批视觉pass但被背景触边阻断，整区几何也仍有未完成片段。独立原生近景2份、主窗口3份均2560×1440，scope绑定及同连接恢复不变量通过。16826字节/3实体待验DWG保存、P1只读重开及额外原生字段核对通过；整图false。该轮在BUG098背景触边补修之前，旧状态保留。 |

原始大图的整图覆盖、全部标签/拓扑/最终视觉尚不能标通过。部分DWG、源片段通过或文件重开均不能替代整体条件。源模型的器件/端子清点分歧仍是独立问题，不能用放开未知片段绘制解决。

## Skill证据

progressive-drawing入口和四份references集中注册，main/vision只读；源worker使用新增source-observation，主规划用task-decomposition，CAD评审用verification-and-repair，恢复用checkpoint-and-recovery。实际skill.loaded记录角色、资源、正文与context hash，源worker不能据Skill取得写工具。当前文件摘要如下，历史run加载不同版本的事件保留：

| 资源 | SHA256 |
|---|---|
| SKILL.md | `8ab472b88d10936c5fc6af4b2a61e739bbf2530976a7b31a6d2c214398189468` |
| references/task-decomposition.md | `f36072f75c05614b8543172a347c32998a5ced39b2c65ddfaad7c6c5a236c369` |
| references/source-observation.md | `a04f9114ffa8fa5652ce84f99816d8b6fb440218b0ceddf5454265418dca9d77` |
| references/verification-and-repair.md | `fa6d534defdea5b796ee816381776b6e05b0f5b17541af3491bb074221ad2aa5` |
| references/checkpoint-and-recovery.md | `0f481cf98eebabf7f2a9660e640bbdeb03dcc396291c67802ccb735c81c3611d` |

## 本轮代码回归的最后检查

属性合同阶段final4为330/330；背景触边补修后最终输出为私有typecheck-final5.txt、tests-final5.txt、smoke-final5.txt：typecheck、331/331、DSH组件smoke通过。新增反例包括独立清点不可看到旧source候选、片段视觉不可自行扩大到未采集样式、细小非文字实体也获得原生近景。未更改Cader Python，故未重复本地cader-mcp Python检查；独立MCP的304/34skip及真实COM另列。

完整4M运行的原生产真实DSH轨迹记录188模型步、15份cad.review、11份主窗口与6份详情事件，4次同图复核复用原图；实际样式争议及所有uncertain保留。以上不是最后默认预算任务的计数。

## 最终原始任务：分层实测结论

`original-contract-final`原始任务2M默认上限，服务在893,326 tokens时QUOTA。共4份视觉结果：1 uncertain、2 pass、1因QUOTA没有有效报告；同图复核1次，2个批次中实际只有第一个pass，第二个因background clipping保留fail，不能将2份视觉pass写成2批通过。最后区域原生几何还有draft_blk_left未齐，故不是只有服务恢复就能直接宣称完成。

实际局部PNG为3份主窗＋2份近景，均2560×1440，configuration_verified/restoration_verified/cleanup_verified为true；两份详情分别绑定两个本批实际短线实体，证明小图元近景触发，不仅是单独截图probe。有效报告全部scope ID匹配。该有限运行中SOURCE_LABEL_BOUNDS_OUTSIDE_CROP和SOURCE_VIEW_OUTSIDE_BASE均0；早期47次错误保留，不能据有限覆盖宣称所有源识别已根治。

首个通过批次后的主动安全中断与同连接resume确实执行：同任务、local/native文档、连接、确认账本、一次new_drawing、原始起始时间与累计预算全保持。服务拒绝后自动保存P1产物，独占路径DWG16826字节，SHA256 `1d40511d1168e98c22a71af75c2e7b514f136e82ebe166bb5c470df1e653098e`；只读副本3实体，额外原生查询字段全部一致。原生verifier未新Open/SaveAs/Activate/Close，未把只读验收图接管为工作图。

另一保留4M产物20711字节/36实体的额外原生核对：源图与只读副本支持几何字段相同，但5个Text的动态bbox高度与早先query回执有差异，故其额外verifier `ok=false`；P1原始summary通过仍保留，不升级为额外原生全字段通过。字体缓存/再生是否原因尚未证实。16922字节/7实体早期产物额外原生核对通过。所有结果与失败并列保留。

最终背景触边修复增加原生scope窗口/配置/目标bbox的确定性正反测试，并用刚才留存的真实PNG/回执重算；这属于真实证据离线再评估，不是新模型评审或新CAD绘制。由于服务QUOTA，补修后的全程付费模型回归尚未执行。独立源清点分歧、高成本重复源读取、后续源样式采集和完整拓扑/覆盖仍需后续工作，Issue20/PR22保持open/Draft。


Skill creator的quick_validate.py对现有Skill聚焦验证通过（Skill is valid），不以frontmatter验证冒充行为验收。最终真实运行的source-observation/main与vision、verification-and-repair/main与vision均有skill.loaded正文与context hash，未加载为写权限。

保留检查：本轮基线30份文件全部hash一致（原始图片、旧DWG、历史屏障）；验证后再核对并保存在私有preservation-after.json。用户未跟踪设计文件与邻仓web/脚本改动不在本次提交。双语手册及新增文档相对链接检查通过；普通提交/当前HEAD CI在Issue20和Draft PR22更新，未通过整体质量不合并。
