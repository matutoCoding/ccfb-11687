/**
 * CSV 导出:遮挡损失(逐组件·月)与眩光时刻表。
 * 统一加 UTF-8 BOM,Excel 直接打开不乱码。
 */
import type { AnnualResult } from './annual';
import type { GlareResult } from '../types';
import { buildModules } from './layout';
import type { Project } from '../types';

const MONTHS = ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'];

function escapeCell(v: string | number): string {
  const s = String(v);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function toCSV(rows: (string | number)[][]): string {
  return '﻿' + rows.map((r) => r.map(escapeCell).join(',')).join('\r\n');
}

/** 遮挡损失 CSV:每块组件一行,含全年均值与 12 个月均值 */
export function shadingLossCSV(project: Project, result: AnnualResult): string {
  const modules = buildModules(project.arrays);
  const rows: (string | number)[][] = [];
  rows.push([
    '组件ID', '阵列', '排号', '列号',
    '中心X(m)', '中心Y(m)', '中心Z(m)',
    '全年平均遮挡比例', '全年遮挡损失(%)',
    ...MONTHS.map((m) => `${m}遮挡比例`),
  ]);
  result.modules.forEach((r, i) => {
    const m = modules[i];
    rows.push([
      m.id, m.arrayName, m.row + 1, m.col + 1,
      round3(m.center.x), round3(m.center.y), round3(m.center.z),
      round4(r.annualMean), round2(r.annualMean * 100),
      ...r.monthly.map((v) => round4(v)),
    ]);
  });
  return toCSV(rows);
}

/** 眩光时刻 CSV:每次事件一行 */
export function glareScheduleCSV(result: GlareResult): string {
  const rows: (string | number)[][] = [];
  rows.push([
    '观察点', '日期', '时刻', '时间戳', '组件ID', '阵列ID',
    '反射偏角(°)', '距离(m)', '是否被遮挡',
  ]);
  for (const e of result.events) {
    rows.push([
      result.observerName, e.dateLabel, e.hourLabel, e.timestamp,
      e.moduleId, e.arrayId, e.angleDeg, e.distance, e.blocked ? '是' : '否',
    ]);
  }
  rows.push([]);
  rows.push(['眩光总时长(h)', round2(result.totalHours)]);
  rows.push(['其中被遮挡时长(h)', round2(result.blockedHours)]);
  rows.push(['有效眩光时长(h)', round2(result.totalHours - result.blockedHours)]);
  return toCSV(rows);
}

/** 浏览器端下载 */
export function downloadCSV(filename: string, csv: string): void {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}
