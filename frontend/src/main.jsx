import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "./style.css";

const API = "http://localhost:8000";
const DEFAULT_EDIT = { filter: "normal", crop: { x: 0, y: 0, width: 100, height: 100 } };
const FILTERS = ["normal", "grayscale", "sepia", "contrast"];
const HANDLES = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

function App() {
  const [images, setImages] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [dragIndex, setDragIndex] = useState(null);
  const [cropDrag, setCropDrag] = useState(null);
  const [status, setStatus] = useState("");
  const [tab, setTab] = useState("images");
  const [mergeFiles, setMergeFiles] = useState([]);
  const [mergeDragIndex, setMergeDragIndex] = useState(null);
  const [splitFile, setSplitFile] = useState(null);
  const [splitPages, setSplitPages] = useState([]);
  const [splitRange, setSplitRange] = useState({ start: 1, end: 1 });
  const [editFile, setEditFile] = useState(null);
  const [editPages, setEditPages] = useState([]);
  const [annotations, setAnnotations] = useState([]);
  const [editingText, setEditingText] = useState(false);
  const [placingSignature, setPlacingSignature] = useState(false);
  const [placingImage, setPlacingImage] = useState(false);
  const [overlayImage, setOverlayImage] = useState(null);
  const [wordFile, setWordFile] = useState(null);
  const [signing, setSigning] = useState(false);
  const [signature, setSignature] = useState(null);
  const [annotationDrag, setAnnotationDrag] = useState(null);
  const signCanvasRef = useRef(null);
  const stageRef = useRef(null);
  const selected = images.find((image) => image.id === selectedId);

  function addImages(event) {
    const files = [...event.target.files].filter((file) => file.type.startsWith("image/"));
    const additions = files.map((file) => ({ file, url: URL.createObjectURL(file), id: crypto.randomUUID(), edit: structuredClone(DEFAULT_EDIT) }));
    if (additions.length) { setImages((current) => [...current, ...additions]); setSelectedId((current) => current || additions[0].id); setStatus(""); }
    event.target.value = "";
  }
  function removeImage(id = selectedId) {
    const removed = images.find((image) => image.id === id);
    if (removed) URL.revokeObjectURL(removed.url);
    const remaining = images.filter((image) => image.id !== id);
    setImages(remaining); setSelectedId(remaining[0]?.id || null);
  }
  function reorder(toIndex) {
    if (dragIndex === null || dragIndex === toIndex) return;
    setImages((current) => { const next = [...current]; const [moved] = next.splice(dragIndex, 1); next.splice(toIndex, 0, moved); return next; }); setDragIndex(null);
  }
  function updateEdit(change) { setImages((current) => current.map((image) => image.id === selectedId ? { ...image, edit: { ...image.edit, ...change } } : image)); }
  function applyFilterToAll() {
    if (!selected) return;
    setImages((current) => current.map((image) => ({ ...image, edit: { ...image.edit, filter: selected.edit.filter } })));
    setStatus(`Applied ${selected.edit.filter} filter to all pages.`);
  }
  function addMergeFiles(event) {
    const files = [...event.target.files].filter((file) => file.type === "application/pdf");
    setMergeFiles((current) => [...current, ...files]); event.target.value = "";
  }
  function reorderMerge(to) {
    if (mergeDragIndex === null || mergeDragIndex === to) return;
    setMergeFiles((current) => { const next = [...current]; const [item] = next.splice(mergeDragIndex, 1); next.splice(to, 0, item); return next; }); setMergeDragIndex(null);
  }
  async function exportMerge() {
    if (mergeFiles.length < 2) return setStatus("Add at least two PDFs to merge.");
    const form = new FormData(); mergeFiles.forEach((file) => form.append("files", file)); setStatus("Merging PDFs...");
    try { const response = await fetch(`${API}/api/merge-pdfs`, { method: "POST", body: form }); if (!response.ok) throw new Error("Could not merge PDFs."); download(response, "merged.pdf"); setStatus("Merged PDF is ready."); } catch (error) { setStatus(error.message); }
  }
  async function loadSplitPdf(event) {
    const file = event.target.files[0]; event.target.value = ""; if (!file) return;
    const form = new FormData(); form.append("file", file); setStatus("Reading PDF pages...");
    try { const response = await fetch(`${API}/api/pdf-pages`, { method: "POST", body: form }); if (!response.ok) throw new Error("Could not read this PDF."); const data = await response.json(); setSplitFile(file); setSplitPages(data.pages); setSplitRange({ start: 1, end: data.pageCount }); setStatus(""); } catch (error) { setStatus(error.message); }
  }
  async function exportSplit() {
    if (!splitFile) return; const form = new FormData(); form.append("file", splitFile); form.append("start", splitRange.start); form.append("end", splitRange.end); setStatus("Creating selected pages...");
    try { const response = await fetch(`${API}/api/split-pdf`, { method: "POST", body: form }); if (!response.ok) throw new Error("Could not export this range."); download(response, `pages-${splitRange.start}-${splitRange.end}.pdf`); setStatus("Selected pages are ready."); } catch (error) { setStatus(error.message); }
  }
  async function download(response, filename) { const url = URL.createObjectURL(await response.blob()); const link = document.createElement("a"); link.href = url; link.download = filename; link.click(); URL.revokeObjectURL(url); }
  function previewUrl(base64) { return `data:image/png;base64,${base64}`; }
  async function loadEditPdf(event) {
    const file = event.target.files[0]; event.target.value = ""; if (!file) return;
    const form = new FormData(); form.append("file", file); setStatus("Loading editable pages...");
    try { const response = await fetch(`${API}/api/pdf-pages`, { method: "POST", body: form }); if (!response.ok) throw new Error("Could not read this PDF."); const data = await response.json(); setEditFile(file); setEditPages(data.pages); setAnnotations([]); setStatus(""); } catch (error) { setStatus(error.message); }
  }
  function addText(page) { setAnnotations((items) => [...items, { id: crypto.randomUUID(), type: "text", page, x: 12, y: 12, width: 35, height: 9, fontSize: 14, content: "Type your text" }]); }
  function saveSignature() { const canvas = signCanvasRef.current; if (!canvas) return; setSignature(canvas.toDataURL("image/png")); setSigning(false); }
  function addSignature(page) { if (!signature) return setSigning(true); setAnnotations((items) => [...items, { id: crypto.randomUUID(), type: "signature", page, x: 15, y: 15, width: 27, height: 12, content: signature }]); }
  function addOverlayImage(page) { if (!overlayImage) return; setAnnotations((items) => [...items, { id: crypto.randomUUID(), type: "image", page, x: 15, y: 15, width: 28, height: 20, content: overlayImage }]); }
  function chooseOverlayImage(event) { const file = event.target.files[0]; event.target.value = ""; if (!file) return; const reader = new FileReader(); reader.onload = () => { setOverlayImage(reader.result); setPlacingImage(true); setEditingText(false); setPlacingSignature(false); }; reader.readAsDataURL(file); }
  function beginAnnotationDrag(event, annotation) { event.preventDefault(); event.stopPropagation(); const box = event.currentTarget.parentElement.getBoundingClientRect(); setAnnotationDrag({ id: annotation.id, x: event.clientX, y: event.clientY, box, originalX: annotation.x, originalY: annotation.y }); }
  function beginAnnotationResize(event, annotation) { event.preventDefault(); event.stopPropagation(); const box = event.currentTarget.parentElement.parentElement.getBoundingClientRect(); setAnnotationDrag({ id: annotation.id, mode: "resize", x: event.clientX, y: event.clientY, box, originalX: annotation.x, originalY: annotation.y, originalWidth: annotation.width, originalHeight: annotation.height }); }
  useEffect(() => {
    const move = (event) => { if (!annotationDrag) return; const dx = (event.clientX - annotationDrag.x) / annotationDrag.box.width * 100; const dy = (event.clientY - annotationDrag.y) / annotationDrag.box.height * 100; setAnnotations((items) => items.map((item) => { if (item.id !== annotationDrag.id) return item; if (annotationDrag.mode === "resize") return { ...item, width: Math.max(8, Math.min(100 - item.x, annotationDrag.originalWidth + dx)), height: Math.max(4, Math.min(100 - item.y, annotationDrag.originalHeight + dy)) }; return { ...item, x: Math.max(0, Math.min(100 - item.width, annotationDrag.originalX + dx)), y: Math.max(0, Math.min(100 - item.height, annotationDrag.originalY + dy)) }; })); };
    const stop = () => setAnnotationDrag(null); window.addEventListener("pointermove", move); window.addEventListener("pointerup", stop); return () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", stop); };
  }, [annotationDrag]);
  function drawSignature(event) { const canvas = signCanvasRef.current; if (!canvas || !event.buttons) return; const rect = canvas.getBoundingClientRect(); const ctx = canvas.getContext("2d"); ctx.strokeStyle = "#162039"; ctx.lineWidth = 3; ctx.lineCap = "round"; ctx.lineTo((event.clientX - rect.left) * canvas.width / rect.width, (event.clientY - rect.top) * canvas.height / rect.height); ctx.stroke(); }
  function startSignature(event) { const canvas = signCanvasRef.current; const rect = canvas.getBoundingClientRect(); const ctx = canvas.getContext("2d"); ctx.beginPath(); ctx.moveTo((event.clientX - rect.left) * canvas.width / rect.width, (event.clientY - rect.top) * canvas.height / rect.height); }
  async function exportEditedPdf() { if (!editFile) return; const form = new FormData(); form.append("file", editFile); form.append("edits", JSON.stringify(annotations)); setStatus("Saving PDF edits..."); try { const response = await fetch(`${API}/api/edit-pdf`, { method: "POST", body: form }); if (!response.ok) throw new Error("Could not save PDF edits."); download(response, "edited.pdf"); setStatus("Edited PDF is ready."); } catch (error) { setStatus(error.message); } }
  async function convertToWord() { if (!wordFile) return; const form = new FormData(); form.append("file", wordFile); setStatus("Converting PDF to editable Word document..."); try { const response = await fetch(`${API}/api/pdf-to-docx`, { method: "POST", body: form }); if (!response.ok) throw new Error((await response.json().catch(() => ({}))).detail || "Could not convert PDF."); download(response, `${wordFile.name.replace(/\.pdf$/i, "") || "converted"}.docx`); setStatus("Editable Word document is ready."); } catch (error) { setStatus(error.message); } }
  function beginCrop(event, handle) {
    event.preventDefault(); event.stopPropagation();
    const bounds = stageRef.current?.getBoundingClientRect();
    if (!bounds || !selected) return;
    setCropDrag({ handle, startX: event.clientX, startY: event.clientY, bounds, crop: { ...selected.edit.crop } });
  }
  useEffect(() => {
    function moveCrop(event) {
      if (!cropDrag) return;
      const dx = (event.clientX - cropDrag.startX) / cropDrag.bounds.width * 100;
      const dy = (event.clientY - cropDrag.startY) / cropDrag.bounds.height * 100;
      const original = cropDrag.crop; let { x, y, width, height } = original;
      const h = cropDrag.handle;
      if (h === "move") { x = Math.max(0, Math.min(100 - width, original.x + dx)); y = Math.max(0, Math.min(100 - height, original.y + dy)); }
      if (h.includes("e")) width = Math.max(8, Math.min(100 - x, original.width + dx));
      if (h.includes("s")) height = Math.max(8, Math.min(100 - y, original.height + dy));
      if (h.includes("w")) { x = Math.max(0, Math.min(original.x + original.width - 8, original.x + dx)); width = original.x + original.width - x; }
      if (h.includes("n")) { y = Math.max(0, Math.min(original.y + original.height - 8, original.y + dy)); height = original.y + original.height - y; }
      updateEdit({ crop: { x, y, width, height } });
    }
    const endCrop = () => setCropDrag(null);
    window.addEventListener("pointermove", moveCrop); window.addEventListener("pointerup", endCrop);
    return () => { window.removeEventListener("pointermove", moveCrop); window.removeEventListener("pointerup", endCrop); };
  }, [cropDrag, selectedId]);
  async function exportPdf() {
    if (!images.length) return setStatus("Add at least one image first.");
    const form = new FormData(); images.forEach((image) => form.append("files", image.file)); form.append("layouts", JSON.stringify(images.map((image) => image.edit))); setStatus("Preparing your PDF...");
    try { const response = await fetch(`${API}/api/images-to-pdf`, { method: "POST", body: form }); if (!response.ok) throw new Error((await response.json().catch(() => ({}))).detail || "PDF export failed."); const url = URL.createObjectURL(await response.blob()); const link = document.createElement("a"); link.href = url; link.download = "image-pages.pdf"; link.click(); URL.revokeObjectURL(url); setStatus("Your PDF is ready."); } catch (error) { setStatus(error.message); }
  }
  const crop = selected?.edit.crop;
  return <div className="app">
    <header className="topbar"><div className="brand"><span className="brand-mark">P</span><span>Paperly</span></div><div className="header-actions">{tab === "images" && <><span className="count">{images.length} {images.length === 1 ? "image" : "images"}</span><button className="button export" onClick={exportPdf} disabled={!images.length}>Export PDF</button></>}</div></header>
    <main className="editor-shell"><nav className="tabs"><button className={tab === "images" ? "active" : ""} onClick={() => setTab("images")}>Images to PDF</button><button className={tab === "merge" ? "active" : ""} onClick={() => setTab("merge")}>Merge PDFs</button><button className={tab === "split" ? "active" : ""} onClick={() => setTab("split")}>Split PDF</button><button className={tab === "edit" ? "active" : ""} onClick={() => setTab("edit")}>Edit PDF</button><button className={tab === "word" ? "active" : ""} onClick={() => setTab("word")}>PDF to Word</button></nav>
      {tab === "images" && <><section className="editor-intro"><div><p className="eyebrow">IMAGE TO PDF</p><h1>Arrange your pages</h1><p>Drag thumbnails to change the PDF page order. Resize or move the crop box freely.</p></div><label className="button ghost">Upload images<input type="file" accept="image/*" multiple onChange={addImages} hidden /></label></section>
      {images.length === 0 ? <label className="upload-empty"><span className="upload-icon">↑</span><strong>Drop images here or choose files</strong><small>PNG, JPG, WEBP, and more</small><input type="file" accept="image/*" multiple onChange={addImages} hidden /></label> : <>
        <section className="canvas-card"><div className="canvas-toolbar"><span>Image editor</span><span className="hint">The complete image is shown here at its original proportions</span></div><div className="canvas"><div className="image-stage" ref={stageRef}><img className={`canvas-image filter-${selected.edit.filter}`} src={selected.url} alt={selected.file.name} /><div className="crop-box" onPointerDown={(event) => beginCrop(event, "move")} style={{ left: `${crop.x}%`, top: `${crop.y}%`, width: `${crop.width}%`, height: `${crop.height}%` }}>{HANDLES.map((handle) => <button key={handle} aria-label={`Resize crop ${handle}`} className={`crop-handle ${handle}`} onPointerDown={(event) => beginCrop(event, handle)} />)}</div></div></div>
          <div className="edit-panel"><div className="tool-group"><span className="tool-label">Crop</span><span className="crop-help">Drag inside to move · Drag dots to resize</span><button className="text-button" onClick={() => updateEdit({ crop: { x: 0, y: 0, width: 100, height: 100 } })}>Reset</button></div><div className="filter-section"><div className="tool-group filters"><span className="tool-label">Filters</span>{FILTERS.map((filter) => <button key={filter} onClick={() => updateEdit({ filter })} className={`filter-button ${selected.edit.filter === filter ? "active" : ""}`}>{filter}</button>)}</div><button className="apply-all" onClick={applyFilterToAll}>Apply current filter to all pages</button></div></div><div className="canvas-footer"><span>{selected.file.name}</span><button className="remove-selected" onClick={() => removeImage()}>Remove image</button></div></section>
        <section className="filmstrip" aria-label="Uploaded images">{images.map((image, index) => <button key={image.id} draggable className={`thumbnail ${image.id === selectedId ? "selected" : ""}`} onClick={() => setSelectedId(image.id)} onDragStart={() => setDragIndex(index)} onDragOver={(event) => event.preventDefault()} onDrop={() => reorder(index)} onDragEnd={() => setDragIndex(null)}><img src={image.url} alt={image.file.name} /><span>{index + 1}</span><i onClick={(event) => { event.stopPropagation(); removeImage(image.id); }}>×</i></button>)}<label className="add-more"><span>+</span><b>Add more</b><input type="file" accept="image/*" multiple onChange={addImages} hidden /></label></section>
      </>}</>}
      {tab === "merge" && <section className="tool-card"><h1>Merge PDFs</h1><p>Upload PDFs, then drag the cards to set the final page order.</p><label className="button ghost">Add PDFs<input type="file" accept="application/pdf" multiple onChange={addMergeFiles} hidden /></label><div className="file-strip">{mergeFiles.map((file, index) => <button key={`${file.name}-${index}`} draggable className="pdf-card" onDragStart={() => setMergeDragIndex(index)} onDragOver={(event) => event.preventDefault()} onDrop={() => reorderMerge(index)} onDragEnd={() => setMergeDragIndex(null)}><span>PDF</span><b>{index + 1}</b><small>{file.name}</small><i onClick={(event) => { event.stopPropagation(); setMergeFiles((current) => current.filter((_, item) => item !== index)); }}>×</i></button>)}{!mergeFiles.length && <div className="empty-inline">Add two or more PDF files to begin.</div>}</div><button className="button export" onClick={exportMerge} disabled={mergeFiles.length < 2}>Merge & export</button></section>}
      {tab === "split" && <section className="tool-card"><h1>Split PDF</h1><p>Choose one PDF, preview its pages, then export the page range you need.</p><label className="button ghost">Upload one PDF<input type="file" accept="application/pdf" onChange={loadSplitPdf} hidden /></label>{splitPages.length > 0 && <><div className="range-controls"><label>From <input type="number" min="1" max={splitPages.length} value={splitRange.start} onChange={(event) => setSplitRange((range) => ({ ...range, start: Math.max(1, Math.min(Number(event.target.value), range.end)) }))} /></label><label>To <input type="number" min="1" max={splitPages.length} value={splitRange.end} onChange={(event) => setSplitRange((range) => ({ ...range, end: Math.max(range.start, Math.min(Number(event.target.value), splitPages.length)) }))} /></label><button className="button export" onClick={exportSplit}>Export pages {splitRange.start}–{splitRange.end}</button></div><div className="page-grid">{splitPages.map((page) => <button key={page.number} className={`page-preview ${page.number >= splitRange.start && page.number <= splitRange.end ? "chosen" : ""}`} onClick={() => setSplitRange((range) => ({ ...range, end: page.number >= range.start ? page.number : range.end }))}><img src={previewUrl(page.preview)} alt={`Page ${page.number}`} /><span>Page {page.number}</span></button>)}</div></>}</section>}
      {tab === "edit" && <section className="tool-card"><h1>Edit PDF</h1><p>Add text, a hand-drawn signature, or an image; then move and resize it anywhere on any page.</p><div className="edit-actions"><label className="button ghost">Upload PDF<input type="file" accept="application/pdf" onChange={loadEditPdf} hidden /></label>{editPages.length > 0 && <><button className="button ghost" onClick={() => { setEditingText(true); setPlacingSignature(false); setPlacingImage(false); }}>Add text</button><button className="button ghost" onClick={() => signature ? (setPlacingSignature(true), setEditingText(false), setPlacingImage(false)) : setSigning(true)}>Add signature</button><label className="button ghost">Add image<input type="file" accept="image/*" onChange={chooseOverlayImage} hidden /></label><button className="button export" onClick={exportEditedPdf}>Save edited PDF</button></>}</div>{(editingText || placingSignature || placingImage) && <div className="annotation-notice">Click any PDF page to place the {editingText ? "text box" : placingSignature ? "signature" : "image"}. <button onClick={() => { setEditingText(false); setPlacingSignature(false); setPlacingImage(false); }}>Cancel</button></div>}{editPages.length > 0 && <div className="edit-page-list">{editPages.map((page) => <div className="edit-page" key={page.number} onClick={() => { if (editingText) { addText(page.number); setEditingText(false); } else if (placingSignature) { addSignature(page.number); setPlacingSignature(false); } else if (placingImage) { addOverlayImage(page.number); setPlacingImage(false); } }}><img src={previewUrl(page.preview)} alt={`Editable page ${page.number}`} />{annotations.filter((item) => item.page === page.number).map((item) => <div key={item.id} className={`annotation ${item.type}`} style={{ left: `${item.x}%`, top: `${item.y}%`, width: `${item.width}%`, height: `${item.height}%` }} onPointerDown={(event) => beginAnnotationDrag(event, item)}>{item.type === "text" ? <><textarea style={{ fontSize: `${item.fontSize || 14}px` }} value={item.content} onPointerDown={(event) => event.stopPropagation()} onClick={(event) => event.stopPropagation()} onChange={(event) => setAnnotations((items) => items.map((current) => current.id === item.id ? { ...current, content: event.target.value } : current))} /><label className="font-size" onPointerDown={(event) => event.stopPropagation()}>A <input aria-label="Text size" type="number" min="6" max="48" value={item.fontSize || 14} onChange={(event) => setAnnotations((items) => items.map((current) => current.id === item.id ? { ...current, fontSize: Number(event.target.value) } : current))} /></label></> : <img src={item.content} alt={item.type === "signature" ? "Signature" : "Placed image"} />}<button className="resize-annotation" aria-label="Resize" onPointerDown={(event) => beginAnnotationResize(event, item)} /><button className="delete-annotation" onClick={(event) => { event.stopPropagation(); setAnnotations((items) => items.filter((current) => current.id !== item.id)); }}>×</button></div>)}<span>Page {page.number}</span></div>)}</div>}{signing && <div className="signature-modal"><div><h2>Draw your signature</h2><canvas ref={signCanvasRef} width="600" height="220" onPointerDown={startSignature} onPointerMove={drawSignature} /><div><button className="button ghost" onClick={() => { const ctx = signCanvasRef.current.getContext("2d"); ctx.clearRect(0, 0, 600, 220); }}>Clear</button><button className="button export" onClick={() => { saveSignature(); setPlacingSignature(true); }}>Save signature</button></div></div></div>}</section>}
      {tab === "word" && <section className="tool-card word-tool"><h1>PDF to Word</h1><p>Convert a text-based PDF into a real, editable Microsoft Word document.</p><label className="upload-word"><strong>{wordFile ? wordFile.name : "Choose a PDF file"}</strong><small>{wordFile ? "Ready to convert" : "Text, basic fonts, images, and detected tables are retained when possible."}</small><input type="file" accept="application/pdf" onChange={(event) => setWordFile(event.target.files[0] || null)} hidden /></label>{wordFile && <button className="button export" onClick={convertToWord}>Convert & download DOCX</button>}<p className="conversion-note">The downloaded DOCX opens in Microsoft Word and remains editable. Complex, scanned, or highly positioned PDF layouts may need small final adjustments in Word.</p></section>}
    </main>{status && <div className="status">{status}</div>}
  </div>;
}
createRoot(document.getElementById("root")).render(<App />);
