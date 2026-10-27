# Hỏi UNI đọc tệp Office (kế hoạch 1 — Phần 1a) Implementation Plan

> **Trạng thái:** in-progress — kế hoạch đầu tiên của spec Hỏi UNI soạn tệp Office; đang triển khai; issue UNI-2224 (con của UNI-415), nhánh `feature/UNI-2224-hoi-uni-doc-tep-office-trong-tai-lieu-va`.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `get_document` (của Hỏi UNI và MCP connector, một đường đọc chung) trả về chữ của tệp DOCX, XLSX, PPTX, ODT, CSV trong kho Tài liệu thay vì chỉ tên và loại; Hỏi UNI có thêm công cụ đọc `list_documents` để duyệt thư mục.

**Architecture:** Nhánh tệp của `McpToolService.GetDocument` (`server/internal/service/mcp_tools_documents.go:202-222`) có thêm một đường: tệp Office đọc trọn (tối đa 20 MiB) bằng `OpenDocumentFile(..., DocumentAccessDownload)`, trích chữ bằng `attachtext.Extract`, gói vào ngân sách bằng `attachtext.Fit`, cắt ở `mcpMaxItemRunes`. Hỏi UNI dùng lại nguyên đường đó qua `agentGetDocument`, và có thêm `list_documents` bọc `McpToolService.ListDocuments` (`mcp_tools_documents.go:244`). Không đổi quyền, phạm vi workspace hay cờ.

**Tech Stack:** Go (service layer), `server/internal/attachtext`, test Go có DB (`TEST_DATABASE_URL`).

**Spec:** `docs/superpowers/specs/2026-10-27-ask-uni-office-design.md` (§6 Phần 1, gạch đầu dòng 1–2; quyết định của người viết số 2).

**Ngoài kế hoạch này (các kế hoạch sau của cùng spec):** 1b chỉ mục nội dung tệp cho `search`; 1c tệp đính kèm ở công việc/chat/cuộc họp/Email Hub; **PDF** — `attachtext` không trích chữ PDF (`ReadPDF`, `attachtext/pdf.go:60`, chỉ cắt trang để gửi model), nên PDF vẫn chỉ trả tên và loại ở đây; Phần 2–6.

## Global Constraints

- Mọi AI chạy bằng UniWork AI; kế hoạch này không gọi model nào.
- Phạm vi workspace không đổi: mọi đọc đi qua `McpToolService.document()` (`mcp_tools_documents.go:118`); tài liệu workspace khác hay trong thùng rác đọc như không có. `TestAgentToolsStayInTheAskedWorkspace` và `TestMcpDocumentLookupStaysInTheGrantAndTheWorkspace` phải vẫn xanh.
- Mỗi lần đọc nội dung tệp ghi đúng một dòng `download` vào nhật ký truy cập của tài liệu, như tệp văn bản (`mcp_tools_documents.go:230`); lời gọi bị từ chối hay tệp không được mở thì không ghi gì.
- Cắt nội dung ở `mcpMaxItemRunes` (16.000) với đuôi `mcpItemCut`; `truncated` báo khi bị cắt.
- Trần đọc tệp Office: 20 MiB, dùng lại `askMaxAttachmentsBytes` (`askuni_attachments.go:39`); tệp lớn hơn không được mở.
- Code comment tiếng Anh; `gofmt`, `go vet`, `staticcheck` sạch.
- Chạy test hẹp bằng `-run`; không chạy `make check` hay toàn bộ `go test` cho tới khi xong mọi kế hoạch của spec (CI chạy toàn bộ).
- Không chạy eval AI thật. Không nhắc tên ClickUp trong code, test, commit.
- Commit dạng `feat(ask-uni): …`; hook tự thêm `Refs: UNI-nnn` trên nhánh issue.

## Review Focus

1. **Tệp Office hỏng** (XML phần chính không đóng thẻ): lời gọi không lỗi, trả tên/loại kèm ghi chú "không đọc được" — test ở Task 2.
2. **Tệp không có chữ** (deck toàn ảnh, tài liệu trống): `content` rỗng, ghi chú nói rõ không có chữ — test ở Task 2.
3. **Tệp lớn hơn 20 MiB**: không mở, không ghi nhật ký, ghi chú "quá lớn" — quyết định theo `SizeBytes` trước khi mở; test `mcpOfficeReadable` ở Task 1.
4. **Workbook nhiều sheet dài**: mỗi sheet được phần ngân sách bằng nhau (`attachtext.Fit`), tổng không quá 16.000 ký tự, kết thúc bằng `mcpItemCut`, `truncated` true — test ở Task 1.
5. **Đuôi tệp viết hoa, MIME có tham số** (`BAO-GIA.DOCX`, `text/csv; charset=utf-8`): vẫn nhận ra — test ở Task 1.

