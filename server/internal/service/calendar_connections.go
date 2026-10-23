package service

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
	"golang.org/x/oauth2"

	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/config"
	"github.com/unicomhub/uniwork/server/internal/util"
	"github.com/unicomhub/uniwork/server/internal/util/secretbox"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

var ErrCalendarProviderNotConfigured = errors.New("calendar provider is not configured")

type CalendarConnectionView struct {
	Provider, Email     string
	SelectedCalendarIDs []string
}

type ExternalCalendar struct {
	ID, Name, Color             string
	Primary, Selected, ReadOnly bool
}

type CalendarOAuthState struct {
	WorkspaceID string `json:"workspace_id"`
	UserID      string `json:"user_id"`
	Provider    string `json:"provider"`
	ExpiresAt   int64  `json:"expires_at"`
}

type CalendarConnectionService struct {
	pool *pgxpool.Pool
	q    *db.Queries
	ws   *WorkspaceService
	box  *secretbox.Box
	cfg  config.Config
	http *http.Client
}

func NewCalendarConnectionService(pool *pgxpool.Pool, q *db.Queries, ws *WorkspaceService, box *secretbox.Box, cfg config.Config) *CalendarConnectionService {
	return &CalendarConnectionService{pool: pool, q: q, ws: ws, box: box, cfg: cfg, http: &http.Client{Timeout: 15 * time.Second}}
}

