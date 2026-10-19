/**
 * Signal metadata: [name, unit, nominal, component?].
 * Nominal values are illustrative base values (TEP Mode 1 order of magnitude).
 * Moved verbatim from the original page.
 */
export type SignalMeta = [name: string, unit: string, nominal: number, component?: string];

export const SIG: Record<string, SignalMeta> = {
  'XMEAS(1)': ['A feed', 'kscmh', 0.25052], 'XMEAS(2)': ['D feed', 'kg/h', 3664.0], 'XMEAS(3)': ['E feed', 'kg/h', 4509.3], 'XMEAS(4)': ['A and C feed', 'kscmh', 9.3477],
  'XMEAS(5)': ['Recycle flow', 'kscmh', 26.902], 'XMEAS(6)': ['Reactor feed rate', 'kscmh', 42.339], 'XMEAS(7)': ['Reactor pressure', 'kPa gauge', 2705.0], 'XMEAS(8)': ['Reactor level', '%', 75.0],
  'XMEAS(9)': ['Reactor temperature', 'degC', 120.40], 'XMEAS(10)': ['Purge rate', 'kscmh', 0.33712], 'XMEAS(11)': ['Separator temperature', 'degC', 80.109], 'XMEAS(12)': ['Separator level', '%', 50.0],
  'XMEAS(13)': ['Separator pressure', 'kPa gauge', 2633.7], 'XMEAS(14)': ['Separator underflow', 'm3/h', 25.160], 'XMEAS(15)': ['Stripper level', '%', 50.0], 'XMEAS(16)': ['Stripper pressure', 'kPa gauge', 3102.2],
  'XMEAS(17)': ['Stripper underflow', 'm3/h', 22.949], 'XMEAS(18)': ['Stripper temperature', 'degC', 65.731], 'XMEAS(19)': ['Stripper steam flow', 'kg/h', 230.31], 'XMEAS(20)': ['Compressor work', 'kW', 341.43],
  'XMEAS(21)': ['Reactor CW outlet temperature', 'degC', 94.599], 'XMEAS(22)': ['Condenser CW outlet temperature', 'degC', 77.297],
  'XMV(1)': ['D feed flow', '%', 63.053], 'XMV(2)': ['E feed flow', '%', 53.980], 'XMV(3)': ['A feed flow', '%', 24.644], 'XMV(4)': ['A and C feed flow', '%', 61.302],
  'XMV(5)': ['Compressor recycle valve', '%', 22.210], 'XMV(6)': ['Purge valve', '%', 40.064], 'XMV(7)': ['Separator liquid flow', '%', 38.100], 'XMV(8)': ['Stripper product flow', '%', 46.534],
  'XMV(9)': ['Stripper steam valve', '%', 47.446], 'XMV(10)': ['Reactor CW flow', '% command', 41.106], 'XMV(11)': ['Condenser CW flow', '%', 18.114], 'XMV(12)': ['Agitator speed', '%', 50.0],
};

(function addCompositions() {
  const comp: Record<string, [number, string, number[]]> = {
    6: [23, 'ABCDEF', [32.188, 8.8933, 26.383, 6.882, 18.776, 1.6567]],
    9: [29, 'ABCDEFGH', [32.958, 13.823, 23.978, 1.2565, 18.579, 2.2633, 4.8436, 2.2986]],
    11: [37, 'DEFGH', [0.01787, 0.8357, 0.09858, 53.724, 43.828]],
  };
  Object.keys(comp).forEach((s) => {
    const c = comp[s];
    for (let i = 0; i < c[1].length; i++) {
      SIG['XMEAS(' + (c[0] + i) + ')'] = ['stream ' + s + ' composition ' + c[1][i], 'mol%', c[2][i], c[1][i]];
    }
  });
})();

export const SIGNAL_IDS: readonly string[] = Object.keys(SIG);

/** All twelve TEP manipulated variables that exist in the signal table. */
export const XMV_IDS: readonly string[] = SIGNAL_IDS.filter((id) => id.startsWith('XMV('));

/**
 * XMVs whose effect the lumped browser model actually simulates. Every other XMV
 * is only a noisy constant around its nominal value, so an adjustment would have
 * no modelled consequence; the gate rejects it rather than pretending.
 */
export const MODELLED_XMVS: readonly string[] = ['XMV(10)'];

/** Signals with dynamics in the lumped model (the rest are noise around nominal). */
export const MODELLED_SIGNALS: readonly string[] = ['XMEAS(7)', 'XMEAS(9)', 'XMEAS(11)', 'XMEAS(13)', 'XMEAS(21)', 'XMV(10)'];

export function isKnownSignal(id: string): boolean {
  return Object.prototype.hasOwnProperty.call(SIG, id);
}
