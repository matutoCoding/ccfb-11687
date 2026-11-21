import { AnnualShadingResult } from './solar/shading';
import { GlareResult } from './solar/glare';

export function downloadCsv(filename: string, content: string) {
  // 加 BOM 以便 Excel 正确识别 UTF-8 中文
  const blob = new Blob(['﻿' + content], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function fmt(x: number, digits = 4): string {
  return (Math.round(x * 10 ** digits) / 10 ** digits).toString();
}

/** 遮挡损失 CSV: 每组件年遮挡比例 + 阵列逐时步序列 */
export function shadingCsv(result: AnnualShadingResult, projectName: string, timezone: number): string {
  const lines: string[] = [];
  lines.push(`项目,${projectName}`);
  lines.push(`时间步长(分钟),${result.timeStepMin}`);
  lines.push(`全年日照时步数,${result.sunSteps}`);
  lines.push(`计算耗时(ms),${fmt(result.elapsedMs, 0)}`);
  lines.push('');
  lines.push('组件遮挡损失(按排/列)');
  lines.push('排,列,时间加权遮挡比例,辐照加权遮挡损失');
  for (let r = 0; r < result.rows; r++) {
    for (let c = 0; c < result.cols; c++) {
      const i = r * result.cols + c;
      lines.push(`${r + 1},${c + 1},${fmt(result.moduleTimeFrac[i])},${fmt(result.moduleIrrFrac[i])}`);
    }
  }
  lines.push('');
  lines.push('阵列逐时步遮挡比例(辐照加权)');
  lines.push('当地时间,阵列遮挡比例');
  for (let s = 0; s < result.stepTimes.length; s++) {
    const local = new Date(result.stepTimes[s] + timezone * 3600000);
    const ts = local.toISOString().slice(0, 16).replace('T', ' ');
    lines.push(`${ts},${fmt(result.stepShadedFrac[s])}`);
  }
  return lines.join('\r\n');
}

/** 眩光时刻表 CSV */
export function glareCsv(result: GlareResult, projectName: string): string {
  const lines: string[] = [];
  lines.push(`项目,${projectName}`);
  lines.push(`眩光时间窗数量,${result.windows.length}`);
  lines.push('');
  lines.push('日期,开始,结束,持续(分钟),峰值眩光组件数');
  for (const w of result.windows) {
    lines.push(`${w.date},${w.start},${w.end},${w.minutes},${w.peakModules}`);
  }
  return lines.join('\r\n');
}
