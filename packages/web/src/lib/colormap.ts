/**
 * 应力云图颜色映射：蓝（低）→ 青 → 绿 → 黄 → 红（高）。
 * 采用分段线性近似的 "turbo" 风格色带。
 */

const STOPS: Array<[number, [number, number, number]]> = [
  [0.0, [48, 18, 59]],
  [0.15, [32, 90, 170]],
  [0.35, [20, 190, 200]],
  [0.55, [80, 210, 90]],
  [0.75, [240, 210, 40]],
  [0.9, [235, 110, 30]],
  [1.0, [150, 20, 20]],
];

export function colorMap(t: number): [number, number, number] {
  const x = Math.max(0, Math.min(1, t));
  for (let i = 0; i < STOPS.length - 1; i++) {
    const [t0, c0] = STOPS[i];
    const [t1, c1] = STOPS[i + 1];
    if (x >= t0 && x <= t1) {
      const f = (x - t0) / (t1 - t0);
      return [
        Math.round(c0[0] + (c1[0] - c0[0]) * f),
        Math.round(c0[1] + (c1[1] - c0[1]) * f),
        Math.round(c0[2] + (c1[2] - c0[2]) * f),
      ];
    }
  }
  return STOPS[STOPS.length - 1][1];
}

export function rgbCss(c: [number, number, number], alpha = 1): string {
  return `rgba(${c[0]},${c[1]},${c[2]},${alpha})`;
}

export function colorForValue(v: number, min: number, max: number): string {
  if (max <= min) return rgbCss(colorMap(0.5));
  return rgbCss(colorMap((v - min) / (max - min)));
}

/** 工程数值格式化 */
export function engineering(v: number, digits = 3): string {
  if (!isFinite(v)) return "—";
  if (v === 0) return "0";
  const abs = Math.abs(v);
  if (abs >= 1e9) return (v / 1e9).toFixed(digits) + " G";
  if (abs >= 1e6) return (v / 1e6).toFixed(digits) + " M";
  if (abs >= 1e3) return (v / 1e3).toFixed(digits) + " k";
  if (abs >= 1) return v.toFixed(digits);
  if (abs >= 1e-3) return (v * 1e3).toFixed(digits) + " m";
  if (abs >= 1e-6) return (v * 1e6).toFixed(digits) + " µ";
  return v.toExponential(digits);
}
