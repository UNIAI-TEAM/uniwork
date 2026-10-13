package service

// blankPPTXSeed is the starting package of a blank PPTX: one blank 16:9 slide
// on a one-layout master with a minimal theme. It mirrors the genoffice Slides
// editor's own blank template (packages/pptx-engine/src/blank.ts) so a blank
// the server makes opens exactly like one the editor makes. No engine binds
// serialize:pptx, so these bytes are the document's first version as they are.
// Entries carry a fixed time: the seed is deterministic.
func blankPPTXSeed() []byte {
	const (
		nsA = "http://schemas.openxmlformats.org/drawingml/2006/main"
		nsR = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
		nsP = "http://schemas.openxmlformats.org/presentationml/2006/main"
	)
	ns := `xmlns:a="` + nsA + `" xmlns:r="` + nsR + `" xmlns:p="` + nsP + `"`
	relsOpen := blankXMLDecl + `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`
	rel := func(id, kind, target string) string {
		return `<Relationship Id="` + id + `" Type="` + nsR + `/` + kind + `" Target="` + target + `"/>`
	}
	emptyTree := `<p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>` +
		`<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr></p:spTree>`
	override := func(part, kind string) string {
		return `<Override PartName="` + part + `" ContentType="application/vnd.openxmlformats-officedocument.` + kind + `+xml"/>`
	}
	return blankZip([]blankPart{
		{"[Content_Types].xml", blankXMLDecl + `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
			`<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
			`<Default Extension="xml" ContentType="application/xml"/>` +
			override("/ppt/presentation.xml", "presentationml.presentation.main") +
			override("/ppt/slideMasters/slideMaster1.xml", "presentationml.slideMaster") +
			override("/ppt/slideLayouts/slideLayout1.xml", "presentationml.slideLayout") +
			override("/ppt/slides/slide1.xml", "presentationml.slide") +
			override("/ppt/theme/theme1.xml", "theme") + `</Types>`},
		{"_rels/.rels", relsOpen + rel("rId1", "officeDocument", "ppt/presentation.xml") + `</Relationships>`},
		{"ppt/presentation.xml", blankXMLDecl + `<p:presentation ` + ns + `>` +
			`<p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>` +
			`<p:sldIdLst><p:sldId id="256" r:id="rId2"/></p:sldIdLst>` +
			`<p:sldSz cx="12192000" cy="6858000"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>`},
		{"ppt/_rels/presentation.xml.rels", relsOpen + rel("rId1", "slideMaster", "slideMasters/slideMaster1.xml") +
			rel("rId2", "slide", "slides/slide1.xml") + `</Relationships>`},
		{"ppt/slides/slide1.xml", blankXMLDecl + `<p:sld ` + ns + `><p:cSld>` + emptyTree + `</p:cSld>` +
			`<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`},
		{"ppt/slides/_rels/slide1.xml.rels", relsOpen + rel("rId1", "slideLayout", "../slideLayouts/slideLayout1.xml") + `</Relationships>`},
		{"ppt/slideLayouts/slideLayout1.xml", blankXMLDecl + `<p:sldLayout ` + ns + ` type="blank"><p:cSld name="Blank">` + emptyTree + `</p:cSld>` +
			`<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`},
		{"ppt/slideLayouts/_rels/slideLayout1.xml.rels", relsOpen + rel("rId1", "slideMaster", "../slideMasters/slideMaster1.xml") + `</Relationships>`},
		{"ppt/slideMasters/slideMaster1.xml", blankXMLDecl + `<p:sldMaster ` + ns + `><p:cSld>` + emptyTree + `</p:cSld>` +
			`<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>` +
			`<p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst>` +
			`<p:txStyles><p:titleStyle/><p:bodyStyle/><p:otherStyle/></p:txStyles></p:sldMaster>`},
		{"ppt/slideMasters/_rels/slideMaster1.xml.rels", relsOpen + rel("rId1", "slideLayout", "../slideLayouts/slideLayout1.xml") +
			rel("rId2", "theme", "../theme/theme1.xml") + `</Relationships>`},
		{"ppt/theme/theme1.xml", blankPPTXTheme(nsA)},
	})
}

func blankPPTXTheme(nsA string) string {
	phFill := `<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>`
	line := func(w string) string { return `<a:ln w="` + w + `">` + phFill + `</a:ln>` }
	effect := `<a:effectStyle><a:effectLst/></a:effectStyle>`
	return blankXMLDecl + `<a:theme xmlns:a="` + nsA + `" name="Office"><a:themeElements>` +
		`<a:clrScheme name="Office">` +
		`<a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1>` +
		`<a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1>` +
		`<a:dk2><a:srgbClr val="44546A"/></a:dk2><a:lt2><a:srgbClr val="E7E6E6"/></a:lt2>` +
		`<a:accent1><a:srgbClr val="C43E1C"/></a:accent1><a:accent2><a:srgbClr val="ED7D31"/></a:accent2>` +
		`<a:accent3><a:srgbClr val="A5A5A5"/></a:accent3><a:accent4><a:srgbClr val="FFC000"/></a:accent4>` +
		`<a:accent5><a:srgbClr val="4472C4"/></a:accent5><a:accent6><a:srgbClr val="70AD47"/></a:accent6>` +
		`<a:hlink><a:srgbClr val="0563C1"/></a:hlink><a:folHlink><a:srgbClr val="954F72"/></a:folHlink></a:clrScheme>` +
		`<a:fontScheme name="Office">` +
		`<a:majorFont><a:latin typeface="Calibri Light"/><a:ea typeface="Microsoft YaHei"/><a:cs typeface=""/></a:majorFont>` +
		`<a:minorFont><a:latin typeface="Calibri"/><a:ea typeface="Microsoft YaHei"/><a:cs typeface=""/></a:minorFont></a:fontScheme>` +
		`<a:fmtScheme name="Office">` +
		`<a:fillStyleLst>` + phFill + phFill + phFill + `</a:fillStyleLst>` +
		`<a:lnStyleLst>` + line("6350") + line("12700") + line("19050") + `</a:lnStyleLst>` +
		`<a:effectStyleLst>` + effect + effect + effect + `</a:effectStyleLst>` +
		`<a:bgFillStyleLst>` + phFill + phFill + phFill + `</a:bgFillStyleLst></a:fmtScheme>` +
		`</a:themeElements></a:theme>`
}
