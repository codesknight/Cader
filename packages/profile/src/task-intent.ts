export type TaskIntent = 'preference' | 'status' | 'continue' | 'drawing' | 'conversation';

/** Conservative, deterministic routing. Mixed policy + action requests remain
 * actions; a policy acknowledgement must never authorize CAD writes. */
export function taskIntent(text: string): TaskIntent {
  const task = text.trim();
  if (/^(?:继续|继续绘制|继续重绘|继续这个任务|开始|开始绘制|重试|continue|resume)[。！!？?]*$/i.test(task)) return 'continue';
  const action = /(?:现在|这次|本次|然后|并且|顺便).*(?:画|绘制|新建|创建|移动|修改|保存)|^(?:请|帮我|请帮我|能否帮我|能帮我)?\s*(?:新建|画|绘制|重绘|设计|生成|制作|复现|临摹|移动|旋转|修改|保存|检查|验证|修正|draw\b|move\b|rotate\b)/i.test(task);
  if (!action && /(?:以后|今后|每次|始终|默认|以后都|from now on|always|every time)/i.test(task) && /视觉|验证|校验|检查|vision|review|verif/i.test(task)) return 'preference';
  if (!action && /(?:是否|有没有|多少次|几次|结果|状态|为什么|为何|如何|怎么|有什么功能|能画什么|have you|did you|status)|(?:做过|用过|调用过|使用过|检查过|验证过|校验过).*[吗?？]|了吗[?？。]*$/i.test(task)) return 'status';
  if (/画|绘制|重绘|复现|临摹|描绘|布局|添加.*(?:文字|标注)|(?:创建|设计|生成|制作|搭建|做).*(?:电路|图|符号|组件)|\bdraw\b|\bredraw\b|\btrace\b|\breproduce\b|\brecreate\b|\bdiagram\b|\bschematic\b/i.test(task)) return 'drawing';
  return 'conversation';
}
