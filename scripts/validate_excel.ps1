param([Parameter(Mandatory=$true)][string]$WorkbookPath)

$ErrorActionPreference = 'Stop'
$excel = New-Object -ComObject Excel.Application
$excel.Visible = $false
$excel.DisplayAlerts = $false
try {
  $book = $excel.Workbooks.Open((Resolve-Path $WorkbookPath))
  Write-Output "OPENED=$($book.Name)"
  Write-Output "SHEETS=$($book.Worksheets.Count)"
  $book.Close($false)
} finally {
  $excel.Quit()
  [System.Runtime.InteropServices.Marshal]::ReleaseComObject($excel) | Out-Null
}
