param([ValidateSet('protect', 'unprotect', 'profile')][string]$Operation)

$ErrorActionPreference = 'Stop'
$utf8 = [Text.UTF8Encoding]::new($false)
$reader = [IO.StreamReader]::new([Console]::OpenStandardInput(), $utf8)
$writer = [IO.StreamWriter]::new([Console]::OpenStandardOutput(), $utf8)
try {
    $inputValue = $reader.ReadToEnd()
    if ($Operation -eq 'profile') {
        $folder = [IO.DirectoryInfo]::new($inputValue)
        if (($folder.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
            throw 'The camera profile must be a regular directory.'
        }
        $security = [Security.AccessControl.DirectorySecurity]::new()
        $security.SetAccessRuleProtection($true, $false)
        $owner = [Security.Principal.WindowsIdentity]::GetCurrent().User
        $system = [Security.Principal.SecurityIdentifier]::new('S-1-5-18')
        foreach ($identity in @($owner, $system)) {
            $rule = [Security.AccessControl.FileSystemAccessRule]::new(
                $identity, 'FullControl', 'ContainerInherit, ObjectInherit', 'None', 'Allow'
            )
            $security.AddAccessRule($rule)
        }
        $folder.SetAccessControl($security)
        $writer.Write('ok')
    } elseif ($Operation -eq 'protect') {
        $secure = ConvertTo-SecureString -String $inputValue -AsPlainText -Force
        $writer.Write((ConvertFrom-SecureString -SecureString $secure))
    } else {
        $secure = ConvertTo-SecureString -String $inputValue
        $writer.Write([Net.NetworkCredential]::new('', $secure).Password)
    }
} finally {
    $writer.Dispose()
    $reader.Dispose()
}
