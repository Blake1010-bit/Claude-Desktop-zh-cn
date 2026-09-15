/**
 * 定位 Claude Desktop 的资源目录，并加载其中的语言文件。
 *
 * 所有脚本共用本模块，安装路径的逻辑只在这里写一次。
 *
 * 关于 Windows 上一个容易踩的坑：
 *   C:\Program Files\WindowsApps 这个**父目录本身不允许枚举**
 *   （普通权限下 readdir 会直接报 Access denied），
 *   但里面**具体的包目录是可以直接访问的**。
 *   所以这里不能用「列目录再筛选」的办法，只能对候选路径逐个探测是否存在。
 */
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

/** 项目根目录（本文件位于 lib/ 下）。 */
export const PROJECT_ROOT = dirname(dirname(fileURLToPath(import.meta.url)))

/** 前端语言文件相对于资源目录的位置。 */
export const FRONTEND_I18N = join('ion-dist', 'i18n')

/**
 * 判断一个候选目录是否真的是 Claude 的资源目录。
 * 同时要求两个标志性文件存在，避免误判同名目录。
 */
export function isClaudeResources(dir) {
  if (!dir || !existsSync(dir)) return false
  try {
    return existsSync(join(dir, 'en-US.json')) && existsSync(join(dir, FRONTEND_I18N, 'en-US.json'))
  } catch {
    return false
  }
}

/** 列目录，失败就返回空数组（受保护目录会抛错，不能让它中断探测）。 */
function safeReadDir(dir) {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
  } catch {
    return []
  }
}

const WIN = process.platform === 'win32'
const MAC = process.platform === 'darwin'

/** WindowsApps 下 MSIX 版 Claude 的已知版本号（第 2 级兜底用）。 */
const MSIX_VERSION_PROBES = [
  '1.52386.6.0',
  '1.52386.3.0',
  '1.40609.0',
]

/** MSIX 包的目录后缀（架构 + 发行者哈希）。 */
const MSIX_SUFFIXES = ['_x64__pzs8sxrjxfjjc', '_arm64__pzs8sxrjxfjjc', '_x64__', '_arm64__']

/**
 * 找到当前**活动**的 MSIX 包目录名。
 *
 * 为什么必须动态查（这里踩过一次真实的坑）
 * ----------------------------------------
 * 早先的实现是硬编码一份版本号列表：
 *     const MSIX_VERSION_PROBES = ['1.52386.3.0', '1.40609.0']
 * 然后指望 `safeReadDir('C:\Program Files\WindowsApps')` 兜底。
 * 但那个兜底**永远不生效** —— WindowsApps 的父目录不允许枚举
 * （本文件顶部的注释其实已经写明了这一点，只是当时没意识到后果）。
 *
 * 结果就是：**Claude 每自动更新一次，工具就必然找不到安装路径**。
 * 实测发生在 1.52386.3.0 → 1.52386.6.0 这次更新上。
 *
 * 现在改成多级探测，任何一级成功即可：
 *   1. Get-AppxPackage 问系统要包名（最可靠，完全不用猜版本）
 *   2. 已知版本号列表（兼容性兜底）
 *   3. 从正在运行的 Claude 进程反推包目录（不依赖 PowerShell）
 *   4. 万一父目录碰巧可列，用实际存在的名字
 */
function msixDirNames() {
  const names = []

  // ---- 1) 问系统 ----
  if (WIN) {
    try {
      const out = execFileSync(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          "(Get-AppxPackage -Name '*Claude*' | Select-Object -First 1).PackageFullName",
        ],
        { encoding: 'utf8', timeout: 15000, windowsHide: true },
      )
      const full = String(out || '').trim()
      if (full) names.push(full)
    } catch {
      /* PowerShell 不可用时忽略，继续下一级 */
    }
  }

  // ---- 2) 已知版本号 ----
  for (const v of MSIX_VERSION_PROBES) {
    for (const s of MSIX_SUFFIXES) names.push(`Claude_${v}${s}`)
  }

  // ---- 3) 从正在运行的 Claude 进程反推 ----
  //    不依赖 PowerShell，也不需要枚举受保护目录。
  if (WIN) {
    try {
      const out = execFileSync(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          "Get-Process -Name claude -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty Path",
        ],
        { encoding: 'utf8', timeout: 15000, windowsHide: true },
      )
      const exe = String(out || '').trim()
      const m = exe.match(/WindowsApps[\\/](Claude_[^\\/]+)[\\/]/i)
      if (m) names.push(m[1])
    } catch {
      /* 进程没在跑就跳过 */
    }
  }

  // ---- 4) 父目录可列时用实际名字 ----
  for (const name of safeReadDir('C:\\Program Files\\WindowsApps')) {
    if (/^Claude_/i.test(name)) names.push(name)
  }

  return [...new Set(names)]
}


