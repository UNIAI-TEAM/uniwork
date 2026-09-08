package meetings

// MediaPermissions controls LiveKit track grants for a participant role.
type MediaPermissions struct {
	CanSubscribe   bool
	CanPublish     bool
	CanPublishData bool
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
