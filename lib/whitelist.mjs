/**
 * 快速定位 Claude 前端的"支持语言白名单"文件。
 *
 * 适用范围
 * --------
 * 只服务**第三方登录状态**。官方账号登录模式本项目从未开发
 * （那种模式下界面是远程页面，本地语言文件无效）。详见 README。
 *
 * 背景
 * ----
 * Claude 前端有一份硬编码的支持语言数组：
 *     var Kn=["en-US","de-DE","fr-FR","ko-KR","ja-JP","es-419","es-ES",
 *             "it-IT","hi-IN","pt-BR","id-ID"];
 * 与之配套的判断是 `e && Kn.includes(e) ? e : void 0` —— 不在列表里就丢弃。
 * 官方没出简体中文，所以必须把 zh-CN 补进去。
 *
 * 为什么需要"快速"定位
 * --------------------
 * ion-dist/assets/v1 里有 3000+ 个 js 文件。逐个读会造成十几秒的等待，
 * 用户会以为程序卡死了。这里用两个条件把候选压到极少：
 *
 *   1. 体积：真正的白名单文件约 170 KB；
 *      dayjs / formatjs 的语言表虽然也含 "ja-JP"，但都有 2 MB 以上，直接排除。
 *   2. 内容：必须同时含 `["en-US","de-DE"`（数组开头）和 `"ja-JP"`。
 *      只测 `"ja-JP"` 会命中 8 个文件，误改无关内容。
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

/** 候选文件体积上限：白名单约 170 KB，语言表都在 2 MB 以上。 */
const MAX_SIZE = 600 * 1024

/** 数组开头字面量，用于确认是那份语言名单而不是别的表。 */
const ARRAY_HEAD = '["en-US","de-DE"'

/**
 * 找出所有含语言白名单的文件。
 *
 * @param {string} resourcesDir Claude 的 resources 目录
 * @returns {Array<{file: string, path: string, text: string, hasZh: boolean}>}
 */
export function findWhitelistFiles(resourcesDir) {
  const v1 = join(resourcesDir, 'ion-dist', 'assets', 'v1')
  const out = []

  let names
  try {
    names = readdirSync(v1)
  } catch {
    return out
  }

  // 第一遍：用体积筛出候选，避免读大文件
  const candidates = []
  for (const name of names) {
    if (!name.endsWith('.js')) continue
    const p = join(v1, name)
    try {
      const st = statSync(p)
      if (st.size > MAX_SIZE) continue
      candidates.push({ file: name, path: p, size: st.size })
    } catch {
      continue
    }
  }

  // 第二遍：只读候选，做内容判定
  for (const c of candidates) {
    let text
    try {
      text = readFileSync(c.path, 'utf8')
    } catch {
      continue
    }
    if (!text.includes(ARRAY_HEAD) || !text.includes('"ja-JP"')) continue
    out.push({ file: c.file, path: c.path, text, hasZh: text.includes('"zh-CN"') })
  }

  return out
}

/** 只需要知道"白名单里有没有 zh-CN"时用这个。 */
export function whitelistHasZh(resourcesDir) {
  const found = findWhitelistFiles(resourcesDir)
  if (found.length === 0) return null // 找不到
  return found.every((f) => f.hasZh)
}
