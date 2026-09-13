#!/usr/bin/env node
/**
 * 交付前自检：把踩过的坑固化成可执行检查。
 *
 * 这里每一条都对应一个真实发生过的故障 —— 不是"代码风格"检查，
 * 而是"用户双击之后会不会报错"的检查。
 *
 *   1. 入口文件的编码/换行（见下面注释）
 *   2. PowerShell 语法（没有 BOM 时中文会让引号错位）
 *   3. 批处理里引用的脚本文件是否都存在（改名后漏改引用会静默失效）
 *
 * 用法：node tests/lint.mjs
 * 退出码：0 = 全部通过，1 = 有问题
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))

let failed = 0
const bad = (msg) => {
  failed++
  console.log(`  FAIL  ${msg}`)
}
const ok = (msg) => console.log(`  ok    ${msg}`)

// ---------------------------------------------------------------------------
console.log('\n[1/3] 入口文件编码与换行')

/**
 * .bat 必须：无 BOM + CRLF。
 *   cmd 按 ANSI（简体中文系统上是 GBK）读取批处理；带 BOM 时第一行会变成
 *   乱码命令，用 LF 换行时双击会一闪而过什么都不做。
 *   唯一允许出现非 ASCII 的地方是 `title` 行 —— chcp 65001 之后 cmd 已按
 *   UTF-8 读脚本，title 里的中文没问题；`echo` 里的中文会被切碎成
 *   "不是内部命令"，所以一律禁止。
 */
const bats = readdirSync(ROOT).filter((n) => n.toLowerCase().endsWith('.bat'))
if (bats.length === 0) bad('根目录下没有找到任何 .bat')
for (const name of bats) {
  const buf = readFileSync(join(ROOT, name))
  const text = buf.toString('binary')

  if (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) bad(`${name}: 有 UTF-8 BOM（cmd 会把第一行读成乱码）`)
  const loneLf = (text.match(/(?<!\r)\n/g) || []).length
  if (loneLf > 0) bad(`${name}: 有 ${loneLf} 处纯 LF 换行（双击会一闪而过）`)

  const offenders = []
  text.split(/\r?\n/).forEach((line, i) => {
    if (![...line].some((c) => c.charCodeAt(0) > 0x7f)) return
    if (/^\s*(rem|::|title)\b/i.test(line)) return
    offenders.push(i + 1)
  })
  if (offenders.length > 0) {
    bad(`${name}: 第 ${offenders.join(', ')} 行含中文，且不在 title/rem 里（cmd 会解析失败）`)
  }
  if (offenders.length === 0 && !(buf[0] === 0xef) && loneLf === 0) ok(name)
}

/**
 * .ps1 必须：UTF-8 + BOM。
 *   PowerShell 5.1 读无 BOM 的 .ps1 时按 ANSI 解码，中文注释会被解成乱码，
 *   紧跟在中文行后面的反引号换行符会连带失效，报
 *   "The string is missing the terminator"。中文 Windows 上这个错误必现。
 */
const ps1 = []
const walk = (dir) => {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue
    const p = join(dir, e.name)
    if (e.isDirectory()) walk(p)
    else if (e.name.toLowerCase().endsWith('.ps1')) ps1.push(p)
  }
}
walk(ROOT)

if (ps1.length === 0) bad('没有找到任何 .ps1')
for (const p of ps1) {
  const buf = readFileSync(p)
  const rel = p.slice(ROOT.length + 1)
  if (!(buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf)) {
    bad(`${rel}: 缺少 UTF-8 BOM（PowerShell 5.1 会按 GBK 解码，中文字符串会报错）`)
  } else {
    ok(rel)
  }
}

// ---------------------------------------------------------------------------
console.log('\n[2/3] PowerShell 语法')

/** 借用 Windows PowerShell 自带的解析器做真正的语法检查。 */
function parsePs1(path) {
  const script = `
    $errors = $null; $tokens = $null
    [System.Management.Automation.Language.Parser]::ParseFile('${path.replace(/'/g, "''")}', [ref]$tokens, [ref]$errors) | Out-Null
    if ($errors.Count -eq 0) { 'OK' } else { $errors | ForEach-Object { "L$($_.Extent.StartLineNumber): $($_.Message)" } }
  `
  return execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script], {
    encoding: 'utf8',
  }).trim()
}

for (const p of ps1) {
  const rel = p.slice(ROOT.length + 1)
  try {
    const out = parsePs1(p)
    if (out === 'OK') ok(`${rel} 语法正常`)
    else bad(`${rel} 语法错误: ${out.split('\n')[0]}`)
  } catch (err) {
    bad(`${rel} 无法解析: ${err.message.split('\n')[0]}`)
  }
}

// ---------------------------------------------------------------------------
console.log('\n[3/3] 批处理引用的脚本是否存在')

/**
 * 只检查 scripts\ 下面那些**跑起来就会用到**的入口，不做全量分析。
 * 目的很窄：改名/删文件之后忘了改 .bat 里的引用，这类错误在运行时才暴露，
 * 而且报出来的信息（"系统找不到指定的文件"）对用户毫无帮助。
 */
const ENTRY_SCRIPTS = [
  'scripts\\install.mjs',
  'scripts\\restore.mjs',
  'scripts\\detect.mjs',
  'scripts\\need-admin.mjs',
  'scripts\\elevate.ps1',
  'scripts\\elevate-run.ps1',
]
for (const rel of ENTRY_SCRIPTS) {
  const p = join(ROOT, ...rel.split('\\'))
  if (existsSync(p)) ok(rel)
  else bad(`${rel} 不存在，但 .bat 会调用它`)
}

console.log()
if (failed === 0) {
  console.log('自检通过：可以交付。')
  process.exit(0)
} else {
  console.log(`自检未通过：${failed} 项。上面的每一条都会导致用户双击失败。`)
  process.exit(1)
}
