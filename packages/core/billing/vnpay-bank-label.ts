/** VNPay vnp_BankCode → display label (subset; unknown codes shown as-is). */
const VNPAY_BANK_LABELS: Record<string, string> = {
  NCB: "NCB",
  VIETCOMBANK: "Vietcombank",
  VIETINBANK: "VietinBank",
  BIDV: "BIDV",
  AGRIBANK: "Agribank",
  TPBANK: "TPBank",
  MBBANK: "MB Bank",
  VPBANK: "VPBank",
  TECHCOMBANK: "Techcombank",
  ACB: "ACB",
  SHB: "SHB",
  HDB: "HDBank",
  VIB: "VIB",
  SCB: "SCB",
  SACOMBANK: "Sacombank",
  EXIMBANK: "Eximbank",
  MSBANK: "MSB",
  NAMABANK: "Nam A Bank",
  VNMART: "Vi điện tử VnMart",
  VNPAYQR: "VNPay QR",
  VNPAY: "Thẻ nội địa / ATM",
};

export function vnpayBankLabel(code: string): string {
  const key = code.trim().toUpperCase();
  if (!key) return "";
  return VNPAY_BANK_LABELS[key] ?? code.trim();
}
