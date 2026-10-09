package service

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/unicomhub/uniwork/server/internal/billing"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// RefundInvoiceOnProvider calls VNPay refund for vnpay invoices; manual invoices skip the gateway.
func (s *BillingService) RefundInvoiceOnProvider(ctx context.Context, adminID string, inv db.AdminGetInvoiceByIDRow, refundAmount int64, reason, clientIP string) (providerRef string, err error) {
	switch inv.Provider {
	case "manual":
		return "", nil
	case "vnpay":
		vnp, ok := s.provider.(*billing.VNPay)
		if !ok {
			return "", CodedError{Code: "billing_provider_unavailable", Status: http.StatusServiceUnavailable,
				Msg: "VNPay chưa được cấu hình trên server (kiểm tra BILLING_PROVIDER và TMN)"}
		}
		intent, err := s.paymentIntentForInvoice(ctx, s.q, invoiceIntentLookupFromAdminRow(inv))
		if errors.Is(err, pgx.ErrNoRows) {
			return "", CodedError{Code: "payment_intent_not_found", Status: http.StatusConflict,
				Msg: "không tìm thấy giao dịch checkout đã thanh toán — mở tab Giao dịch checkout và đối chiếu mã VNPay"}
		}
		if err != nil {
			return "", err
		}
		qev, qErr := s.vnpayQueryDR(ctx, vnp, intent, clientIP)
		if qErr != nil {
			msg := fmt.Sprintf("VNPay không tra được giao dịch gốc: %v", qErr)
			if errors.Is(qErr, billing.ErrInvalidWebhookSignature) {
				msg = "VNPay trả phản hồi QueryDr không hợp lệ (chữ ký) — kiểm tra VNPAY_HASH_SECRET"
			}
			return "", CodedError{Code: "vnpay_query_failed", Status: http.StatusBadGateway, Msg: msg}
		}
		if !qev.Paid {
			return "", CodedError{Code: "vnpay_refund_failed", Status: http.StatusConflict,
				Msg: "giao dịch gốc chưa thành công trên VNPay — không thể hoàn tiền"}
		}
		txnNo := qev.RawParams["vnp_TransactionNo"]
		if txnNo == "" && inv.ProviderInvoiceID.Valid {
			txnNo = strings.TrimSpace(inv.ProviderInvoiceID.String)
		}
		txType := "02"
		if refundAmount < inv.AmountPaid {
			txType = "03"
		}
		orderInfo := fmt.Sprintf("Hoàn tiền HĐ %s", inv.Number)
		refundTxDate := intentVNPayTransactionDate(intent)
		if pd := strings.TrimSpace(pgTextString(intent.ProviderPayDate)); len(pd) == 14 {
			if t, err := time.ParseInLocation("20060102150405", pd, vnpayICT); err == nil {
				refundTxDate = t
			}
		}
		res, err := vnp.Refund(ctx, billing.RefundInput{
			TxnRef: intent.ProviderTxnRef, TransactionDate: refundTxDate, Amount: refundAmount,
			TransactionType: txType,
			OrderInfo:       orderInfo, CreateBy: adminID, ClientIP: clientIP, TransactionNo: txnNo,
		})
		if err != nil {
			// VNPay accepted or is already processing the refund; UniWork should move the invoice to pending.
			if vnpayRefundTreatAsPending(res.ResponseCode) {
				ref := res.TransactionNo
				if ref == "" {
					ref = res.RequestID
				}
				return ref, nil
			}
			return "", CodedError{Code: "vnpay_refund_failed", Status: http.StatusBadGateway,
				Msg: vnpayRefundUserMessage(res.ResponseCode, res.Message, err)}
		}
		ref := res.TransactionNo
		if ref == "" {
			ref = res.RequestID
		}
		return ref, nil
	default:
		return "", CodedError{Code: "invoice_not_refundable", Status: http.StatusConflict,
			Msg: "cổng thanh toán không hỗ trợ hoàn tiền tự động"}
	}
}

func vnpayRefundUserMessage(code, vnpMsg string, err error) string {
	if msg := strings.TrimSpace(vnpMsg); msg != "" && code != "" {
		switch code {
		case "91":
			return "VNPay không tìm thấy giao dịch gốc (91). Tab Giao dịch checkout: copy mã txn ref; ngày pay = lúc tạo checkout."
		case "95":
			return "VNPay từ chối: giao dịch gốc không thành công (95)."
		case "97":
			return "VNPay: chữ ký không hợp lệ (97) — kiểm tra VNPAY_HASH_SECRET và TMN."
		case "94":
			return "VNPay đang xử lý hoàn tiền hoặc đã nhận yêu cầu trước đó (94)."
		case "99":
			return "VNPay đang xử lý hoàn tiền hoặc đã nhận yêu cầu trước đó (99)."
		default:
			return fmt.Sprintf("VNPay (%s): %s", code, msg)
		}
	}
	if err != nil {
		return err.Error()
	}
	return "VNPay từ chối hoàn tiền"
}

// vnpayRefundTreatAsPending is true when VNPay reports an in-flight or duplicate refund (merchant approval path).
func vnpayRefundTreatAsPending(responseCode string) bool {
	switch responseCode {
	case "94", "99":
		return true
	default:
		return false
	}
}
