/**
 * 平台 adapter 注册入口。
 * content-script 引入本模块产生副作用：所有平台 adapter 完成注册。
 * 各平台 adapter 在后续 Step 中逐个加入。
 */

// 每个 adapter 的 index.ts 在 import 时自注册（副作用导入）。
import './x';
import './zhihu';
import './heybox';
import './chatgpt';

export { registry } from '../core/platform-registry';
