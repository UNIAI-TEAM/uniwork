import {
  CT_APP, CT_CORE, REL_DOC, ROOT_RELS, XML_DECL, appProps, contentTypes, coreProps, ooxmlEntries, relsXml, xmlEscape,
  zipStore,
} from './zip.mjs';
import { Q1_TOTAL, REPORT_TABLE_HEADER, fmtVi, reportTableRows } from './data.mjs';

const NS = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
const SLIDE_W = 12192000;
const SLIDE_H = 6858000;

const GRP = '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>';
const xfrm = (x, y, cx, cy) => `<a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm>`;
const TITLE_BOX = [609600, 365760, 10972800, 1143000];
const BODY_BOX = [609600, 1752600, 10972800, 4114800];

const rpr = (sz, bold) => `<a:rPr lang="vi-VN" sz="${sz}"${bold ? ' b="1"' : ''} dirty="0"/>`;
const textP = (text, sz, bold, ppr = '') => `<a:p>${ppr}<a:r>${rpr(sz, bold)}<a:t>${xmlEscape(text)}</a:t></a:r></a:p>`;

function placeholder(id, name, type, idx, box, paragraphs) {
  const phAttrs = `type="${type}"${idx ? ` idx="${idx}"` : ''}`;
  return (
    `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${name}"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph ${phAttrs}/></p:nvPr></p:nvSpPr>` +
    `<p:spPr>${xfrm(...box)}</p:spPr><p:txBody><a:bodyPr/><a:lstStyle/>${paragraphs}</p:txBody></p:sp>`
  );
}

const BULLET = '<a:pPr marL="342900" indent="-342900"><a:buFont typeface="Arial"/><a:buChar char="•"/></a:pPr>';
const NO_BULLET = '<a:pPr marL="0" indent="0"><a:buNone/></a:pPr>';

function tableFrame(header, rows) {
  const colW = [3600000, 4400000, 2972800];
  const rowH = 560000;
  const line = (side) => `<a:${side} w="6350"><a:solidFill><a:srgbClr val="808080"/></a:solidFill></a:${side}>`;
  const cell = (text, bold, shade) =>
    `<a:tc><a:txBody><a:bodyPr/><a:lstStyle/>${textP(text, 1800, bold)}</a:txBody>` +
    `<a:tcPr>${['lnL', 'lnR', 'lnT', 'lnB'].map(line).join('')}${shade ? '<a:solidFill><a:srgbClr val="D9E1F2"/></a:solidFill>' : ''}</a:tcPr></a:tc>`;
  const tr = (cells, bold, shade) => `<a:tr h="${rowH}">${cells.map((t) => cell(t, bold, shade)).join('')}</a:tr>`;
  return (
    '<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="3" name="Bảng doanh thu"/><p:cNvGraphicFramePr><a:graphicFrameLocks noGrp="1"/></p:cNvGraphicFramePr><p:nvPr/></p:nvGraphicFramePr>' +
    `<p:xfrm><a:off x="${BODY_BOX[0]}" y="${BODY_BOX[1]}"/><a:ext cx="${colW.reduce((a, b) => a + b, 0)}" cy="${rowH * (rows.length + 1)}"/></p:xfrm>` +
    '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table"><a:tbl><a:tblPr firstRow="1" bandRow="1"/>' +
    `<a:tblGrid>${colW.map((w) => `<a:gridCol w="${w}"/>`).join('')}</a:tblGrid>` +
    tr(header, true, true) + rows.map((r, i) => tr(r, i === rows.length - 1, false)).join('') +
    '</a:tbl></a:graphicData></a:graphic></p:graphicFrame>'
  );
}

const deckContent = () => ({
  slides: [
    { title: 'Kết quả kinh doanh quý 1 năm 2026', subtitle: 'Bản trình bày tổng hợp từ dữ liệu mẫu' },
    {
      title: 'Điểm chính',
      bullets: [
        `Tổng doanh thu quý 1 đạt ${fmtVi(Q1_TOTAL())} đồng.`,
        'Khu vực Bắc đóng góp nhiều nhất, khu vực Trung ít nhất.',
        'Cột giảm giá nhập theo hai cách cần được thống nhất.',
      ],
    },
    { title: 'Doanh thu theo khu vực', table: { header: REPORT_TABLE_HEADER, rows: reportTableRows() } },
  ],
});

