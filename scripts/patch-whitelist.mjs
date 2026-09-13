/**
 * 把 zh-CN 注册进 Claude 前端的语言白名单。
 *
 * 适用范围
 * --------
 * 只服务**第三方登录状态**。官方账号登录模式本项目从未开发
 * （那种模式下界面是远程页面，本地语言文件无效）。详见 README。
 *
 * 为什么必须做这一步
 * ------------------
 * Claude 前端有一份硬编码的"支持语言"数组（在 ion-dist/assets/v1 的某个
 * shared-*.js 里）：
 *     ["en-US","de-DE","fr-FR","ko-KR","ja-JP","es-419","es-ES",
 *      "it-IT","hi-IN","pt-BR","id-ID"]
 * 与之配套的判断函数是 `e && Kn.includes(e) ? e : void 0` ——
 * 语言代码不在数组里就被丢弃、回退英文，**即使对应的语言文件存在也没用**。
 *
 * 官方没有出简体中文，所以 zh-CN 天生不在列表里，必须在应用代码里补进去。
 * 这正是「只放语言文件」失败的原因。
 *
 * 作为模块使用：
 *   import { patchWhitelist } from './patch-whitelist.mjs'
 *   const r = patchWhitelist(resourcesDir, { check: true })
 */
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { findWhitelistFiles } from '../lib/whitelist.mjs'

/**
 * 目标数组（官方支持的语言列表）。
 *
 * 注意 alternation 里每一项后面都要有 `|`，包括 id-ID 和 zh-CN ——
 * 早先漏写导致 zh-CN 匹配不上，校验时误判为"替换失败"。
 */
const LOCALE_ARRAY = /\[(?:"(?:en-US|de-DE|fr-FR|ko-KR|ja-JP|es-419|es-ES|it-IT|hi-IN|pt-BR|id-ID|zh-CN)"(?:,)?){10,13}\]/g

/**
 * 找出含语言白名单的文件。
 *
 * 用 lib/whitelist.mjs 的快速定位：先按体积筛掉 2 MB 的语言表，再读候选。
 * 直接逐个读 3000+ 个 js 文件要十几秒，用户会以为程序卡死。
 */
function findTargets(resourcesDir) {
  const out = []
  for (const f of findWhitelistFiles(resourcesDir)) {
    const m = f.text.match(LOCALE_ARRAY)
    if (m && m.some((s) => s.includes('"ja-JP"'))) {
      out.push({ file: f.file, path: f.path, matches: m })
    }
  }
  return out
}

/**
 * 打补丁 / 检查 / 还原。
 *
 * @param {string} resourcesDir Claude 的 resources 目录
 * @param {{check?: boolean, revert?: boolean, quiet?: boolean}} [opts]
 * @returns {{targets: number, patched: number, already: number, failed: number, log: string[]}}
 */
