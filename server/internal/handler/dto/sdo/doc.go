// Package sdo holds HTTP response envelopes (SDO) and wire-row DTOs.
//
// OpenAPI is reflected from these structs at process start. Handlers
// write JSON that matches SDO. description tags are Vietnamese with
// diacritics; example tags show sample wire values.
//
// Layout is one file per domain. Shared envelopes live in common.go.
package sdo
