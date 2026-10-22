/**
 * 简历上下文加载（发送给模型的简历内容）。
 * 隐私硬约束：
 * - 文本简历只发送脱敏后的文本（优先使用已保存的 maskedText，否则对 rawText 现场脱敏），
 *   绝不发送 rawText 原文；
 * - PDF 简历以 base64 附件形式发送（原文发送，已在设置页单独确认）。
 */
import { getActiveResumeSnapshot, getResume } from '../shared/idb';
import { maskText } from '../shared/mask';
import type { PdfAttachment } from '../shared/types';

/** 供 Prompt 使用的简历上下文。 */
export interface ResumeContext {
  version: number;
  kind: 'pdf' | 'text';
  maskName: boolean;
  text: string;
  attachment: PdfAttachment | null;
}

/** 分块 base64 编码：避免一次性大字符串拼接导致卡顿。 */
export async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const CHUNK = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/** 读取当前启用版本的简历上下文；无简历时返回 null。 */
export async function loadResumeContext(): Promise<ResumeContext | null> {
  const snapshot = await getActiveResumeSnapshot();
  if (!snapshot) return null;
  const rec = await getResume(snapshot.version);

  if (snapshot.kind === 'pdf') {
    const blob = snapshot.blob;
    if (!blob) return null;
    const base64 = await blobToBase64(blob);
    return {
      version: snapshot.version,
      kind: 'pdf',
      maskName: snapshot.maskName,
      text: '',
      attachment: {
        kind: 'pdf',
        mime: 'application/pdf',
        base64,
        size: rec?.size ?? blob.size,
        sha256: rec?.sha256 ?? '',
        filename: snapshot.name || 'resume.pdf',
      },
    };
  }

  // 文本简历：仅使用已脱敏文本；无 maskedText 时现场对 rawText 脱敏（绝不直接用 rawText）。
  const masked =
    rec?.maskedText ?? maskText(rec?.rawText ?? snapshot.text ?? '', { maskName: snapshot.maskName }).masked;
  return {
    version: snapshot.version,
    kind: 'text',
    maskName: snapshot.maskName,
    text: masked.trim(),
    attachment: null,
  };
}
