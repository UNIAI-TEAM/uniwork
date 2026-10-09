package sdo

// AiByokVendorSDO stands for the vendor's own response, passed through
// unchanged: JSON, or text/event-stream when the request asked to stream.
// Only Content-Type and Retry-After are forwarded from the vendor.
type AiByokVendorSDO map[string]any
