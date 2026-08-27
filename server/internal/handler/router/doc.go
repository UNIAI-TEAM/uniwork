// Package router mounts Chi routes and builds the OpenAPI catalog.
//
// handler.New fills Routes with HTTP funcs and calls New. This package
// does not import handler, so there is no cycle.
package router