---

### Task 1: Hàm thuần nhận diện và gói chữ tệp Office

**Files:**
- Create: `server/internal/service/mcp_tools_office.go`
- Test: `server/internal/service/mcp_tools_office_test.go`

**Interfaces:**
- Consumes: `attachtext.Doc`, `attachtext.Part`, `attachtext.Fit` (`attachtext/fit.go:19`); `capRunes`, `mcpMaxItemRunes`, `mcpItemCut` (`mcp_tools.go:79-82`); `askMaxAttachmentsBytes`.
- Produces:
  - `const mcpOfficeReadBytes = askMaxAttachmentsBytes`
  - `func mcpOfficeMIME(mime, filename string) (extract string, ok bool)` — đuôi trước (`.docx`, `.xlsx`, `.pptx`, `.odt`, `.csv`, không phân biệt hoa thường), rồi MIME đã bỏ tham số, hạ chữ thường; trả đúng chuỗi `attachtext.Extract` nhận: `application/vnd.openxmlformats-officedocument.wordprocessingml.document`, `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`, `application/vnd.openxmlformats-officedocument.presentationml.presentation`, `application/vnd.oasis.opendocument.text`, `text/csv`.
  - `func mcpOfficeReadable(size int64) bool` — `0 < size <= mcpOfficeReadBytes`.
  - `func mcpOfficeText(d attachtext.Doc) (text string, truncated bool)` — `attachtext.Fit(d, mcpMaxItemRunes/3)` (`EstimateTokens` = ký tự/3), rồi `capRunes(…, mcpMaxItemRunes, mcpItemCut)`; khi `read < total` mà chưa bị cắt thì nối `"\n" + mcpItemCut`; `truncated` = bị bỏ phần hoặc bị cắt.

- [ ] **Step 1: Write the failing tests**

```go
func TestMcpOfficeMIME(t *testing.T) {
	for _, c := range []struct {
		mime, name, want string
		ok               bool
	}{
		{"", "BAO-GIA.DOCX", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", true},
		{"application/zip", "so-lieu.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", true},
		{"", "gioi-thieu.pptx", "application/vnd.openxmlformats-officedocument.presentationml.presentation", true},
		{"application/vnd.oasis.opendocument.text", "bien-ban", "application/vnd.oasis.opendocument.text", true},
		{"text/csv; charset=utf-8", "don-hang", "text/csv", true},
		{"application/pdf", "tai-lieu.pdf", "", false},
		{"text/markdown", "ghi-chu.md", "", false}, // text files keep their own path
		{"image/png", "logo.png", "", false},
	} {
		if got, ok := mcpOfficeMIME(c.mime, c.name); got != c.want || ok != c.ok {
			t.Errorf("mcpOfficeMIME(%q, %q) = %q, %v; want %q, %v", c.mime, c.name, got, ok, c.want, c.ok)
		}
	}
}

func TestMcpOfficeReadable(t *testing.T) {
	for size, want := range map[int64]bool{0: false, 1: true, mcpOfficeReadBytes: true, mcpOfficeReadBytes + 1: false} {
		if got := mcpOfficeReadable(size); got != want {
			t.Errorf("mcpOfficeReadable(%d) = %v", size, got)
		}
	}
}

func TestMcpOfficeText(t *testing.T) {
	short := attachtext.Doc{Unit: "paragraph", Parts: []attachtext.Part{{Text: "Báo giá tháng 10"}, {Text: "Hàng | Giá"}}}
	if text, cut := mcpOfficeText(short); text != "Báo giá tháng 10\nHàng | Giá" || cut {
		t.Errorf("short = %q, %v", text, cut)
	}
	if text, cut := mcpOfficeText(attachtext.Doc{}); text != "" || cut {
		t.Errorf("empty = %q, %v", text, cut)
	}
	// Two long sheets: each keeps its own first rows, the whole stays under the cap.
	var long attachtext.Doc
	for _, sheet := range []string{"Doanh thu Q1", "Doanh thu Q2"} {
		long.Parts = append(long.Parts, attachtext.Part{Label: sheet})
		for i := 0; i < 2000; i++ {
			long.Parts = append(long.Parts, attachtext.Part{Text: fmt.Sprintf("Q-%04d | Máy lọc nước | 12 | 3.500.000", i)})
		}
	}
	text, cut := mcpOfficeText(long)
	if !cut || utf8.RuneCountInString(text) > mcpMaxItemRunes || !strings.HasSuffix(text, mcpItemCut) ||
		!strings.Contains(text, "## Doanh thu Q1") || !strings.Contains(text, "## Doanh thu Q2") {
		t.Errorf("long: cut=%v runes=%d", cut, utf8.RuneCountInString(text))
	}
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd server && go test ./internal/service -run '^TestMcpOffice(MIME|Readable|Text)$' -count=1`
Expected: FAIL — `undefined: mcpOfficeMIME` (lỗi biên dịch).