function slideXml(slide) {
  let shapes = placeholder(2, 'Tiêu đề 1', 'title', 0, TITLE_BOX, textP(slide.title, slide.subtitle ? 4400 : 3600, true));
  if (slide.subtitle) shapes += placeholder(3, 'Nội dung 2', 'body', 1, BODY_BOX, textP(slide.subtitle, 2400, false, NO_BULLET));
  if (slide.bullets) shapes += placeholder(3, 'Nội dung 2', 'body', 1, BODY_BOX, slide.bullets.map((b) => textP(b, 2400, false, BULLET)).join(''));
  if (slide.table) shapes += tableFrame(slide.table.header, slide.table.rows);
  return (
    XML_DECL + `<p:sld ${NS}><p:cSld><p:spTree>${GRP}${shapes}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`
  );
}

const lvl = (sz, bold) => `<a:lvl1pPr algn="l"><a:defRPr sz="${sz}"${bold ? ' b="1"' : ''}><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mn-lt"/></a:defRPr></a:lvl1pPr>`;

const masterXml = () =>
  XML_DECL +
  `<p:sldMaster ${NS}><p:cSld><p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg><p:spTree>${GRP}` +
  placeholder(2, 'Title Placeholder 1', 'title', 0, TITLE_BOX, '<a:p><a:r><a:rPr lang="vi-VN"/><a:t>Tiêu đề</a:t></a:r></a:p>') +
  placeholder(3, 'Text Placeholder 2', 'body', 1, BODY_BOX, '<a:p><a:r><a:rPr lang="vi-VN"/><a:t>Nội dung</a:t></a:r></a:p>') +
  '</p:spTree></p:cSld>' +
  '<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>' +
  '<p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst>' +
  `<p:txStyles><p:titleStyle>${lvl(3600, true)}</p:titleStyle><p:bodyStyle>${lvl(2400, false)}</p:bodyStyle><p:otherStyle>${lvl(1800, false)}</p:otherStyle></p:txStyles></p:sldMaster>`;

const layoutXml = () =>
  XML_DECL +
  `<p:sldLayout ${NS} type="obj" preserve="1"><p:cSld name="Tiêu đề và nội dung"><p:spTree>${GRP}` +
  '<p:sp><p:nvSpPr><p:cNvPr id="2" name="Title 1"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:endParaRPr lang="vi-VN"/></a:p></p:txBody></p:sp>' +
  '<p:sp><p:nvSpPr><p:cNvPr id="3" name="Content 2"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:endParaRPr lang="vi-VN"/></a:p></p:txBody></p:sp>' +
  '</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>';

const themeXml = () => {
  const clr = (name, val) => `<a:${name}><a:srgbClr val="${val}"/></a:${name}>`;
  const fill = '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>';
  const ln = (w) => `<a:ln w="${w}" cap="flat" cmpd="sng" algn="ctr">${fill}<a:prstDash val="solid"/></a:ln>`;
  return (
    XML_DECL +
    '<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="UniWork fixture"><a:themeElements>' +
    '<a:clrScheme name="UniWork"><a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1><a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1>' +
    clr('dk2', '1F2937') + clr('lt2', 'F3F4F6') + clr('accent1', '2563EB') + clr('accent2', '16A34A') + clr('accent3', 'D97706') +
    clr('accent4', 'DC2626') + clr('accent5', '7C3AED') + clr('accent6', '0891B2') + clr('hlink', '2563EB') + clr('folHlink', '7C3AED') + '</a:clrScheme>' +
    '<a:fontScheme name="UniWork"><a:majorFont><a:latin typeface="Arial"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont>' +
    '<a:minorFont><a:latin typeface="Arial"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme>' +
    `<a:fmtScheme name="UniWork"><a:fillStyleLst>${fill}${fill}${fill}</a:fillStyleLst><a:lnStyleLst>${ln(6350)}${ln(12700)}${ln(19050)}</a:lnStyleLst>` +
    '<a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst>' +
    `<a:bgFillStyleLst>${fill}${fill}${fill}</a:bgFillStyleLst></a:fmtScheme></a:themeElements></a:theme>`
  );
};

