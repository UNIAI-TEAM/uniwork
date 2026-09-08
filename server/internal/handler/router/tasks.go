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
//	GET  /api/v1/workspaces/{workspaceID}/my-tasks
//	GET  /api/v1/tasks/{taskID}/children
//	GET  /api/v1/workspaces/{workspaceID}/tasks/children
//	GET  /api/v1/workspaces/{workspaceID}/tasks/child-progress
//	PUT  /api/v1/tasks/{taskID}/parent
//	POST /api/v1/tasks/{taskID}/dependencies
//	DELETE /api/v1/tasks/{taskID}/dependencies/{dependsOnTaskID}
//	POST /api/v1/workspaces/{workspaceID}/tasks/table/groups
//	POST /api/v1/workspaces/{workspaceID}/tasks/table/rows
//	POST /api/v1/workspaces/{workspaceID}/tasks/table/facets
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
		suite.Get("/workspaces/{workspaceID}/my-tasks", h.ListMyTasks, apiOp{
			summary:     "My tasks",
			description: "Công việc của người gọi trong workspace (relation=all|assigned|created|involved). Flag tasks_work_management_parity.",
			tags:        []string{"tasks"},
			sdi:         sdi.ListMyTasksSDI{},
			sdo:         sdo.TaskQueryPageSDO{},
			auth:        true,
		})
		suite.Get("/tasks/{taskID}/children", h.ListTaskChildren, apiOp{
			summary:     "List child tasks",
			description: "Task con trực tiếp của một task. Flag tasks_work_management_parity.",
			tags:        []string{"tasks"},
			sdo:         sdo.TaskListSDO{},
			auth:        true,
		})
		suite.Get("/workspaces/{workspaceID}/tasks/children", h.ListChildrenByParents, apiOp{
			summary:     "List children by parents",
			description: "Query parent_ids=id,id — batch children cho Swimlane. Flag tasks_work_management_parity.",
			tags:        []string{"tasks"},
			sdo:         sdo.TaskListSDO{},
			auth:        true,
		})
		suite.Get("/workspaces/{workspaceID}/tasks/child-progress", h.ChildTaskProgress, apiOp{
			summary:     "Child task progress",
			description: "Tổng/done theo từng parent trong workspace. Flag tasks_work_management_parity.",
			tags:        []string{"tasks"},
			sdo:         sdo.ChildProgressListSDO{},
			auth:        true,
		})
		suite.Put("/tasks/{taskID}/parent", h.SetTaskParent, apiOp{
			summary:     "Set task parent",
			description: "Gán hoặc gỡ cha. Chu trình → 422 parent_cycle. Flag tasks_work_management_parity.",
			tags:        []string{"tasks"},
			sdi:         sdi.SetTaskParentSDI{},
			sdo:         sdo.TaskSDO{},
			auth:        true,
		})
		suite.Post("/tasks/{taskID}/dependencies", h.SetTaskDependency, apiOp{
			summary:     "Set task dependency",
			description: "Thêm phụ thuộc blocks/blocked_by/related. Chu trình → 422 parent_cycle. Flag tasks_work_management_parity.",
			tags:        []string{"tasks"},
			sdi:         sdi.SetTaskDependencySDI{},
			sdo:         sdo.TaskDependencySDO{},
			auth:        true,
		})
		suite.Delete("/tasks/{taskID}/dependencies/{dependsOnTaskID}", h.RemoveTaskDependency, apiOp{
			summary:     "Remove task dependency",
			description: "Xóa cạnh phụ thuộc. Query type tùy chọn. Flag tasks_work_management_parity.",
			tags:        []string{"tasks"},
			sdo:         sdo.StatusSDO{},
			auth:        true,
		})
		suite.Post("/workspaces/{workspaceID}/tasks/table/groups", h.TableGroups, apiOp{
			summary:     "Table groups",
			description: "Nhóm công việc theo group_by (status|priority|assignee) với filter/columns. Flag tasks_work_management_parity.",
			tags:        []string{"tasks"},
			sdi:         sdi.TableGroupsSDI{},
			sdo:         sdo.TableGroupsSDO{},
			auth:        true,
		})
		suite.Post("/workspaces/{workspaceID}/tasks/table/rows", h.TableRows, apiOp{
			summary:     "Table rows",
			description: "Hàng bảng trong một group_key; filter/group_by/columns. Flag tasks_work_management_parity.",
			tags:        []string{"tasks"},
			sdi:         sdi.TableRowsSDI{},
			sdo:         sdo.TableRowsSDO{},
			auth:        true,
		})
		suite.Post("/workspaces/{workspaceID}/tasks/table/facets", h.TableFacets, apiOp{
			summary:     "Table facets",
			description: "Đếm facet (status|priority|assignee) theo filter. Flag tasks_work_management_parity.",
			tags:        []string{"tasks"},
			sdi:         sdi.TableFacetsSDI{},
			sdo:         sdo.TableFacetsSDO{},
			auth:        true,
		})

		// Catalog: statuses, labels, properties. Reorder before {id}.
		suite.Get("/workspaces/{workspaceID}/task-statuses", h.ListTaskStatuses, apiOp{
			summary: "List task statuses", description: "Catalog trạng thái workspace. Flag tasks_work_management_parity.",
			tags: []string{"tasks"}, sdo: sdo.TaskStatusListSDO{}, auth: true,
		})
		suite.Post("/workspaces/{workspaceID}/task-statuses", h.CreateTaskStatus, apiOp{
			summary: "Create task status", description: "Thêm trạng thái tùy chỉnh. Flag tasks_work_management_parity.",
			tags: []string{"tasks"}, sdi: sdi.CreateTaskStatusSDI{}, sdo: sdo.TaskStatusSDO{}, auth: true,
		})
		suite.Patch("/workspaces/{workspaceID}/task-statuses/reorder", h.ReorderTaskStatuses, apiOp{
			summary: "Reorder task statuses", description: "Sắp xếp custom status trong một category. Flag tasks_work_management_parity.",
			tags: []string{"tasks"}, sdi: sdi.ReorderTaskStatusesSDI{}, sdo: sdo.TaskStatusListSDO{}, auth: true,
		})
		suite.Patch("/workspaces/{workspaceID}/task-statuses/{id}", h.PatchTaskStatus, apiOp{
			summary: "Update task status", description: "Sửa trạng thái tùy chỉnh; built-in → 422 system_status_immutable.",
			tags: []string{"tasks"}, sdi: sdi.PatchTaskStatusSDI{}, sdo: sdo.TaskStatusSDO{}, auth: true,
		})
		suite.Delete("/workspaces/{workspaceID}/task-statuses/{id}", h.DeleteTaskStatus, apiOp{
			summary: "Archive task status", description: "Archive trạng thái tùy chỉnh; built-in → 422 system_status_immutable.",
			tags: []string{"tasks"}, sdo: sdo.StatusSDO{}, auth: true,
		})

		suite.Get("/workspaces/{workspaceID}/task-labels", h.ListTaskLabels, apiOp{
			summary: "List task labels", description: "Danh sách nhãn workspace. Flag tasks_work_management_parity.",
			tags: []string{"tasks"}, sdo: sdo.TaskLabelListSDO{}, auth: true,
		})
		suite.Post("/workspaces/{workspaceID}/task-labels", h.CreateTaskLabel, apiOp{
			summary: "Create task label", description: "Tạo nhãn. Flag tasks_work_management_parity.",
			tags: []string{"tasks"}, sdi: sdi.CreateTaskLabelSDI{}, sdo: sdo.TaskLabelSDO{}, auth: true,
		})
		suite.Get("/workspaces/{workspaceID}/task-labels/{id}", h.GetTaskLabel, apiOp{
			summary: "Get task label", description: "Chi tiết một nhãn. Flag tasks_work_management_parity.",
			tags: []string{"tasks"}, sdo: sdo.TaskLabelSDO{}, auth: true,
		})
		suite.Put("/workspaces/{workspaceID}/task-labels/{id}", h.PutTaskLabel, apiOp{
			summary: "Update task label", description: "Sửa nhãn. Flag tasks_work_management_parity.",
			tags: []string{"tasks"}, sdi: sdi.PutTaskLabelSDI{}, sdo: sdo.TaskLabelSDO{}, auth: true,
		})
		suite.Delete("/workspaces/{workspaceID}/task-labels/{id}", h.DeleteTaskLabel, apiOp{
			summary: "Delete task label", description: "Xóa nhãn và gỡ khỏi task. Flag tasks_work_management_parity.",
			tags: []string{"tasks"}, sdo: sdo.StatusSDO{}, auth: true,
		})

		suite.Get("/workspaces/{workspaceID}/task-properties", h.ListTaskProperties, apiOp{
			summary: "List task properties", description: "Định nghĩa thuộc tính tùy chỉnh. Flag tasks_work_management_parity.",
			tags: []string{"tasks"}, sdo: sdo.TaskPropertyListSDO{}, auth: true,
		})
		suite.Post("/workspaces/{workspaceID}/task-properties", h.CreateTaskProperty, apiOp{
			summary: "Create task property", description: "Tạo thuộc tính tùy chỉnh. Flag tasks_work_management_parity.",
			tags: []string{"tasks"}, sdi: sdi.CreateTaskPropertySDI{}, sdo: sdo.TaskPropertySDO{}, auth: true,
		})
		suite.Patch("/workspaces/{workspaceID}/task-properties/{id}", h.PatchTaskProperty, apiOp{
			summary: "Update task property", description: "Sửa hoặc archive thuộc tính. Flag tasks_work_management_parity.",
			tags: []string{"tasks"}, sdi: sdi.PatchTaskPropertySDI{}, sdo: sdo.TaskPropertySDO{}, auth: true,
		})

		suite.Get("/tasks/{taskID}/labels", h.ListTaskLabelsOnTask, apiOp{
			summary: "List labels on task", description: "Nhãn gắn trên một task. Flag tasks_work_management_parity.",
			tags: []string{"tasks"}, sdo: sdo.TaskLabelListSDO{}, auth: true,
		})
		suite.Post("/tasks/{taskID}/labels", h.AttachTaskLabel, apiOp{
			summary: "Attach label to task", description: "Gắn nhãn vào task. Flag tasks_work_management_parity.",
			tags: []string{"tasks"}, sdi: sdi.AttachTaskLabelSDI{}, sdo: sdo.StatusSDO{}, auth: true,
		})
		suite.Delete("/tasks/{taskID}/labels/{labelID}", h.DetachTaskLabel, apiOp{
			summary: "Detach label from task", description: "Gỡ nhãn khỏi task. Flag tasks_work_management_parity.",
			tags: []string{"tasks"}, sdo: sdo.StatusSDO{}, auth: true,
		})
		suite.Put("/tasks/{taskID}/properties/{propertyID}", h.PutTaskPropertyValue, apiOp{
			summary: "Set task property value", description: "Ghi giá trị thuộc tính trên task. Flag tasks_work_management_parity.",
			tags: []string{"tasks"}, sdi: sdi.PutTaskPropertyValueSDI{}, sdo: sdo.TaskSDO{}, auth: true,
		})
		suite.Delete("/tasks/{taskID}/properties/{propertyID}", h.DeleteTaskPropertyValue, apiOp{
			summary: "Clear task property value", description: "Xóa giá trị thuộc tính trên task. Flag tasks_work_management_parity.",
			tags: []string{"tasks"}, sdo: sdo.TaskSDO{}, auth: true,
		})

		// Views + preferences + pins (catalogue group views).
		suite.Get("/workspaces/{workspaceID}/task-views", h.ListTaskViews, apiOp{
			summary: "List task views", description: "Saved views cho một scope. Query: scope_type, scope_id. Flag tasks_work_management_parity.",
			tags: []string{"tasks"}, sdo: sdo.TaskViewListSDO{}, auth: true,
		})
		suite.Post("/workspaces/{workspaceID}/task-views", h.CreateTaskView, apiOp{
			summary: "Create task view", description: "Tạo saved view. Flag tasks_work_management_parity.",
			tags: []string{"tasks"}, sdi: sdi.CreateTaskViewSDI{}, sdo: sdo.TaskViewSDO{}, auth: true,
		})
		suite.Get("/workspaces/{workspaceID}/task-views/{id}", h.GetTaskView, apiOp{
			summary: "Get task view", description: "Chi tiết một saved view. Flag tasks_work_management_parity.",
			tags: []string{"tasks"}, sdo: sdo.TaskViewSDO{}, auth: true,
		})
		suite.Patch("/workspaces/{workspaceID}/task-views/{id}", h.PatchTaskView, apiOp{
			summary: "Update task view", description: "Sửa view với expected_revision. Flag tasks_work_management_parity.",
			tags: []string{"tasks"}, sdi: sdi.PatchTaskViewSDI{}, sdo: sdo.TaskViewSDO{}, auth: true,
		})
		suite.Delete("/workspaces/{workspaceID}/task-views/{id}", h.DeleteTaskView, apiOp{
			summary: "Delete task view", description: "Xóa saved view và pin liên quan. Flag tasks_work_management_parity.",
			tags: []string{"tasks"}, sdo: sdo.StatusSDO{}, auth: true,
		})
		suite.Get("/workspaces/{workspaceID}/task-view-preferences", h.GetTaskViewPreference, apiOp{
			summary: "Get task view preferences", description: "Prefs thanh view theo scope. Query: scope_type, scope_id. Flag tasks_work_management_parity.",
			tags: []string{"tasks"}, sdo: sdo.TaskViewPreferenceSDO{}, auth: true,
		})
		suite.Put("/workspaces/{workspaceID}/task-view-preferences", h.PutTaskViewPreference, apiOp{
			summary: "Put task view preferences", description: "Ghi prefs thanh view (last-write-wins). Flag tasks_work_management_parity.",
			tags: []string{"tasks"}, sdi: sdi.PutTaskViewPreferenceSDI{}, sdo: sdo.TaskViewPreferenceSDO{}, auth: true,
		})
		suite.Get("/workspaces/{workspaceID}/pins", h.ListPins, apiOp{
			summary: "List pins", description: "Pin sidebar. Query include=task_view để gồm pin view. Flag tasks_work_management_parity.",
			tags: []string{"tasks"}, sdo: sdo.TaskPinListSDO{}, auth: true,
		})
		suite.Post("/workspaces/{workspaceID}/pins", h.CreatePin, apiOp{
			summary: "Create pin", description: "Ghim task|project|task_view. Flag tasks_work_management_parity.",
			tags: []string{"tasks"}, sdi: sdi.CreatePinSDI{}, sdo: sdo.TaskPinSDO{}, auth: true,
		})
		suite.Put("/workspaces/{workspaceID}/pins/reorder", h.ReorderPins, apiOp{
			summary: "Reorder pins", description: "Đặt lại position các pin. Flag tasks_work_management_parity.",
			tags: []string{"tasks"}, sdi: sdi.ReorderPinsSDI{}, sdo: sdo.StatusSDO{}, auth: true,
		})
		suite.Delete("/workspaces/{workspaceID}/pins/{itemType}/{itemID}", h.DeletePin, apiOp{
			summary: "Delete pin", description: "Bỏ ghim theo item_type + item_id. Flag tasks_work_management_parity.",
			tags: []string{"tasks"}, sdo: sdo.StatusSDO{}, auth: true,
		})

		// Projects + resources (catalogue group projects). search before {projectID}.
		suite.Get("/workspaces/{workspaceID}/projects/search", h.SearchProjects, apiOp{
			summary: "Search projects", description: "Tìm project theo title/description. Query: q, include_closed, limit, offset. Flag tasks_work_management_parity.",
			tags: []string{"tasks"}, sdo: sdo.ProjectListSDO{}, auth: true,
		})
		suite.Get("/workspaces/{workspaceID}/projects", h.ListProjects, apiOp{
			summary: "List projects", description: "Danh sách project workspace. Query: status, priority. Flag tasks_work_management_parity.",
			tags: []string{"tasks"}, sdo: sdo.ProjectListSDO{}, auth: true,
		})
		suite.Post("/workspaces/{workspaceID}/projects", h.CreateProject, apiOp{
			summary: "Create project", description: "Tạo project (tuỳ chọn kèm resources). Flag tasks_work_management_parity.",
			tags: []string{"tasks"}, sdi: sdi.CreateProjectSDI{}, sdo: sdo.ProjectSDO{}, auth: true,
		})
		suite.Get("/workspaces/{workspaceID}/projects/{projectID}", h.GetProject, apiOp{
			summary: "Get project", description: "Chi tiết một project. Flag tasks_work_management_parity.",
			tags: []string{"tasks"}, sdo: sdo.ProjectSDO{}, auth: true,
		})
		suite.Put("/workspaces/{workspaceID}/projects/{projectID}", h.PutProject, apiOp{
			summary: "Update project", description: "Sửa project. Flag tasks_work_management_parity.",
			tags: []string{"tasks"}, sdi: sdi.PutProjectSDI{}, sdo: sdo.ProjectSDO{}, auth: true,
		})
		suite.Delete("/workspaces/{workspaceID}/projects/{projectID}", h.DeleteProject, apiOp{
			summary: "Delete project", description: "Xóa project, resources, pin và view theo scope. Flag tasks_work_management_parity.",
			tags: []string{"tasks"}, sdo: sdo.StatusSDO{}, auth: true,
		})
		suite.Get("/workspaces/{workspaceID}/projects/{projectID}/resources", h.ListProjectResources, apiOp{
			summary: "List project resources", description: "Tài nguyên gắn với project. Flag tasks_work_management_parity.",
			tags: []string{"tasks"}, sdo: sdo.ProjectResourceListSDO{}, auth: true,
		})
		suite.Post("/workspaces/{workspaceID}/projects/{projectID}/resources", h.CreateProjectResource, apiOp{
			summary: "Create project resource", description: "Thêm github_repo hoặc local_directory. Flag tasks_work_management_parity.",
			tags: []string{"tasks"}, sdi: sdi.CreateProjectResourceSDI{}, sdo: sdo.ProjectResourceSDO{}, auth: true,
		})
		suite.Put("/workspaces/{workspaceID}/projects/{projectID}/resources/{resourceID}", h.PutProjectResource, apiOp{
			summary: "Update project resource", description: "Sửa ref/label/position. Flag tasks_work_management_parity.",
			tags: []string{"tasks"}, sdi: sdi.PutProjectResourceSDI{}, sdo: sdo.ProjectResourceSDO{}, auth: true,
		})
		suite.Delete("/workspaces/{workspaceID}/projects/{projectID}/resources/{resourceID}", h.DeleteProjectResource, apiOp{
			summary: "Delete project resource", description: "Xóa một resource. Flag tasks_work_management_parity.",
			tags: []string{"tasks"}, sdo: sdo.StatusSDO{}, auth: true,
		})

		// Collaboration (catalogue group collaboration).
		suite.Put("/comments/{commentID}", h.UpdateComment, apiOp{
			summary: "Update comment", description: "Sửa nội dung comment. Flag tasks_work_management_parity.",
			tags: []string{"tasks"}, sdi: sdi.UpdateCommentSDI{}, sdo: sdo.CommentSDO{}, auth: true,
		})
		suite.Delete("/comments/{commentID}", h.DeleteComment, apiOp{
			summary: "Delete comment", description: "Xóa comment. Flag tasks_work_management_parity.",
			tags: []string{"tasks"}, sdo: sdo.StatusSDO{}, auth: true,
		})
		suite.Post("/comments/{commentID}/resolve", h.ResolveComment, apiOp{
			summary: "Resolve comment", description: "Đánh dấu comment đã giải quyết. Flag tasks_work_management_parity.",
			tags: []string{"tasks"}, sdo: sdo.CommentSDO{}, auth: true,
		})
		suite.Delete("/comments/{commentID}/resolve", h.UnresolveComment, apiOp{
			summary: "Unresolve comment", description: "Bỏ đánh dấu giải quyết. Flag tasks_work_management_parity.",
			tags: []string{"tasks"}, sdo: sdo.CommentSDO{}, auth: true,
		})
		suite.Post("/comments/{commentID}/reactions", h.AddCommentReaction, apiOp{
			summary: "Add comment reaction", description: "Thêm emoji trên comment. Flag tasks_work_management_parity.",
			tags: []string{"tasks"}, sdi: sdi.ReactionSDI{}, sdo: sdo.CommentReactionSDO{}, auth: true,
		})
		suite.Delete("/comments/{commentID}/reactions", h.RemoveCommentReaction, apiOp{
			summary: "Remove comment reaction", description: "Gỡ emoji trên comment. Flag tasks_work_management_parity.",
			tags: []string{"tasks"}, sdi: sdi.ReactionSDI{}, sdo: sdo.StatusSDO{}, auth: true,
		})
		suite.Get("/comments/{commentID}/sub-task-preview", h.CommentSubTaskPreview, apiOp{
			summary: "Sub-task preview", description: "Preview tạo sub-task từ comment (stub). Flag tasks_work_management_parity.",
			tags: []string{"tasks"}, sdo: sdo.StatusSDO{}, auth: true,
		})
		suite.Post("/comments/{commentID}/sub-tasks", h.CreateCommentSubTasks, apiOp{
			summary: "Create sub-tasks from comment", description: "Tạo sub-task từ comment (stub). Flag tasks_work_management_parity.",
			tags: []string{"tasks"}, sdo: sdo.StatusSDO{}, auth: true,
		})
		suite.Post("/tasks/{taskID}/reactions", h.AddTaskReaction, apiOp{
			summary: "Add task reaction", description: "Thêm emoji trên task. Flag tasks_work_management_parity.",
			tags: []string{"tasks"}, sdi: sdi.ReactionSDI{}, sdo: sdo.TaskReactionSDO{}, auth: true,
		})
		suite.Delete("/tasks/{taskID}/reactions", h.RemoveTaskReaction, apiOp{
			summary: "Remove task reaction", description: "Gỡ emoji trên task. Flag tasks_work_management_parity.",
			tags: []string{"tasks"}, sdi: sdi.ReactionSDI{}, sdo: sdo.StatusSDO{}, auth: true,
		})
		suite.Get("/tasks/{taskID}/subscribers", h.ListTaskSubscribers, apiOp{
			summary: "List task subscribers", description: "Danh sách người theo dõi task. Flag tasks_work_management_parity.",
			tags: []string{"tasks"}, sdo: sdo.TaskSubscriberListSDO{}, auth: true,
		})
		suite.Post("/tasks/{taskID}/subscribe", h.SubscribeTask, apiOp{
			summary: "Subscribe to task", description: "Theo dõi task. Flag tasks_work_management_parity.",
			tags: []string{"tasks"}, sdi: sdi.SubscribeTaskSDI{}, sdo: sdo.StatusSDO{}, auth: true,
		})
		suite.Post("/tasks/{taskID}/unsubscribe", h.UnsubscribeTask, apiOp{
			summary: "Unsubscribe from task", description: "Bỏ theo dõi task. Flag tasks_work_management_parity.",
			tags: []string{"tasks"}, sdi: sdi.SubscribeTaskSDI{}, sdo: sdo.StatusSDO{}, auth: true,
		})
		suite.Post("/tasks/{taskID}/unsubscribe/subtree", h.UnsubscribeTaskSubtree, apiOp{
			summary: "Unsubscribe subtree", description: "Bỏ theo dõi task và mọi con. Flag tasks_work_management_parity.",
			tags: []string{"tasks"}, sdi: sdi.SubscribeTaskSDI{}, sdo: sdo.StatusSDO{}, auth: true,
		})
		suite.Get("/tasks/{taskID}/attachments", h.ListTaskAttachments, apiOp{
			summary: "List task attachments", description: "Đính kèm trên task (stub storage). Flag tasks_work_management_parity.",
			tags: []string{"tasks"}, sdo: sdo.StatusSDO{}, auth: true,
		})
		suite.Get("/attachments/{attachmentID}", h.GetAttachment, apiOp{
			summary: "Get attachment", description: "Chi tiết đính kèm (stub storage). Flag tasks_work_management_parity.",
			tags: []string{"tasks"}, sdo: sdo.StatusSDO{}, auth: true,
		})
		suite.Delete("/attachments/{attachmentID}", h.DeleteAttachment, apiOp{
			summary: "Delete attachment", description: "Xóa đính kèm (stub storage). Flag tasks_work_management_parity.",
			tags: []string{"tasks"}, sdo: sdo.StatusSDO{}, auth: true,
		})
		suite.Get("/tasks/{taskID}/timeline", h.GetTaskTimeline, apiOp{
			summary: "Task timeline", description: "Timeline hoạt động (stub). Flag tasks_work_management_parity.",
			tags: []string{"tasks"}, sdo: sdo.StatusSDO{}, auth: true,
		})
		suite.Post("/tasks/{taskID}/comments/trigger-preview", h.PreviewCommentTriggers, apiOp{
			summary: "Comment trigger preview", description: "Preview agent mention (stub). Flag tasks_work_management_parity.",
			tags: []string{"tasks"}, sdo: sdo.StatusSDO{}, auth: true,
		})

		registerTasksSuiteStubs(suite, h)
	})
}
