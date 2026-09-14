import json
import base64
import os
import tempfile
from io import BytesIO
from typing import List

import fitz  # PyMuPDF
from PIL import Image, ImageEnhance, ImageOps
from docx import Document
from docx.enum.text import WD_BREAK
from docx.shared import Inches, Pt
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse

app = FastAPI(title="PDF Editor API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["https://pdf-edit-rosy.vercel.app"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/")
def root():
    return {"message": "PDF Editor API is running"}


@app.post("/api/images-to-pdf")
async def images_to_pdf(
    files: List[UploadFile] = File(...),
    layouts: str = Form("[]"),
):
    if not files:
        raise HTTPException(400, "No images uploaded.")

    try:
        layout_data = json.loads(layouts)
        if not isinstance(layout_data, list):
            raise ValueError
    except (json.JSONDecodeError, ValueError):
        raise HTTPException(400, "Invalid image layout data.")

    pdf = fitz.open()

    try:
        for index, upload in enumerate(files):
            data = await upload.read()
            try:
                image = Image.open(BytesIO(data))
                image.load()
            except Exception:
                raise HTTPException(400, f"{upload.filename} is not a valid image.")

            # Convert through PIL so formats such as WEBP/RGBA work reliably.
            if image.mode in ("RGBA", "LA"):
                background = Image.new("RGB", image.size, "white")
                background.paste(image, mask=image.getchannel("A"))
                image = background
            else:
                image = image.convert("RGB")

            edit = layout_data[index] if index < len(layout_data) else {}
            crop = edit.get("crop", {})
            crop_x = max(0, min(100, float(crop.get("x", 0))))
            crop_y = max(0, min(100, float(crop.get("y", 0))))
            crop_width = max(1, min(100 - crop_x, float(crop.get("width", 100))))
            crop_height = max(1, min(100 - crop_y, float(crop.get("height", 100))))
            left = round(image.width * crop_x / 100)
            top = round(image.height * crop_y / 100)
            right = round(image.width * (crop_x + crop_width) / 100)
            bottom = round(image.height * (crop_y + crop_height) / 100)
            image = image.crop((left, top, right, bottom))

            image_filter = edit.get("filter", "normal")
            if image_filter == "grayscale":
                image = ImageOps.grayscale(image).convert("RGB")
            elif image_filter == "sepia":
                grayscale = ImageOps.grayscale(image)
                image = ImageOps.colorize(grayscale, "#392916", "#e7c687")
            elif image_filter == "contrast":
                image = ImageEnhance.Contrast(image).enhance(1.32)
                image = ImageEnhance.Color(image).enhance(1.1)

            image_bytes = BytesIO()
            image.save(image_bytes, format="JPEG", quality=95)
            image_bytes = image_bytes.getvalue()

            # Choose A4 orientation from the image itself. This keeps landscape
            # images from getting large white top/bottom bands and portrait pages
            # from getting large white side bands, without distorting the image.
            page_width, page_height = (842, 595) if image.width >= image.height else (595, 842)
            margin = 12
            available_width = page_width - 2 * margin
            available_height = page_height - 2 * margin
            scale = min(available_width / image.width, available_height / image.height)
            draw_width = image.width * scale
            draw_height = image.height * scale
            x = (page_width - draw_width) / 2
            y = (page_height - draw_height) / 2
            page = pdf.new_page(width=page_width, height=page_height)
            page.insert_image(fitz.Rect(x, y, x + draw_width, y + draw_height), stream=image_bytes)

        output = pdf.tobytes()
        pdf.close()

        return StreamingResponse(
            BytesIO(output),
            media_type="application/pdf",
            headers={"Content-Disposition": "attachment; filename=images.pdf"},
        )
    except HTTPException:
        pdf.close()
        raise
    except Exception as exc:
        pdf.close()
        raise HTTPException(500, f"Could not create PDF: {exc}")


@app.post("/api/pdf-pages")
async def pdf_pages(file: UploadFile = File(...)):
    """Return lightweight page previews for the split-PDF picker."""
    data = await file.read()
    try:
        source = fitz.open(stream=data, filetype="pdf")
    except Exception:
        raise HTTPException(400, "Invalid PDF.")
    try:
        previews = []
        for index, page in enumerate(source):
            # This is the full edit canvas, not a tiny thumbnail. Render at a
            # higher resolution so text stays crisp when the page is displayed.
            pix = page.get_pixmap(matrix=fitz.Matrix(1.35, 1.35), alpha=False)
            previews.append({"number": index + 1, "preview": base64.b64encode(pix.tobytes("png")).decode("ascii")})
        return JSONResponse({"pageCount": source.page_count, "pages": previews})
    finally:
        source.close()


@app.post("/api/split-pdf")
async def split_pdf(file: UploadFile = File(...), start: int = Form(...), end: int = Form(...)):
    data = await file.read()
    try:
        source = fitz.open(stream=data, filetype="pdf")
    except Exception:
        raise HTTPException(400, "Invalid PDF.")
    try:
        if start < 1 or end < start or end > source.page_count:
            raise HTTPException(400, "Choose a valid page range.")
        result = fitz.open()
        result.insert_pdf(source, from_page=start - 1, to_page=end - 1)
        output = result.tobytes()
        result.close()
        return StreamingResponse(BytesIO(output), media_type="application/pdf", headers={"Content-Disposition": "attachment; filename=split-pages.pdf"})
    finally:
        source.close()


@app.post("/api/edit-pdf")
async def edit_pdf(
    file: UploadFile = File(...),
    edits: str = Form("[]"),
):
    data = await file.read()
    try:
        source = fitz.open(stream=data, filetype="pdf")
        annotations = json.loads(edits)
        if not isinstance(annotations, list):
            raise ValueError
    except Exception:
        raise HTTPException(400, "Invalid PDF or edit data.")
    try:
        for annotation in annotations:
            page_number = int(annotation.get("page", 0))
            if page_number < 1 or page_number > source.page_count:
                continue
            page = source[page_number - 1]
            rect = page.rect
            x = max(0, min(100, float(annotation.get("x", 10)))) / 100 * rect.width
            y = max(0, min(100, float(annotation.get("y", 10)))) / 100 * rect.height
            width = max(2, min(100, float(annotation.get("width", 25)))) / 100 * rect.width
            height = max(2, min(100, float(annotation.get("height", 8)))) / 100 * rect.height
            target = fitz.Rect(x, y, min(rect.width, x + width), min(rect.height, y + height))
            if annotation.get("type") == "text":
                font_size = max(6, min(48, float(annotation.get("fontSize", 14))))
                page.insert_textbox(target, str(annotation.get("content", "")), fontsize=font_size, color=(0.08, 0.12, 0.2), fontname="helv")
            elif annotation.get("type") in ("signature", "image"):
                signature = annotation.get("content", "")
                if signature.startswith("data:image"):
                    signature = signature.split(",", 1)[-1]
                try:
                    page.insert_image(target, stream=base64.b64decode(signature))
                except Exception:
                    continue
        output = source.tobytes()
        return StreamingResponse(BytesIO(output), media_type="application/pdf", headers={"Content-Disposition": "attachment; filename=edited.pdf"})
    finally:
        source.close()


@app.post("/api/pdf-to-docx")
async def pdf_to_docx(file: UploadFile = File(...)):
    """Create an editable Word document from a text-based PDF."""
    data = await file.read()
    try:
        source = fitz.open(stream=data, filetype="pdf")
    except Exception:
        raise HTTPException(400, "Invalid PDF.")

    document = Document()
    section = document.sections[0]
    section.top_margin = Inches(0.6)
    section.bottom_margin = Inches(0.6)
    section.left_margin = Inches(0.65)
    section.right_margin = Inches(0.65)
    temp_images = []
    try:
        for page_index, page in enumerate(source):
            # Preserve editable text and its basic span-level type styling.
            page_data = page.get_text("dict")
            for block in page_data["blocks"]:
                if block.get("type") != 0:
                    continue
                for line in block.get("lines", []):
                    paragraph = document.add_paragraph()
                    for span in line.get("spans", []):
                        run = paragraph.add_run(span.get("text", ""))
                        flags = span.get("flags", 0)
                        run.bold = bool(flags & 16)
                        run.italic = bool(flags & 2)
                        run.font.name = span.get("font", "Arial")
                        run.font.size = Pt(max(7, min(36, span.get("size", 11))))

            # Embed extractable raster images as editable Word image objects.
            for image_info in page.get_images(full=True):
                try:
                    image_data = source.extract_image(image_info[0])
                    suffix = image_data.get("ext", "png")
                    handle = tempfile.NamedTemporaryFile(delete=False, suffix=f".{suffix}")
                    handle.write(image_data["image"])
                    handle.close()
                    temp_images.append(handle.name)
                    document.add_picture(handle.name, width=Inches(5.8))
                except Exception:
                    continue

            # Convert detected ruled tables into native editable Word tables.
            try:
                for table_data in page.find_tables().tables:
                    rows = table_data.extract()
                    if not rows:
                        continue
                    table = document.add_table(rows=len(rows), cols=max(len(row) for row in rows))
                    table.style = "Table Grid"
                    for row_index, row in enumerate(rows):
                        for column_index, value in enumerate(row):
                            table.cell(row_index, column_index).text = value or ""
            except Exception:
                pass
            if page_index < source.page_count - 1:
                document.add_paragraph().add_run().add_break(WD_BREAK.PAGE)

        output = tempfile.NamedTemporaryFile(delete=False, suffix=".docx")
        output.close()
        document.save(output.name)
        with open(output.name, "rb") as generated:
            result = generated.read()
        os.unlink(output.name)
        return StreamingResponse(BytesIO(result), media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document", headers={"Content-Disposition": "attachment; filename=converted.docx"})
    except Exception as exc:
        raise HTTPException(500, f"Could not convert PDF to Word: {exc}")
    finally:
        source.close()
        for path in temp_images:
            if os.path.exists(path):
                os.unlink(path)


@app.post("/api/merge-pdfs")
async def merge_pdfs(files: List[UploadFile] = File(...)):
    if len(files) < 2:
        raise HTTPException(400, "Upload at least two PDF files.")

    result = fitz.open()

    try:
        for upload in files:
            data = await upload.read()
            try:
                source = fitz.open(stream=data, filetype="pdf")
            except Exception:
                raise HTTPException(400, f"{upload.filename} is not a valid PDF.")

            result.insert_pdf(source)
            source.close()

        output = result.tobytes()
        result.close()

        return StreamingResponse(
            BytesIO(output),
            media_type="application/pdf",
            headers={"Content-Disposition": "attachment; filename=merged.pdf"},
        )
    except HTTPException:
        result.close()
        raise
    except Exception as exc:
        result.close()
        raise HTTPException(500, f"Could not merge PDFs: {exc}")


@app.post("/api/reorder-pdf")
async def reorder_pdf(
    file: UploadFile = File(...),
    order: str = "",
):
    """
    order example: "2,0,1"
    Creates a new PDF using the requested zero-based page order.
    """
    data = await file.read()

    try:
        source = fitz.open(stream=data, filetype="pdf")
    except Exception:
        raise HTTPException(400, "Invalid PDF.")

    try:
        indexes = [int(x.strip()) for x in order.split(",") if x.strip() != ""]
        if not indexes:
            raise HTTPException(400, "Page order is empty.")
        if sorted(indexes) != list(range(source.page_count)):
            raise HTTPException(
                400,
                "Order must contain every page exactly once."
            )

        result = fitz.open()
        for index in indexes:
            result.insert_pdf(source, from_page=index, to_page=index)

        output = result.tobytes()
        result.close()
        source.close()

        return StreamingResponse(
            BytesIO(output),
            media_type="application/pdf",
            headers={"Content-Disposition": "attachment; filename=reordered.pdf"},
        )
    except HTTPException:
        source.close()
        raise
    except Exception as exc:
        source.close()
        raise HTTPException(500, f"Could not reorder PDF: {exc}")
