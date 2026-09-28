/** Replay frame layout shared by the game, the replay viewer and the server validator. */
export const FRAME_STRIDE = 14;
export const F = {
  t: 0, x: 1, z: 2, heading: 3, pitch: 4, roll: 5, heave: 6, speed: 7, steer: 8, throttle: 9, brake: 10, s: 11, gear: 12, rpm: 13,
} as const;

/** gzip + base64 for transport */
export async function packFrames(frames: Float32Array): Promise<string> {
  const stream = new Blob([frames.buffer as ArrayBuffer]).stream().pipeThrough(new CompressionStream('gzip'));
  const buf = new Uint8Array(await new Response(stream).arrayBuffer());
  let s = '';
  for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return btoa(s);
}

export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export async function unpackFrames(gz: Uint8Array): Promise<Float32Array> {
  const stream = new Blob([gz as unknown as ArrayBuffer]).stream().pipeThrough(new DecompressionStream('gzip'));
  const buf = await new Response(stream).arrayBuffer();
  return new Float32Array(buf);
}
