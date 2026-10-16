package ai

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"strings"
	"testing"
)

// Paths from server/internal/ai/ to the committed generated tool artifacts.
var (
	genofficeSchemasJSONPath = filepath.Join("..", "..", "..", "docs", "office", "g5g6g7", "genoffice-tool-schemas.json")
	genofficeToolsDocPath    = filepath.Join("..", "..", "..", "docs", "office", "g5g6g7", "genoffice-tools.md")
	genofficeFacadeGoPath    = "openai_facade.go"
)

// uniworkGroupBWriteOverrides lists the group-B file-writing tools whose
// mechanical editor_write cell in docs/office/g5g6g7/genoffice-tools.md §3 is
// "no" (their renderer executeTool returns mutated: false because they do not
// mutate the open in-memory document buffer), but which write new files or
// userData outside the open document and are therefore classified as Write in
// officeUniworkModulesV1 (and promoted before G6-09a removes save_style_template
// from slides).
//
// Each entry names where the exception is documented:
//   - "docs/create_document":
//     docs/office/g5g6g7/genoffice-tools.md §3 (row docs|create_document, editor_write=no),
//     §3.1 group B ("B. Ghi ra ngoài tài liệu", hand column "file"),
//     §4.2 (BOUND_HIDDEN_TOOLS / create_document), §5 docs (c), §9 row 2;
//     server/internal/ai/openai_facade.go:703-705,714-721.
//   - "sheets/create_document":
//     docs/office/g5g6g7/genoffice-tools.md §3 (row sheets|create_document, editor_write=no),
//     §3.1 group B ("B. Ghi ra ngoài tài liệu", hand column "file"),
//     §5 sheets (c), §9 row 17;
//     server/internal/ai/openai_facade.go:703-705,714-721.
//   - "pdf/create_document":
//     docs/office/g5g6g7/genoffice-tools.md §3 (row pdf|create_document, editor_write=no),
//     §3.1 group B ("B. Ghi ra ngoài tài liệu", hand column "file"),
//     §4.8 (create_document row), §5 pdf (c), §9 row 31;
//     server/internal/ai/openai_facade.go:703-705,714-721.
//   - "slides/save_style_template":
//     docs/office/g5g6g7/genoffice-tools.md §3 (row slides|save_style_template, editor_write=no),
//     §3.1 group B ("B. Ghi ra ngoài tài liệu", hand column "file", writes userData/style-templates/<name>.json),
//     §4.7 (save_style_template row), §5 slides (c), §9 rows 27-28;
//     server/internal/ai/openai_facade.go:703-705 (promoted by group B, then removed by G6-09a below).
var uniworkGroupBWriteOverrides = map[string]string{
	"docs/create_document":       "genoffice-tools.md §3 (editor_write=no), §3.1 group B (hand=file), §4.2, §5 docs (c), §9 row 2; openai_facade.go:703-705,714-721",
	"sheets/create_document":     "genoffice-tools.md §3 (editor_write=no), §3.1 group B (hand=file), §5 sheets (c), §9 row 17; openai_facade.go:703-705,714-721",
	"pdf/create_document":        "genoffice-tools.md §3 (editor_write=no), §3.1 group B (hand=file), §4.8, §5 pdf (c), §9 row 31; openai_facade.go:703-705,714-721",
	"slides/save_style_template": "genoffice-tools.md §3 (editor_write=no), §3.1 group B (hand=file), §4.7, §5 slides (c), §9 rows 27-28; openai_facade.go:703-705",
}

