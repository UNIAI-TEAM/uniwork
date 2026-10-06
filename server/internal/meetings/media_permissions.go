package meetings

// MediaPermissions controls LiveKit track grants for a participant role.
type MediaPermissions struct {
	CanSubscribe   bool
	CanPublish     bool
	CanPublishData bool
	// MicrophoneLocked keeps publishing on for every source but the mic and
	// shared-tab audio: the host locks someone's voice without taking their
	// camera or the picture of their share.
	MicrophoneLocked bool
	// ScreenShareLocked takes the screen share and its audio: a live share
	// stops and a new one is refused, while the mic and camera stay.
	ScreenShareLocked bool
}

// MediaPermissionsForRole maps meeting participant roles to provider grants.
// AUDIENCE is subscribe-only (webinar / viewer); ATTENDEE and MODERATOR publish.
func MediaPermissionsForRole(role string) MediaPermissions {
	switch role {
	case "AUDIENCE":
		return MediaPermissions{CanSubscribe: true, CanPublish: false, CanPublishData: true}
	case "MODERATOR":
		return MediaPermissions{CanSubscribe: true, CanPublish: true, CanPublishData: true}
	default:
		return MediaPermissions{CanSubscribe: true, CanPublish: true, CanPublishData: true}
	}
}
