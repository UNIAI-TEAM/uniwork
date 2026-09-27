package sdo_test

// Contract test for docs/parity/documents-api: until the G1-05a routes exist
// the sample set IS the wire contract (plan §2.6). Every response sample must
// decode into the named SDO type with no unknown fields and must carry every
// field the SDO declares required; every JSON request sample must decode into
// the named SDI type the same way; form/query samples may only name declared
// formData/query tags; and every error_class must have an envelope sample.

import (
	"bytes"
	"encoding/json"
	"io"
	"os"
	"path/filepath"
	"reflect"
	"regexp"
	"strings"
	"testing"

	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdi"
	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdo"
)

var documentsAPIContractDir = filepath.Join("..", "..", "..", "..", "..", "docs", "parity", "documents-api")

type documentsAPIEndpoint struct {
	Name         string `json:"name"`
	Method       string `json:"method"`
	Path         string `json:"path"`
	RequestKind  string `json:"request_kind"`
	Request      string `json:"request"`
	ResponseKind string `json:"response_kind"`
	Response     string `json:"response"`
	SDI          string `json:"sdi"`
	SDO          string `json:"sdo"`
}

type documentsAPIIndex struct {
	ContractVersion string                 `json:"contract_version"`
	Endpoints       []documentsAPIEndpoint `json:"endpoints"`
	ErrorClasses    []string               `json:"error_classes"`
	ErrorSamples    []struct {
		ErrorClass string `json:"error_class"`
		File       string `json:"file"`
	} `json:"error_samples"`
}

var documentsAPISDI = map[string]reflect.Type{
	"CreateDocumentSDI":        reflect.TypeOf(sdi.CreateDocumentSDI{}),
	"PatchDocumentSDI":         reflect.TypeOf(sdi.PatchDocumentSDI{}),
	"CreateDocumentFileSDI":    reflect.TypeOf(sdi.CreateDocumentFileSDI{}),
	"UploadDocumentFileSDI":    reflect.TypeOf(sdi.UploadDocumentFileSDI{}),
	"CommitDocumentVersionSDI": reflect.TypeOf(sdi.CommitDocumentVersionSDI{}),
	"CreateDocumentVersionSDI": reflect.TypeOf(sdi.CreateDocumentVersionSDI{}),
	"UploadDocumentAssetSDI":   reflect.TypeOf(sdi.UploadDocumentAssetSDI{}),
	"ListDocumentVersionsSDI":  reflect.TypeOf(sdi.ListDocumentVersionsSDI{}),
	"DownloadDocumentSDI":      reflect.TypeOf(sdi.DownloadDocumentSDI{}),
}

var documentsAPISDO = map[string]reflect.Type{
	"DocumentSDO":              reflect.TypeOf(sdo.DocumentSDO{}),
	"DocumentUploadSDO":        reflect.TypeOf(sdo.DocumentUploadSDO{}),
	"DocumentVersionSDO":       reflect.TypeOf(sdo.DocumentVersionSDO{}),
	"DocumentVersionListSDO":   reflect.TypeOf(sdo.DocumentVersionListSDO{}),
	"DocumentVersionResultSDO": reflect.TypeOf(sdo.DocumentVersionResultSDO{}),
	"DocumentAssetSDO":         reflect.TypeOf(sdo.DocumentAssetSDO{}),
	"DocumentDownloadSDO":      reflect.TypeOf(sdo.DocumentDownloadSDO{}),
}

func readContractSample(t *testing.T, name string) ([]byte, map[string]any) {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join(documentsAPIContractDir, name))
	if err != nil {
		t.Fatalf("read sample %s: %v", name, err)
	}
	var asMap map[string]any
	if err := json.Unmarshal(raw, &asMap); err != nil {
		t.Fatalf("sample %s is not a JSON object: %v", name, err)
	}
	return raw, asMap
}

func decodeStrict(t *testing.T, raw []byte, typ reflect.Type, sample string) {
	t.Helper()
	target := reflect.New(typ).Interface()
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.DisallowUnknownFields()
	if err := dec.Decode(target); err != nil {
		t.Fatalf("sample %s does not decode into %s: %v", sample, typ.Name(), err)
	}
	if dec.More() {
		t.Fatalf("sample %s has trailing data after %s", sample, typ.Name())
	}
}

