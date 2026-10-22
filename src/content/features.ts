/**
 * Content 功能注册表。
 *
 * 本文件只提供类型与一个空数组：Task 10（列表快评与对比）会向 FEATURES push 自己的实现。
 * 入口 src/content/index.ts 会遍历 FEATURES 调用 mount / unmount，
 * 因此后续任务只需向这一个数组注册，无需改动装配层。
 */
import type { PageKind } from '../shared/types';
import { quickReviewFeature } from './quick-review';

/** 功能挂载上下文。 */
export interface FeatureContext {
  host: import('./panel/types').PanelHost;
  pageKind: PageKind;
}

/** 一个可从装配层统一挂载 / 卸载的 content 功能。 */
export interface ContentFeature {
  id: string;
  mount(ctx: FeatureContext): void;
  unmount(): void;
}

/** 功能注册表：Task 10（列表快评与对比）会往这里 push 自己的实现。 */
export const FEATURES: ContentFeature[] = [];

// 列表快评（F7）：本模块只负责注册，实现见 ./quick-review。
FEATURES.push(quickReviewFeature);
