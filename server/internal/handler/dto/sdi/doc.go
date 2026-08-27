// Package sdi holds HTTP request types (SDI).
//
// OpenAPI is reflected from these structs at process start. Handlers
// decode SDI. description tags are Vietnamese with diacritics; example
// tags show sample wire values.
//
// Layout is one file per domain. Path params are not declared here;
// they come from pathParamSDI in handler/router/openapi.go.
package sdi