// assertRequiredPresent walks the SDO type against the decoded sample: every
// field without omitempty must appear on the wire, recursively through nested
// structs and struct slices. Pointer/omitempty fields are optional; a null
// value satisfies presence.
func assertRequiredPresent(t *testing.T, typ reflect.Type, val any, path string) {
	t.Helper()
	obj, ok := val.(map[string]any)
	if !ok {
		return
	}
	for i := 0; i < typ.NumField(); i++ {
		f := typ.Field(i)
		tag := f.Tag.Get("json")
		if tag == "" || tag == "-" || !f.IsExported() {
			continue
		}
		name, opts, _ := strings.Cut(tag, ",")
		v, present := obj[name]
		if !present {
			if !strings.Contains(opts, "omitempty") {
				t.Errorf("%s: required field %q missing from sample", path, name)
			}
			continue
		}
		ft := f.Type
		if ft.Kind() == reflect.Pointer {
			ft = ft.Elem()
		}
		if v == nil {
			continue
		}
		switch ft.Kind() {
		case reflect.Struct:
			assertRequiredPresent(t, ft, v, path+"."+name)
		case reflect.Slice:
			elem := ft.Elem()
			if elem.Kind() == reflect.Pointer {
				elem = elem.Elem()
			}
			if elem.Kind() != reflect.Struct {
				continue
			}
			if arr, ok := v.([]any); ok {
				for _, item := range arr {
					assertRequiredPresent(t, elem, item, path+"."+name+"[]")
				}
			}
		default:
		}
	}
}

func wireTagSet(typ reflect.Type, tag string) map[string]bool {
	names := map[string]bool{}
	for i := 0; i < typ.NumField(); i++ {
		f := typ.Field(i)
		v := f.Tag.Get(tag)
		if v == "" || v == "-" {
			continue
		}
		name, _, _ := strings.Cut(v, ",")
		names[name] = true
	}
	return names
}

func TestDocumentsAPIContractVersion(t *testing.T) {
	raw, _ := readContractSample(t, "index.json")
	var idx documentsAPIIndex
	if err := json.Unmarshal(raw, &idx); err != nil {
		t.Fatalf("index.json does not decode: %v", err)
	}
	if idx.ContractVersion == "" {
		t.Fatal("contract_version missing")
	}
	if !regexp.MustCompile(`^documents-api/\d+$`).MatchString(idx.ContractVersion) {
		t.Fatalf("contract_version %q does not match documents-api/<n>", idx.ContractVersion)
	}
	if len(idx.Endpoints) == 0 {
		t.Fatal("no endpoints declared")
	}
	if len(idx.ErrorClasses) == 0 || len(idx.ErrorSamples) == 0 {
		t.Fatal("error_classes / error_samples missing")
	}
}

func TestDocumentsAPIEndpointSamples(t *testing.T) {
	raw, _ := readContractSample(t, "index.json")
	var idx documentsAPIIndex
	if err := json.Unmarshal(raw, &idx); err != nil {
		t.Fatalf("index.json does not decode: %v", err)
	}

	sdiCovered := map[string]bool{}
	sdoCovered := map[string]bool{}

	for _, ep := range idx.Endpoints {
		t.Run(ep.Name, func(t *testing.T) {
			if ep.Method == "" || ep.Path == "" {
				t.Fatalf("endpoint %s lacks method/path", ep.Name)
			}
			if !strings.HasPrefix(ep.Path, "/api/v1/") {
				t.Errorf("path %q must start with /api/v1/", ep.Path)
			}

			// Request side.
			switch ep.RequestKind {
			case "json":
				typ, ok := documentsAPISDI[ep.SDI]
				if !ok {
					t.Fatalf("unknown SDI %q", ep.SDI)
				}
				raw, _ := readContractSample(t, ep.Request)
				decodeStrict(t, raw, typ, ep.Request)
				sdiCovered[ep.SDI] = true
			case "form", "query":
				typ, ok := documentsAPISDI[ep.SDI]
				if !ok {
					t.Fatalf("unknown SDI %q", ep.SDI)
				}
				tag := "formData"
				if ep.RequestKind == "query" {
					tag = "query"
				}
				allowed := wireTagSet(typ, tag)
				_, sample := readContractSample(t, ep.Request)
				for key := range sample {
					if !allowed[key] {
						t.Errorf("request %s names %q which is not a %s tag of %s", ep.Request, key, tag, ep.SDI)
					}
				}
				sdiCovered[ep.SDI] = true
			case "none":
				if ep.Request != "" {
					t.Errorf("request_kind none but request file %q declared", ep.Request)
				}
			default:
				t.Fatalf("request_kind %q unknown", ep.RequestKind)
			}

			// Response side.
			switch ep.ResponseKind {
			case "json":
				typ, ok := documentsAPISDO[ep.SDO]
				if !ok {
					t.Fatalf("unknown SDO %q", ep.SDO)
				}
				raw, sample := readContractSample(t, ep.Response)
				decodeStrict(t, raw, typ, ep.Response)
				assertRequiredPresent(t, typ, sample, ep.SDO)
				sdoCovered[ep.SDO] = true
			case "stream":
				if ep.Response != "" || ep.SDO != "" {
					t.Errorf("stream endpoint %s must not declare a JSON response", ep.Name)
				}
			default:
				t.Fatalf("response_kind %q unknown", ep.ResponseKind)
			}
		})
	}

	for name := range documentsAPISDI {
		if !sdiCovered[name] {
			t.Errorf("SDI %s is not exercised by any endpoint sample", name)
		}
	}
	for name := range documentsAPISDO {
		if !sdoCovered[name] {
			t.Errorf("SDO %s is not exercised by any endpoint sample", name)
		}
	}
}

