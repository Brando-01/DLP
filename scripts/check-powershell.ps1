# Verificacion estatica: analiza sintaxis; no ejecuta sensores ni politicas.
$ErrorActionPreference='Stop'
$root=Split-Path -Parent $PSScriptRoot
$files=@(Get-ChildItem -LiteralPath (Join-Path $root 'endpoint\windows') -Filter '*.ps1' -File)
foreach ($file in $files) {
  $errors=$null
  [System.Management.Automation.Language.Parser]::ParseFile($file.FullName,[ref]$null,[ref]$errors) | Out-Null
  if ($errors.Count) { throw ($file.Name+': '+($errors | Out-String)) }
}
@{files=$files.Count;syntaxValid=$true;scriptsExecuted=$false;powerShell=$PSVersionTable.PSVersion.ToString()} | ConvertTo-Json
