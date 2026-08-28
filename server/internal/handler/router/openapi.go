package router

import (
	"encoding/json"
	"fmt"
	"net/http"
	"regexp"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/swaggest/openapi-go"
	"github.com/swaggest/openapi-go/openapi3"
	httpSwagger "github.com/swaggo/http-swagger/v2"

	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdo"
)

// apiOp is the common OpenAPI description for one Chi route: method+path
// come from the router, SDI/SDO from the handler's request/response types.
type apiOp struct {
	summary     string
	description string
	tags        []string
	sdi         any
	sdo         any
	status      int
	auth        bool
}

type apiCatalog struct {
	ops []struct {
		method string
		path   string
		apiOp
	}
}

func (c *apiCatalog) add(method, path string, op apiOp) {
	c.ops = append(c.ops, struct {
		method string
		path   string
		apiOp
	}{method: method, path: path, apiOp: op})
}

func (c *apiCatalog) marshalJSON() ([]byte, error) {
	reflector := openapi3.Reflector{}
	reflector.Spec = &openapi3.Spec{Openapi: "3.0.3"}
	reflector.Spec.Info.
		WithTitle("UniWork API").
		WithVersion("1.0").
		WithDescription("HTTP API for UniWork. Access tokens go in Authorization as Bearer <jwt>. Register and login also set the HttpOnly cookie uniwork_refresh on /api/v1/auth.")
	reflector.SpecEns().SetHTTPBearerTokenSecurity("BearerAuth", "JWT", "JWT access token")

	for _, op := range c.ops {
		oc, err := reflector.NewOperationContext(op.method, op.path)
		if err != nil {
			return nil, err
		}
		oc.SetSummary(op.summary)
		if op.description != "" {
			oc.SetDescription(op.description)
		}
		if len(op.tags) > 0 {
			oc.SetTags(op.tags...)
		}
		if op.sdi != nil {
			oc.AddReqStructure(op.sdi)
		}
		if pathParamRE.MatchString(op.path) {
			ps := pathParamSDI(op.path)
			if ps == nil {
				return nil, fmt.Errorf("openapi: add pathParamSDI case for %s", op.path)
			}
			oc.AddReqStructure(ps)
		}
		status := op.status
		if status == 0 {
			status = http.StatusOK
		}
		if op.sdo != nil {
			oc.AddRespStructure(op.sdo, func(cu *openapi.ContentUnit) { cu.HTTPStatus = status })
		}
		oc.AddRespStructure(new(sdo.ErrorSDO), func(cu *openapi.ContentUnit) { cu.HTTPStatus = http.StatusBadRequest })
		if op.auth {
			oc.AddSecurity("BearerAuth")
			oc.AddRespStructure(new(sdo.ErrorSDO), func(cu *openapi.ContentUnit) { cu.HTTPStatus = http.StatusUnauthorized })
		}
		if err := reflector.AddOperation(oc); err != nil {
			return nil, err
		}
	}
	return json.Marshal(reflector.Spec)
}

var pathParamRE = regexp.MustCompile(`\{([^}/]+)\}`)

