package storage

import (
	"context"
	"errors"
	"fmt"
	"reflect"
)

// Factory builds a Storage adapter from an already validated Config.
//
// New returns an error instead of a nil Storage: a nil pointer held in an
// interface passes `!= nil` checks and only panics at the first method call,
// which turns a missing adapter into a request-time crash instead of a startup
// failure.
type Factory interface {
	// Backend reports the selector code this factory implements.
	Backend() Backend
	// New builds the adapter. cfg was validated by LoadConfig, so a failure
	// here is an environment problem (unreachable endpoint, no write
	// permission on the local root), not a shape error.
	New(ctx context.Context, cfg Config) (Storage, error)
}

// Registration errors. They are programming errors, not environment errors:
// they surface while the composition root wires the process up.
var (
	// ErrFactoryNil: the factory is a nil interface or an interface holding a
	// typed nil (storage_factory_nil).
	ErrFactoryNil = errors.New("storage_factory_nil")
	// ErrFactoryDuplicate: a factory is already registered for that code
	// (storage_factory_duplicate).
	ErrFactoryDuplicate = errors.New("storage_factory_duplicate")
	// ErrFactoryInvalid: the registry or the factory's code is unusable
	// (storage_factory_invalid).
	ErrFactoryInvalid = errors.New("storage_factory_invalid")
)

// Registry maps selector codes to adapter factories. It is built once during
// startup and then read; it is not safe for concurrent registration.
type Registry struct {
	factories map[Backend]Factory
}

// NewRegistry returns an empty registry.
func NewRegistry() *Registry {
	return &Registry{factories: make(map[Backend]Factory, len(knownBackends))}
}

// Register adds one factory. A nil interface, a typed-nil factory, a code
// outside the enum and a duplicate registration are all rejected, so a
// half-wired process fails at startup instead of the first upload.
func (r *Registry) Register(f Factory) error {
	if r == nil {
		return fmt.Errorf("%w: registry is nil", ErrFactoryInvalid)
	}
	if f == nil {
		return fmt.Errorf("%w: factory is nil", ErrFactoryNil)
	}
	if isTypedNil(f) {
		return fmt.Errorf("%w: factory %T is a typed nil", ErrFactoryNil, f)
	}
	code := f.Backend()
	if !code.Valid() {
		return fmt.Errorf("%w: factory %T reports unknown backend %q", ErrFactoryInvalid, f, string(code))
	}
	if _, exists := r.factories[code]; exists {
		return fmt.Errorf("%w: a factory for %q is already registered", ErrFactoryDuplicate, string(code))
	}
	r.factories[code] = f
	return nil
}

// Has reports whether a factory is registered for code. A nil registry has
// none, so a missing registry is reported the same way as a missing factory.
func (r *Registry) Has(code Backend) bool {
	if r == nil {
		return false
	}
	_, ok := r.factories[code]
	return ok
}

// Get returns the factory for code, or ErrAdapterNotImplemented when the code
// has no factory.
func (r *Registry) Get(code Backend) (Factory, error) {
	if r != nil {
		if factory, ok := r.factories[code]; ok && factory != nil {
			return factory, nil
		}
	}
	return nil, fmt.Errorf("%w: no adapter factory is registered for %q", ErrAdapterNotImplemented, string(code))
}

// isTypedNil reports whether v is an interface holding a nil pointer, map,
// slice, channel or function: the shape that survives `f == nil` and then
// panics inside New.
func isTypedNil(v any) bool {
	value := reflect.ValueOf(v)
	switch value.Kind() {
	case reflect.Chan, reflect.Func, reflect.Interface, reflect.Map, reflect.Ptr, reflect.Slice:
		return value.IsNil()
	default:
		return false
	}
}
