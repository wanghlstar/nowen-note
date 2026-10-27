#!/usr/bin/env node
/**
 * 飞牛 fpk 直装版打包脚本（原生应用，不经过 Docker）
 *
 * 与 scripts/fpk/build-fpk.mjs（docker-project 类型）的区别：
 *   - 产物自带 Node 运行时 + backend（tsc 产物 + 生产 node_modules）+ frontend/dist，
 *     由 cmd/main 直接拉起 Node 进程，安装时不需要拉取任何镜像；
 *   - 必须在 Linux（或交叉准备 payload）下产出 linux-x64 内容，因此默认由
 *     .github/workflows/fpk-native.yml 在 ubuntu-latest 上执行。
 *
 * 用法：
 *   FNPACK_BIN=/path/to/fnpack \
 *   NODE_BIN=/path/to/node-22-linux-x64 \
 *     node scripts/fpk-native/build-fpk-native.mjs
 *
 * 环境变量：
 *   FNPACK_BIN        必填，fnpack 可执行文件（官方下载 developer.fnnas.com）
 *   NODE_BIN          要随包分发的 node 运行时，默认 process.execPath（仅本地结构测试）
 *   FPK_VERSION       写入 manifest 的版本号（X.Y.Z），默认 package.json.version
 *   FPK_OUT_DIR       输出目录，默认 dist-fpk-native
 *   BACKEND_DIST      默认 <repo>/backend/dist（tsc 产物）
 *   BACKEND_MODULES   默认 <repo>/backend/node_modules（npm prune --omit=dev 之后）
 *   FRONTEND_DIST     默认 <repo>/frontend/dist
 */
import { execSync } from 'node:child_process';
import {
    cpSync,
    existsSync,
    mkdirSync,
    readFileSync,
    rmSync,
    writeFileSync,
    chmodSync,
    readdirSync,
    copyFileSync,
    realpathSync,
    statSync,
} from 'node:fs';
import { dirname, join, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '..', '..');
const TEMPLATE_DIR = join(__dirname, 'template');

const pkg = JSON.parse(readFileSync(join(PROJECT_ROOT, 'package.json'), 'utf8'));
const VERSION = process.env.FPK_VERSION || pkg.version;
const OUT_DIR = resolve(PROJECT_ROOT, process.env.FPK_OUT_DIR || 'dist-fpk-native');
const FNPACK = process.env.FNPACK_BIN;
const NODE_BIN = process.env.NODE_BIN || process.execPath;
const BACKEND_DIST = resolve(PROJECT_ROOT, process.env.BACKEND_DIST || 'backend/dist');
const BACKEND_MODULES = resolve(PROJECT_ROOT, process.env.BACKEND_MODULES || 'backend/node_modules');
const FRONTEND_DIST = resolve(PROJECT_ROOT, process.env.FRONTEND_DIST || 'frontend/dist');
const BACKEND_TEMPLATES = resolve(PROJECT_ROOT, 'backend/templates');

if (!FNPACK) {
    console.error('[fpk-native] 错误：必须设置 FNPACK_BIN（fnpack 可执行文件路径）');
    process.exit(1);
}
for (const [label, p] of [
    ['node 运行时', NODE_BIN],
    ['backend/dist', BACKEND_DIST],
    ['backend/node_modules', BACKEND_MODULES],
    ['frontend/dist', FRONTEND_DIST],
]) {
    if (!existsSync(p)) {
        console.error(`[fpk-native] 错误：找不到${label}: ${p}`);
        process.exit(1);
    }
}

console.log(`[fpk-native] 版本: ${VERSION}`);
console.log(`[fpk-native] node 运行时: ${NODE_BIN}`);

// 1. 准备工作目录并复制模板
mkdirSync(OUT_DIR, { recursive: true });
const WORK_DIR = join(OUT_DIR, `nowen-note-${VERSION}`);
if (existsSync(WORK_DIR)) rmSync(WORK_DIR, { recursive: true, force: true });
mkdirSync(WORK_DIR, { recursive: true });
cpSync(TEMPLATE_DIR, WORK_DIR, { recursive: true });

// 2. 组装应用负载（app/ 目录）
console.log('[fpk-native] 组装应用负载');
const APP_DIR = join(WORK_DIR, 'app');

mkdirSync(join(APP_DIR, 'node', 'bin'), { recursive: true });
cpSync(NODE_BIN, join(APP_DIR, 'node', 'bin', 'node'));
chmodSync(join(APP_DIR, 'node', 'bin', 'node'), 0o755);

