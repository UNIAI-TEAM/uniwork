package config

import (
	"reflect"
	"testing"
)

func setDesktopAuthEnv(t *testing.T, clients, clientID, redirects string) {
	t.Helper()
	t.Setenv("DESKTOP_AUTH_CLIENTS", clients)
	t.Setenv("DESKTOP_AUTH_CLIENT_ID", clientID)
	t.Setenv("DESKTOP_AUTH_REDIRECT_URIS", redirects)
	t.Setenv("DESKTOP_AUTH_DEPLOYMENT_IDS", "default")
}

func TestLoadDesktopAuthClientsListsEachClientWithItsRedirects(t *testing.T) {
	setRequired(t)
	setDesktopAuthEnv(t, " uniwork-office=uniwork-office://auth/callback , uniwork-office-dev=uniwork-office-dev://auth/callback|uniwork-office-dev://auth/alt ", "", "")
	c, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	want := []DesktopAuthClient{
		{ID: "uniwork-office", RedirectURIs: []string{"uniwork-office://auth/callback"}},
		{ID: "uniwork-office-dev", RedirectURIs: []string{"uniwork-office-dev://auth/callback", "uniwork-office-dev://auth/alt"}},
	}
	if got := c.DesktopClients(); !reflect.DeepEqual(got, want) {
		t.Fatalf("DesktopClients() = %#v, want %#v", got, want)
	}
}

func TestLoadDesktopAuthLegacySingleClientUnchanged(t *testing.T) {
	setRequired(t)
	setDesktopAuthEnv(t, "", "", "")
	c, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	want := []DesktopAuthClient{{ID: "uniwork-office", RedirectURIs: []string{"uniwork-office://auth/callback"}}}
	if got := c.DesktopClients(); !reflect.DeepEqual(got, want) {
		t.Fatalf("default DesktopClients() = %#v, want %#v", got, want)
	}

	setDesktopAuthEnv(t, "", "uniwork-office-dev", "uniwork-office-dev://auth/callback,uniwork-office-dev://auth/other")
	c, err = Load()
	if err != nil {
		t.Fatal(err)
	}
	want = []DesktopAuthClient{{ID: "uniwork-office-dev", RedirectURIs: []string{"uniwork-office-dev://auth/callback", "uniwork-office-dev://auth/other"}}}
	if got := c.DesktopClients(); !reflect.DeepEqual(got, want) {
		t.Fatalf("legacy DesktopClients() = %#v, want %#v", got, want)
	}
}

func TestDesktopClientsFallsBackToTheLegacyFields(t *testing.T) {
	c := Config{DesktopAuthClientID: "uniwork-office", DesktopAuthRedirectURIs: []string{"uniwork-office://auth/callback"}}
	want := []DesktopAuthClient{{ID: "uniwork-office", RedirectURIs: []string{"uniwork-office://auth/callback"}}}
	if got := c.DesktopClients(); !reflect.DeepEqual(got, want) {
		t.Fatalf("DesktopClients() = %#v, want %#v", got, want)
	}
	if (Config{}).DesktopClients() != nil {
		t.Fatal("an empty config must not invent a client")
	}
}

func TestLoadRejectsMalformedDesktopAuthClients(t *testing.T) {
	cases := map[string]struct{ clients, clientID, redirects string }{
		"empty id":          {clients: "=uniwork-office://auth/callback"},
		"missing equals":    {clients: "uniwork-office"},
		"no redirect":       {clients: "uniwork-office="},
		"empty redirect":    {clients: "uniwork-office=uniwork-office://auth/callback|"},
		"relative redirect": {clients: "uniwork-office=auth/callback"},
		"space in id":       {clients: "uniwork office=uniwork-office://auth/callback"},
		"duplicate id":      {clients: "a=a://auth/callback,a=b://auth/callback"},
		"empty entry":       {clients: "a=a://auth/callback,,b=b://auth/callback"},
		"legacy id too":     {clients: "a=a://auth/callback", clientID: "uniwork-office"},
		"legacy uris too":   {clients: "a=a://auth/callback", redirects: "uniwork-office://auth/callback"},
	}
	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			setRequired(t)
			setDesktopAuthEnv(t, tc.clients, tc.clientID, tc.redirects)
			if _, err := Load(); err == nil {
				t.Fatalf("DESKTOP_AUTH_CLIENTS=%q loaded without an error", tc.clients)
			}
		})
	}
}
