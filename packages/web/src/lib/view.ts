import type { Vec2 } from "@fem2d/core";

/** 真实坐标（米，y 向上）↔ 画布像素坐标（y 向下）的二维变换 */
export class ViewTransform {
  // 像素/米
  scale = 100;
  // 真实原点在画布中的像素位置
  ox = 0;
  oy = 0;

  toPixel(p: Vec2): [number, number] {
    return [this.ox + p[0] * this.scale, this.oy - p[1] * this.scale];
  }
  toWorld(px: number, py: number): Vec2 {
    return [(px - this.ox) / this.scale, (this.oy - py) / this.scale];
  }

  /** 根据包围盒与画布尺寸自适应（留边距） */
  fit(
    bbox: { minX: number; minY: number; maxX: number; maxY: number },
    width: number,
    height: number,
    margin = 40
  ) {
    const w = Math.max(1e-9, bbox.maxX - bbox.minX);
    const h = Math.max(1e-9, bbox.maxY - bbox.minY);
    const sx = (width - 2 * margin) / w;
    const sy = (height - 2 * margin) / h;
    this.scale = Math.min(sx, sy);
    const cx = (bbox.minX + bbox.maxX) / 2;
    const cy = (bbox.minY + bbox.maxY) / 2;
    this.ox = width / 2 - cx * this.scale;
    this.oy = height / 2 + cy * this.scale;
  }
}

export function loopsBBox(loops: Vec2[][]): {
  minX: number; minY: number; maxX: number; maxY: number;
} {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const loop of loops) {
    for (const [x, y] of loop) {
      minX = Math.min(minX, x); minY = Math.min(minY, y);
      maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
    }
  }
  if (!isFinite(minX)) return { minX: 0, minY: 0, maxX: 1, maxY: 1 };
  return { minX, minY, maxX, maxY };
}