cpSync(BACKEND_DIST, join(APP_DIR, 'backend', 'dist'), { recursive: true });
cpSync(BACKEND_MODULES, join(APP_DIR, 'backend', 'node_modules'), { recursive: true });
cpSync(join(PROJECT_ROOT, 'backend', 'package.json'), join(APP_DIR, 'backend', 'package.json'));
if (existsSync(BACKEND_TEMPLATES)) {
    cpSync(BACKEND_TEMPLATES, join(APP_DIR, 'backend', 'templates'), { recursive: true });
}
cpSync(FRONTEND_DIST, join(APP_DIR, 'frontend', 'dist'), { recursive: true });
// 根 package.json 供 version 路由在无 NOWEN_APP_VERSION 时兜底
cpSync(join(PROJECT_ROOT, 'package.json'), join(APP_DIR, 'package.json'));

// 2.5 清除 npm CLI shim 与所有符号链接。
// npm 在 macOS 上会把 node_modules/.bin/* 建成指向绝对路径的符号链接，
// 这类条目在飞牛上既无意义（运行时不需要 CLI shim），也可能让解包器拒绝。
function removeBinDirs(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const full = join(dir, entry.name);
        if (entry.name === '.bin') {
            rmSync(full, { recursive: true, force: true });
            continue;
        }
        removeBinDirs(full);
    }
}

function dereferenceSymlinks(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isSymbolicLink()) {
            let target;
            try {
                target = realpathSync(full);
            } catch {
                rmSync(full, { force: true });
                continue;
            }
            const stat = statSync(target);
            rmSync(full, { recursive: true, force: true });
            if (stat.isDirectory()) {
                cpSync(target, full, { recursive: true });
            } else {
                copyFileSync(target, full);
            }
            chmodSync(full, stat.mode & 0o777);
            continue;
        }
        if (entry.isDirectory()) dereferenceSymlinks(full);
    }
}

function countSymlinks(dir) {
    let count = 0;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isSymbolicLink()) count += 1;
        else if (entry.isDirectory()) count += countSymlinks(full);
    }
    return count;
}

removeBinDirs(APP_DIR);
dereferenceSymlinks(APP_DIR);
const remainingLinks = countSymlinks(APP_DIR);
if (remainingLinks > 0) {
    console.error(`[fpk-native] 错误：应用负载仍有 ${remainingLinks} 个符号链接，飞牛解包可能失败`);
    process.exit(1);
}
console.log('[fpk-native] 已移除 .bin 并消除全部符号链接');

// 3. 注入版本号
function injectInto(filePath, replacements) {
    let content = readFileSync(filePath, 'utf8');
    for (const [key, val] of Object.entries(replacements)) {
        content = content.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), val);
    }
    writeFileSync(filePath, content);
}
injectInto(join(WORK_DIR, 'manifest'), { VERSION });
injectInto(join(WORK_DIR, 'cmd', 'main'), { VERSION });

// 4. 生命周期脚本可执行位（飞牛 Linux 上必须）
const cmdDir = join(WORK_DIR, 'cmd');
for (const f of readdirSync(cmdDir)) {
    chmodSync(join(cmdDir, f), 0o755);
}

// 5. 调用 fnpack 打包
console.log('[fpk-native] 调用 fnpack 打包');
function listFpks(dir) {
    if (!existsSync(dir)) return new Set();
    return new Set(readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.fpk')));
}
const beforeOut = listFpks(OUT_DIR);
const beforeWork = listFpks(WORK_DIR);
const beforeRoot = listFpks(PROJECT_ROOT);

try {
    execSync(`"${FNPACK}" build -d "${WORK_DIR}"`, {
        stdio: 'inherit',
        cwd: OUT_DIR,
    });
} catch {
    console.error('[fpk-native] fnpack 执行失败');
    process.exit(1);
}

// 6. 收集产物
const newFpks = [
    ...[...listFpks(OUT_DIR)].filter((f) => !beforeOut.has(f)).map((f) => join(OUT_DIR, f)),
    ...[...listFpks(WORK_DIR)].filter((f) => !beforeWork.has(f)).map((f) => join(WORK_DIR, f)),
    ...[...listFpks(PROJECT_ROOT)].filter((f) => !beforeRoot.has(f)).map((f) => join(PROJECT_ROOT, f)),
];

if (newFpks.length === 0) {
    console.warn('[fpk-native] fnpack 执行结束但未找到新增 .fpk，请检查输出目录');
    process.exit(1);
}
for (const src of newFpks) {
    const baseName = basename(src, '.fpk');
    const versionedName = baseName.includes(VERSION)
        ? `${baseName}.fpk`
        : `${baseName}-${VERSION}.fpk`;
    const dst = join(OUT_DIR, versionedName);
    if (resolve(src) !== resolve(dst)) {
        cpSync(src, dst);
        rmSync(src, { force: true });
    }
    console.log(`[fpk-native] 产物: ${dst}`);
}

console.log('');
console.log('[fpk-native] 完成。安装方式：把 .fpk 传到飞牛 NAS，');
console.log('[fpk-native]              「应用中心 → 设置 → 手动安装」选择该文件。');
