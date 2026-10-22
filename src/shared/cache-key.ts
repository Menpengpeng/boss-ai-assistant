/**
 * ID 与缓存 Key 生成工具。
 * - hash32：纯同步 FNV-1a 32 位，用于生成稳定的短 ID（如岗位 ID 兜底）。
 * - sha256Hex / cacheKey：基于 WebCrypto，用于缓存去重（相同 JD + 简历版本 + 模型 + Prompt 版本命中缓存）。
 */

/** FNV-1a 32 位哈希 → 8 位十六进制字符串（同步、无依赖）。 */
export function hash32(str: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i += 1) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

/** 计算 SHA-256 十六进制摘要（WebCrypto）。 */
export async function sha256Hex(
  input: string | ArrayBuffer | Uint8Array,
): Promise<string> {
  let data: ArrayBuffer;
  if (typeof input === 'string') {
    data = new TextEncoder().encode(input).buffer as ArrayBuffer;
  } else if (input instanceof Uint8Array) {
    data = input.buffer.slice(
      input.byteOffset,
      input.byteOffset + input.byteLength,
    ) as ArrayBuffer;
  } else {
    data = input;
  }
  const digest = await globalThis.crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * 生成缓存 Key：sha256(task + jd + resumeVersion + model + promptVersion) 的前 32 位。
 * 任一输入项变化都会得到不同的 Key。
 */
export async function cacheKey(i: {
  task: string;
  jd: string;
  resumeVersion: number;
  model: string;
  promptVersion: string;
}): Promise<string> {
  const raw = [i.task, i.jd, i.resumeVersion, i.model, i.promptVersion].join('\u0001');
  const hex = await sha256Hex(raw);
  return hex.slice(0, 32);
}