func pathParamSDI(path string) any {
	names := pathParamRE.FindAllStringSubmatch(path, -1)
	if len(names) == 0 {
		return nil
	}
	keys := make([]string, 0, len(names))
	for _, m := range names {
		keys = append(keys, m[1])
	}
	switch strings.Join(keys, ",") {
	case "org":
		return struct {
			Org string `path:"org" description:"Slug tổ chức" example:"acme"`
		}{}
	case "org,wsSlug":
		return struct {
			Org    string `path:"org" description:"Slug tổ chức" example:"acme"`
			WsSlug string `path:"wsSlug" description:"Slug workspace" example:"team"`
		}{}
	case "workspaceID":
		return struct {
			WorkspaceID string `path:"workspaceID" description:"ULID workspace" example:"01J8X4WS0N1P2Q3R4S5T6U7V8"`
		}{}
	case "taskID":
		return struct {
			TaskID string `path:"taskID" description:"ULID công việc" example:"01J8X4TASKN1P2Q3R4S5T6U7"`
		}{}
	case "meetingID":
		return struct {
			MeetingID string `path:"meetingID" description:"ULID cuộc họp" example:"01J8X4MTGN1P2Q3R4S5T6U7V"`
		}{}
	case "participantID":
		return struct {
			ParticipantID string `path:"participantID" description:"ULID người tham dự" example:"01J8X4PARTN1P2Q3R4S5T6"`
		}{}
	case "meetingID,participantID":
		return struct {
			MeetingID     string `path:"meetingID" description:"ULID cuộc họp" example:"01J8X4MTGN1P2Q3R4S5T6U7V"`
			ParticipantID string `path:"participantID" description:"ULID người tham dự" example:"01J8X4PARTN1P2Q3R4S5T6"`
		}{}
	case "meetingID,invitationID":
		return struct {
			MeetingID    string `path:"meetingID" description:"ULID cuộc họp" example:"01J8X4MTGN1P2Q3R4S5T6U7V"`
			InvitationID string `path:"invitationID" description:"ULID lời mời" example:"01J8X4INVN1P2Q3R4S5T6U"`
		}{}
	case "meetingID,linkId":
		return struct {
			MeetingID string `path:"meetingID" description:"ULID cuộc họp" example:"01J8X4MTGN1P2Q3R4S5T6U7V"`
			LinkId    string `path:"linkId" description:"ULID invite link" example:"01J8X4LINKN1P2Q3R4S5T"`
		}{}
	case "requestId":
		return struct {
			RequestId string `path:"requestId" description:"ULID join request" example:"01J8X4JREQN1P2Q3R4S5"`
		}{}
	case "token":
		return struct {
			Token string `path:"token" description:"Token lời mời" example:"inv_01J8X4TOKEN"`
		}{}
	default:
		return nil
	}
}

// api binds a Chi router to the OpenAPI catalog so a route is documented
// from the same method+path that Chi serves.
type api struct {
	r      chi.Router
	cat    *apiCatalog
	prefix string
}

func newAPI(r chi.Router, cat *apiCatalog) api {
	return api{r: r, cat: cat}
}

func (a api) Route(pattern string, fn func(api)) {
	a.r.Route(pattern, func(r chi.Router) {
		fn(api{r: r, cat: a.cat, prefix: joinRoute(a.prefix, pattern)})
	})
}

func (a api) Group(fn func(api)) {
	a.r.Group(func(r chi.Router) {
		fn(api{r: r, cat: a.cat, prefix: a.prefix})
	})
}

func (a api) Use(mws ...func(http.Handler) http.Handler) {
	a.r.Use(mws...)
}

func (a api) With(mws ...func(http.Handler) http.Handler) api {
	return api{r: a.r.With(mws...), cat: a.cat, prefix: a.prefix}
}

func (a api) Get(path string, h http.HandlerFunc, op apiOp) {
	a.r.Get(path, h)
	a.cat.add(http.MethodGet, joinRoute(a.prefix, path), op)
}

func (a api) Post(path string, h http.HandlerFunc, op apiOp) {
	a.r.Post(path, h)
	a.cat.add(http.MethodPost, joinRoute(a.prefix, path), op)
}

func (a api) Patch(path string, h http.HandlerFunc, op apiOp) {
	a.r.Patch(path, h)
	a.cat.add(http.MethodPatch, joinRoute(a.prefix, path), op)
}

func (a api) Delete(path string, h http.HandlerFunc, op apiOp) {
	a.r.Delete(path, h)
	a.cat.add(http.MethodDelete, joinRoute(a.prefix, path), op)
}

func (a api) Put(path string, h http.HandlerFunc, op apiOp) {
	a.r.Put(path, h)
	a.cat.add(http.MethodPut, joinRoute(a.prefix, path), op)
}

func joinRoute(prefix, path string) string {
	if prefix == "" {
		return path
	}
	if path == "" || path == "/" {
		return prefix
	}
	return strings.TrimSuffix(prefix, "/") + "/" + strings.TrimPrefix(path, "/")
}

func mountSwagger(r chi.Router, cat *apiCatalog) {
	spec, err := cat.marshalJSON()
	if err != nil {
		panic("openapi spec: " + err.Error())
	}
	r.Get("/swagger/doc.json", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write(spec)
	})
	r.Get("/swagger", func(w http.ResponseWriter, req *http.Request) {
		http.Redirect(w, req, "/swagger/index.html", http.StatusFound)
	})
	r.Get("/swagger/*", httpSwagger.Handler(httpSwagger.URL("/swagger/doc.json")))
}
