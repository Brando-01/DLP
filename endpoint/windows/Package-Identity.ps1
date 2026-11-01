# Identidad de paquetes instalados: no lee mensajes, documentos ni argumentos.
function Get-DlpPackageSid([string]$Family) {
  if ($Family -notmatch '^[A-Za-z0-9.-]+_[A-Za-z0-9]+$') {throw 'Familia de paquete invalida.'}
  if (-not ('DlpNativePackageSid' -as [type])) {
    Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Security.Principal;
public static class DlpNativePackageSid {
 [DllImport("userenv.dll",CharSet=CharSet.Unicode)] static extern int DeriveAppContainerSidFromAppContainerName(string name,out IntPtr sid);
 [DllImport("advapi32.dll")] static extern IntPtr FreeSid(IntPtr sid);
 public static string Get(string name) {IntPtr sid;int result=DeriveAppContainerSidFromAppContainerName(name,out sid);if(result!=0)throw new InvalidOperationException("No se obtuvo SID de paquete");try{return new SecurityIdentifier(sid).Value;}finally{FreeSid(sid);}}
}
'@
  }
  return [DlpNativePackageSid]::Get($Family)
}
function Get-DlpNativePackages {
  if (Get-Command Get-AppxPackage -ErrorAction SilentlyContinue) {
    return @(Get-AppxPackage | Where-Object {$_.Name -match '(?i)whatsapp|discord'} | Select-Object Name,PackageFamilyName,InstallLocation)
  }
  return @()
}
