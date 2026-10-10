package billing

import "testing"

func TestQueryDRRefundSettled(t *testing.T) {
	if QueryDRRefundSettled(map[string]string{"vnp_ResponseCode": "00", "vnp_TransactionStatus": "00"}) {
		t.Fatal("paid txn should not count as refund settled")
	}
	if !QueryDRRefundSettled(map[string]string{"vnp_ResponseCode": "00", "vnp_TransactionStatus": "04"}) {
		t.Fatal("04 reversed should settle")
	}
	if !QueryDRRefundSettled(map[string]string{"vnp_ResponseCode": "00", "vnp_TransactionStatus": "05"}) {
		t.Fatal("05 refunded should settle")
	}
	if QueryDRRefundSettled(map[string]string{"vnp_ResponseCode": "91", "vnp_TransactionStatus": "04"}) {
		t.Fatal("non-00 response should not settle")
	}
}
