import { describe, expect, it } from "vitest";
import { isEastAsianFontName } from "./font-list";

describe("isEastAsianFontName", () => {
  it("recognises CJK script names", () => {
    for (const name of ["宋体", "等线", "Yu Gothic", "メイリオ", "말은 고딕", "汉仪旗黑", "方正小标宋简体"]) {
      expect(isEastAsianFontName(name), name).toBe(true);
    }
  });

  it("recognises every romanized family genoffice routes to w:eastAsia", () => {
    for (const name of [
      "SimSun",
      "SimHei",
      "NSimSun",
      "KaiTi",
      "FangSong",
      "DengXian",
      "Microsoft YaHei",
      "Songti SC",
      "Heiti SC",
      "Xingkai SC",
      "LiSu",
      "YouYuan",
      "STZhongsong",
      "STKaiti",
      "STFangsong",
      "STXihei",
      "STHupo",
      "STLiti",
      "STCaiyun",
      "PingFang SC",
      "Hiragino Sans",
      "Meiryo",
      "Osaka",
      "Kozuka Gothic Pro",
      "Yu Gothic",
      "Yu Mincho",
      "YuGothic",
      "MS Gothic",
      "MS Mincho",
      "MS PGothic",
      "MS PMincho",
      "MS UI Gothic",
      "BIZ UDGothic",
      "Malgun Gothic",
      "Batang",
      "Gulim",
      "Dotum",
      "Gungsuh",
      "MYungJo",
      "Nanum Gothic",
      "Apple SD Gothic Neo",
      "AppleGothic",
      "AppleMyungjo",
      "Microsoft JhengHei",
      "PMingLiU",
      "MingLiU",
      "BiauKai",
      "DFKai-SB",
      "DFKai-SB Regular",
      "KaiU",
      "Source Han Sans",
      "Noto Sans CJK SC",
      "Noto Serif JP",
      "WenQuanYi Zen Hei",
      "WenQuanYi Micro Hei",
    ]) {
      expect(isEastAsianFontName(name), name).toBe(true);
    }
  });

  it("normalises full-width Latin names before matching", () => {
    expect(isEastAsianFontName("ＭＳ Ｐゴシック")).toBe(true);
  });

  it("leaves Latin faces in the Latin slot", () => {
    for (const name of ["Calibri", "Arial", "Times New Roman", "Georgia", "Impact", "Courier New", "Segoe UI", "Aptos"]) {
      expect(isEastAsianFontName(name), name).toBe(false);
    }
  });
});
