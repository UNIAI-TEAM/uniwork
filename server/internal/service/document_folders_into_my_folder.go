package service

import (
	"context"
	"errors"
)

// FoldersIntoMyFolderSkip is one folder the pass left where it was, with why.
type FoldersIntoMyFolderSkip struct {
	FolderID string
	Reason   string
}

// FoldersIntoMyFolderReport is what one pass found or did.
type FoldersIntoMyFolderReport struct {
	DryRun                 bool
	Units                  int
	MovedFolders           int
	RelocatedDocuments     int
	RelocatedPublicFolders int
	Skipped                []FoldersIntoMyFolderSkip
}

func (s *DocumentService) MoveFoldersIntoMyFolder(ctx context.Context, dryRun bool, batchSize int, organizationID string) (FoldersIntoMyFolderReport, error) {
	return FoldersIntoMyFolderReport{}, errors.New("not implemented")
}
