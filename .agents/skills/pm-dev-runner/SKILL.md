---
name: pm-dev-runner
description: "通过本地 API 手动读取 PM 需求、开发本项目、恢复执行进度、按约定时间交付并回填任务。用户要求查看 PM 开发待办、执行 PM 任务或调用 pm-dev-runner 时使用。"
---

# 项目入口

先完整读取 [PM 手动开发助手](../../../tmp/pm-dev-runner/SKILL.md)，然后依其入口和工作流执行。

Skill 本体、配置、脚本和台账均位于仓库的 `tmp/pm-dev-runner/`。将该目录作为本 Skill 的资源根目录；不要在此入口目录创建另一份台账或复制实现。