func TestDocumentsAPIErrorSamples(t *testing.T) {
	raw, _ := readContractSample(t, "index.json")
	var idx documentsAPIIndex
	if err := json.Unmarshal(raw, &idx); err != nil {
		t.Fatalf("index.json does not decode: %v", err)
	}

	declared := map[string]bool{}
	for _, c := range idx.ErrorClasses {
		declared[c] = true
	}
	seen := map[string]bool{}
	for _, es := range idx.ErrorSamples {
		t.Run("error_"+es.ErrorClass, func(t *testing.T) {
			if !declared[es.ErrorClass] {
				t.Fatalf("error sample for undeclared class %q", es.ErrorClass)
			}
			if seen[es.ErrorClass] {
				t.Fatalf("duplicate sample for error_class %q", es.ErrorClass)
			}
			seen[es.ErrorClass] = true

			raw, _ := readContractSample(t, es.File)
			var env sdo.ErrorSDO
			dec := json.NewDecoder(bytes.NewReader(raw))
			dec.DisallowUnknownFields()
			if err := dec.Decode(&env); err != nil {
				t.Fatalf("%s does not decode into the error envelope: %v", es.File, err)
			}
			if env.Error.Code == "" || env.Error.Message == "" {
				t.Errorf("%s lacks error.code / error.message", es.File)
			}
			if env.Error.ErrorClass != es.ErrorClass {
				t.Errorf("%s error_class = %q, want %q", es.File, env.Error.ErrorClass, es.ErrorClass)
			}
		})
	}
	for _, c := range idx.ErrorClasses {
		if !seen[c] {
			t.Errorf("error_class %q has no sample", c)
		}
	}
}

func TestDocumentsAPISamplesAreUTF8JSON(t *testing.T) {
	entries, err := os.ReadDir(documentsAPIContractDir)
	if err != nil {
		t.Fatalf("read contract dir: %v", err)
	}
	count := 0
	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(e.Name(), ".json") {
			continue
		}
		count++
		raw, err := os.ReadFile(filepath.Join(documentsAPIContractDir, e.Name()))
		if err != nil {
			t.Fatalf("read %s: %v", e.Name(), err)
		}
		if !json.Valid(raw) {
			t.Errorf("%s is not valid JSON", e.Name())
		}
		var v any
		if err := json.Unmarshal(raw, &v); err != nil {
			t.Fatalf("%s: %v", e.Name(), err)
		}
		if _, ok := v.(map[string]any); !ok {
			t.Errorf("%s must be a JSON object at top level", e.Name())
		}
		// No trailing garbage.
		dec := json.NewDecoder(bytes.NewReader(raw))
		if err := dec.Decode(&v); err != nil {
			t.Fatalf("%s: %v", e.Name(), err)
		}
		if dec.More() {
			var rest any
			if err := dec.Decode(&rest); err != io.EOF {
				t.Errorf("%s has trailing data", e.Name())
			}
		}
	}
	if count == 0 {
		t.Fatal("no contract samples found")
	}
}