// uniworkGroupBPdfFileWriteTools lists the remaining eight group-B rows in
// docs/office/g5g6g7/genoffice-tools.md §3.1 ("B. Ghi ra ngoài tài liệu"):
// the pdf file-level page tools that both mutate the document and write a file
// or create a new version. Their §3 mechanical editor_write cell is already
// "yes", so they need no Read->Write override; they remain in pdf.Write because
// the client hides them only for a UniWork-bound document and the module-keyed
// server table carries no document scope (genoffice-tools.md §3.1, §4.8,
// §5 pdf (c), §9 rows 30-31; openai_facade.go:714-721).
var uniworkGroupBPdfFileWriteTools = map[string]string{
	"pdf/insert_blank_page": "genoffice-tools.md §3 (editor_write=yes), §3.1 group B (hand=file), §4.8, §5 pdf (c), §9 row 30; openai_facade.go:714-721",
	"pdf/set_page_size":     "genoffice-tools.md §3 (editor_write=yes), §3.1 group B (hand=file), §4.8, §5 pdf (c), §9 row 30; openai_facade.go:714-721",
	"pdf/crop_pages":        "genoffice-tools.md §3 (editor_write=yes), §3.1 group B (hand=file), §4.8, §5 pdf (c), §9 row 30; openai_facade.go:714-721",
	"pdf/replace_pages":     "genoffice-tools.md §3 (editor_write=yes), §3.1 group B (hand=file), §4.8, §5 pdf (c), §9 row 30; openai_facade.go:714-721",
	"pdf/extract_pages":     "genoffice-tools.md §3 (editor_write=yes), §3.1 group B (hand=file), §4.8, §5 pdf (c), §9 row 31; openai_facade.go:714-721",
	"pdf/split_pdf":         "genoffice-tools.md §3 (editor_write=yes), §3.1 group B (hand=file), §4.8, §5 pdf (c), §9 row 31; openai_facade.go:714-721",
	"pdf/split_pages":       "genoffice-tools.md §3 (editor_write=yes), §3.1 group B (hand=file), §4.8, §5 pdf (c), §9 row 31; openai_facade.go:714-721",
	"pdf/merge_pages":       "genoffice-tools.md §3 (editor_write=yes), §3.1 group B (hand=file), §4.8, §5 pdf (c), §9 row 31; openai_facade.go:714-721",
}

// uniworkG609aHiddenSlidesTools lists the five slides tools that G6-09a
// (UNI-1374 N1) removes from officeUniworkModulesV1["slides"] altogether
// because the slides skill (UNIWORK_AI_HIDDEN_TOOLS in
// apps/slides/src/renderer/ai/slides-skill.ts:1100-1106 at fork rev
// 3e4e9b71fb08682f8afbe5cc0c2045792d14fd3b) hides them whenever the provider is
// UniWork AI. Keeping them out of both Read and Write ensures a modified client
// cannot offer them to the model and any call for one is dropped as
// not_allowlisted rather than view_only.
//
// Each entry names where the exception is documented:
//   - "slides/generate_deck":
//     docs/office/g5g6g7/genoffice-tools.md §3 (editor_write=yes), §4.7 (web stub,
//     multi-turn internal LLM pipeline, local draft/sidecar write), §5 slides (b)-(c),
//     §8.1, §9 rows 27-29; fork slides-skill.ts:1095,1100-1106;
//     server/internal/ai/openai_facade.go:705-713.
//   - "slides/regenerate_slide":
//     docs/office/g5g6g7/genoffice-tools.md §3 (editor_write=yes), §4.7 (web stub,
//     internal LLM call, local draft write), §5 slides (b)-(c), §8.1, §9 rows 27-29;
//     fork slides-skill.ts:1095,1100-1106;
//     server/internal/ai/openai_facade.go:705-713.
//   - "slides/insert_web_image":
//     docs/office/g5g6g7/genoffice-tools.md §3 (editor_write=yes), §4.7 (web stub
//     web-slides-api.ts:1121, desktop arbitrary URL fetch), §5 slides (b), §9 rows 26, 28;
//     fork slides-skill.ts:1095,1100-1106;
//     server/internal/ai/openai_facade.go:705-713.
//   - "slides/replace_image":
//     docs/office/g5g6g7/genoffice-tools.md §3 (editor_write=yes), §4.7 (web stub
//     web-slides-api.ts:1122, desktop arbitrary URL fetch), §5 slides (b), §9 rows 26, 28;
//     fork slides-skill.ts:1095,1100-1106;
//     server/internal/ai/openai_facade.go:705-713.
//   - "slides/save_style_template":
//     docs/office/g5g6g7/genoffice-tools.md §3 (editor_write=no), §3.1 group B
//     (hand column "file", userData/style-templates/<name>.json), §4.7 (web stub
//     web-slides-api.ts:1133), §5 slides (c), §9 rows 27-28;
//     fork slides-skill.ts:1095,1100-1106;
//     server/internal/ai/openai_facade.go:703-713.
var uniworkG609aHiddenSlidesTools = map[string]string{
	"slides/generate_deck":       "genoffice-tools.md §3 (editor_write=yes), §4.7, §5 slides (b)-(c), §8.1, §9 rows 27-29; fork slides-skill.ts:1100-1106; openai_facade.go:705-713",
	"slides/regenerate_slide":    "genoffice-tools.md §3 (editor_write=yes), §4.7, §5 slides (b)-(c), §8.1, §9 rows 27-29; fork slides-skill.ts:1100-1106; openai_facade.go:705-713",
	"slides/insert_web_image":    "genoffice-tools.md §3 (editor_write=yes), §4.7, §5 slides (b), §9 rows 26, 28; fork slides-skill.ts:1100-1106; openai_facade.go:705-713",
	"slides/replace_image":       "genoffice-tools.md §3 (editor_write=yes), §4.7, §5 slides (b), §9 rows 26, 28; fork slides-skill.ts:1100-1106; openai_facade.go:705-713",
	"slides/save_style_template": "genoffice-tools.md §3 (editor_write=no), §3.1 group B, §4.7, §5 slides (c), §9 rows 27-28; fork slides-skill.ts:1100-1106; openai_facade.go:703-713",
}

