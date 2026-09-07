package router

import (
	"net/http"

	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdi"
	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdo"
)

// tag: tasks — board and comments. Requires Bearer.
//
//	GET    /api/v1/workspaces/{workspaceID}/tasks
//	POST   /api/v1/workspaces/{workspaceID}/tasks
//	GET    /api/v1/tasks/{taskID}
//	PATCH  /api/v1/tasks/{taskID}
//	DELETE /api/v1/tasks/{taskID}
//	GET    /api/v1/tasks/{taskID}/comments
//	POST   /api/v1/tasks/{taskID}/comments
func registerTasks(r api, h Routes) {
	r.Get("/workspaces/{workspaceID}/tasks", h.ListTasks, apiOp{
		summary:     "List tasks",
		description: "Công việc trong workspace, sắp xếp theo bảng.",
		tags:        []string{"tasks"},
		sdo:         sdo.TaskListSDO{},
		auth:        true,
	})
	r.Post("/workspaces/{workspaceID}/tasks", h.CreateTask, apiOp{
		summary:     "Create task",
		description: "Tạo công việc trong workspace. Header Idempotency-Key (tuỳ chọn) replay cùng response.",
		tags:        []string{"tasks"},
		sdi:         sdi.CreateTaskSDI{},
		sdo:         sdo.TaskSDO{},
		auth:        true,
	})
	r.Get("/tasks/{taskID}", h.GetTask, apiOp{
		summary:     "Get task",
		description: "Trả một công việc theo ULID hoặc identifier PREFIX-N (prefix không phân biệt hoa thường) nếu người gọi là thành viên workspace.",
		tags:        []string{"tasks"},
		sdo:         sdo.TaskSDO{},
		auth:        true,
	})
	r.Patch("/tasks/{taskID}", h.UpdateTask, apiOp{
		summary:     "Update task",
		description: "Sửa từng field. Key bỏ trống giữ nguyên; assignee_id và due_date nhận JSON null để xóa.",
		tags:        []string{"tasks"},
		sdi:         sdi.PatchTaskSDI{},
		sdo:         sdo.TaskSDO{},
		auth:        true,
	})
	r.Delete("/tasks/{taskID}", h.DeleteTask, apiOp{
		summary:     "Delete task",
		description: "Xóa công việc. Cần quyền sửa bảng.",
		tags:        []string{"tasks"},
		sdo:         sdo.StatusSDO{},
		auth:        true,
	})
	r.Get("/tasks/{taskID}/comments", h.ListComments, apiOp{
		summary:     "List task comments",
		description: "Bình luận trên công việc, cũ nhất trước.",
		tags:        []string{"tasks"},
		sdo:         sdo.CommentListSDO{},
		auth:        true,
	})
	r.Post("/tasks/{taskID}/comments", h.CreateComment, apiOp{
		summary:     "Add task comment",
		description: "Thêm bình luận vào công việc.",
		tags:        []string{"tasks"},
		sdi:         sdi.CreateCommentSDI{},
		sdo:         sdo.CommentSDO{},
		auth:        true,
	})
}

// registerTasksSuite mounts Work Management parity routes behind
// tasks_work_management_parity. Flag off → 404 feature_disabled.
//
//	POST /api/v1/workspaces/{workspaceID}/tasks/query
//	GET  /api/v1/workspaces/{workspaceID}/tasks/grouped
//	PUT  /api/v1/tasks/{taskID}
//	POST /api/v1/workspaces/{workspaceID}/tasks/batch-update
//	POST /api/v1/workspaces/{workspaceID}/tasks/batch-delete
func registerTasksSuite(r api, h Routes, flagMW func(http.Handler) http.Handler) {
	r.Group(func(suite api) {
		suite.Use(flagMW)
		suite.Post("/workspaces/{workspaceID}/tasks/query", h.QueryTasks, apiOp{
			summary:     "Query tasks",
			description: "Lọc và phân trang công việc (suite parity). Flag tasks_work_management_parity.",
			tags:        []string{"tasks"},
			sdi:         sdi.QueryTasksSDI{},
			sdo:         sdo.TaskQueryPageSDO{},
			auth:        true,
		})
		suite.Get("/workspaces/{workspaceID}/tasks/grouped", h.GroupedTasks, apiOp{
			summary:     "Grouped tasks",
			description: "Nhóm công việc theo status cho board. Query: group_by, status, limit, offset. Flag tasks_work_management_parity.",
			tags:        []string{"tasks"},
			sdo:         sdo.TaskGroupedSDO{},
			auth:        true,
		})
		suite.Put("/tasks/{taskID}", h.PutTaskSuite, apiOp{
			summary:     "Update task (suite)",
			description: "Sửa công việc với revision / If-Match. Lệch → 422 revision_conflict. Flag tasks_work_management_parity.",
			tags:        []string{"tasks"},
			sdi:         sdi.PutTaskSDI{},
			sdo:         sdo.TaskSDO{},
			auth:        true,
		})
		suite.Post("/workspaces/{workspaceID}/tasks/batch-update", h.BatchUpdateTasks, apiOp{
			summary:     "Batch update tasks",
			description: "Cập nhật nhiều công việc cùng patch. Flag tasks_work_management_parity.",
			tags:        []string{"tasks"},
			sdi:         sdi.BatchUpdateTasksSDI{},
			sdo:         sdo.BatchUpdateTasksSDO{},
			auth:        true,
		})
		suite.Post("/workspaces/{workspaceID}/tasks/batch-delete", h.BatchDeleteTasks, apiOp{
			summary:     "Batch delete tasks",
			description: "Xóa nhiều công việc. Flag tasks_work_management_parity.",
			tags:        []string{"tasks"},
			sdi:         sdi.BatchDeleteTasksSDI{},
			sdo:         sdo.BatchDeleteTasksSDO{},
			auth:        true,
		})
	})
}
