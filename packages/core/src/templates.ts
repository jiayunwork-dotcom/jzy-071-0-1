import type { TemplateParams, TemplateKind, Vec2 } from "./types.js";

/**
 * 参数化模板，返回的 loops 可直接交给网格生成器。
 * 外环逆时针（CCW），孔洞内环顺时针（CW），坐标原点位于几何中心或左下角附近。
 */
export function templateLoops(params: TemplateParams): Vec2[][] {
  switch (params.kind) {
    case "rectangle":
      return rectangle(params.length ?? 1, params.height ?? 0.2);
    case "lbeam":
      return lBeam(params.width ?? 1, params.thickness ?? 0.3);
    case "holePlate":
      return holePlate(params.plateWidth ?? 1, params.plateHeight ?? 1, params.holeRadius ?? 0.15);
    default:
      throw new Error(`未知模板：${String((params as { kind: TemplateKind }).kind)}`);
  }
}

/** 矩形梁/板：原点在左下角，x∈[0,L], y∈[0,H]，CCW */
export function rectangle(length: number, height: number): Vec2[][] {
  const L = length, H = height;
  return [
    [
      [0, 0],
      [L, 0],
      [L, H],
      [0, H],
    ],
  ];
}

/**
 * L 形截面：外轮廓 CCW。
 *   宽 W、高 W（等肢），壁厚 t；原点在左下角。
 *   角点序列沿外环逆时针行走。
 */
export function lBeam(width: number, thickness: number): Vec2[][] {
  const W = width, t = thickness;
  return [
    [
      [0, 0],
      [W, 0],
      [W, t],
      [t, t],
      [t, W],
      [0, W],
    ],
  ];
}

/**
 * 带圆孔矩形板：外方板 + 内圆孔。
 * 内孔用 24 边形近似（顺时针）。原点在板中心。
 */
export function holePlate(width: number, height: number, radius: number, holeSegments = 24): Vec2[][] {
  const W = width, H = height, r = radius;
  if (r * 2 >= Math.min(W, H)) throw new Error("孔半径过大，必须小于板短边的一半");
  const outer: Vec2[] = [
    [-W / 2, -H / 2],
    [W / 2, -H / 2],
    [W / 2, H / 2],
    [-W / 2, H / 2],
  ];
  // 圆孔（顺时针以表示孔洞）
  const hole: Vec2[] = [];
  for (let i = 0; i < holeSegments; i++) {
    const a = -2 * Math.PI * (i / holeSegments);
    hole.push([r * Math.cos(a), r * Math.sin(a)]);
  }
  return [outer, hole];
}

/** 模板默认参数（供前端表单） */
export function defaultTemplateParams(kind: TemplateKind): Required<TemplateParams> {
  const base = {
    length: 2,
    height: 0.4,
    width: 1,
    thickness: 0.3,
    plateWidth: 1,
    plateHeight: 1,
    holeRadius: 0.15,
  };
  return { kind, ...base };
}