type genofficeToolSchemasDoc struct {
	Header struct {
		Kind                  string         `json:"kind"`
		Version               int            `json:"version"`
		Rev                   string         `json:"rev"`
		MechanicalBlockSha256 string         `json:"mechanicalBlockSha256"`
		Counts                map[string]int `json:"counts"`
	} `json:"header"`
	Docs      []UniworkToolSpec                 `json:"docs"`
	Sheets    []UniworkToolSpec                 `json:"sheets"`
	Slides    []UniworkToolSpec                 `json:"slides"`
	PDF       []UniworkToolSpec                 `json:"pdf"`
	Markdown  []UniworkToolSpec                 `json:"markdown"`
	HTML      []UniworkToolSpec                 `json:"html"`
	Catalogue []genofficeToolSchemaCatalogueRow `json:"catalogue"`
}

func (d *genofficeToolSchemasDoc) moduleSpecs() map[string][]UniworkToolSpec {
	return map[string][]UniworkToolSpec{
		"docs":     d.Docs,
		"html":     d.HTML,
		"markdown": d.Markdown,
		"pdf":      d.PDF,
		"sheets":   d.Sheets,
		"slides":   d.Slides,
	}
}

type genofficeToolSchemaCatalogueRow struct {
	Module              string  `json:"module"`
	Name                string  `json:"name"`
	Host                string  `json:"host"`
	Source              string  `json:"source"`
	SchemaComplete      bool    `json:"schemaComplete"`
	DescriptionComplete bool    `json:"descriptionComplete"`
	Offered             bool    `json:"offered"`
	Reason              string  `json:"reason,omitempty"`
	InputSchemaSha256   *string `json:"inputSchemaSha256"`
	TableHash           string  `json:"tableHash"`
}

type genofficeExtractRow struct {
	Module      string
	Tool        string
	SchemaHash  string
	EditorWrite string
	Source      string
}

var (
	genofficeExtractRevRE = regexp.MustCompile(`^<!-- genoffice-tools-extract v1 rev=([0-9a-f]{7,64}) -->$`)
	genofficeExtractRowRE = regexp.MustCompile(`^\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|$`)
)

func parseGenofficeExtractBlock(docText string) (rev, blockSha256 string, rows map[string]genofficeExtractRow, err error) {
	normalized := strings.ReplaceAll(docText, "\r\n", "\n")
	lines := strings.Split(normalized, "\n")
	beginIdx, endIdx := -1, -1
	for i, line := range lines {
		if line == "<!-- extract:begin -->" {
			beginIdx = i
			break
		}
	}
	if beginIdx >= 0 {
		for i := beginIdx + 1; i < len(lines); i++ {
			if lines[i] == "<!-- extract:end -->" {
				endIdx = i
				break
			}
		}
	}
	if beginIdx < 0 || endIdx < 0 {
		return "", "", nil, fmt.Errorf("missing <!-- extract:begin --> / <!-- extract:end --> markers")
	}
	blockLines := lines[beginIdx+1 : endIdx]
	sum := sha256.Sum256([]byte(strings.Join(blockLines, "\n") + "\n"))
	blockSha256 = hex.EncodeToString(sum[:])

	if len(blockLines) == 0 {
		return "", "", nil, fmt.Errorf("empty extract block")
	}
	if m := genofficeExtractRevRE.FindStringSubmatch(blockLines[0]); m != nil {
		rev = m[1]
	} else {
		return "", "", nil, fmt.Errorf("invalid extract block header line: %q", blockLines[0])
	}

	rows = make(map[string]genofficeExtractRow)
	for _, line := range blockLines[1:] {
		if strings.TrimSpace(line) == "" {
			continue
		}
		m := genofficeExtractRowRE.FindStringSubmatch(line)
		if m == nil {
			return "", "", nil, fmt.Errorf("malformed line in §3 extract block: %q", line)
		}
		mod, tool, hash, write, src := m[1], m[2], m[3], m[4], m[5]
		if mod == "module" || strings.Trim(mod, "-") == "" {
			continue
		}
		if write != "yes" && write != "no" {
			return "", "", nil, fmt.Errorf("%s/%s: invalid editor_write=%q", mod, tool, write)
		}
		key := mod + "/" + tool
		if _, dup := rows[key]; dup {
			return "", "", nil, fmt.Errorf("duplicate §3 extract row %q", key)
		}
		rows[key] = genofficeExtractRow{
			Module:      mod,
			Tool:        tool,
			SchemaHash:  hash,
			EditorWrite: write,
			Source:      src,
		}
	}
	return rev, blockSha256, rows, nil
}