- [ ] **Step 3: Implement the constant and three functions in `server/internal/service/mcp_tools_office.go`**

Theo khối Interfaces; không cần DB.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd server && go test ./internal/service -run '^TestMcpOffice(MIME|Readable|Text)$' -count=1`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/internal/service/mcp_tools_office.go server/internal/service/mcp_tools_office_test.go
git commit -m "feat(ask-uni): recognize and fit the text of Office files for get_document"
```

### Task 2: `get_document` đọc chữ tệp Office

**Files:**
- Modify: `server/internal/service/mcp_tools_documents.go:202-222` (nhánh `case v.File != nil`), method mới cạnh `fileHead` (`:226-236`), mô tả `get_document` trong `mcpDocumentTools` (`:607`)
- Modify: `server/internal/service/mcp_tools_documents_test.go:537` (ghi chú PDF mới)
- Test: `server/internal/service/mcp_tools_documents_test.go` (test và helper mới cạnh `TestMcpGetDocumentReadsTextFiles`, `:515`)

**Interfaces:**
- Consumes: Task 1; `attachtext.Extract(mime string, r io.ReaderAt, size int64) (attachtext.Doc, error)`, `attachtext.ErrUnreadable`; `v.File.SizeBytes` (`DocumentFileInfo`, `document_files.go:74-82`).
- Produces:
  - `func (s *McpToolService) fileBytes(ctx context.Context, p McpPrincipal, documentID string) ([]byte, error)` — như `fileHead` nhưng `DocumentByteRange{Length: mcpOfficeReadBytes + 1}`; đọc được hơn `mcpOfficeReadBytes` byte là lỗi.
  - `McpDocument.Format == "extracted"` cho tệp Office đọc được (tệp văn bản vẫn `"text"`, trang vẫn `"markdown"`).
  - Hằng ghi chú, dùng nguyên văn ở code và test:
    - `mcpOfficeNote = "only the text of this file is shown (paragraphs, table rows, slides or sheet rows); formatting, images and layout are not"`
    - `mcpOfficeEmptyNote = "this file holds no text to show (pictures or empty pages only)"`
    - `mcpOfficeUnreadableNote = "the text of this file could not be read (damaged, encrypted or too complex), so only its name and type are shown"`
    - `mcpOfficeTooLargeNote = "this file is larger than 20 MiB, so only its name and type are shown; open it in UniWork"`
    - `mcpNotTextNote = "this file type cannot be read as text here (md, html, txt, docx, xlsx, pptx, odt and csv can), so only its name and type are shown"` — thay ghi chú "not a text file" ở `:205`.
  - Test helper `officeFile(t *testing.T, parts map[string]string) []byte` (zip có `[Content_Types].xml`, `_rels/.rels` và `parts`, như `docxLike`, `document_storage_harness_test.go:180`) và `var officeXLSXParts map[string]string` (chép `xlsxWorkbook`, `xlsxRels`, `xlsxStrings`, `xlsxSheet` từ `attachtext/attachtext_test.go`, cạnh `xlsxOf` `:126`). Task 3 dùng lại.

- [ ] **Step 1: Write the failing test `TestMcpGetDocumentReadsOfficeFiles`**

