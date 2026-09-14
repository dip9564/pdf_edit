# PDF Editor Web App - V1

A simple web app for:
- Uploading multiple images and converting them into a PDF
- Reordering pages with drag and drop
- Deleting pages
- Uploading multiple PDFs
- Merging PDFs
- Downloading the resulting PDF

## Requirements

- Python 3.10+
- Node.js 18+
- npm

## Backend

```bash
cd backend
python -m venv .venv
# macOS/Linux:
source .venv/bin/activate
# Windows:
# .venv\Scripts\activate

pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

Backend runs at http://localhost:8000

## Frontend

Open another terminal:

```bash
cd frontend
npm install
npm run dev
```

Open the URL shown by Vite, normally http://localhost:5173

## Notes

This is an MVP. Text editing inside an existing PDF is not included yet.
The next stage can add PDF preview, text boxes, annotations, rotation, and more advanced editing.
