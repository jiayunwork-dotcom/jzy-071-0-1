declare module "cdt2d" {
  const cdt: (
    points: Array<[number, number] | number[]>,
    edges?: Array<[number, number] | number[]>,
    options?: {
      delaunay?: boolean;
      interior?: boolean;
      exterior?: boolean;
      infinity?: boolean;
      intermediate?: boolean;
    }
  ) => number[][];
  export default cdt;
}
