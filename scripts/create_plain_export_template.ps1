$ErrorActionPreference = 'Stop'

$output = Join-Path $PSScriptRoot '..\assets\pnl-export-template.xlsx'
$directory = Split-Path -Parent $output
New-Item -ItemType Directory -Force -Path $directory | Out-Null

$excel = New-Object -ComObject Excel.Application
$excel.Visible = $false
$excel.DisplayAlerts = $false
try {
  $workbook = $excel.Workbooks.Add()
  $raw = $workbook.Worksheets.Item(1)
  $raw.Name = 'RAW'
  $headers = @('fiscal_year', 'fiscal_quarter', 'product_name', 'brand', 'customer_group_name', 'site_name', 'account_code', 'account_name', 'amount')
  for ($index = 0; $index -lt $headers.Count; $index += 1) { $raw.Cells.Item(1, $index + 1) = $headers[$index] }
  $sample = @(2023, 'Q1', 'Sample Product', 'Sample Brand', 'Sample Customer', 'Sample Site', 'sales', 'Sales', 0)
  for ($index = 0; $index -lt $sample.Count; $index += 1) { $raw.Cells.Item(2, $index + 1) = $sample[$index] }
  $sourceRange = $raw.Range($raw.Cells.Item(1, 1), $raw.Cells.Item(2, $headers.Count))
  $table = $raw.ListObjects.Add(1, $sourceRange, $null, 1)
  $table.Name = 'RawData'
  $table.TableStyle = 'TableStyleMedium2'
  $raw.Columns.AutoFit() | Out-Null

  $summary = $workbook.Worksheets.Add()
  $summary.Name = 'Summary'
  $summary.Cells.Item(1, 1) = 'P/L Explorer Export'
  $summary.Cells.Item(1, 1).Font.Bold = $true
  $summary.Cells.Item(1, 1).Font.Size = 14
  $summary.Cells.Item(3, 1) = 'Summary is generated from the selected filters and layout.'
  $summary.Columns.AutoFit() | Out-Null
  $workbook.SaveAs($output, 51)
  $workbook.Close($true)
} finally {
  $excel.Quit()
  [System.Runtime.InteropServices.Marshal]::ReleaseComObject($excel) | Out-Null
}
