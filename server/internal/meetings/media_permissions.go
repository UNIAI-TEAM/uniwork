package meetings

// MediaPermissions controls LiveKit track grants for a participant role.
type MediaPermissions struct {
	CanSubscribe   bool
	CanPublish     bool
	CanPublishData bool
}

// MediaPermissionsForRole maps meeting participant roles to provider grants.
// ATTENDEE and MODERATOR are full participants today; a future AUDIENCE role
// can return subscribe-only without changing admission.
func MediaPermissionsForRole(role string) MediaPermissions {
	switch role {
	case "MODERATOR":
		return MediaPermissions{CanSubscribe: true, CanPublish: true, CanPublishData: true}
	default:
		return MediaPermissions{CanSubscribe: true, CanPublish: true, CanPublishData: true}
	}
}