```go
func TestMcpGetDocumentReadsOfficeFiles(t *testing.T) {
	x := newMcpToolWorld(t)
	const w = `xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"`
	docx := x.textFile(t, "bao-gia.docx", officeFile(t, map[string]string{"word/document.xml": `<w:document ` + w + `><w:body>` +
		`<w:p><w:r><w:t>Báo giá tháng 10</w:t></w:r></w:p>` +
		`<w:tbl><w:tr><w:tc><w:p><w:r><w:t>Hàng</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Giá</w:t></w:r></w:p></w:tc></w:tr></w:tbl>` +
		`</w:body></w:document>`}))
	before := x.accessLogs(t, docx)
	d := x.getDoc(t, docx)
	if d.Format != "extracted" || d.Content != "Báo giá tháng 10\nHàng | Giá" || d.Truncated || d.Note != mcpOfficeNote || d.Filename != "bao-gia.docx" {
		t.Fatalf("docx = %+v", d)
	}
	if got := x.accessLogs(t, docx) - before; got != 1 {
		t.Errorf("one read wrote %d access log rows, want 1", got)
	}

	pptx := x.textFile(t, "gioi-thieu.pptx", officeFile(t, map[string]string{"ppt/slides/slide1.xml": `<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>Giới thiệu dịch vụ</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`}))
	if d = x.getDoc(t, pptx); d.Format != "extracted" || d.Content != "Slide 1\nGiới thiệu dịch vụ" {
		t.Fatalf("pptx = %+v", d)
	}

	xlsx := x.textFile(t, "so-lieu.xlsx", officeFile(t, officeXLSXParts))
	if d = x.getDoc(t, xlsx); d.Format != "extracted" || !strings.HasPrefix(d.Content, "## ") || d.Note != mcpOfficeNote {
		t.Fatalf("xlsx = %+v", d)
	}

	empty := x.textFile(t, "trong.docx", officeFile(t, map[string]string{"word/document.xml": `<w:document ` + w + `><w:body/></w:document>`}))
	if d = x.getDoc(t, empty); d.Format != "extracted" || d.Content != "" || d.Note != mcpOfficeEmptyNote {
		t.Fatalf("empty = %+v", d)
	}

	broken := x.textFile(t, "hong.docx", officeFile(t, map[string]string{"word/document.xml": `<w:document ` + w + `><w:body><w:p>`}))
	if d = x.getDoc(t, broken); d.Format != "" || d.Content != "" || d.Note != mcpOfficeUnreadableNote || d.Filename != "hong.docx" {
		t.Fatalf("broken = %+v", d)
	}
}
```

Nếu `CreateFileDocument` từ chối gói nào (FileService kiểm phần OOXML), thêm phần nó đòi vào `officeFile`; không nới kiểm tra của FileService.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && go test ./internal/service -run '^TestMcpGetDocumentReadsOfficeFiles$' -count=1`
Expected: FAIL — `undefined: mcpOfficeNote`; sau khi khai báo hằng, `docx = {… Note:this is not a text file …}`.

- [ ] **Step 3: Implement**

Nhánh tệp của `GetDocument`: `mcpTextFile` → giữ nguyên; `mcpOfficeMIME` không nhận → `mcpNotTextNote`; `!mcpOfficeReadable(v.File.SizeBytes)` → `mcpOfficeTooLargeNote` (không mở tệp); `fileBytes` lỗi → log + ghi chú "just now" như `:212-213`; `Extract` trả `ErrUnreadable` → `mcpOfficeUnreadableNote`, lỗi khác → log + ghi chú "just now"; chữ rỗng → `Format "extracted"` + `mcpOfficeEmptyNote`; còn lại `Format "extracted"`, `Content`/`Truncated` từ `mcpOfficeText`, `Note = mcpOfficeNote`. Mô tả `get_document` (`:607`): tệp docx/xlsx/pptx/odt/csv trả chữ trích ra với format `extracted`, cắt như trang; pdf và loại khác chỉ tên, loại và ghi chú.

- [ ] **Step 4: Update the PDF assertion of `TestMcpGetDocumentReadsTextFiles`**

`:537`: `!strings.Contains(d.Note, "not a text file")` → `d.Note != mcpNotTextNote`.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd server && go test ./internal/service -run '^(TestMcpGetDocumentReadsOfficeFiles|TestMcpGetDocumentReadsTextFiles|TestMcpDocumentReadsWriteOnlyTheAccessLog|TestMcpRefusedDocumentReadsLeaveNoAccessLog|TestMcpDocumentsKeepTheirOwnPermissions|TestMcpDocumentLookupStaysInTheGrantAndTheWorkspace)$' -count=1`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add server/internal/service/mcp_tools_documents.go server/internal/service/mcp_tools_documents_test.go
git commit -m "feat(ask-uni): get_document reads the text of docx, xlsx, pptx, odt and csv files"
```

### Task 3: Hỏi UNI có `list_documents` và mô tả `get_document` mới

**Files:**
- Modify: `server/internal/service/askuni_agent_tools.go:183-184` (mô tả `get_document`), `readTool("list_documents", …)` ngay sau, handler mới cạnh `agentGetDocument` (`:515`)
- Modify: `server/internal/service/askuni_agent_tools_test.go:20-23` (`agentToolOrder`: thêm `"list_documents"` ngay sau `"get_document"`)
- Modify: `server/internal/service/askuni_taint_test.go` (~`:225`) nếu bảng đó phải liệt kê đủ mọi công cụ
- Test: `server/internal/service/askuni_agent_tools_test.go`

