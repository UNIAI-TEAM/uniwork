package sdo

type MotionResultDTO struct {
	Yes      int    `json:"yes" example:"9"`
	No       int    `json:"no" example:"3"`
	Abstain  int    `json:"abstain" example:"2"`
	Required int    `json:"required" description:"Số phiếu tán thành tối thiểu để thông qua; 0 khi không có cử tri" example:"8"`
	Outcome  string `json:"outcome" description:"PASSED | FAILED" example:"PASSED"`
}

// MotionDTO is the same for every caller who sees the motion: who chose what
// is MotionVotersSDO and the caller's own ballot is MyBallotListSDO, so the
// list every client refetches on each ballot carries tallies only.
type MotionDTO struct {
	ID           string           `json:"id"`
	Title        string           `json:"title" example:"Thông qua kế hoạch quý IV"`
	Description  string           `json:"description"`
	Position     int32            `json:"position" example:"1"`
	BallotMode   string           `json:"ballot_mode" description:"PUBLIC | SECRET" example:"SECRET"`
	Threshold    string           `json:"threshold" description:"MAJORITY | TWO_THIRDS" example:"MAJORITY"`
	Base         string           `json:"base" description:"PRESENT | ALL_MEMBERS" example:"PRESENT"`
	Status       string           `json:"status" description:"DRAFT | OPEN | CLOSED" example:"OPEN"`
	OpenedAt     string           `json:"opened_at,omitempty"`
	ClosedAt     string           `json:"closed_at,omitempty"`
	RollSize     *int32           `json:"roll_size" description:"Số cử tri chốt lúc mở; null khi còn nháp" example:"14"`
	TotalMembers *int32           `json:"total_members" description:"Tổng thành viên lúc mở; null khi còn nháp" example:"18"`
	CastCount    int              `json:"cast_count" example:"9"`
	Result       *MotionResultDTO `json:"result" description:"Chỉ có khi CLOSED; null khi đang mở, kể cả với chủ trì"`
}

type MotionListSDO struct {
	Motions []MotionDTO `json:"motions"`
}

type MotionSDO struct {
	Motion MotionDTO `json:"motion"`
}

type MotionVotersDTO struct {
	Yes     []string `json:"yes" description:"Tên người tán thành (chỉ phiếu công khai)"`
	No      []string `json:"no"`
	Abstain []string `json:"abstain"`
}

type MotionVotersSDO struct {
	MotionID string           `json:"motion_id" example:"01J8X4MOTN1P2Q3R4S5T6U7V"`
	Voters   *MotionVotersDTO `json:"voters" description:"Chỉ có khi CLOSED và PUBLIC; null khi đang mở, còn nháp hoặc bỏ phiếu kín"`
}

type MyBallotDTO struct {
	MotionID string  `json:"motion_id" description:"Nội dung người gọi có tên trong danh sách cử tri chốt lúc mở" example:"01J8X4MOTN1P2Q3R4S5T6U7V"`
	Cast     bool    `json:"cast"`
	Choice   *string `json:"choice" description:"null với phiếu kín hoặc khi chưa bỏ phiếu" example:"YES"`
}

type MyBallotListSDO struct {
	Ballots []MyBallotDTO `json:"ballots"`
}
