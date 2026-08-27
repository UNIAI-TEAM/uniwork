# Quy chuẩn khai báo API, SDI, SDO (Swagger)

Nguồn sự thật của OpenAPI là **cùng method + path Chi đăng ký** và **cùng
struct SDI/SDO handler decode/encode**. Spec được dựng lúc process start.
Không có `swagger.json` / `swagger.yaml` khai báo tay, không `swag` CLI,
không comment `// @Summary`, không `make swag`.

Đọc file này trước khi thêm hoặc sửa một HTTP endpoint trên `server/`.
Đặt tên type/file/cột vẫn theo [`docs/conventions.md`](conventions.md).

`server/internal/handler/swagger_test.go` bắt mọi route REST trên Chi phải
xuất hiện trong spec (trừ ngoại lệ ở § 8).

---

## 1. Luồng bắt buộc khi thêm API

Làm theo thứ tự này. Bỏ bước nào là Swagger lệch runtime.

1. Thêm type vào `server/internal/handler/dto/sdi/{domain}.go` /
   `handler/dto/sdo/{domain}.go` của đúng domain. Gắn `description` và `example`.
2. Handler decode SDI (`decode(w, r, &in, maxJSONBody)`), ghi SDO (hoặc
   cùng envelope JSON với SDO).
3. Đăng ký route trong `server/internal/handler/router/{tag}.go` bằng
   wrapper `api` (`Get` / `Post` / `Patch` / `Delete`) và điền
   `apiOp{summary, description, tags, sdi, sdo, auth, status}`. Tag mới
   thì thêm `register{Tag}` và gọi từ `router.New`. Gắn handler vào
   `router.Routes` trong `handler.New`.
4. Path có `{param}` **mới** → thêm `case` trong `pathParamSDI`
   (`server/internal/handler/router/openapi.go`). Thiếu case thì process
   panic lúc `mountSwagger`.
5. Frontend: thêm hàm + schema + test malformed trong
   `packages/core/api/endpoints/<domain>.ts` (xem `CLAUDE.md` § API
   Compatibility). Không đợi file spec.

Không đăng ký bằng `chi.Router.Get/Post/...` cho REST — Chi sẽ có URL,
Swagger sẽ không.

---

## 2. File đặt ở đâu

SDI/SDO sống trong `server/internal/handler/dto/` (package `sdi` và
`sdo`) — không tách `controller` / `repository` riêng. Layer vẫn là
`handler` → `service` → `pkg/db`.

Gom **theo domain trong từng package**. Không có một `sdi.go` / `sdo.go`
chung, không nhồi mọi type vào `swagger_models.go`.

```
server/internal/handler/
  dto/
    sdi/                       # package sdi — body / form request
      auth.go
      task.go
      …
    sdo/                       # package sdo — envelope + DTO resource
      common.go                # ErrorSDO, StatusSDO
      auth.go
      task.go
      …
  auth.go                      # HTTP + toUserDTO
  router.go                    # Deps + handler.New → router.Routes
  router/                      # Chi + OpenAPI, một file một tag
    router.go / openapi.go
    auth.go / me.go / tasks.go / …
```

| File | Vai trò |
| --- | --- |
| `dto/sdi/{domain}.go` | Body / form request (SDI) |
| `dto/sdo/{domain}.go` | Envelope SDO + DTO resource (`UserDTO`, `TaskDTO`, …) |
| `dto/sdo/common.go` | `ErrorSDO`, `StatusSDO` |
| `handler/{domain}.go` | Handler + mapper `to*DTO` |
| `handler/router.go` | `Deps` + `handler.New` map sang `router.Routes` |
| `handler/router/{tag}.go` | Gắn `sdi` / `sdo` vào `apiOp` theo tag |
| `handler/router/openapi.go` | Catalog, `pathParamSDI`, mount `/swagger` |

Domain hiện có:

| Domain | SDI | SDO |
| --- | --- | --- |
| Auth / me | `dto/sdi/auth.go` | `dto/sdo/auth.go` |
| Onboarding | `dto/sdi/onboarding.go` | dùng `UserSDO` / `TaskSDO` |
| Organization | `dto/sdi/organization.go` | `dto/sdo/organization.go` |
| Workspace / members / invites | `dto/sdi/workspace.go` | `dto/sdo/workspace.go` |
| Task / comments | `dto/sdi/task.go` | `dto/sdo/task.go` |
| Meeting / notes / token | `dto/sdi/meeting.go` | `dto/sdo/meeting.go` |

Domain mới: tạo cặp `dto/sdi/{domain}.go` + `dto/sdo/{domain}.go`.
Endpoint không body thì không cần SDI. SDO có thể dùng lại
(`sdo.StatusSDO`, onboarding → `sdo.UserSDO`).

---

## 3. Đặt tên type

Export từ package `sdi` hoặc `sdo`. Reflector đặt schema `{Pkg}{Name}` —
`sdi.LoginSDI` thành `SdiLoginSDI`.

| Vai trò | Pattern | Ví dụ |
| --- | --- | --- |
| Request body / form | `{Verb}{Resource}SDI` | `sdi.CreateTaskSDI`, `sdi.LoginSDI` |
| Response envelope | `{Resource}SDO` | `sdo.TaskSDO`, `sdo.SessionSDO` |
| List envelope | `{Resource}ListSDO` | `sdo.TaskListSDO` |
| DTO resource (wire row) | `{Resource}DTO` | `sdo.TaskDTO` — trong `dto/sdo/{domain}.go` |
| Envelope dùng chung | `ErrorSDO`, `StatusSDO` | `dto/sdo/common.go` |

Động từ: `create`, `patch`, `complete`, `upload`. Không `Request` / `Response`
/ `Input` / `Output` cho type HTTP.

PATCH: field optional là pointer (`*string`). Field bắt buộc lúc create là
value. `patchTaskSDI` là docs-only nếu handler vẫn decode
`map[string]json.RawMessage` để phân biệt vắng mặt và `null` — type SDI
vẫn phải khớp field trên wire.

---

## 4. Tag struct (để Swagger đọc đúng chỗ)

JSON trên wire là `snake_case`, giống frontend (`docs/conventions.md` §
TypeScript).

| Nguồn | Tag | Ví dụ |
| --- | --- | --- |
| JSON body | `json:"field_name"` | `DisplayName string \`json:"display_name"\`` |
| Mô tả / ví dụ Swagger | `description`, `example` | `description` tiếng Việt có dấu; `example:"Nguyễn Văn An"` |
| Ràng buộc schema | `minLength`, `format` | `format:"email" minLength:"1"` |
| Multipart | `formData:"name"` | `File []byte \`formData:"file" description:"…"\`` |
| Path | **không** gắn trên SDI domain | `pathParamSDI` trong `openapi.go` |
| Query / header | chưa dùng; khi cần: `query:"…"`, `header:"…"` trên SDI của đúng route | |

Không dùng tag Gin `binding:"required"`. Field bắt buộc = value
(không pointer), không `omitempty`. Optional PATCH = `*string`.

```go
type CreateOrganizationSDI struct {
    Name string `json:"name" minLength:"1" description:"Tên hiển thị của tổ chức" example:"Acme"`
    Slug string `json:"slug" minLength:"1" description:"Slug trên URL, không trùng" example:"acme"`
}
```

`omitempty` chỉ trên field response thật sự có thể thiếu (`avatar_url`).

Path param **không** nhét vào `dto/sdi/{domain}.go`. Catalog tự gắn
`pathParamSDI` khi URL có `{…}`.

---

## 5. Khai báo route (`apiOp`)

```go
auth.Post("/workspaces/{workspaceID}/tasks", h.createTask, apiOp{
    summary:     "Create task",
    description: "Tạo công việc trong workspace.",
    tags:        []string{"tasks"},
    sdi:         sdi.CreateTaskSDI{},
    sdo:         sdo.TaskSDO{},
    status:      200, // bỏ trống = 200; create resource thường 201
    auth:        true,
})
```

