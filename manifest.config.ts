// manifest 唯一事实源（Single Source of Truth）。
// vite.config.ts 中的内联插件会 import 此处的 manifest 对象，
// 在 writeBundle 阶段序列化为「无 BOM 的 UTF-8」并写入 dist/manifest.json。
// 注意：Chrome/Edge 的 JSON 解析器不接受 BOM，因此不能带 EF BB BF。

/** 扩展图标集合（MV3 要求的四个尺寸）。 */
export interface ManifestIconSet {
  16: string;
  32: string;
  48: string;
  128: string;
}

/** 内容脚本声明。 */
export interface ContentScriptDeclaration {
  matches: string[];
  js: string[];
  run_at?: 'document_start' | 'document_end' | 'document_idle';
}

/** 仅声明本项目实际用到的字段，避免依赖 @types/chrome 的具体版本。 */
export interface ManifestV3 {
  manifest_version: 3;
  name: string;
  version: string;
  description: string;
  minimum_chrome_version?: string;
  permissions?: string[];
  host_permissions?: string[];
  optional_host_permissions?: string[];
  background?: {
    service_worker: string;
    type?: 'module' | 'classic';
  };
  content_scripts?: ContentScriptDeclaration[];
  options_page?: string;
  action?: {
    default_title?: string;
    default_icon?: ManifestIconSet;
  };
  icons?: ManifestIconSet;
}

const icons: ManifestIconSet = {
  16: 'icons/icon16.png',
  32: 'icons/icon32.png',
  48: 'icons/icon48.png',
  128: 'icons/icon128.png',
};

/** 权限严格最小化：仅 storage；自定义 API 域名走 optional_host_permissions 动态申请。 */
export const manifest: ManifestV3 = {
  manifest_version: 3,
  name: 'BOSS 求职 AI 助手',
  version: '0.1.0',
  description:
    '在 BOSS直聘 页面内分析岗位、评估简历匹配度、生成沟通建议并识别风险信号；数据仅存本地，仅请求你自行配置的模型服务商。',
  minimum_chrome_version: '114',
  permissions: ['storage'],
  host_permissions: ['https://www.zhipin.com/*'],
  optional_host_permissions: ['https://*/*'],
  background: {
    service_worker: 'background.js',
    type: 'module',
  },
  content_scripts: [
    {
      matches: ['https://www.zhipin.com/*'],
      js: ['content.js'],
      run_at: 'document_idle',
    },
  ],
  options_page: 'options.html',
  action: {
    default_title: 'BOSS 求职 AI 助手',
    default_icon: icons,
  },
  icons,
};

/** 需要按环境生成 manifest 时使用（当前与 manifest 一致）。 */
export function createManifest(): ManifestV3 {
  return manifest;
}

export default manifest;
