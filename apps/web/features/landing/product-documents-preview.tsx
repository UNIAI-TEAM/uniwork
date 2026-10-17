"use client";

import { DEMO_MEMBERS, DEMO_PROFILE } from "./product-demo-data";

import { lazy, Suspense, useRef, useState, type ComponentProps } from "react";
import { ArrowLeft, Check, Folder, FolderTree, Monitor, Star } from "lucide-react";
import { useTranslation } from "react-i18next";
import { DEFAULT_DOCUMENT_MAX_BYTES, formatDocumentSizeMB } from "@uniwork/core/documents/limits";
import type { DocumentList } from "@uniwork/core/types/document";
import { Button } from "@uniwork/ui/components/ui/button";
import { Input } from "@uniwork/ui/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@uniwork/ui/components/ui/dialog";
import { CollectionPageHeader } from "@uniwork/views/layout/collection-page";
import { MODULE_ICONS } from "@uniwork/views/layout/module-icons";
import { DocumentsGreeting, CreateCards, CreateMenu } from "@uniwork/views/documents/documents-home-create";
import { DocumentsSidebar, DocumentsSidebarSheet, type LibraryView } from "@uniwork/views/documents/documents-sidebar";
import { LibraryToolbar } from "@uniwork/views/documents/documents-library-toolbar";
import { DocumentsLibraryList } from "@uniwork/views/documents/documents-library-list";
import { DocumentUploadDialog } from "@uniwork/views/documents/document-upload-dialog";
import { FolderNameDialog } from "@uniwork/views/documents/folder-name-dialog";
import { DocumentTypeIcon } from "@uniwork/views/documents/document-type-icon";
import { groupRows, rowFormat, type AccessFilter, type GroupBy, type TypeChip } from "@uniwork/views/documents/library-rows";

const DocumentEditor = lazy(() => import("@uniwork/views/documents/document-editor").then(module => ({ default: module.DocumentEditor })));
type Doc = DocumentList["documents"][number];
type CreateType = Parameters<ComponentProps<typeof CreateCards>["onCreate"]>[0];
const FORMATS = ["page", "folder", "md", "page", "html", "docx", "pptx", "xlsx", "pdf", "page", "docx", "md"];
const UNAVAILABLE = new Set<CreateType>();
const pageContent = (text: string) => ({ type: "doc", content: text.split("\n\n").map(text => ({ type: "paragraph", content: text ? [{ type: "text", text }] : [] })) });