export function buildPptx() {
  const deck = deckContent();
  const parts = {};
  deck.slides.forEach((slide, i) => {
    parts[`ppt/slides/slide${i + 1}.xml`] = slideXml(slide);
    parts[`ppt/slides/_rels/slide${i + 1}.xml.rels`] = relsXml([['rId1', `${REL_DOC}/slideLayout`, '../slideLayouts/slideLayout1.xml']]);
  });
  parts['ppt/slideLayouts/slideLayout1.xml'] = layoutXml();
  parts['ppt/slideLayouts/_rels/slideLayout1.xml.rels'] = relsXml([['rId1', `${REL_DOC}/slideMaster`, '../slideMasters/slideMaster1.xml']]);
  parts['ppt/slideMasters/slideMaster1.xml'] = masterXml();
  parts['ppt/slideMasters/_rels/slideMaster1.xml.rels'] = relsXml([
    ['rId1', `${REL_DOC}/slideLayout`, '../slideLayouts/slideLayout1.xml'],
    ['rId2', `${REL_DOC}/theme`, '../theme/theme1.xml'],
  ]);
  parts['ppt/theme/theme1.xml'] = themeXml();
  parts['ppt/presentation.xml'] =
    XML_DECL + `<p:presentation ${NS}><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:sldIdLst>` +
    deck.slides.map((_, i) => `<p:sldId id="${256 + i}" r:id="rId${i + 2}"/>`).join('') +
    `</p:sldIdLst><p:sldSz cx="${SLIDE_W}" cy="${SLIDE_H}"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>`;
  parts['ppt/_rels/presentation.xml.rels'] = relsXml([
    ['rId1', `${REL_DOC}/slideMaster`, 'slideMasters/slideMaster1.xml'],
    ...deck.slides.map((_, i) => [`rId${i + 2}`, `${REL_DOC}/slide`, `slides/slide${i + 1}.xml`]),
    [`rId${deck.slides.length + 2}`, `${REL_DOC}/theme`, 'theme/theme1.xml'],
  ]);
  parts['_rels/.rels'] = ROOT_RELS('officeDocument', 'ppt/presentation.xml');
  parts['docProps/core.xml'] = coreProps(deck.slides[0].title);
  parts['docProps/app.xml'] = appProps('UniWork fixture generator');
  const pm = 'application/vnd.openxmlformats-officedocument.presentationml';
  parts['[Content_Types].xml'] = contentTypes([
    ['/ppt/presentation.xml', `${pm}.presentation.main+xml`],
    ['/ppt/slideMasters/slideMaster1.xml', `${pm}.slideMaster+xml`],
    ['/ppt/slideLayouts/slideLayout1.xml', `${pm}.slideLayout+xml`],
    ...deck.slides.map((_, i) => [`/ppt/slides/slide${i + 1}.xml`, `${pm}.slide+xml`]),
    ['/ppt/theme/theme1.xml', 'application/vnd.openxmlformats-officedocument.theme+xml'],
    ['/docProps/core.xml', CT_CORE],
    ['/docProps/app.xml', CT_APP],
  ]);
  const oracle = {
    slideCount: deck.slides.length,
    slides: deck.slides.map((s, i) => ({
      index: i + 1,
      title: s.title,
      ...(s.subtitle ? { subtitle: s.subtitle } : {}),
      ...(s.bullets ? { bullets: s.bullets } : {}),
      ...(s.table ? { table: s.table } : {}),
    })),
  };
  return { bytes: zipStore(ooxmlEntries(parts)), oracle };
}
