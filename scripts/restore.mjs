#!/usr/bin/env node
/**
 * 一键还原：把语言文件恢复成安装前的样子。
 *
 * 用法：
 *   node scripts/restore.mjs --list     列出所有备份
 *   node scripts/restore.mjs            还原最近一次备份
 *   node scripts/restore.mjs 20260101120000   还原指定备份
 *   node scripts/restore.mjs --all      还原全部（按每个文件各自的最近备份）
 */
import { existsSync, readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { FRONTEND_I18N, findResources, diagnoseNotFound } from '../lib/paths.mjs'
import { patchWhitelist } from './patch-whitelist.mjs'

const argv = process.argv.slice(2)
const found = findResources(argv)

if (found === null) {
  console.error(diagnoseNotFound())
  process.exit(1)
}

const RES = found.dir
const ROOT = join(RES, '.zh-cn-toolkit-backup')

if (!existsSync(ROOT)) {
  console.log('没有找到本工具产生的备份，说明你可能还没用本工具安装过。')
  console.log(`备份目录应为：${ROOT}`)
  process.exit(0)
}

const stamps = readdirSync(ROOT).sort()

if (argv.includes('--list') || stamps.length === 0) {
  console.log(`备份列表（${ROOT}）：`)
  for (const s of stamps) {
    const files = readdirSync(join(ROOT, s))
    console.log(`  ${s}   ${files.join(', ')}`)
  }
  process.exit(0)
}

/** 备份文件名 → 它应该还原到哪个位置。 */
const destinations = {
  '前端界面-zh-CN.json': join(RES, FRONTEND_I18N, 'zh-CN.json'),
  '桌面外壳-zh-CN.json': join(RES, 'zh-CN.json'),
}

/**
 * 从命令行里挑出「指定备份编号」。
 *
 * 不能直接用 argv[2]：调用链是 一键还原.bat -> 自己(带 admin 参数) -> elevate.ps1
 * -> node restore.mjs，中间会有 --resources 之类的参数插进来，位置并不固定。
 * 所以只认「看起来像时间戳」的那一个，其余一律忽略。
 */
function fromArgvStamp(argv) {
  // 时间戳格式与 install.mjs 里生成备份目录的一致：YYYYMMDDHHMMSS
  const m = argv.find((a) => /^\d{14}$/.test(a))
  return m
}

const wanted = argv.includes('--all') ? stamps : [fromArgvStamp(argv) ?? stamps[stamps.length - 1]]

let restored = 0
for (const stamp of wanted) {
  const dir = join(ROOT, stamp)
  if (!existsSync(dir)) {
    console.error(`找不到备份：${stamp}`)
    console.error(`可用：${stamps.join(', ')}`)
    process.exit(1)
  }
  console.log(`从备份还原：${stamp}`)
  for (const name of readdirSync(dir)) {
    // whitelist 是子目录，由下面单独处理
    if (name === 'whitelist') continue
    const target = destinations[name]
    if (target === undefined) {
      console.log(`  – 跳过未知文件 ${name}`)
      continue
    }
    // 不用 copyFileSync：从备份写到 WindowsApps 目标时，
    // copyFile 会抛 UNKNOWN(-4094)；读入内存再写出可靠。
    writeFileSync(target, readFileSync(join(dir, name)))
    console.log(`  ✔ ${name} → ${statSync(target).size} 字节`)
    restored++
  }
}

// 语言白名单单独存放在 whitelist/ 子目录里，也要还原，
// 否则应用代码里仍留着 zh-CN，语言列表会出现一个指向不存在翻译的选项。
const wlDir = join(ROOT, 'whitelist')
if (existsSync(wlDir)) {
  console.log('')
  console.log('还原语言白名单...')
  const wl = patchWhitelist(RES, { revert: true, quiet: false })
  if (wl.log.length === 0) console.log('  – 没有可还原的白名单备份')
}

console.log()
console.log(`完成，共还原 ${restored} 个文件。`)
console.log('请完全退出 Claude 再重新打开（托盘图标右键 → 退出）。')
