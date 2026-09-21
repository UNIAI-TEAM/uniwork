package main

import (
	"bufio"
	"os"
	"strings"
)

// tryLoadDevEnv reads a local .env for keys not already in the process
// environment. Production and CI set vars explicitly; this helps `go run`
// from server/ on Windows where run-app.sh does not source .env.
func tryLoadDevEnv() {
	if env := strings.ToLower(strings.TrimSpace(os.Getenv("APP_ENV"))); env == "production" || env == "staging" {
		return
	}
	for _, path := range []string{".env", "../.env", "../../.env", "../../../.env"} {
		loadEnvFile(path)
	}
}

func loadEnvFile(path string) bool {
	f, err := os.Open(path)
	if err != nil {
		return false
	}
	defer f.Close()

	sc := bufio.NewScanner(f)
	for sc.Scan() {
		line := strings.TrimSpace(sc.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		key, val, ok := strings.Cut(line, "=")
		if !ok {
			continue
		}
		key = strings.TrimSpace(key)
		if key == "" || os.Getenv(key) != "" {
			continue
		}
		val = strings.TrimSpace(val)
		if len(val) >= 2 {
			if (val[0] == '"' && val[len(val)-1] == '"') || (val[0] == '\'' && val[len(val)-1] == '\'') {
				val = val[1 : len(val)-1]
			}
		}
		_ = os.Setenv(key, val)
	}
	return true
}
