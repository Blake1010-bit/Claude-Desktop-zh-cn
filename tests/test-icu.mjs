/**
 * 校验器回归测试套件。
 *
 * 9 个「必须通过」的用例 + 9 个「必须拦下」的用例。
 * 后者尤其重要：每一条都对应一个真实踩过的坑，
 * 其中好几条属于「残缺译文能静默通过」的漏洞，一旦回归就会把界面弄坏。
 *
 * 运行：node tests/test-icu.mjs
 */
import { compareMessage } from '../lib/icu-check.mjs'

// [英文原文, 中文译文] —— 这些都必须通过
const good = [
  // ICU 复数：分支内的文字本来就该翻译
  [
    '{count, plural, one {# remote session} other {# remote sessions}}',
    '{count, plural, one {# 个远程会话} other {# 个远程会话}}',
  ],
  // select 分支
  [
    '{action, select, connect {Connect} disconnect {Disconnect} other {Confirm}}',
    '{action, select, connect {连接} disconnect {断开} other {确认}}',
  ],
  // 普通占位符
  ['Your changes to {name} weren’t saved.', '你对 {name} 的更改未保存。'],
  ['{label} ({shortcut})', '{label}（{shortcut}）'],
  // 复数 + 中文量词语序调整
  [
    '{months, plural, one {# month} other {# months}} of code reviews on us',
    '{months, plural, one {# 个月} other {# 个月}}的免费代码审查',
  ],
  // # 在分支内的位置变化是合法的
  [
    'Skipped {skipped, plural, one {# session that was} other {# sessions that were}} already in your list.',
    '已跳过 {skipped, plural, one {# 个} other {# 个}}已在列表中的会话。',
  ],
  // 标签内部嵌套 ICU —— 早期版本会漏检这里
  [
    'Claude can’t access {repos}. <install>Install the App on {count, plural, one {this repo} other {these repos}}</install>, or <reconnect>reconnect</reconnect>.',
    'Claude 无法访问 {repos}。请在 {count, plural, one {此仓库} other {这些仓库}}上<install>安装应用</install>，或<reconnect>重新连接</reconnect>。',
  ],
  // 富文本标签
  ['<link>Read more</link> and {name}', '<link>了解更多</link>以及 {name}'],
  // 中文两个分支都带 # 是正确的（中文没有单复数变化）
  [
    'Import {n, plural, one {# file} other {# files}}?',
    '导入 {n, plural, one {# 个文件} other {# 个文件}}？',
  ],
]

// [英文原文, 中文译文, 说明] —— 这些都必须被拦下
const bad = [
  // 丢掉整个 other 分支：应用解析器会抛 MISSING_OTHER_CLAUSE，界面直接崩
  ['{count, plural, one {# file} other {# files}}', '{count, plural, one {# 个文件}}', 'other 分支整个丢失'],
  // 凭空多出一个分支
  [
    '{count, plural, one {# file} other {# files}}',
    '{count, plural, one {# 个文件} other {# 个文件} many {# 个}}',
    '凭空多出 many 分支',
  ],
  // 空译文会让界面显示空白
  ['{count, plural, one {# file} other {# files}}', '', '空译文'],
  // 占位符改名：ICU 参数名不能动
  ['Hello {name}', '你好 {用户名}', '占位符改名'],
  ['Hello {name}', '你好', '占位符丢失'],
  // 标签名被翻译：会渲染失败
  ['<link>Read more</link>', '<链接>了解更多</链接>', '标签名被翻译'],
  ['<b>Bold</b> and <i>italic</i>', '<b>粗体</b>', '第二个标签被丢掉'],
  // select 分支丢失
  ['{action, select, a {A} b {B} other {C}}', '{action, select, a {甲} other {丙}}', 'select 分支丢失'],
  // 标签内部的 ICU 被删掉
  [
    'Claude can’t access {repos}. <install>Install on {count, plural, one {this repo} other {these repos}}</install>.',
    'Claude 无法访问 {repos}。请在<install>此仓库上安装</install>。',
    '标签内嵌套的 ICU 被删掉',
  ],
  // 选择符改名 —— 曾经是校验器的真实盲区（只比较分支数量、不比较名称）
  ['{n, plural, one {a} other {b}}', '{n, plural, one {甲} many {乙}}', 'other 被改名成 many'],
  ['{n, plural, one {a} other {b}}', '{n, plural, xxxx {甲} yyyy {乙}}', 'one/other 都被改名'],
]

let pass = 0
let fail = 0

console.log('=== 必须通过的用例 ===')
for (const [src, dst] of good) {
  const r = compareMessage(src, dst)
  if (r.ok) {
    pass++
    console.log(`  ✔ ${src.slice(0, 58)}`)
  } else {
    fail++
    console.log(`  ✘ 误报（本应通过）：${src.slice(0, 58)}`)
    for (const w of r.reasons) console.log(`      ${w}`)
  }
}

console.log()
console.log('=== 必须拦下的用例 ===')
for (const [src, dst, label] of bad) {
  const r = compareMessage(src, dst)
  if (!r.ok) {
    pass++
    console.log(`  ✔ 已拦下：${label}`)
  } else {
    fail++
    console.log(`  ✘ 漏检（本应拦下）：${label}`)
  }
}

console.log()
console.log(`${pass} 项正确 / ${fail} 项错误`)
process.exit(fail === 0 ? 0 : 1)