export function patchWhitelist(resourcesDir, opts = {}) {
  const { check = false, revert = false, quiet = false } = opts
  const log = []
  const say = (s) => {
    log.push(s)
    if (!quiet) console.log(s)
  }

  const v1 = join(resourcesDir, 'ion-dist', 'assets', 'v1')
  const backupDir = join(resourcesDir, '.zh-cn-toolkit-backup', 'whitelist')
  const targets = findTargets(resourcesDir)

  say(`资源目录: ${v1}`)
  say(`含语言白名单的文件: ${targets.length} 个`)

  if (targets.length === 0) {
    say('✘ 没有找到语言白名单')
    return { targets: 0, patched: 0, already: 0, failed: 1, log }
  }

  let patched = 0
  let already = 0
  let failed = 0

  for (const t of targets) {
    say('')
    say(t.file)
    const hasZh = t.matches.some((s) => s.includes('"zh-CN"'))
    say(`  白名单出现 ${t.matches.length} 处，含 zh-CN: ${hasZh ? '是' : '否'}`)

    if (revert) {
      const bf = join(backupDir, t.file)
      if (existsSync(bf)) {
        writeFileSync(t.path, readFileSync(bf))
        say(`  ✔ 已还原（${statSync(t.path).size} 字节）`)
      } else {
        say('  – 没有备份，跳过')
      }
      continue
    }

    if (hasZh) {
      already++
      say('  ✔ 已有 zh-CN，无需改动')
      continue
    }

    if (check) {
      say('  ! 需要补 zh-CN（检查模式，未修改）')
      continue
    }

    // 备份。
    //
    // 备份失败**不能阻断安装** —— 它只是安全网，不是必需条件。
    // Claude 重装后 resources 目录通常是只读的，连建备份目录都会 EPERM；
    // 这种情况下继续打补丁，只是没有备份而已（要还原可重新下载发布包，或
    // 用 --revert 前先手动备份）。
    //
    // 优先放在 resources 里；不行就退到用户目录。
    const original = readFileSync(t.path, 'utf8')
    let backupAt = null
    for (const dir of [backupDir, join(homedir(), 'AppData', 'Local', 'Claude-zh-cn-backup', 'whitelist')]) {
      try {
        mkdirSync(dir, { recursive: true })
        const bf = join(dir, t.file)
        if (!existsSync(bf)) writeFileSync(bf, original)
        backupAt = bf
        break
      } catch {
        // 换下一个位置
      }
    }
    if (backupAt) say(`  · 原文件已备份到 ${backupAt}`)
    else say('  · 无法创建备份（目录只读），继续打补丁')

    let changed = 0
    const text = original.replace(LOCALE_ARRAY, (arr) => {
      if (arr.includes('"zh-CN"')) return arr
      changed++
      return arr.replace('"id-ID"]', '"id-ID","zh-CN"]')
    })

    if (changed === 0) {
      say('  ! 未发生替换，跳过')
      failed++
      continue
    }

    // 校验：zh-CN 确实出现，且总长度只增加了 8 字符（,"zh-CN"）
    const expectedGrowth = changed * 8
    if (!text.includes('"zh-CN"') || text.length - original.length !== expectedGrowth) {
      say(`  ✘ 校验失败（长度增量 ${text.length - original.length}，预期 ${expectedGrowth}）`)
      failed++
      continue
    }

    try {
      writeFileSync(t.path, text, 'utf8')
    } catch (err) {
      if (err.code === 'EPERM' || err.code === 'EACCES') {
        say('  ✘ 没有写权限。Claude 的安装目录受系统保护，需要用管理员身份运行。')
      } else {
        say(`  ✘ 写入失败：${err.code} ${err.message.split('\n')[0]}`)
      }
      failed++
      continue
    }

    // 写后复读，确认真的落盘
    if (!readFileSync(t.path, 'utf8').includes('"zh-CN"')) {
      say('  ✘ 写入后复读未发现 zh-CN')
      failed++
      continue
    }

    patched++
    say(`  ✔ 已补上 zh-CN（${changed} 处，文件 ${statSync(t.path).size} 字节）`)
  }

  return { targets: targets.length, patched, already, failed, log }
}

// ---------------------------------------------------------------------------
// 命令行入口（直接运行时）
// ---------------------------------------------------------------------------
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]

if (isMain) {
  const { findResources, diagnoseNotFound } = await import('../lib/paths.mjs')
  const argv = process.argv.slice(2)
  const check = argv.includes('--check')
  const revert = argv.includes('--revert')

  const found = findResources(argv)
  if (found === null) {
    console.error(diagnoseNotFound())
    process.exit(1)
  }

  const r = patchWhitelist(found.dir, { check, revert })

  console.log('')
  console.log('─'.repeat(56))
  if (revert) console.log('还原完成。请完全退出 Claude 再重新打开。')
  else if (check) console.log('检查完成（未修改任何文件）。')
  else if (r.failed > 0) {
    console.log(`有 ${r.failed} 个文件处理失败`)
    process.exit(1)
  } else if (r.patched > 0) {
    console.log(`补丁完成：修改 ${r.patched} 个文件，跳过 ${r.already} 个`)
    console.log('请完全退出 Claude 再重新打开，界面才会变成中文。')
  } else {
    console.log(`无需改动：${r.already} 个文件都已包含 zh-CN`)
  }
  console.log('─'.repeat(56))
}
