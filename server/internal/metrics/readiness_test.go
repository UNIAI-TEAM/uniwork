package metrics

import (
	"io"
	"net/http/httptest"
	"strings"
	"testing"
)

// The RedisUnreachable alert reads this exact series.
func TestReadinessDependencyGaugeIsExposed(t *testing.T) {
	reg := NewRegistry(RegistryOptions{})
	reg.Readiness.SetDependencyUp("redis", false)
	reg.Readiness.SetDependencyUp("storage", true)
	rec := httptest.NewRecorder()
	NewHandler(reg.Gatherer).ServeHTTP(rec, httptest.NewRequest("GET", "/metrics", nil))
	body, _ := io.ReadAll(rec.Body)
	for _, want := range []string{
		`uniwork_readiness_dependency_up{dependency="redis"} 0`,
		`uniwork_readiness_dependency_up{dependency="storage"} 1`,
	} {
		if !strings.Contains(string(body), want) {
			t.Errorf("missing %s", want)
		}
	}
}
