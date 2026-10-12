declare module 'clipper-lib' {
  export interface IntPoint { X: number; Y: number }
  export type Path = IntPoint[]
  export type Paths = Path[]
  export class Clipper {
    constructor(initOptions?: number)
    AddPath(path: Path, polyType: number, closed: boolean): boolean
    AddPaths(paths: Paths, polyType: number, closed: boolean): boolean
    Execute(clipType: number, solution: Paths, subjFillType?: number, clipFillType?: number): boolean
    static Area(path: Path): number
    static Orientation(path: Path): boolean
    static CleanPolygons(paths: Paths, distance: number): Paths
  }
  const ClipperLib: {
    Clipper: typeof Clipper
    Paths: new () => Paths
    ClipType: { ctIntersection: number; ctUnion: number; ctDifference: number; ctXor: number }
    PolyType: { ptSubject: number; ptClip: number }
    PolyFillType: { pftEvenOdd: number; pftNonZero: number; pftPositive: number; pftNegative: number }
  }
  export default ClipperLib
}
