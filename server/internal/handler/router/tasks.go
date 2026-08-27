package router

import (
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
		description: "Tạo công việc trong workspace.",
		tags:        []string{"tasks"},
		sdi:         sdi.CreateTaskSDI{},
		sdo:         sdo.TaskSDO{},
		auth:        true,
	})
	r.Get("/tasks/{taskID}", h.GetTask, apiOp{
		summary:     "Get task",
		description: "Trả một công việc nếu người gọi là thành viên workspace.",
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
