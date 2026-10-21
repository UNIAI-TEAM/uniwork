/**
 * The operator as registered (enterprise registration certificate, amendment 1,
 * 2024-04-01). Only the company's public registry details: never the people's
 * identity numbers or home addresses printed on the same certificate.
 */
export const legalEntity = {
  nameVi: "Công ty TNHH Giải pháp Công nghệ Unicom",
  nameEn: "Unicom Technology Solutions Company Limited",
  enterpriseCode: "0110397654",
  addressVi: "Tầng 4, Số 39 HDI Homes, ngõ 29 Mạc Thái Tông, phường Trung Hòa, quận Cầu Giấy, Hà Nội, Việt Nam",
  addressEn: "4th Floor, No. 39 HDI Homes, Lane 29 Mac Thai Tong, Trung Hoa Ward, Cau Giay District, Hanoi, Vietnam",
  email: "contact@unicomhub.com",
};

/** Publish only owner-confirmed details. The optional fields that are still unconfirmed stay empty. */
export const siteInformation = {
  name: "UniWork",
  legalName: legalEntity.nameEn as string | null,
  supportEmail: legalEntity.email as string | null,
  privacyUrl: "/privacy" as string | null,
  termsUrl: null as string | null,
  googleSiteVerification: null as string | null,
};
