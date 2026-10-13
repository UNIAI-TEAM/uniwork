-- C-06 lát 2: hồ sơ xóa tổ chức dùng cùng bảng với bản xuất.
ALTER TABLE data_subject_requests DROP CONSTRAINT data_subject_requests_kind_check;
ALTER TABLE data_subject_requests ADD CONSTRAINT data_subject_requests_kind_check
  CHECK (kind IN ('export', 'delete'));
