declare module 'fili' {
  export class CalcCascades {
    bandpass(params: {
      order: number;
      characteristic: string;
      Fs: number;
      Fc: number;
      BW: number;
    }): any;
  }
  export class IirFilter {
    constructor(coeffs: any);
    multiStep(input: number[]): number[];
  }
}
