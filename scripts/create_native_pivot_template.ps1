$ErrorActionPreference = 'Stop'

$output = Join-Path $PSScriptRoot '..\assets\pnl-native-pivot-template.xlsx'
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

  $pivotSheet = $workbook.Worksheets.Add()
  $pivotSheet.Name = 'PivotTable'
  $pivotSheet.Cells.Item(1, 1) = 'P/L Explorer PivotTable'
  $pivotSheet.Cells.Item(1, 1).Font.Bold = $true
  $cache = $workbook.PivotCaches().Create(1, 'RawData')
  $pivot = $cache.CreatePivotTable($pivotSheet.Range('A3'), 'PLPivot')
  $pivot.PivotFields('product_name').Orientation = 1
  $pivot.PivotFields('brand').Orientation = 1
  $pivot.PivotFields('fiscal_year').Orientation = 2
  $pivot.PivotFields('fiscal_quarter').Orientation = 2
  $pivot.AddDataField($pivot.PivotFields('amount'), 'Amount Sum', -4157) | Out-Null
  # The cache, rather than the PivotTable object, owns this setting.  Excel
  # refreshes the cache against the RAW table as soon as the file is opened.
  try { $cache.RefreshOnFileOpen = $true } catch { }
  $workbook.SaveAs($output, 51)
  $workbook.Close($true)
} finally {
  $excel.Quit()
  [System.Runtime.InteropServices.Marshal]::ReleaseComObject($excel) | Out-Null
}
