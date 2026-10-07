package router

// vnpayBillingWebhookPath is exempt from the global rate limiter (VNPay IPN retries).
const vnpayBillingWebhookPath = "/billing/webhooks/vnpay"

func registerBillingWebhooks(r api, h Routes) {
	op := apiOp{
		summary:     "VNPay IPN webhook",
		description: "Xác nhận thanh toán từ VNPay (không Bearer; chữ ký HMAC).",
		tags:        []string{"billing"},
		auth:        false,
	}
	r.Get(vnpayBillingWebhookPath, h.VNPayBillingWebhook, op)
	r.Post(vnpayBillingWebhookPath, h.VNPayBillingWebhook, op)
}