/** 收集所有候选资源目录，按「越可能」排序。 */
function candidates() {
  const out = []
  const push = (p) => {
    if (p) out.push(p)
  }

  // 0) 由调用方（.bat / elevate.ps1）通过 Get-AppxPackage 问到的真实位置。
  //    版本号会随 Claude 更新变化，硬编码的探测表迟早会过期；
  //    这条是唯一不会过期的来源，所以排在最前面。
  const hint = process.env.CLAUDE_RESOURCES_HINT
  if (hint) {
    push(join(hint, 'app', 'resources'))
    push(hint)
  }

  if (WIN) {
    // 1) Microsoft Store / MSIX 版
    for (const name of msixDirNames()) {
      push(join('C:\\Program Files\\WindowsApps', name, 'app', 'resources'))
      // 有些版本的 InstallLocation 直接就是包目录
      push(join(name, 'app', 'resources'))
    }
    // 2) 官方独立安装包版（Squirrel 风格）
    const local = process.env.LOCALAPPDATA
    if (local) {
      for (const name of safeReadDir(join(local, 'Programs'))) {
        if (/^claude/i.test(name)) push(join(local, 'Programs', name, 'resources'))
      }
      for (const name of safeReadDir(local)) {
        if (/^claude/i.test(name)) {
          push(join(local, name, 'resources'))
          push(join(local, name, 'app', 'resources'))
          // Squirrel 会在 app-<版本> 子目录里放 resources
          for (const sub of safeReadDir(join(local, name))) {
            if (/^app-/i.test(sub)) push(join(local, name, sub, 'resources'))
          }
        }
      }
    }
    // 3) 传统 Program Files 安装
    for (const base of [process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)']]) {
      if (base) push(join(base, 'Claude', 'resources'))
    }
  } else if (MAC) {
    push('/Applications/Claude.app/Contents/Resources')
    if (process.env.HOME) {
      push(join(process.env.HOME, 'Applications', 'Claude.app', 'Contents', 'Resources'))
    }
  } else {
    push('/opt/Claude/resources')
    push('/usr/lib/claude/resources')
    if (process.env.HOME) {
      push(join(process.env.HOME, '.local', 'share', 'claude', 'resources'))
    }
  }

  // 环境变量覆盖一切
  push(process.env.CLAUDE_RESOURCES)
  return out
}

/** 解析命令行里的 --resources=路径 / --resources 路径 / -r 路径。 */
function fromArgv(argv) {
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--resources' || a === '-r') return argv[i + 1]
    if (typeof a === 'string' && a.startsWith('--resources=')) return a.slice('--resources='.length)
  }
  return undefined
}

/**
 * 找到当前机器的 Claude 资源目录。
 * @param {string[]} [argv] 命令行参数（用于 --resources 覆盖）
 * @returns {{dir: string, source: string} | null}
 */
export function findResources(argv = process.argv.slice(2)) {
  const explicit = fromArgv(argv)
  if (explicit) {
    return isClaudeResources(explicit) ? { dir: explicit, source: '命令行指定' } : null
  }
  for (const c of candidates()) {
    if (isClaudeResources(c)) return { dir: c, source: '自动探测' }
  }
  return null
}

/**
 * 找不到时的排查提示。
 * 会列出探测过的位置和各自的状态，方便用户判断问题在哪。
 */
export function diagnoseNotFound() {
  const lines = [
    '没有找到 Claude Desktop 的资源目录。',
    '',
    '请确认：',
    '  1. 你确实装了 Claude Desktop 桌面版（不是只用网页版）；',
    '  2. 装好后至少启动过一次。',
    '',
    '如果你的 Claude 装在非常规位置，可以手动指定：',
    '  node scripts/detect.mjs --resources "你的资源目录路径"',
    '',
    '（资源目录就是包含 en-US.json 和 ion-dist 的那个文件夹）',
    '',
    '本次探测过的位置：',
  ]
  const seen = new Set()
  for (const c of candidates()) {
    if (seen.has(c)) continue
    seen.add(c)
    let mark
    if (isClaudeResources(c)) mark = '可用'
    else if (existsSync(c)) mark = '存在，但不像 Claude 资源目录'
    else mark = '不存在'
    lines.push(`  [${mark}] ${c}`)
  }
  if (WIN) {
    lines.push('')
    lines.push('说明：C:\\Program Files\\WindowsApps 是受保护目录，')
    lines.push('      在资源管理器里打不开它是正常的，本工具会用程序方式访问。')
  }
  return lines.join('\n')
}

/**
 * 读取一个 JSON 文件。
 *
 * 会先剥掉可能的 UTF-8 BOM：语言文件可能被编辑器或脚本加上 BOM，
 * 而 JSON.parse 遇到 BOM 会直接抛错，导致整个安装中断。
 */
export function readJson(path) {
  let text = readFileSync(path, 'utf8')
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1)
  return JSON.parse(text)
}

/** 写入 JSON 文件（2 空格缩进，方便人工查看和 diff；不写 BOM）。 */
export function writeJson(path, value) {
  writeFileSync(path, JSON.stringify(value, null, 2), 'utf8')
}

/** 读文件字节数，失败返回 0。 */
export function sizeOf(path) {
  try {
    return statSync(path).size
  } catch {
    return 0
  }
}
