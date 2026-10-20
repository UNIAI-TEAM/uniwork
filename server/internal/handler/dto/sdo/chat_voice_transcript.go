package sdo

// ChatVoiceTranscriptSDO is the stored transcript of one voice message.
type ChatVoiceTranscriptSDO struct {
	Text     string `json:"text" description:"Transcript of the voice message; empty when nothing was said" example:"Lan chỉnh giúp màu nút CTA trên banner 3 nhé."`
	Language string `json:"language" description:"Language the transcriber detected, in its own words; empty when unknown" example:"vietnamese"`
}