// crossCheckUniworkTableAgainstSchemas derives each module's Read and Write
// sets from the committed genoffice-tool-schemas.json and §3 mechanical block,
// applying only the documented group-B and G6-09a exceptions, and returns any
// drift findings against the served table.
func crossCheckUniworkTableAgainstSchemas(
	schemasBytes []byte,
	toolsDocText string,
	servedTable map[string]uniworkModuleTools,
	allowlistFn func(module string, offered []UniworkToolSpec, viewOnly bool) UniworkAllowlist,
) (derived map[string]uniworkModuleTools, findings []string) {
	var schemaDoc genofficeToolSchemasDoc
	if err := json.Unmarshal(schemasBytes, &schemaDoc); err != nil {
		return nil, []string{fmt.Sprintf("unmarshal schema JSON: %v", err)}
	}
	blockRev, blockSha256, extractRows, err := parseGenofficeExtractBlock(toolsDocText)
	if err != nil {
		return nil, []string{fmt.Sprintf("parse §3 extract block: %v", err)}
	}
	if schemaDoc.Header.Kind != "genoffice-tool-schemas" || schemaDoc.Header.Version != 1 {
		findings = append(findings, fmt.Sprintf("header kind/version = %q/%d, want genoffice-tool-schemas/1", schemaDoc.Header.Kind, schemaDoc.Header.Version))
	}
	if schemaDoc.Header.Rev != blockRev {
		findings = append(findings, fmt.Sprintf("schema JSON header.rev = %q, §3 block rev = %q", schemaDoc.Header.Rev, blockRev))
	}
	if schemaDoc.Header.MechanicalBlockSha256 != blockSha256 {
		findings = append(findings, fmt.Sprintf("schema JSON header.mechanicalBlockSha256 = %q, §3 block sha256 = %q", schemaDoc.Header.MechanicalBlockSha256, blockSha256))
	}
	if len(schemaDoc.Catalogue) != len(extractRows) {
		findings = append(findings, fmt.Sprintf("schema JSON catalogue has %d rows, §3 block has %d rows", len(schemaDoc.Catalogue), len(extractRows)))
	}

	specsByModule := schemaDoc.moduleSpecs()
	offeredSpecSetByModule := make(map[string]map[string]bool, len(specsByModule))
	for mod, specs := range specsByModule {
		set := make(map[string]bool, len(specs))
		for _, spec := range specs {
			name := spec.Function.Name
			if set[name] {
				findings = append(findings, fmt.Sprintf("%s: duplicate tool %q in schema JSON module array", mod, name))
			}
			set[name] = true
		}
		offeredSpecSetByModule[mod] = set
	}

	catalogueOffered := make(map[string]bool, len(schemaDoc.Catalogue))
	catalogueCountByModule := make(map[string]int, len(specsByModule))
	derived = make(map[string]uniworkModuleTools, len(specsByModule))
	for mod := range specsByModule {
		derived[mod] = uniworkModuleTools{}
	}

	for _, entry := range schemaDoc.Catalogue {
		key := entry.Module + "/" + entry.Name
		catalogueCountByModule[entry.Module]++
		row, ok := extractRows[key]
		if !ok {
			findings = append(findings, fmt.Sprintf("catalogue row %q missing from §3 extract block", key))
			continue
		}
		if entry.TableHash != row.SchemaHash {
			findings = append(findings, fmt.Sprintf("%s: catalogue tableHash %q != §3 input_schema_sha256 %q", key, entry.TableHash, row.SchemaHash))
		}
		if entry.Source != row.Source {
			findings = append(findings, fmt.Sprintf("%s: catalogue source %q != §3 source %q", key, entry.Source, row.Source))
		}
		inModuleArray := offeredSpecSetByModule[entry.Module][entry.Name]
		if entry.Offered != inModuleArray {
			findings = append(findings, fmt.Sprintf("%s: catalogue offered=%v but present in %s array=%v", key, entry.Offered, entry.Module, inModuleArray))
		}
		if !entry.Offered {
			continue
		}
		if !entry.SchemaComplete {
			findings = append(findings, fmt.Sprintf("%s: offered=true with schemaComplete=false", key))
		}
		catalogueOffered[key] = true

		// G6-09a (UNI-1374 N1): slides tools hidden under UniWork AI are omitted
		// from both Read and Write so a call is dropped as not_allowlisted.
		if _, hidden := uniworkG609aHiddenSlidesTools[key]; hidden {
			continue
		}

		_, groupBWrite := uniworkGroupBWriteOverrides[key]
		isWrite := row.EditorWrite == "yes" || groupBWrite
		modTools := derived[entry.Module]
		if isWrite {
			modTools.Write = append(modTools.Write, entry.Name)
		} else {
			modTools.Read = append(modTools.Read, entry.Name)
		}
		derived[entry.Module] = modTools
	}

	for mod, wantCount := range schemaDoc.Header.Counts {
		if got := catalogueCountByModule[mod]; got != wantCount {
			findings = append(findings, fmt.Sprintf("%s: header.counts=%d, catalogue rows=%d", mod, wantCount, got))
		}
	}

	// Every documented exception must match a real offered tool and have the
	// expected mechanical classification, so stale exceptions fail immediately.
	for key := range uniworkGroupBWriteOverrides {
		if !catalogueOffered[key] {
			findings = append(findings, fmt.Sprintf("group-B override %q is not an offered tool in genoffice-tool-schemas.json", key))
			continue
		}
		if row, ok := extractRows[key]; !ok || row.EditorWrite != "no" {
			findings = append(findings, fmt.Sprintf("group-B override %q has §3 editor_write=%q, want \"no\" (if already \"yes\", remove override)", key, row.EditorWrite))
		}
	}
	for key := range uniworkGroupBPdfFileWriteTools {
		if !catalogueOffered[key] {
			findings = append(findings, fmt.Sprintf("group-B pdf file-write tool %q is not an offered tool in genoffice-tool-schemas.json", key))
			continue
		}
		if row, ok := extractRows[key]; !ok || row.EditorWrite != "yes" {
			findings = append(findings, fmt.Sprintf("group-B pdf file-write tool %q has §3 editor_write=%q, want \"yes\"", key, row.EditorWrite))
		}
	}
	for key := range uniworkG609aHiddenSlidesTools {
		if !strings.HasPrefix(key, "slides/") {
			findings = append(findings, fmt.Sprintf("G6-09a hidden slides tool %q is not in module slides", key))
		}
		if !catalogueOffered[key] {
			findings = append(findings, fmt.Sprintf("G6-09a hidden slides tool %q is not an offered tool in genoffice-tool-schemas.json", key))
			continue
		}
		row := extractRows[key]
		_, groupB := uniworkGroupBWriteOverrides[key]
		if row.EditorWrite != "yes" && !groupB {
			findings = append(findings, fmt.Sprintf("G6-09a hidden slides tool %q is neither §3 editor_write=yes nor in uniworkGroupBWriteOverrides", key))
		}
	}

	// Compare module set and per-module Read/Write sets against servedTable and
	// against the live allowlist function fed with the schema JSON's specs.
	derivedMods := make([]string, 0, len(derived))
	for mod := range derived {
		derivedMods = append(derivedMods, mod)
	}
	servedMods := make([]string, 0, len(servedTable))
	for mod := range servedTable {
		servedMods = append(servedMods, mod)
	}
	slices.Sort(derivedMods)
	slices.Sort(servedMods)
	if !slices.Equal(derivedMods, servedMods) {
		findings = append(findings, fmt.Sprintf("served modules = %v, derived modules = %v", servedMods, derivedMods))
	}

	for _, mod := range derivedMods {
		want := derived[mod]
		got, ok := servedTable[mod]
		if !ok {
			continue
		}
		wantRead := append([]string(nil), want.Read...)
		wantWrite := append([]string(nil), want.Write...)
		gotRead := append([]string(nil), got.Read...)
		gotWrite := append([]string(nil), got.Write...)
		slices.Sort(wantRead)
		slices.Sort(wantWrite)
		slices.Sort(gotRead)
		slices.Sort(gotWrite)
		if !slices.Equal(gotRead, wantRead) {
			findings = append(findings, fmt.Sprintf("%s Read = %v, derived from schema JSON + §3 = %v", mod, gotRead, wantRead))
		}
		if !slices.Equal(gotWrite, wantWrite) {
			findings = append(findings, fmt.Sprintf("%s Write = %v, derived from schema JSON + §3 = %v", mod, gotWrite, wantWrite))
		}

		if allowlistFn != nil {
			specs := specsByModule[mod]
			rw := allowlistFn(mod, specs, false)
			var servedRWRead, servedRWWrite []string
			for _, t := range rw.Tools {
				switch t.Kind {
				case ToolRead:
					servedRWRead = append(servedRWRead, t.Name)
				case ToolWrite:
					servedRWWrite = append(servedRWWrite, t.Name)
				}
			}
			slices.Sort(servedRWRead)
			slices.Sort(servedRWWrite)
			if !slices.Equal(servedRWRead, wantRead) {
				findings = append(findings, fmt.Sprintf("%s allowlist(viewOnly=false) served Read = %v, want %v", mod, servedRWRead, wantRead))
			}
			if !slices.Equal(servedRWWrite, wantWrite) {
				findings = append(findings, fmt.Sprintf("%s allowlist(viewOnly=false) served Write = %v, want %v", mod, servedRWWrite, wantWrite))
			}

			ro := allowlistFn(mod, specs, true)
			servedRORead := append([]string(nil), ro.Tools.Names()...)
			servedROWriteNames := append([]string(nil), ro.WriteNames...)
			slices.Sort(servedRORead)
			slices.Sort(servedROWriteNames)
			if !slices.Equal(servedRORead, wantRead) {
				findings = append(findings, fmt.Sprintf("%s allowlist(viewOnly=true) served Read = %v, want %v", mod, servedRORead, wantRead))
			}
			if !slices.Equal(servedROWriteNames, wantWrite) {
				findings = append(findings, fmt.Sprintf("%s allowlist(viewOnly=true) WriteNames = %v, want %v", mod, servedROWriteNames, wantWrite))
			}
		}
	}

	return derived, findings
}

