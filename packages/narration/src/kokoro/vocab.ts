/**
 * Kokoro's phoneme symbols and the token number the model knows each by, from the model's
 * tokenizer (onnx-community/Kokoro-82M-v1.0-ONNX). Token 0 pads the start and end of a passage.
 */
const SYMBOLS =
  '$;:,.!?\u2014\u2026"()\u201c\u201d \u0303\u02a3\u02a5\u02a6\u02a8\u1d5d\uab67AIOQSTWY\u1d4aabcdefhijklmnopqrstuvwxyz\u0251\u0250\u0252\u00e6\u03b2\u0254\u0255\u00e7\u0256\u00f0\u02a4\u0259\u025a\u025b\u025c\u025f\u0261\u0265\u0268\u026a\u029d\u026f\u0270\u014b\u0273\u0272\u0274\u00f8\u0278\u03b8\u0153\u0279\u027e\u027b\u0281\u027d\u0282\u0283\u0288\u02a7\u028a\u028b\u028c\u0263\u0264\u03c7\u028e\u0292\u0294\u02c8\u02cc\u02d0\u02b0\u02b2\u2193\u2192\u2197\u2198\u1d7b'
const IDS = [
  0, 1, 2, 3, 4, 5, 6, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 31, 33,
  35, 36, 39, 41, 42, 43, 44, 45, 46, 47, 48, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 60, 61, 62,
  63, 64, 65, 66, 67, 68, 69, 70, 71, 72, 75, 76, 77, 78, 80, 81, 82, 83, 85, 86, 87, 90, 92, 99,
  101, 102, 103, 110, 111, 112, 113, 114, 115, 116, 118, 119, 120, 123, 125, 126, 128, 129, 130,
  131, 132, 133, 135, 136, 138, 139, 140, 142, 143, 147, 148, 156, 157, 158, 162, 164, 169, 171,
  172, 173, 177
]

export const KOKORO_VOCAB: ReadonlyMap<string, number> = new Map(
  [...SYMBOLS].map((symbol, index) => [symbol, IDS[index]])
)

export const KOKORO_PAD = 0
/** The most tokens the model reads at once, padding included. */
export const KOKORO_MAX_TOKENS = 510
