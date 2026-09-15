#!/usr/bin/env node
/**
 * 把 Claude 的界面语言设成指定值（默认 zh-CN）。
 *
 * 为什么需要单独一个脚本
 * ----------------------
 * 安装流程只负责**写语言文件 + 注册白名单**，而界面显示还要看
 * config.json 里的 `locale`。这三处必须同时满足：
 *
 *   1. 白名单含 zh-CN        （否则语言被前端丢弃）
 *   2. zh-CN.json 存在        （否则没内容可显示）
 *   3. config.json 的 locale  （否则不会选中这个语言）
 *
 * 第三处会在几种情况下被打回 en-US：
 *   * Claude 更新 / 重装之后
 *   * 切换第三方供应商（CC Switch 之类）之后
 *   * 官方登录模式下，远程页面主动把它改回去
 *
 * 之前这一版没有这个脚本，导致"装完了但界面还是英文"，用户只能重装一次。
 * 现在单独提供，几秒钟就能修好，不需要管理员权限。
 *
 * 用法：
 *   node scripts/set-locale.mjs              设为 zh-CN
 *   node scripts/set-locale.mjs en-US        设回英文
 *   node scripts/set-locale.mjs --check      只看状态，不改
 *   node scripts/set-locale.mjs --restore    从备份还原
 */
import { existsSync, readFileSync, writeFileSync, copyFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const TARGET = (() => {
  const a = process.argv.slice(2).filter((x) => !x.startsWith('--'))
  return a[0] || 'zh-CN'
})()
const CHECK = process.argv.includes('--check')
const RESTORE = process.argv.includes('--restore')

/**
 * Claude 有两个互不相干的 userData 目录，各自有一份 config.json：
 *   %APPDATA%\Claude          官方账号（1P）
 *   %LOCALAPPDATA%\Claude-3p  第三方 / CC Switch（3P）
 * 两处都要处理，否则切模式之后又变英文。
 */
function configPaths() {
  const out = []
  const roaming = process.env.APPDATA
  const local = process.env.LOCALAPPDATA
  if (roaming) out.push({ label: '官方账号 (1P)', path: join(roaming, 'Claude', 'config.json') })
  if (local) out.push({ label: '第三方 (3P)', path: join(local, 'Claude-3p', 'config.json') })
  return out
}

/**
 * 只修改 locale 这一个键，其它内容原样保留。
 *
 * 为什么不用 JSON.parse + stringify：
 * config.json 里可能有 Claude 自己写的、我们不理解的结构，
 * 整体重新序列化有丢字段的风险（缩进、键顺序也会变）。
 * 这里做**定点替换**：找到 "locale": "..." 就地改写。
 */
function patchLocale(text, value) {
  const re = /("locale"\s*:\s*)"([^"]*)"/
  if (re.test(text)) {
    return { text: text.replace(re, `$1"${value}"`), mode: '替换' }
  }
  // 没有 locale 键 → 在最外层对象开头插入
  const i = text.indexOf('{')
  if (i < 0) return { text, mode: '失败（不是合法 JSON 对象）' }
  const insert = `\n\t"locale": "${value}",`
  return { text: text.slice(0, i + 1) + insert + text.slice(i + 1), mode: '新增' }
}

function backupPath(p) {
  return `${p}.bak-locale`
}

let changed = 0
let already = 0
let missing = 0

for (const { label, path: p } of configPaths()) {
  if (!existsSync(p)) {
    console.log(`  【${label}】未使用（找不到 ${p}）`)
    missing++
    continue
  }
  const text = readFileSync(p, 'utf8')
  const cur = (text.match(/"locale"\s*:\s*"([^"]*)"/) || [])[1]

  if (CHECK) {
    const ok = cur === TARGET
    console.log(`  【${label}】locale = ${cur ?? '(未设置)'}  ${ok ? '✔' : `← 需要改成 ${TARGET}`}`)
    continue
  }

  if (RESTORE) {
    const bak = backupPath(p)
    if (!existsSync(bak)) {
      console.log(`  【${label}】没有备份，跳过`)
      continue
    }
    copyFileSync(bak, p)
    console.log(`  【${label}】已从备份还原`)
    changed++
    continue
  }

  if (cur === TARGET) {
    console.log(`  【${label}】已经是 ${TARGET}，无需改动`)
    already++
    continue
  }

  // 改之前先备份一次（只在没有备份时创建，避免把"已改过的"覆盖进去）
  if (!existsSync(backupPath(p))) {
    try {
      copyFileSync(p, backupPath(p))
    } catch {
      /* 备份失败不阻断，继续改 */
    }
  }

  const r = patchLocale(text, TARGET)
  if (r.mode.startsWith('失败')) {
    console.log(`  【${label}】${r.mode}`)
    continue
  }
  writeFileSync(p, r.text, 'utf8')
  console.log(`  【${label}】locale ${cur ?? '(未设置)'} → ${TARGET}（${r.mode}）`)
  changed++
}

if (!CHECK) console.log('')
if (CHECK) {
  process.exit(0)
}
if (RESTORE) {
  console.log(`还原完成：处理 ${changed} 个文件`)
} else if (changed > 0) {
  console.log('完成。请完全退出 Claude（托盘图标右键 → 退出）再重新打开。')
} else if (already > 0 && missing === 0) {
  console.log('界面语言已经是目标值，无需改动。')
} else {
  console.log('没有可修改的 config.json —— 请确认 Claude Desktop 至少启动过一次。')
}