| Field | Bắt buộc | Ý nghĩa |
| --- | --- | --- |
| `summary` | có | Một câu, tiếng Anh, không trùng URL |
| `description` | nên có | Tiếng Việt có dấu, hiện trên Swagger UI |
| `tags` | có | Một tag domain: `auth`, `me`, `organizations`, `workspaces`, `tasks`, `meetings`, `onboarding`, `meta` |
| `sdi` | khi có body/form | Zero-value `sdi.*SDI{}` |
| `sdo` | hầu hết | Zero-value `sdo.*SDO{}`; delete / logout / healthz dùng `sdo.StatusSDO{}` |
| `status` | khi ≠ 200 | HTTP status thành công (`201` cho create org/workspace) |
| `auth` | khi có `RequireAuth` | Gắn `BearerAuth` + 401 `ErrorSDO` |

`ErrorSDO` (400) được catalog gắn sẵn cho mọi operation. Có `auth: true`
thì thêm 401. Không khai báo lại trên từng route.

GET không body: bỏ `sdi`. Refresh/logout không JSON body: bỏ `sdi`.

---

## 6. Path param (`pathParamSDI`)

`case` là danh sách tên param **theo thứ tự trên URL**, nối bằng dấu phẩy.

| URL | Case |
| --- | --- |
| `/orgs/{org}` | `"org"` |
| `/orgs/{org}/workspaces/{wsSlug}` | `"org,wsSlug"` |
| `/workspaces/{workspaceID}` | `"workspaceID"` |
| `/tasks/{taskID}` | `"taskID"` |
| `/meetings/{meetingID}` | `"meetingID"` |
| `/invitations/{token}` | `"token"` |

Param mới (ví dụ `{commentID}`): thêm `case` và struct `path:"commentID"`.
Tên field Go PascalCase; tag `path` phải **trùng** tên trong `{…}` của Chi.

---

## 7. Handler và SDO phải cùng envelope

SDI/SDO không chỉ để docs. Handler decode đúng type SDI. JSON ghi ra phải
cùng shape với SDO (`json` tag), dù đang `respondJSON` bằng `map` hay
struct.

```go
var in sdi.CreateTaskSDI
if !decode(w, r, &in, maxJSONBody) {
    return
}
// …
respondJSON(w, 200, sdo.TaskSDO{Task: toTaskDTO(t)})
// hoặc map cùng key: {"task": …} — key phải khớp json tag của SDO
```

Body JSON luôn qua `decode` (`json.go`, tối đa `maxJSONBody`). Multipart
tự đặt cap (xem `uploadAvatar`).

---

## 8. Không đưa vào spec

| Route | Lý do |
| --- | --- |
| `GET /api/v1/ws` | WebSocket; đăng ký `v1.r.Get`, không qua `api` |
| `GET /uploads/*` | File tĩnh local storage |
| `GET /swagger`, `/swagger/*` | Chính UI/spec |
| `OPTIONS *` | CORS |

`TestSwaggerSpecFollowsChiRoutesAndSDI` bỏ qua đúng bốn nhóm này. Route
REST mới mà đăng ký ngoài wrapper `api` sẽ làm test đỏ.

---

## 9. Bật / đọc Swagger

- UI: `http://localhost:{PORT}/swagger/index.html`
- Spec runtime: `GET /swagger/doc.json` (OpenAPI 3)
- Localhost `FRONTEND_ORIGIN`: mặc định bật, trừ `ENABLE_SWAGGER=0/false/no`
- Origin production: mặc định tắt, trừ `ENABLE_SWAGGER=1/true/yes`
- GNU Make 3.81 (macOS stock) nuốt dòng **cuối** `.env` nếu không có
  newline — đừng để `ENABLE_SWAGGER` là dòng cuối không newline

Đổi route/SDI/SDO xong phải **restart** `make server`. Spec chỉ build lúc
start.

---

## 10. Việc không làm

- Không commit `swagger.json` / `swagger.yaml` / `server/docs/` generated
- Không thêm `github.com/swaggo/swag` hay target `make swag`
- Không comment `// @Router` / `// @Param` trên handler
- Không nhét path param vào SDI domain
- Không đặt SDI/SDO trong `internal/service` — service nhận input riêng
- Không tạo compatibility layer / dual write chỉ để docs
