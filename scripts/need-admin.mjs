#!/usr/bin/env node
/**
 * 判断安装是否需要管理员权限。
 *
 * 之所以单独做一个小脚本：.bat 里写不动这种逻辑（中文/正则/引号全都容易出错），
 * 让 node 判断、用退出码告诉批处理。
 *
 * 退出码：
 *   0 = 什么都不用做（已装好）
 *   2 = 需要写入，但当前没有权限 -> 应当提权
 *   3 = 需要写入，且当前有权限 -> 直接装即可
 *   1 = 出错
 */
import { existsSync, writeFileSync, unlinkSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { findResources, FRONTEND_I18N } from '../lib/paths.mjs'
import { findWhitelistFiles } from '../lib/whitelist.mjs'

const argv = process.argv.slice(2)
const found = findResources(argv)
if (found === null) {
  console.error('找不到 Claude 资源目录')
  process.exit(1)
}

const RES = found.dir

/** 目录是否可写：真的写一个临时文件试试，别靠猜。 */
function writable(dir) {
  const probe = join(dir, `_wtest_${process.pid}.tmp`)
  try {
    writeFileSync(probe, 'x')
    unlinkSync(probe)
    return true
  } catch {
    return false
  }
}

/** 语言文件是否需要补。 */
function langNeeded() {
  const targets = [
    [join(RES, FRONTEND_I18N, 'zh-CN.json'), join(RES, FRONTEND_I18N, 'en-US.json')],
    [join(RES, 'zh-CN.json'), join(RES, 'en-US.json')],
  ]
  for (const [target, en] of targets) {
    if (!existsSync(target)) return true // 不存在就得新建
    try {
      const zh = JSON.parse(stripBom(readFileSync(target, 'utf8')))
      const enObj = JSON.parse(stripBom(readFileSync(en, 'utf8')))
      for (const k of Object.keys(enObj)) if (!(k in zh)) return true
    } catch {
      return true
    }
  }
  return false
}

const stripBom = (s) => (s.charCodeAt(0) === 0xfeff ? s.slice(1) : s)

/** 白名单是否需要补。用快速定位，避免逐个读 3000+ 个文件。 */
function whitelistNeeded() {
  const found = findWhitelistFiles(RES)
  if (found.length === 0) return false
  return found.some((f) => !f.hasZh)
}

const needLang = langNeeded()
const needWl = whitelistNeeded()

if (!needLang && !needWl) {
  process.exit(0)
}

// 只有确认要动的那几个目录真的可写，才算"不用提权"。
//
// 早先这里只探测了 resources 根目录，结果前端语言文件（在 ion-dist\i18n
// 下面）写不进去也照样返回 3，.bat 直接开装，最后在写文件那一步报 EPERM。
// 现在把真正要写的三个目录逐个探测：
//   ion-dist\i18n  —— 前端语言文件
//   resources      —— 桌面外壳语言文件
//   assets\v1      —— 语言白名单（只改已存在的那个 js 文件）
const writeDirs = new Set()
if (needLang) {
  writeDirs.add(join(RES, FRONTEND_I18N))
  writeDirs.add(RES)
}
if (needWl) {
  for (const f of findWhitelistFiles(RES)) {
    if (!f.hasZh) writeDirs.add(dirname(f.path))
  }
}

const allWritable = [...writeDirs].every((d) => existsSync(d) && writable(d))
process.exit(allWritable ? 3 : 2)