**Interfaces:**
- Consumes: `McpToolService.ListDocuments(ctx, p McpPrincipal, in mcpListDocumentsIn) (McpDocumentList, error)` (`mcp_tools_documents.go:244`), `mcpListDocumentsIn{WorkspaceID, ParentID, Cursor}`, `principalOf(tc)`, `s.needsReads`, `agentArgs`, `moreNote`, `s.href`; test: `newAgentWorld`, `runAgentTool`, `x.withDocs`, `DocumentService.CreatePage` với `CreatePageInput{Kind: DocumentKindFolder, …}` / `{ParentID: …}` (như `TestMcpListDocumentsByParentAndCursor`, `mcp_tools_documents_test.go:429`), workspace thứ hai như `TestAgentToolsStayInTheAskedWorkspace`.
- Produces: `func (s *AskUNIService) agentListDocuments(ctx context.Context, tc ai.ToolContext, raw json.RawMessage) ([]agentItem, error)` — `WorkspaceID` luôn là `tc.WorkspaceID` (model không chọn workspace); mỗi dòng một `agentItem{Kind: "document", ID, Key: s.href(d.URL), Href: s.href(d.URL), Title, Text: "ID: …\nType: …"}`; `Foreign` như dòng tài liệu của `search`; có `NextCursor` thì thêm `moreNote("More documents follow; call list_documents again with cursor " + cursor + ".")`.
- Mô tả công cụ (nguyên văn):
  - `get_document`: `"One document: a page as Markdown; a text file's text; a docx, xlsx, pptx, odt or csv file's text read paragraph by paragraph, slide by slide or row by row (no formatting); any other file's name and type."`
  - `list_documents`: `"Pages, files and folders directly under one folder or page of the workspace (the top level when parent_id is \"\"), in the order of the document tree, 50 at a time. Use it to browse a folder; open a row with get_document."`, tham số `parent_id` = `strArg("A folder or page id from list_documents or search; \"\" for the top level.")`, `cursor` = `strArg("The cursor a previous list_documents call gave; \"\" for the first page.")`.

- [ ] **Step 1: Write the failing test `TestAgentListDocuments`**

Kịch bản và khẳng định:
- Dựng: một thư mục "Báo giá" ở gốc; trong đó một trang "Báo giá Minh An" và một tệp `don-hang-10.xlsx` (`officeFile(t, officeXLSXParts)`, `CreateFileDocumentInput` với `ParentID` = thư mục).
- `runAgentTool(t, s, tc, "list_documents", `{"parent_id":"","cursor":""}`)` có một item mang ID của thư mục.
- `list_documents` với `parent_id` = thư mục trả đúng 2 item: ID của trang và của tệp.
- `list_documents` với `parent_id` là thư mục của workspace thứ hai trả 0 item.
- `agentToolOrder` có `"list_documents"` ngay sau `"get_document"`.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && go test ./internal/service -run '^(TestAgentListDocuments|TestAgentTools.*)$' -count=1`
Expected: FAIL — công cụ `list_documents` không có trong registry.

- [ ] **Step 3: Implement `agentListDocuments` và đăng ký `readTool("list_documents", …, s.needsReads(s.agentListDocuments))`; sửa mô tả `get_document`**

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd server && go test ./internal/service -run '^(TestAgentListDocuments|TestAgentTools.*|TestAskUniTaint.*|TestAskFindsDocuments|TestContextRefusesAnUnreadableMention|TestMcpOffice.*|TestMcpGetDocumentReads.*)$' -count=1`
Expected: PASS

- [ ] **Step 5: Format, vet, record the plan in the spec**

Run: `cd server && gofmt -l ./internal/service && go vet ./internal/service`
Expected: gofmt không in tệp nào; vet sạch.
Sửa dòng `> **Trạng thái:**` của spec, thêm: "kế hoạch 1 (Phần 1a): `docs/superpowers/plans/2026-10-27-ask-uni-office-p1-read.md`".

- [ ] **Step 6: Commit**

```bash
git add server/internal/service/askuni_agent_tools.go server/internal/service/askuni_agent_tools_test.go server/internal/service/askuni_taint_test.go docs/superpowers/specs/2026-10-27-ask-uni-office-design.md
git commit -m "feat(ask-uni): browse document folders with list_documents"
```