/** The current Documents library, with production navigation, create choices and rows. */
export function ProductDemoDocuments() {
  const { t, i18n } = useTranslation();
  const sequence = useRef(20);
  const [items, setItems] = useState<Doc[]>(() => FORMATS.map((format, index) => ({ id: `sample-doc-${index}`, organization_id: "demo", workspace_id: "demo", parent_id: index > 8 ? "sample-doc-1" : null, kind: format === "folder" ? "folder" : format === "page" ? "page" : "file", title: format === "folder" ? "Product launch" : `${["Product launch brief", "", "Meeting notes", "Design guidelines", "Product page", "Project proposal", "Launch presentation", "Project budget", "Implementation plan", "Team decisions", "Project scope", "Release notes"][index]}${format === "page" || format === "folder" ? "" : `.${format}`}`, visibility: "workspace", revision: "1", current_version: 1, position: index, created_by: DEMO_PROFILE.name, created_by_kind: "human", updated_by: DEMO_MEMBERS[index % 3]!.name, updated_by_kind: "human", created_at: "2026-10-14T08:00:00Z", updated_at: "2026-10-16T08:00:00Z", my_level: "manage", origin: "created", size_bytes: format === "page" || format === "folder" ? null : 2480, archived_at: null })));
  const [view, setView] = useState<LibraryView>({ kind: "home" });
  const [folderId, setFolderId] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [contents, setContents] = useState<Record<string, unknown>>({});
  const [starred, setStarred] = useState<string[]>([]);
  const [chip, setChip] = useState<TypeChip>("all");
  const [groupBy, setGroupBy] = useState<GroupBy>("folder");
  const [access, setAccess] = useState<AccessFilter>("all");
  const [query, setQuery] = useState("");
  const [navOpen, setNavOpen] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [rename, setRename] = useState<Doc | null>(null);
  const [notice, setNotice] = useState("");
  const [officeOpen, setOfficeOpen] = useState(false);
  const [dirty, setDirty] = useState(false);
  const folders = items.filter(doc => doc.kind === "folder" && !doc.archived_at);
  const active = items.find(doc => doc.id === selected);
  const folder = folders.find(doc => doc.id === folderId);
  const selectView = (next: LibraryView) => { setView(next); setFolderId(null); setSelected(null); setQuery(""); setNavOpen(false); };
  const openFolder = (id: string) => { setFolderId(id); setView({ kind: "home" }); setSelected(null); setNavOpen(false); };
  const patch = (id: string, change: Partial<Doc>) => setItems(current => current.map(doc => doc.id === id ? { ...doc, ...change } : doc));
  const create = (format: CreateType | "folder", title?: string, file?: File, parentId = folderId) => {
    const id = `local-document-${++sequence.current}`;
    const doc: Doc = { ...items[0]!, id, parent_id: parentId, kind: format === "folder" ? "folder" : format === "page" ? "page" : "file", title: title ?? t(format === "page" ? "documents.page.new_page" : format === "folder" ? "documents.home.folders.default_name" : `documents.home.default_names.${format}`), position: sequence.current, origin: file ? "upload" : "created", size_bytes: file?.size ?? null, archived_at: null };
    setItems(current => [doc, ...current]); setUploadOpen(false); setNotice(t("landing.productDemo.saved"));
    if (format === "folder") openFolder(id); else { setSelected(id); setDirty(false); }
    return true;
  };
  const sidebar = { wsId: "", view, folderId, starredCount: starred.length, sourcesAvailable: true, canCreate: true, onView: selectView, onFolder: openFolder, onNewFolder: (title?: string) => create("folder", title), folderTree: <div className="flex flex-col gap-0.5">{folders.map(doc => <button type="button" key={doc.id} aria-current={folderId === doc.id ? "page" : undefined} onClick={() => openFolder(doc.id)} className="flex min-h-9 items-center gap-2 rounded-md px-8 text-left text-body hover:bg-accent aria-[current=page]:bg-accent"><Folder className="size-4 text-muted-foreground" aria-hidden /><span className="truncate">{doc.title}</span></button>)}</div> };
  const rows = items.filter(doc => (view.kind === "archived" ? !!doc.archived_at : !doc.archived_at) && (view.kind !== "starred" || starred.includes(doc.id)) && (view.kind !== "shared" || doc.id === "sample-doc-0" || doc.id === "sample-doc-3") && (view.kind !== "sources") && (folderId ? doc.parent_id === folderId : true) && doc.title.toLocaleLowerCase().includes(query.toLocaleLowerCase())).map(doc => ({ type: "document" as const, id: doc.id, doc })).filter(row => chip === "all" || rowFormat(row) === chip);
  const groups = groupRows(rows, groupBy, new Map(folders.map(doc => [doc.id, { id: doc.id, title: doc.title, parentId: doc.parent_id ?? null, kind: "folder" }])));
  const body = active ? contents[active.id] ?? pageContent(`${t("landing.lovable.projectGoal")}\n\n${t("landing.lovable.projectExample")}\n\n${t("landing.lovable.scope")}`) : null;
  return <div className="product-documents-preview">
    <CollectionPageHeader headingAs="h2" icon={MODULE_ICONS.documents} tone="orange" title={t("documents.page.title")} count={items.filter(doc => !doc.archived_at).length} className="h-auto min-h-12 flex-wrap py-2 sm:h-12 sm:flex-nowrap sm:py-0 [&>div:last-child]:contents sm:[&>div:last-child]:flex" actions={<><div className="order-last basis-full sm:order-first sm:basis-auto sm:w-48 md:w-64"><Input type="search" value={query} onChange={event => { setQuery(event.target.value); setSelected(null); }} placeholder={t("documents.home.search.placeholder")} aria-label={t("documents.home.search.label")} /></div><div className="flex shrink-0 items-center gap-2"><Button variant="outline" size="sm" onClick={() => setOfficeOpen(true)}><Monitor aria-hidden /><span className="hidden lg:inline">{t("landing.productDemo.officeHome")}</span></Button><CreateMenu pending={false} unavailable={UNAVAILABLE} onCreate={create} onUpload={() => setUploadOpen(true)} onNewFolder={() => create("folder", t("documents.home.folders.default_name"))} /></div></>} />
    <div className="product-documents-body"><aside className="product-documents-sidebar"><DocumentsSidebar {...sidebar} className="w-full" /></aside><section className="product-documents-main" aria-label={t("documents.page.title")}>
      <div className="product-documents-mobile-nav"><Button variant="outline" size="sm" onClick={() => setNavOpen(true)}><FolderTree aria-hidden />{t("documents.tree.sheet_title")}</Button></div>
      {active ? <article className="product-documents-editor"><div className="flex flex-wrap items-center gap-2"><Button variant="ghost" size="icon" aria-label={t("common.back")} onClick={() => setSelected(null)}><ArrowLeft aria-hidden /></Button><DocumentTypeIcon format={rowFormat({ type: "document", id: active.id, doc: active })} decorative className="size-6" /><h2 className="min-w-0 flex-1 text-title font-semibold">{active.title}</h2><Button variant="ghost" size="icon" aria-label={t("documents.home.sidebar.starred")} aria-pressed={starred.includes(active.id)} onClick={() => setStarred(current => current.includes(active.id) ? current.filter(id => id !== active.id) : [...current, active.id])}><Star aria-hidden fill={starred.includes(active.id) ? "currentColor" : "none"} /></Button><Button size="sm" onClick={() => { setDirty(false); setNotice(t("landing.productDemo.saved")); }}><Check aria-hidden />{t("common.save")}</Button></div><Suspense fallback={<p>{t("common.loading")}</p>}><DocumentEditor key={active.id} wsId="" documentId={active.id} initialContent={body} content={body} contentRevision={active.revision} editable dirty={dirty} onChange={content => { setContents(current => ({ ...current, [active.id]: content })); setDirty(true); }} onUploadAsset={async () => { throw new Error(t("landing.lovable.sample")); }} /></Suspense></article> : <div className="product-documents-library"><DocumentsGreeting name={DEMO_PROFILE.name} folderTitle={folder?.title ?? null} now={new Date(2026, 9, 16, 13)} />{view.kind === "home" && <CreateCards pending={false} unavailable={UNAVAILABLE} onCreate={create} onUpload={() => setUploadOpen(true)} />}<LibraryToolbar scope={["home", "recent", "shared", "archived"].includes(view.kind) ? view.kind as "home" | "recent" | "shared" | "archived" : null} count={{ value: rows.length, more: false }} onScope={kind => selectView({ kind })} chip={chip} onChip={setChip} access={access} onAccess={setAccess} groupBy={groupBy} onGroupBy={setGroupBy} /><DocumentsLibraryList groups={groups} loading={false} failure={null} filteredBy={chip !== "all" || !!query ? "client" : null} cardsShown={view.kind === "home"} archived={view.kind === "archived"} hasMore={false} loadingMore={false} onLoadMore={() => {}} onRetry={() => {}} onClearFilters={() => { setChip("all"); setQuery(""); }} handlers={{ onOpen: id => { setSelected(id); setDirty(false); }, onFolder: openFolder, onGoToSource: () => setNotice(t("landing.lovable.sample")), onDownloadSource: () => setNotice(t("landing.lovable.sample")), onSaveSource: () => setNotice(t("landing.productDemo.saved")), onToggleStar: id => setStarred(current => current.includes(id) ? current.filter(value => value !== id) : [...current, id]), isStarred: id => starred.includes(id), onNewSubfolder: doc => { create("folder", t("documents.home.folders.default_name"), undefined, doc.id); }, onRename: setRename, onArchive: doc => patch(doc.id, { archived_at: "2026-10-16T08:00:00Z" }), onRestore: doc => patch(doc.id, { archived_at: null }), personName: id => id }} empty={{ title: t("documents.home.empty.title"), description: t("landing.lovable.sample") }} /></div>}
    </section></div>
    {notice && <p role="status" className="product-documents-notice">{notice}</p>}
    <DocumentsSidebarSheet {...sidebar} open={navOpen} onOpenChange={setNavOpen} />
    <DocumentUploadDialog open={uploadOpen} onOpenChange={setUploadOpen} title={t("documents.upload.title")} description={t("landing.lovable.sample")} hint={t("documents.upload.size_hint", { max: formatDocumentSizeMB(DEFAULT_DOCUMENT_MAX_BYTES, i18n.language) })} onSubmit={file => create("page", file.name, file)} />
    <FolderNameDialog open={!!rename} onOpenChange={open => { if (!open) setRename(null); }} mode="rename" kind={rename?.kind} initialName={rename?.title} onSubmit={title => { if (rename) patch(rename.id, { title }); setRename(null); return true; }} />
    <Dialog open={officeOpen} onOpenChange={setOfficeOpen}><DialogContent><DialogHeader><DialogTitle>{t("landing.productDemo.officeHome")}</DialogTitle><DialogDescription>{t("landing.lovable.sample")}</DialogDescription></DialogHeader><CreateCards pending={false} unavailable={UNAVAILABLE} onCreate={format => { create(format); setOfficeOpen(false); }} onUpload={() => { setOfficeOpen(false); setUploadOpen(true); }} /></DialogContent></Dialog>
  </div>;
}
