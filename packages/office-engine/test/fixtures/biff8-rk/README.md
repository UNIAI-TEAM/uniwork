# BIFF8 RK real-file fixtures (UNI-2207 C0)

Real Microsoft Excel 97–2003 BIFF8 `.xls` fixtures exercising `RkNumber`
decoding (MS-XLS §2.5.122: bit 0 = `fX100` divide by 100, bit 1 = `fInt` signed
30-bit integer `rk >> 2`).

## Source & License

Both files originate from the Apache POI `test-data/spreadsheet/` corpus and are
redistributed under the **Apache License, Version 2.0** (full license text in
`docs/office/g0/fixtures/upstream-license/LICENSE-Apache-POI.txt` and notice in
`docs/office/g0/fixtures/upstream-license/NOTICE-Apache-POI.txt`):

| File | Bytes | SHA-256 | Upstream Origin | Key RK Cells Tested |
| --- | ---: | --- | --- | --- |
| `poi-FormatKM.xls` | 33,280 | `dafc1b91557f2abe8baecf499bfd21f03aa35248761a945f508bff4ec083db82` | `https://raw.githubusercontent.com/apache/poi/trunk/test-data/spreadsheet/FormatKM.xls` | `Sheet1!A2 = 1.02` (`fInt=1, fX100=1`, `102 / 100`), `Sheet1!A6 = 1021.02` (`102102 / 100`) |
| `poi-44010-TwoCharts.xls` | 29,696 | `e9186774ff6b1e50059238121f12270e92c83ca34e800dbe5416fc370d5b1da0` | `https://raw.githubusercontent.com/apache/poi/trunk/test-data/spreadsheet/44010-TwoCharts.xls` | `auto_1!D3 = 46.4` (`4640 / 100`), `auto_1!E3 = 0.7` (`70 / 100`) |