func (s *CalendarConnectionService) oauthConfig(provider string) (*oauth2.Config, error) {
	var clientID, secret string
	var endpoint oauth2.Endpoint
	var scopes []string
	switch provider {
	case "google":
		clientID, secret = s.cfg.GoogleClientID, s.cfg.GoogleClientSecret
		endpoint = oauth2.Endpoint{AuthURL: "https://accounts.google.com/o/oauth2/v2/auth", TokenURL: "https://oauth2.googleapis.com/token"}
		scopes = []string{"openid", "email", "https://www.googleapis.com/auth/calendar.readonly"}
	case "outlook":
		clientID, secret = s.cfg.MicrosoftCalendarClientID, s.cfg.MicrosoftCalendarClientSecret
		endpoint = oauth2.Endpoint{AuthURL: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize", TokenURL: "https://login.microsoftonline.com/common/oauth2/v2.0/token"}
		scopes = []string{"openid", "email", "offline_access", "https://graph.microsoft.com/User.Read", "https://graph.microsoft.com/Calendars.Read"}
	default:
		return nil, Invalid("unsupported calendar provider")
	}
	if s.box == nil || clientID == "" || secret == "" {
		return nil, ErrCalendarProviderNotConfigured
	}
	return &oauth2.Config{ClientID: clientID, ClientSecret: secret, Endpoint: endpoint, RedirectURL: s.cfg.CalendarRedirectURL(provider), Scopes: scopes}, nil
}

func (s *CalendarConnectionService) Start(ctx context.Context, workspaceID, userID, provider string) (string, error) {
	if _, err := s.ws.RequireMember(ctx, workspaceID, userID); err != nil {
		return "", err
	}
	cfg, err := s.oauthConfig(provider)
	if err != nil {
		return "", err
	}
	raw, _ := json.Marshal(CalendarOAuthState{WorkspaceID: workspaceID, UserID: userID, Provider: provider, ExpiresAt: time.Now().Add(10 * time.Minute).Unix()})
	sealed, err := s.box.Seal(raw)
	if err != nil {
		return "", err
	}
	state := base64.RawURLEncoding.EncodeToString(sealed)
	opts := []oauth2.AuthCodeOption{oauth2.AccessTypeOffline}
	if provider == "google" {
		opts = append(opts, oauth2.SetAuthURLParam("prompt", "consent select_account"))
	}
	return cfg.AuthCodeURL(state, opts...), nil
}

func (s *CalendarConnectionService) Complete(ctx context.Context, currentUser, provider, state, code string) (CalendarConnectionView, error) {
	sealed, err := base64.RawURLEncoding.DecodeString(state)
	if err != nil {
		return CalendarConnectionView{}, Invalid("invalid oauth state")
	}
	raw, err := s.box.Open(sealed)
	if err != nil {
		return CalendarConnectionView{}, Invalid("invalid oauth state")
	}
	var st CalendarOAuthState
	if json.Unmarshal(raw, &st) != nil || (currentUser != "" && st.UserID != currentUser) || st.Provider != provider || time.Now().Unix() > st.ExpiresAt {
		return CalendarConnectionView{}, Invalid("expired oauth state")
	}
	currentUser = st.UserID
	if _, err := s.ws.RequireMember(ctx, st.WorkspaceID, currentUser); err != nil {
		return CalendarConnectionView{}, err
	}
	ws, err := s.q.GetWorkspaceByID(ctx, st.WorkspaceID)
	if err != nil {
		return CalendarConnectionView{}, err
	}
	cfg, err := s.oauthConfig(provider)
	if err != nil {
		return CalendarConnectionView{}, err
	}
	tok, err := cfg.Exchange(ctx, code)
	if err != nil {
		return CalendarConnectionView{}, fmt.Errorf("calendar oauth exchange: %w", err)
	}
	client := cfg.Client(ctx, tok)
	email, err := providerEmail(ctx, client, provider)
	if err != nil {
		return CalendarConnectionView{}, err
	}
	if strings.TrimSpace(email) == "" {
		return CalendarConnectionView{}, fmt.Errorf("calendar provider did not return an account email")
	}
	calendars, err := providerCalendars(ctx, client, provider)
	if err != nil {
		return CalendarConnectionView{}, err
	}
	selected := make([]string, 0, 1)
	for _, c := range calendars {
		if c.Primary {
			selected = append(selected, c.ID)
			break
		}
	}
	if len(selected) == 0 && len(calendars) > 0 {
		selected = append(selected, calendars[0].ID)
	}
	access, err := s.seal(tok.AccessToken)
	if err != nil {
		return CalendarConnectionView{}, err
	}
	if tok.RefreshToken == "" {
		if existing, existingErr := s.q.GetCalendarConnection(ctx, db.GetCalendarConnectionParams{OrganizationID: ws.OrganizationID, WorkspaceID: st.WorkspaceID, UserID: currentUser, Provider: provider}); existingErr == nil {
			tok.RefreshToken, _ = s.open(existing.RefreshTokenEnc)
		}
	}
	if tok.RefreshToken == "" {
		return CalendarConnectionView{}, fmt.Errorf("calendar provider did not return an offline refresh token")
	}
	refresh, err := s.seal(tok.RefreshToken)
	if err != nil {
		return CalendarConnectionView{}, err
	}
	selectedJSON, _ := json.Marshal(selected)
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return CalendarConnectionView{}, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	qtx := s.q.WithTx(tx)
	row, err := qtx.UpsertCalendarConnection(ctx, db.UpsertCalendarConnectionParams{ID: util.NewID(), OrganizationID: ws.OrganizationID, WorkspaceID: st.WorkspaceID, UserID: currentUser, Provider: provider, AccountEmail: email, AccessTokenEnc: access, RefreshTokenEnc: refresh, AccessTokenExpiresAt: pgtype.Timestamptz{Time: tok.Expiry, Valid: true}, SelectedCalendarIds: selectedJSON})
	if err != nil {
		return CalendarConnectionView{}, err
	}
	if err := auditRecorder.Record(ctx, qtx, audit.Entry{
		OrganizationID: ws.OrganizationID, WorkspaceID: st.WorkspaceID, Actor: Human(currentUser),
		Action: audit.ActionCalendarConnected, ResourceType: "calendar_connection", ResourceID: row.ID,
		Metadata: map[string]any{"provider": provider},
	}); err != nil {
		return CalendarConnectionView{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return CalendarConnectionView{}, err
	}
	return connectionView(row), nil
}

func (s *CalendarConnectionService) List(ctx context.Context, workspaceID, userID string) ([]CalendarConnectionView, error) {
	ws, err := s.memberWorkspace(ctx, workspaceID, userID)
	if err != nil {
		return nil, err
	}
	rows, err := s.q.ListCalendarConnections(ctx, db.ListCalendarConnectionsParams{OrganizationID: ws.OrganizationID, WorkspaceID: workspaceID, UserID: userID})
	if err != nil {
		return nil, err
	}
	out := make([]CalendarConnectionView, 0, len(rows))
	for _, row := range rows {
		out = append(out, connectionView(row))
	}
	return out, nil
}

func (s *CalendarConnectionService) Calendars(ctx context.Context, workspaceID, userID, provider string) ([]ExternalCalendar, error) {
	row, cfg, tok, err := s.connectionToken(ctx, workspaceID, userID, provider)
	if err != nil {
		return nil, err
	}
	client := cfg.Client(ctx, tok)
	items, err := providerCalendars(ctx, client, provider)
	if err != nil {
		return nil, err
	}
	selected := decodeSelection(row.SelectedCalendarIds)
	chosen := map[string]bool{}
	for _, id := range selected {
		chosen[id] = true
	}
	for i := range items {
		items[i].Selected = chosen[items[i].ID]
	}
	return items, nil
}

func (s *CalendarConnectionService) Select(ctx context.Context, workspaceID, userID, provider string, ids []string) error {
	ws, err := s.memberWorkspace(ctx, workspaceID, userID)
	if err != nil {
		return err
	}
	row, _, _, err := s.connectionToken(ctx, workspaceID, userID, provider)
	if err != nil {
		return err
	}
	available, err := s.Calendars(ctx, workspaceID, userID, provider)
	if err != nil {
		return err
	}
	allowed := make(map[string]bool, len(available))
	for _, calendar := range available {
		allowed[calendar.ID] = true
	}
	unique := make([]string, 0, len(ids))
	seen := map[string]bool{}
	for _, id := range ids {
		if !allowed[id] {
			return Invalid("calendar is not available to this account")
		}
		if !seen[id] {
			unique = append(unique, id)
			seen[id] = true
		}
	}
	raw, _ := json.Marshal(unique)
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	qtx := s.q.WithTx(tx)
	if err := qtx.UpdateCalendarConnectionSelection(ctx, db.UpdateCalendarConnectionSelectionParams{OrganizationID: ws.OrganizationID, WorkspaceID: workspaceID, UserID: userID, Provider: provider, SelectedCalendarIds: raw}); err != nil {
		return err
	}
	if err := auditRecorder.Record(ctx, qtx, audit.Entry{
		OrganizationID: ws.OrganizationID, WorkspaceID: workspaceID, Actor: Human(userID),
		Action: audit.ActionCalendarSelectionUpdated, ResourceType: "calendar_connection", ResourceID: row.ID,
		Metadata: map[string]any{"provider": provider, "calendar_count": len(unique)},
	}); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (s *CalendarConnectionService) Disconnect(ctx context.Context, workspaceID, userID, provider string) error {
	ws, err := s.memberWorkspace(ctx, workspaceID, userID)
	if err != nil {
		return err
	}
	row, err := s.q.GetCalendarConnection(ctx, db.GetCalendarConnectionParams{OrganizationID: ws.OrganizationID, WorkspaceID: workspaceID, UserID: userID, Provider: provider})
	if err != nil {
		return err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	qtx := s.q.WithTx(tx)
	if _, err = qtx.DisconnectCalendarConnection(ctx, db.DisconnectCalendarConnectionParams{OrganizationID: ws.OrganizationID, WorkspaceID: workspaceID, UserID: userID, Provider: provider}); err != nil {
		return err
	}
	if err := auditRecorder.Record(ctx, qtx, audit.Entry{
		OrganizationID: ws.OrganizationID, WorkspaceID: workspaceID, Actor: Human(userID),
		Action: audit.ActionCalendarDisconnected, ResourceType: "calendar_connection", ResourceID: row.ID,
		Metadata: map[string]any{"provider": provider},
	}); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (s *CalendarConnectionService) Events(ctx context.Context, workspaceID, userID string, from, to time.Time) ([]CalendarEvent, error) {
	connections, err := s.List(ctx, workspaceID, userID)
	if err != nil {
		return nil, err
	}
	out := []CalendarEvent{}
	for _, connection := range connections {
		_, cfg, tok, tokenErr := s.connectionToken(ctx, workspaceID, userID, connection.Provider)
		if tokenErr != nil {
			continue
		}
		client := cfg.Client(ctx, tok)
		for _, calendarID := range connection.SelectedCalendarIDs {
			items, err := providerEvents(ctx, client, connection.Provider, calendarID, from, to)
			if err != nil {
				continue
			}
			for _, item := range items {
				if ev, ok := item.calendarEvent(connection.Provider, calendarID); ok {
					out = append(out, ev)
				}
			}
		}
	}
	return out, nil
}

type providerDate struct {
	Date     string `json:"date"`
	DateTime string `json:"dateTime"`
	TimeZone string `json:"timeZone"`
}
type providerEvent struct {
	ID          string       `json:"id"`
	Summary     string       `json:"summary"`
	Subject     string       `json:"subject"`
	Status      string       `json:"status"`
	IsCancelled bool         `json:"isCancelled"`
	IsAllDay    bool         `json:"isAllDay"`
	HTMLLink    string       `json:"htmlLink"`
	WebLink     string       `json:"webLink"`
	Start       providerDate `json:"start"`
	End         providerDate `json:"end"`
}

func (e providerEvent) calendarEvent(provider, calendarID string) (CalendarEvent, bool) {
	if e.Status == "cancelled" || e.IsCancelled {
		return CalendarEvent{}, false
	}
	title := e.Summary
	if title == "" {
		title = e.Subject
	}
	start, end, allDay := e.Start.DateTime, e.End.DateTime, e.IsAllDay
	if allDay {
		start = providerDateOnly(start)
		end = providerDateOnly(end)
	}
	if provider == "outlook" && e.Start.TimeZone == "UTC" && start != "" && !strings.HasSuffix(start, "Z") {
		start += "Z"
	}
	if provider == "outlook" && e.End.TimeZone == "UTC" && end != "" && !strings.HasSuffix(end, "Z") {
		end += "Z"
	}
	if e.Start.Date != "" {
		start, allDay = e.Start.Date, true
	}
	if e.End.Date != "" {
		end = e.End.Date
	}
	if start == "" {
		return CalendarEvent{}, false
	}
	link := e.HTMLLink
	if link == "" {
		link = e.WebLink
	}
	entity := calendarID + ":" + e.ID
	return CalendarEvent{ID: provider + ":" + entity, Kind: "external", EntityID: entity, Title: title, Start: start, End: calendarStrPtr(end), AllDay: allDay, Provider: calendarStrPtr(provider), ExternalURL: calendarStrPtr(link)}, true
}

func (s *CalendarConnectionService) memberWorkspace(ctx context.Context, workspaceID, userID string) (db.Workspace, error) {
	if _, err := s.ws.RequireMember(ctx, workspaceID, userID); err != nil {
		return db.Workspace{}, err
	}
	return s.q.GetWorkspaceByID(ctx, workspaceID)
}

func (s *CalendarConnectionService) connectionToken(ctx context.Context, workspaceID, userID, provider string) (db.CalendarConnection, *oauth2.Config, *oauth2.Token, error) {
	ws, err := s.memberWorkspace(ctx, workspaceID, userID)
	if err != nil {
		return db.CalendarConnection{}, nil, nil, err
	}
	row, err := s.q.GetCalendarConnection(ctx, db.GetCalendarConnectionParams{OrganizationID: ws.OrganizationID, WorkspaceID: workspaceID, UserID: userID, Provider: provider})
	if errors.Is(err, pgx.ErrNoRows) {
		return row, nil, nil, ErrNotFound
	}
	if err != nil {
		return row, nil, nil, err
	}
	cfg, err := s.oauthConfig(provider)
	if err != nil {
		return row, nil, nil, err
	}
	access, err := s.open(row.AccessTokenEnc)
	if err != nil {
		return row, nil, nil, err
	}
	refresh, err := s.open(row.RefreshTokenEnc)
	if err != nil {
		return row, nil, nil, err
	}
	old := &oauth2.Token{AccessToken: access, RefreshToken: refresh, Expiry: row.AccessTokenExpiresAt.Time}
	tok, err := cfg.TokenSource(ctx, old).Token()
	if err != nil {
		return row, nil, nil, fmt.Errorf("calendar token refresh: %w", err)
	}
	if tok.AccessToken != old.AccessToken || (tok.RefreshToken != "" && tok.RefreshToken != old.RefreshToken) {
		if tok.RefreshToken == "" {
			tok.RefreshToken = old.RefreshToken
		}
		a, err := s.seal(tok.AccessToken)
		if err != nil {
			return row, nil, nil, err
		}
		r, err := s.seal(tok.RefreshToken)
		if err != nil {
			return row, nil, nil, err
		}
		if err := s.q.UpdateCalendarConnectionTokens(ctx, db.UpdateCalendarConnectionTokensParams{OrganizationID: ws.OrganizationID, WorkspaceID: workspaceID, UserID: userID, Provider: provider, AccessTokenEnc: a, RefreshTokenEnc: r, AccessTokenExpiresAt: pgtype.Timestamptz{Time: tok.Expiry, Valid: true}}); err != nil {
			return row, nil, nil, err
		}
	}
	return row, cfg, tok, nil
}

func (s *CalendarConnectionService) seal(v string) (string, error) {
	b, err := s.box.Seal([]byte(v))
	return base64.StdEncoding.EncodeToString(b), err
}
func (s *CalendarConnectionService) open(v string) (string, error) {
	b, err := base64.StdEncoding.DecodeString(v)
	if err != nil {
		return "", err
	}
	p, err := s.box.Open(b)
	return string(p), err
}
func connectionView(row db.CalendarConnection) CalendarConnectionView {
	return CalendarConnectionView{Provider: row.Provider, Email: row.AccountEmail, SelectedCalendarIDs: decodeSelection(row.SelectedCalendarIds)}
}
func decodeSelection(raw []byte) []string {
	var ids []string
	if json.Unmarshal(raw, &ids) != nil {
		return []string{}
	}
	return ids
}

func providerEmail(ctx context.Context, client *http.Client, provider string) (string, error) {
	endpoint := "https://www.googleapis.com/oauth2/v2/userinfo"
	if provider == "outlook" {
		endpoint = "https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName"
	}
	var v struct {
		Email             string `json:"email"`
		Mail              string `json:"mail"`
		UserPrincipalName string `json:"userPrincipalName"`
	}
	if err := getJSON(ctx, client, endpoint, &v); err != nil {
		return "", err
	}
	if v.Email != "" {
		return v.Email, nil
	}
	if v.Mail != "" {
		return v.Mail, nil
	}
	return v.UserPrincipalName, nil
}

func providerCalendars(ctx context.Context, client *http.Client, provider string) ([]ExternalCalendar, error) {
	if provider == "google" {
		type page struct {
			Items []struct {
				ID, Summary, BackgroundColor, AccessRole string
				Primary                                  bool
			} `json:"items"`
			NextPageToken string `json:"nextPageToken"`
		}
		out := []ExternalCalendar{}
		endpoint := "https://www.googleapis.com/calendar/v3/users/me/calendarList?maxResults=250"
		for pageNumber := 0; endpoint != "" && pageNumber < 20; pageNumber++ {
			var v page
			if err := getJSON(ctx, client, endpoint, &v); err != nil {
				return nil, err
			}
			for _, c := range v.Items {
				out = append(out, ExternalCalendar{ID: c.ID, Name: c.Summary, Color: c.BackgroundColor, Primary: c.Primary, ReadOnly: c.AccessRole == "reader" || c.AccessRole == "freeBusyReader"})
			}
			if v.NextPageToken == "" {
				endpoint = ""
			} else {
				endpoint = "https://www.googleapis.com/calendar/v3/users/me/calendarList?maxResults=250&pageToken=" + url.QueryEscape(v.NextPageToken)
			}
		}
		return out, nil
	}
	type page struct {
		Value []struct {
			ID, Name, HexColor         string
			IsDefaultCalendar, CanEdit bool
		} `json:"value"`
		Next string `json:"@odata.nextLink"`
	}
	out := []ExternalCalendar{}
	endpoint := "https://graph.microsoft.com/v1.0/me/calendars?$select=id,name,color,hexColor,isDefaultCalendar,canEdit"
	for pageNumber := 0; endpoint != "" && pageNumber < 20; pageNumber++ {
		var v page
		if err := getJSON(ctx, client, endpoint, &v); err != nil {
			return nil, err
		}
		for _, c := range v.Value {
			out = append(out, ExternalCalendar{ID: c.ID, Name: c.Name, Color: c.HexColor, Primary: c.IsDefaultCalendar, ReadOnly: !c.CanEdit})
		}
		nextURL, err := providerNextPageURL(v.Next, "graph.microsoft.com")
		if err != nil {
			return nil, err
		}
		endpoint = nextURL
	}
	return out, nil
}

func providerEvents(ctx context.Context, client *http.Client, provider, calendarID string, from, to time.Time) ([]providerEvent, error) {
	endpoint := calendarViewURL(provider, calendarID, from, to)
	out := []providerEvent{}
	for pageNumber := 0; endpoint != "" && pageNumber < 20; pageNumber++ {
		var raw map[string]json.RawMessage
		if err := getJSON(ctx, client, endpoint, &raw); err != nil {
			return nil, err
		}
		key, nextKey := "items", "nextPageToken"
		if provider == "outlook" {
			key, nextKey = "value", "@odata.nextLink"
		}
		var items []providerEvent
		if err := json.Unmarshal(raw[key], &items); err != nil {
			return nil, err
		}
		out = append(out, items...)
		var next string
		_ = json.Unmarshal(raw[nextKey], &next)
		if next == "" {
			endpoint = ""
		} else if provider == "google" {
			separator := "&"
			endpoint = calendarViewURL(provider, calendarID, from, to) + separator + "pageToken=" + url.QueryEscape(next)
		} else {
			nextURL, err := providerNextPageURL(next, "graph.microsoft.com")
			if err != nil {
				return nil, err
			}
			endpoint = nextURL
		}
	}
	return out, nil
}

func providerDateOnly(value string) string {
	if len(value) < len("2006-01-02") {
		return value
	}
	date := value[:len("2006-01-02")]
	if _, err := time.Parse("2006-01-02", date); err != nil {
		return value
	}
	return date
}

func providerNextPageURL(value, allowedHost string) (string, error) {
	if value == "" {
		return "", nil
	}
	parsed, err := url.Parse(value)
	if err != nil || parsed.Scheme != "https" || !strings.EqualFold(parsed.Hostname(), allowedHost) {
		return "", fmt.Errorf("calendar provider returned an invalid pagination URL")
	}
	return parsed.String(), nil
}

func getJSON(ctx context.Context, client *http.Client, endpoint string, out any) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return err
	}
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("calendar provider returned %s", resp.Status)
	}
	return json.NewDecoder(resp.Body).Decode(out)
}

func calendarViewURL(provider, calendarID string, from, to time.Time) string {
	if provider == "google" {
		q := url.Values{"timeMin": {from.UTC().Format(time.RFC3339)}, "timeMax": {to.UTC().Format(time.RFC3339)}, "singleEvents": {"true"}, "maxResults": {"2500"}}
		return "https://www.googleapis.com/calendar/v3/calendars/" + url.PathEscape(calendarID) + "/events?" + q.Encode()
	}
	q := url.Values{"startDateTime": {from.UTC().Format(time.RFC3339)}, "endDateTime": {to.UTC().Format(time.RFC3339)}, "$top": {"1000"}}
	return "https://graph.microsoft.com/v1.0/me/calendars/" + url.PathEscape(calendarID) + "/calendarView?" + q.Encode()
}