// RBT-5 (UNI-1825, REPIN-1): cross-check officeUniworkModulesV1 and the
// served UniworkModuleAllowlist Read/Write sets against the committed
// docs/office/g5g6g7/genoffice-tool-schemas.json and the §3 mechanical block of
// docs/office/g5g6g7/genoffice-tools.md, with the group-B file-write overrides
// and G6-09a hidden slides tools as explicit, source-cited exception lists.
func TestAIUniworkModuleTableMatchesGeneratedSchemas(t *testing.T) {
	schemasBytes, err := os.ReadFile(genofficeSchemasJSONPath)
	if err != nil {
		t.Fatalf("read %s: %v", genofficeSchemasJSONPath, err)
	}
	toolsDocBytes, err := os.ReadFile(genofficeToolsDocPath)
	if err != nil {
		t.Fatalf("read %s: %v", genofficeToolsDocPath, err)
	}
	facadeGoBytes, err := os.ReadFile(genofficeFacadeGoPath)
	if err != nil {
		t.Fatalf("read %s: %v", genofficeFacadeGoPath, err)
	}

	derived, findings := crossCheckUniworkTableAgainstSchemas(
		schemasBytes,
		string(toolsDocBytes),
		officeUniworkModulesV1,
		UniworkModuleAllowlist,
	)
	if len(findings) != 0 {
		t.Fatalf("UniWork tool allowlist drifted from %s / %s:\n%s",
			genofficeSchemasJSONPath, genofficeToolsDocPath, strings.Join(findings, "\n"))
	}

	var schemaDoc genofficeToolSchemasDoc
	if err := json.Unmarshal(schemasBytes, &schemaDoc); err != nil {
		t.Fatal(err)
	}
	facadeText := string(facadeGoBytes)
	if !strings.Contains(facadeText, schemaDoc.Header.Rev) {
		t.Errorf("openai_facade.go comment does not cite schema JSON header.rev %s", schemaDoc.Header.Rev)
	}
	if !strings.Contains(facadeText, schemaDoc.Header.MechanicalBlockSha256) {
		t.Errorf("openai_facade.go comment does not cite schema JSON header.mechanicalBlockSha256 %s", schemaDoc.Header.MechanicalBlockSha256)
	}

	for module, want := range derived {
		got := officeUniworkModulesV1[module]
		facadeAssertExactNames(t, module, "read (derived from genoffice-tool-schemas.json)", got.Read, want.Read)
		facadeAssertExactNames(t, module, "write (derived from genoffice-tool-schemas.json)", got.Write, want.Write)
	}

	t.Run("negative: dropping generate_mindmap from docs Read is caught", func(t *testing.T) {
		cloned := cloneUniworkModuleTable(officeUniworkModulesV1)
		cloned["docs"] = uniworkModuleTools{
			Read: slices.DeleteFunc(append([]string(nil), cloned["docs"].Read...), func(name string) bool {
				return name == "generate_mindmap"
			}),
			Write: cloned["docs"].Write,
		}
		_, gotFindings := crossCheckUniworkTableAgainstSchemas(schemasBytes, string(toolsDocBytes), cloned, nil)
		if !slices.ContainsFunc(gotFindings, func(f string) bool {
			return strings.Contains(f, "docs Read =") && strings.Contains(f, "generate_mindmap")
		}) {
			t.Fatalf("expected docs Read drift finding for generate_mindmap, got %v", gotFindings)
		}
	})

	t.Run("negative: flipping a row in a temp copy of genoffice-tool-schemas.json is caught", func(t *testing.T) {
		var mutated genofficeToolSchemasDoc
		if err := json.Unmarshal(schemasBytes, &mutated); err != nil {
			t.Fatal(err)
		}
		for i := range mutated.Catalogue {
			if mutated.Catalogue[i].Module == "docs" && mutated.Catalogue[i].Name == "generate_mindmap" {
				mutated.Catalogue[i].Offered = false
			}
		}
		mutated.Docs = slices.DeleteFunc(mutated.Docs, func(spec UniworkToolSpec) bool {
			return spec.Function.Name == "generate_mindmap"
		})
		tmpPath := filepath.Join(t.TempDir(), "genoffice-tool-schemas.json")
		raw, err := json.Marshal(&mutated)
		if err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(tmpPath, raw, 0o600); err != nil {
			t.Fatal(err)
		}
		reRead, err := os.ReadFile(tmpPath)
		if err != nil {
			t.Fatal(err)
		}
		_, gotFindings := crossCheckUniworkTableAgainstSchemas(reRead, string(toolsDocBytes), officeUniworkModulesV1, UniworkModuleAllowlist)
		if !slices.ContainsFunc(gotFindings, func(f string) bool {
			return strings.Contains(f, "docs Read =") && strings.Contains(f, "generate_mindmap")
		}) {
			t.Fatalf("expected docs Read drift finding from temp schema JSON copy, got %v", gotFindings)
		}
	})

	t.Run("negative: re-adding a G6-09a hidden slides tool is caught", func(t *testing.T) {
		cloned := cloneUniworkModuleTable(officeUniworkModulesV1)
		slides := cloned["slides"]
		slides.Write = append(append([]string(nil), slides.Write...), "generate_deck")
		cloned["slides"] = slides
		_, gotFindings := crossCheckUniworkTableAgainstSchemas(schemasBytes, string(toolsDocBytes), cloned, nil)
		if !slices.ContainsFunc(gotFindings, func(f string) bool {
			return strings.Contains(f, "slides Write =") && strings.Contains(f, "generate_deck")
		}) {
			t.Fatalf("expected slides Write drift finding for generate_deck, got %v", gotFindings)
		}
	})
}

func cloneUniworkModuleTable(src map[string]uniworkModuleTools) map[string]uniworkModuleTools {
	out := make(map[string]uniworkModuleTools, len(src))
	for k, v := range src {
		out[k] = uniworkModuleTools{
			Read:  append([]string(nil), v.Read...),
			Write: append([]string(nil), v.Write...),
		}
	}
	return out
}
