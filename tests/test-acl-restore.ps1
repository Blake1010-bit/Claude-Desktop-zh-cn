# 离线验证 Restore-Acls 的幂等性。
#
# 背景：这个函数在正常流程里会被调用两次 —— 一次是 [3/3] 还原权限，
# 一次是 Done() 里的兜底。第一次还原成功后会删掉备份文件，所以第二次
# 必须把"备份已不在"当成"已经还原过"，而不是去 Import-Clixml 一个不存在的文件。
# 早期版本没有这个判断：用户看到安装"成功"之后，控制台上会突然冒出
# 四行「未能找到文件 ...acl_xxx.xml」，看起来很吓人。
#
# 这个测试不需要管理员权限：它只对 %TEMP% 下一个自己建的目录做 ACL 往返。

$ErrorActionPreference = 'Stop'

# 把 elevate.ps1 里的函数原样取出来测，避免"测了一份复制品"。
#
# 用 PowerShell 自带的语法树定位函数，不要用正则 ——
# 正则匹配 "function X {" 到第一个 "}" 会被函数体里的 if/catch 花括号截断。
$elevatePath = Join-Path (Split-Path -Parent $PSScriptRoot) 'scripts\elevate.ps1'
$tokens = $null
$errors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile($elevatePath, [ref]$tokens, [ref]$errors)
if ($errors.Count -gt 0) { throw "elevate.ps1 有语法错误: $($errors[0].Message)" }

$fn = @($ast.FindAll({
    param($n)
    $n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq 'Restore-Acls'
}, $true))
if ($fn.Count -ne 1) { throw "在 elevate.ps1 里找到 $($fn.Count) 个 Restore-Acls，预期 1 个" }

$script:aclBackups = @()
$script:aclRestoredCount = 0
Invoke-Expression $fn[0].Extent.Text

# ---- 造一个真实的 ACL 往返 ----
$dir = Join-Path $env:TEMP ('acl-test-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Path $dir -Force | Out-Null
$bakDir = Join-Path $env:TEMP ('acl-bak-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Path $bakDir -Force | Out-Null

$original = Get-Acl -LiteralPath $dir
$bakFile = Join-Path $bakDir 'acl_test.xml'
$original | Export-Clixml -LiteralPath $bakFile
$script:aclBackups += @{ Path = $dir; Backup = $bakFile }

Write-Host "测试目录: $dir"
Write-Host "备份文件: $bakFile"
Write-Host ''

# ---- 第一次调用：应该真的还原，并且删掉备份 ----
$r1 = Restore-Acls
$existsAfter1 = Test-Path -LiteralPath $bakFile
$countAfter1 = $script:aclRestoredCount
Write-Host "第一次调用: 返回=$r1  备份还在=$existsAfter1  累计还原=$countAfter1"

# ---- 第二次调用：备份已不在，不应该报错，也不该重复计数 ----
$err = $null
$r2 = $null
try {
    $r2 = Restore-Acls
} catch {
    $err = $_
}
Write-Host "第二次调用: 返回=$r2  抛异常=$($null -ne $err)  累计还原=$script:aclRestoredCount"

# ---- 判定 ----
$fail = 0
if (-not $r1) { Write-Host '  FAIL 第一次调用应当成功'; $fail++ }
if ($existsAfter1) { Write-Host '  FAIL 还原成功后备份文件应当被删除'; $fail++ }
if ($countAfter1 -ne 1) { Write-Host "  FAIL 第一次调用应累计 1 份，实际 $countAfter1"; $fail++ }
if ($err) { Write-Host "  FAIL 第二次调用不应抛异常: $err"; $fail++ }
if (-not $r2) { Write-Host '  FAIL 第二次调用应当返回成功（视为已还原）'; $fail++ }
if ($script:aclRestoredCount -ne 1) { Write-Host "  FAIL 累计还原次数应为 1，实际 $script:aclRestoredCount"; $fail++ }

# ---- 还原到的 ACL 是否和原始一致 ----
$now = Get-Acl -LiteralPath $dir
$same = ($now.Sddl -eq $original.Sddl)
Write-Host "ACL 与原始一致: $same"
if (-not $same) { Write-Host '  FAIL ACL 没有被正确还原'; $fail++ }

Remove-Item $dir, $bakDir -Recurse -Force -ErrorAction SilentlyContinue

Write-Host ''
if ($fail -eq 0) {
    Write-Host 'Restore-Acls 幂等性测试通过。'
    exit 0
}
Write-Host "Restore-Acls 测试失败：$fail 项"
exit 1
